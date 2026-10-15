// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { splitTitle, systemAppend } from "./prompts.js";

describe("splitTitle", () => {
  it("takes the title from the first line", () => {
    expect(splitTitle("Title: fix(server): retry a poll\n\n## What changed\n- x")).toEqual({
      title: "fix(server): retry a poll",
      description: "## What changed\n- x",
    });
  });

  it("accepts bold or code formatting around the title", () => {
    expect(splitTitle("\n**Title:** `feat: add x`\n\nBody").title).toBe("feat: add x");
  });

  it("removes attribution lines a model adds out of habit", () => {
    const reply = "Title: feat: add x\n\n## What changed\n- x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\nCo-Authored-By: Claude <noreply@anthropic.com>";
    expect(splitTitle(reply).description).toBe("## What changed\n- x");
  });

  it("keeps the whole reply when there is no title line", () => {
    expect(splitTitle("## What changed\n- x")).toEqual({ title: undefined, description: "## What changed\n- x" });
  });
});

describe("systemAppend", () => {
  it("describes the network level", () => {
    expect(systemAppend("none")).toContain("There is no internet access");
    expect(systemAppend("registries")).toContain("package registries");
    expect(systemAppend("registries")).toContain("Never commit");
  });
});
