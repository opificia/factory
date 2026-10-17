// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { EgressAllow, SandboxPodSettings } from "./config.js";

const messages = (value: string) => {
  const result = EgressAllow.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("EgressAllow", () => {
  it("accepts host names and normalises them", () => {
    expect(EgressAllow.parse("example.org, binaries.prisma.sh")).toEqual(["example.org", "binaries.prisma.sh"]);
    expect(EgressAllow.parse(" Example.ORG. ")).toEqual(["example.org"]);
  });

  it("accepts an entry with a leading dot", () => {
    expect(EgressAllow.parse(".example.org")).toEqual([".example.org"]);
  });

  it("accepts an empty value", () => {
    expect(EgressAllow.parse("")).toEqual([]);
    expect(EgressAllow.parse(" , ")).toEqual([]);
    expect(EgressAllow.parse(undefined)).toEqual([]);
  });

  it.each(["https://example.org", "example.org:443", "*.example.org"])("rejects %s", (entry) => {
    const [message, ...rest] = messages(entry);
    expect(rest).toEqual([]);
    expect(message).toContain(`"${entry}"`);
    expect(message).toContain('"example.org"');
  });

  it("names only the invalid entry in a mixed list", () => {
    const found = messages("example.org,https://bad.example");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("https://bad.example");
    expect(found[0]).not.toContain('"example.org" is not');
  });
});

describe("SandboxPodSettings", () => {
  it("accepts tolerations with Kubernetes' fields", () => {
    const toleration = { key: "opificia.ai/sandbox", operator: "Exists", effect: "NoSchedule" };
    expect(SandboxPodSettings.parse(JSON.stringify({ tolerations: [toleration] })).tolerations).toEqual([toleration]);
  });

  it("rejects a toleration with a misspelt field or value", () => {
    expect(SandboxPodSettings.safeParse(JSON.stringify({ tolerations: [{ key: "a", operatr: "Exists" }] })).success).toBe(false);
    expect(SandboxPodSettings.safeParse(JSON.stringify({ tolerations: [{ key: "a", effect: "NoSchedul" }] })).success).toBe(false);
  });
});
