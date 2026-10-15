// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Environment for git that ignores system and user configuration. */
export function isolatedGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: isolatedGitEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

export type WorkspaceOptions = {
  /** Git bundle with the default branch. */
  bundlePath: string;
  /** Directory to create the working copy in. */
  dir: string;
  defaultBranch: string;
  baseSha: string;
  branch: string;
  authorName: string;
  authorEmail: string;
};

/** Clones the repository from the bundle and creates the work branch. */
export async function prepareWorkspace(options: WorkspaceOptions): Promise<void> {
  await run("git", ["clone", "--quiet", "--branch", options.defaultBranch, options.bundlePath, options.dir], {
    env: isolatedGitEnv(),
  });
  await git(options.dir, ["checkout", "--quiet", "-B", options.branch, options.baseSha]);
  await git(options.dir, ["config", "user.name", options.authorName]);
  await git(options.dir, ["config", "user.email", options.authorEmail]);
  await git(options.dir, ["remote", "remove", "origin"]);
}

/** True when the working tree has changes that are not committed. */
export async function hasChanges(dir: string): Promise<boolean> {
  return (await git(dir, ["status", "--porcelain"])).trim().length > 0;
}

/** Commits every change in the working tree, if there are any. */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  if (!(await hasChanges(dir))) return false;
  await git(dir, ["add", "--all"]);
  await git(dir, ["commit", "--quiet", "--no-verify", "--message", message]);
  return true;
}

export async function headSha(dir: string): Promise<string> {
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

/** Number of commits on the branch that are not on the base. */
export async function commitCount(dir: string, baseSha: string): Promise<number> {
  return Number((await git(dir, ["rev-list", "--count", `${baseSha}..HEAD`])).trim());
}

/** Writes the branch to a git bundle. */
export async function bundleBranch(dir: string, branch: string, outFile: string): Promise<void> {
  await git(dir, ["bundle", "create", "--quiet", outFile, branch]);
}
