// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { CheckFinding } from "@opificia/contracts";
import { describe, expect, it } from "vitest";
import { RULE_LABEL, problems, ruleLabel } from "./checks.ts";

describe("ruleLabel", () => {
  it("has a plain label for every rule", () => {
    for (const rule of CheckFinding.shape.rule.options) {
      expect(RULE_LABEL[rule]).toBeTruthy();
      expect(RULE_LABEL[rule]).not.toContain("_");
    }
  });

  it("starts with a capital letter", () => {
    expect(ruleLabel("protected_path")).toBe("Protected path");
  });
});

describe("problems", () => {
  it("counts in the singular and the plural", () => {
    expect(problems(1)).toBe("1 problem");
    expect(problems(2)).toBe("2 problems");
  });
});
