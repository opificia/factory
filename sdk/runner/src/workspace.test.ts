// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleBranch, commitAll, git, headSha, prepareWorkspace } from "./workspace.js";

let dir: string;
let source: string;
let baseSha: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "opificia-workspace-"));
  source = join(dir, "source");
  await git(dir, ["init", "--quiet", "--initial-branch", "main", source]);
  // A large file in the history, which the result bundle must not repeat.
  // Random bytes, because git would compress anything regular to nothing.
  await writeFile(join(source, "big.bin"), randomBytes(200_000));
  await git(source, ["add", "--all"]);
  await git(source, ["-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "--quiet", "--message", "base"]);
  baseSha = (await git(source, ["rev-parse", "HEAD"])).trim();
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("bundles in the workspace", () => {
  it("clones from the input bundle, removes it, and returns only the new commits", async () => {
    // As the server writes it (bundleForSandbox in apps/server/src/github/git.ts).
    const input = join(dir, "repo.bundle");
    await git(source, ["bundle", "create", "--quiet", input, "refs/heads/main"]);
    expect((await stat(input)).size).toBeGreaterThan(150_000);
    const repo = join(dir, "work");
    await prepareWorkspace({ bundlePath: input, dir: repo, defaultBranch: "main", baseSha, branch: "opificia/1", authorName: "a", authorEmail: "a@example.org" });
    expect(existsSync(input)).toBe(false);

    await writeFile(join(repo, "change.txt"), "a change");
    await commitAll(repo, "feat: a change");
    const head = await headSha(repo);
    const output = join(dir, "result.bundle");
    await bundleBranch(repo, "opificia/1", baseSha, output);
    expect((await stat(output)).size).toBeLessThan(10_000);

    // As the server loads it (loadResult): the base first, then the bundle.
    const check = join(dir, "check.git");
    await git(dir, ["init", "--quiet", "--bare", check]);
    await git(check, ["fetch", "--quiet", source, "+refs/heads/main:refs/base/main"]);
    await git(check, ["bundle", "verify", "--quiet", output]);
    await git(check, ["fetch", "--quiet", output, "+refs/heads/opificia/1:refs/heads/opificia/1"]);
    expect((await git(check, ["rev-parse", "refs/heads/opificia/1"])).trim()).toBe(head);
  });
});
