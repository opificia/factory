// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEFAULT_PROTECTED_PATHS } from "@opificia/contracts";
import { protectedPathHook, protectedPathViolation } from "./guard.js";

const repo = "/work/repo";

describe("protectedPathViolation", () => {
  it("blocks edits to workflows and agent instructions", () => {
    expect(protectedPathViolation("Write", { file_path: "/work/repo/.github/workflows/ci.yml" }, repo, DEFAULT_PROTECTED_PATHS)).toMatch(/protected/);
    expect(protectedPathViolation("Edit", { file_path: "AGENTS.md" }, repo, DEFAULT_PROTECTED_PATHS)).toMatch(/protected/);
    expect(protectedPathViolation("NotebookEdit", { notebook_path: "/work/repo/.claude/x.ipynb" }, repo, DEFAULT_PROTECTED_PATHS)).toMatch(/protected/);
  });

  it("blocks paths outside the repository", () => {
    expect(protectedPathViolation("Write", { file_path: "/etc/passwd" }, repo, DEFAULT_PROTECTED_PATHS)).toMatch(/outside/);
    expect(protectedPathViolation("Write", { file_path: "../x" }, repo, DEFAULT_PROTECTED_PATHS)).toMatch(/outside/);
  });

  it("allows ordinary edits and other tools", () => {
    expect(protectedPathViolation("Edit", { file_path: "/work/repo/src/text.ts" }, repo, DEFAULT_PROTECTED_PATHS)).toBeUndefined();
    expect(protectedPathViolation("Read", { file_path: "/work/repo/AGENTS.md" }, repo, DEFAULT_PROTECTED_PATHS)).toBeUndefined();
  });
});

describe("protectedPathHook", () => {
  it("returns a deny decision", async () => {
    const hook = protectedPathHook(repo, DEFAULT_PROTECTED_PATHS);
    const output = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/work/repo/CLAUDE.md" },
        tool_use_id: "t1",
        session_id: "s",
        transcript_path: "/tmp/t",
        cwd: repo,
      } as never,
      "t1",
      { signal: new AbortController().signal },
    );
    expect(output).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });
});
