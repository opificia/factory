// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { DEFAULT_PROTECTED_PATHS } from "@opificia/contracts";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  checkChange,
  parseAddedLines,
  parseNumstat,
  parseRawModes,
  type ChangeSummary,
} from "./checker.js";

const limits = { ...DEFAULT_LIMITS, protectedPaths: DEFAULT_PROTECTED_PATHS };
const file = (path: string, extra: Partial<ChangeSummary["files"][number]> = {}) => ({
  path,
  additions: 1,
  deletions: 0,
  binary: false,
  mode: "100644",
  ...extra,
});

describe("checkChange", () => {
  it("passes an ordinary change", () => {
    const change: ChangeSummary = {
      files: [file("src/text.ts"), file("src/text.test.ts")],
      addedLines: [{ path: "src/text.ts", text: "export const x = 1;" }],
      basedOnBase: true,
    };
    expect(checkChange(change, limits)).toEqual([]);
  });

  it("finds changes to protected paths, including renames away from them", () => {
    const findings = checkChange(
      {
        files: [file(".github/workflows/ci.yml"), file("docs/agents.md", { oldPath: "AGENTS.md" })],
        addedLines: [],
        basedOnBase: true,
      },
      limits,
    );
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      ["protected_path", ".github/workflows/ci.yml"],
      ["protected_path", "AGENTS.md"],
    ]);
  });

  it("finds secrets and hidden characters in added lines", () => {
    const findings = checkChange(
      {
        files: [file("a.ts"), file("b.ts")],
        addedLines: [
          { path: "a.ts", text: `const key = "sk-ant-${"x".repeat(30)}";` },
          { path: "a.ts", text: `const again = "sk-ant-${"y".repeat(30)}";` },
          { path: "b.ts", text: "if (isAdmin‮) {" },
          { path: "b.ts", text: "-----BEGIN RSA " + "PRIVATE KEY-----" },
        ],
        basedOnBase: true,
      },
      limits,
    );
    expect(findings.map((f) => f.rule).sort()).toEqual(["hidden_unicode", "secret", "secret"]);
    expect(findings.find((f) => f.rule === "hidden_unicode")?.message).toContain("U+202E");
  });

  it("finds hidden characters in file names", () => {
    const findings = checkChange({ files: [file("src/admin\u202E.ts")], addedLines: [], basedOnBase: true }, limits);
    expect(findings).toEqual([expect.objectContaining({ rule: "hidden_unicode" })]);
  });

  it("finds tag characters used to smuggle text", () => {
    const findings = checkChange(
      { files: [file("a.md")], addedLines: [{ path: "a.md", text: "hello\u{E0041}" }], basedOnBase: true },
      limits,
    );
    expect(findings).toHaveLength(1);
  });

  it("enforces size limits, submodules and history", () => {
    const many = Array.from({ length: 51 }, (_, i) => file(`f${i}.ts`, { additions: 50 }));
    const findings = checkChange(
      { files: [...many, file("vendor/lib", { mode: "160000" })], addedLines: [], basedOnBase: false },
      limits,
    );
    expect(findings.map((f) => f.rule).sort()).toEqual(["history", "size", "size", "submodule"]);
  });
});

describe("git output parsers", () => {
  it("parses numstat with renames and binary files", () => {
    const out = "3\t1\tsrc/a.ts\0-\t-\timg.png\x002\t0\t\0old.ts\0new.ts\0";
    expect(parseNumstat(out)).toEqual([
      { path: "src/a.ts", additions: 3, deletions: 1, binary: false },
      { path: "img.png", additions: 0, deletions: 0, binary: true },
      { path: "new.ts", oldPath: "old.ts", additions: 2, deletions: 0, binary: false },
    ]);
  });

  it("parses raw modes", () => {
    const out =
      ":100644 100644 aaa bbb M\0src/a.ts\0:000000 160000 000 ccc A\0vendor/lib\0:100644 100644 ddd eee R100\0old.ts\0new.ts\0";
    const modes = parseRawModes(out);
    expect(modes.get("src/a.ts")).toBe("100644");
    expect(modes.get("vendor/lib")).toBe("160000");
    expect(modes.get("new.ts")).toBe("100644");
  });

  it("collects added lines per file", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1,2 @@",
      "+one",
      "+two",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "-removed",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { path: "a.ts", text: "one" },
      { path: "a.ts", text: "two" },
    ]);
  });
});
