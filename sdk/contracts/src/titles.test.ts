// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { conventionalTitle, isConventionalTitle } from "./titles.js";

describe("isConventionalTitle", () => {
  it("accepts what the CI check accepts", () => {
    expect(isConventionalTitle("feat: add x")).toBe(true);
    expect(isConventionalTitle("fix(server): handle a timeout")).toBe(true);
    expect(isConventionalTitle("feat!: drop y")).toBe(true);
  });

  it("refuses what the CI check refuses", () => {
    expect(isConventionalTitle("Add x")).toBe(false);
    expect(isConventionalTitle("feat: add x.")).toBe(false);
    expect(isConventionalTitle("feat:  add x")).toBe(false);
    expect(isConventionalTitle("feature: add x")).toBe(false);
    expect(isConventionalTitle(`feat: ${"x".repeat(101)}`)).toBe(false);
    expect(isConventionalTitle("feat(Server): add x")).toBe(false);
  });
});

describe("conventionalTitle", () => {
  it("keeps a valid candidate", () => {
    expect(conventionalTitle(" fix(web): show the error ", "Whatever")).toBe("fix(web): show the error");
  });

  it("falls back to a valid issue title, then to chore", () => {
    expect(conventionalTitle("Not a title", "docs: fix a link")).toBe("docs: fix a link");
    expect(conventionalTitle(undefined, "Show the run cost on the run page.")).toBe("chore: Show the run cost on the run page");
    expect(conventionalTitle("", "  ")).toBe("chore: update the repository");
  });

  it("always returns a valid title", () => {
    for (const fallback of ["A\nmultiline\ntitle...", "x".repeat(300), "Ends with dots ...", "é"]) {
      expect(isConventionalTitle(conventionalTitle(undefined, fallback)), fallback).toBe(true);
    }
  });
});
