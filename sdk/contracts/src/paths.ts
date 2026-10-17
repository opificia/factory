// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Paths an agent must not change: CI workflows and scripts, the git hooks
 * contributors install, code owners, the list of maintainers who may sign off
 * (ADR-0011) and the files that instruct agents. The harness blocks edits to
 * them, and the control plane checks the result again before it pushes.
 */
export const DEFAULT_PROTECTED_PATHS: readonly string[] = [
  ".github/workflows/**",
  ".github/actions/**",
  ".github/scripts/**",
  ".githooks/**",
  "CODEOWNERS",
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
  "MAINTAINERS.md",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  ".mcp.json",
  ".claude/**",
  ".gitmodules",
];

const cache = new Map<string, RegExp>();

/** Turns a glob with `*`, `**` and `?` into a regular expression. */
export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const re = new RegExp(`^${out}$`);
  cache.set(pattern, re);
  return re;
}

/** Normalises a repository-relative path: no leading `./` or `/`, forward slashes. */
export function normaliseRepoPath(path: string): string {
  let p = path.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  while (p.startsWith("/")) p = p.slice(1);
  return p;
}

/** Returns the first protected pattern that matches the path, if any. */
export function matchProtectedPath(path: string, patterns: readonly string[]): string | undefined {
  const p = normaliseRepoPath(path);
  return patterns.find((pattern) => globToRegExp(pattern).test(p));
}
