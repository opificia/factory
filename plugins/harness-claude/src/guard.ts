// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { relative, resolve, isAbsolute } from "node:path";
import { matchProtectedPath } from "@opificia/contracts";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Paths that a file tool call would change, relative to the repository. */
export function targetPaths(toolName: string, toolInput: unknown, repoDir: string): string[] {
  if (!FILE_TOOLS.has(toolName) || typeof toolInput !== "object" || toolInput === null) return [];
  const input = toolInput as Record<string, unknown>;
  const raw = input.file_path ?? input.notebook_path;
  if (typeof raw !== "string") return [];
  const absolute = isAbsolute(raw) ? raw : resolve(repoDir, raw);
  return [relative(repoDir, absolute)];
}

/**
 * Decides whether a tool call may run. Returns a reason when it must not.
 * The control plane checks the result again, so this is a first line only.
 */
export function protectedPathViolation(
  toolName: string,
  toolInput: unknown,
  repoDir: string,
  patterns: readonly string[],
): string | undefined {
  for (const path of targetPaths(toolName, toolInput, repoDir)) {
    if (path.startsWith("..")) return `${path} is outside the repository`;
    const pattern = matchProtectedPath(path, patterns);
    if (pattern) return `${path} is protected (${pattern}); Opificia does not let agents change it`;
  }
  return undefined;
}

/** A PreToolUse hook that blocks edits to protected paths. */
export function protectedPathHook(repoDir: string, patterns: readonly string[]): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const reason = protectedPathViolation(input.tool_name, input.tool_input, repoDir, patterns);
    if (!reason) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  };
}
