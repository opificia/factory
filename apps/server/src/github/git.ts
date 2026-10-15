// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Git on the control plane. It works only in bare repositories that Opificia
 * owns, with hooks and the user's git configuration switched off. It never
 * checks out files an agent wrote. Tokens reach git through the environment,
 * not the command line or a credential helper.
 */

import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChangeSummary } from "../checks/checker.js";
import { parseAddedLines, parseNumstat, parseRawModes } from "../checks/checker.js";

const run = promisify(execFile);

function gitEnv(token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
  };
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    Object.assign(env, {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: "",
    });
  }
  return env;
}

export async function git(cwd: string, args: string[], token?: string): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.file.allow=always", ...args], {
    cwd,
    env: gitEnv(token),
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function initBare(dir: string): Promise<void> {
  if (await exists(join(dir, "HEAD"))) return;
  await mkdir(dir, { recursive: true });
  await git(dir, ["init", "--quiet", "--bare"]);
}

const remoteUrl = (fullName: string) => `https://github.com/${fullName}.git`;

/** Fetches the default branch into the cache and returns its commit. */
export async function updateCache(cacheDir: string, fullName: string, branch: string, token: string): Promise<string> {
  await initBare(cacheDir);
  await git(cacheDir, ["fetch", "--quiet", "--prune", remoteUrl(fullName), `+refs/heads/${branch}:refs/heads/${branch}`], token);
  return (await git(cacheDir, ["rev-parse", `refs/heads/${branch}`])).trim();
}

/** Writes the default branch, including `baseSha`, to a bundle for a sandbox. */
export async function bundleForSandbox(cacheDir: string, branch: string, baseSha: string, outFile: string): Promise<void> {
  await git(cacheDir, ["cat-file", "-e", `${baseSha}^{commit}`]);
  await git(cacheDir, ["bundle", "create", "--quiet", outFile, `refs/heads/${branch}`]);
}

/**
 * Loads an agent's bundle into a fresh bare repository next to the base, and
 * summarises the change for the checker.
 */
export async function loadResult(input: {
  checkDir: string;
  cacheDir: string;
  defaultBranch: string;
  baseSha: string;
  bundleFile: string;
  branch: string;
  headSha: string;
}): Promise<ChangeSummary> {
  const { checkDir, branch, baseSha, headSha } = input;
  await initBare(checkDir);
  await git(checkDir, ["fetch", "--quiet", input.cacheDir, `+refs/heads/${input.defaultBranch}:refs/base/${input.defaultBranch}`]);
  await git(checkDir, ["bundle", "verify", "--quiet", input.bundleFile]);
  await git(checkDir, ["fetch", "--quiet", input.bundleFile, `+refs/heads/${branch}:refs/heads/${branch}`]);
  const head = (await git(checkDir, ["rev-parse", `refs/heads/${branch}`])).trim();
  if (head !== headSha) throw new Error(`the bundle's branch is at ${head}, but the runner reported ${headSha}`);

  const basedOnBase = await git(checkDir, ["merge-base", "--is-ancestor", baseSha, head]).then(
    () => true,
    () => false,
  );
  const range = [baseSha, head];
  const numstat = parseNumstat(await git(checkDir, ["diff", "--numstat", "-z", "-M", ...range]));
  const modes = parseRawModes(await git(checkDir, ["diff", "--raw", "-z", "-M", ...range]));
  const addedLines = parseAddedLines(await git(checkDir, ["diff", "--unified=0", "--no-color", "--no-ext-diff", "-M", ...range]));
  return {
    files: numstat.map((f) => ({ ...f, mode: modes.get(f.path) ?? "100644" })),
    addedLines,
    basedOnBase,
  };
}

/** Pushes the checked commit to a new branch on GitHub. */
export async function pushBranch(checkDir: string, fullName: string, headSha: string, branch: string, token: string): Promise<void> {
  await git(checkDir, ["push", "--quiet", remoteUrl(fullName), `${headSha}:refs/heads/${branch}`], token);
}
