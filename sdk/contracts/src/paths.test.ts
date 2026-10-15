// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEFAULT_PROTECTED_PATHS, globToRegExp, matchProtectedPath } from "./paths.js";

describe("globToRegExp", () => {
  it("matches a single segment with *", () => {
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  });

  it("matches any depth with **", () => {
    expect(globToRegExp(".github/workflows/**").test(".github/workflows/ci.yml")).toBe(true);
    expect(globToRegExp(".github/workflows/**").test(".github/workflows/x/y.yml")).toBe(true);
    expect(globToRegExp("**/AGENTS.md").test("AGENTS.md")).toBe(true);
    expect(globToRegExp("**/AGENTS.md").test("a/b/AGENTS.md")).toBe(true);
    expect(globToRegExp("**/AGENTS.md").test("NOTAGENTS.md")).toBe(false);
  });

  it("escapes regular expression characters", () => {
    expect(globToRegExp(".mcp.json").test("xmcpxjson")).toBe(false);
  });
});

describe("matchProtectedPath", () => {
  it("protects workflows, scripts, git hooks, agent instructions, code owners and maintainers", () => {
    for (const p of [
      ".github/workflows/release.yml",
      ".github/scripts/signoff.sh",
      ".githooks/pre-push",
      "MAINTAINERS.md",
      "./AGENTS.md",
      "/CLAUDE.md",
      "packages/x/CLAUDE.md",
      ".claude/settings.json",
      "CODEOWNERS",
      ".gitmodules",
    ]) {
      expect(matchProtectedPath(p, DEFAULT_PROTECTED_PATHS), p).toBeDefined();
    }
  });

  it("allows ordinary source files", () => {
    for (const p of ["src/text.ts", "README.md", ".github/ISSUE_TEMPLATE/bug.md", "docs/githooks.md"]) {
      expect(matchProtectedPath(p, DEFAULT_PROTECTED_PATHS), p).toBeUndefined();
    }
  });
});
