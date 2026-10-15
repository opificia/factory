// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { decideHost, isPublicAddress, matchesList, normalizeHost } from "./egress-policy.js";

const decide = (host: string, level: "none" | "registries" | "open" = "registries", port = 443, extraHosts: string[] = []) =>
  decideHost({ host, port, level, extraHosts });

describe("decideHost", () => {
  it("allows the built-in registries at the default level", () => {
    expect(decide("registry.npmjs.org")).toMatchObject({ allowed: true });
    expect(decide("REGISTRY.npmjs.org.")).toMatchObject({ allowed: true });
    expect(decide("files.pythonhosted.org")).toMatchObject({ allowed: true });
  });

  it("refuses everything at level none", () => {
    expect(decide("registry.npmjs.org", "none")).toEqual({ allowed: false, reason: "the network level is none" });
  });

  it("refuses unknown hosts at the default level, unless the operator allows them", () => {
    expect(decide("example.org")).toMatchObject({ allowed: false });
    expect(decide("binaries.prisma.sh", "registries", 443, ["binaries.prisma.sh"])).toMatchObject({ allowed: true });
    expect(decide("cdn.example.org", "registries", 443, [".example.org"])).toMatchObject({ allowed: true });
    expect(decide("example.org.evil.test", "registries", 443, [".example.org"])).toMatchObject({ allowed: false });
  });

  it("does not let look-alike hosts pass as registries", () => {
    expect(decide("registry.npmjs.org.evil.test")).toMatchObject({ allowed: false });
    expect(decide("evil-registry.npmjs.org")).toMatchObject({ allowed: false });
    expect(decide("gist.github.com")).toMatchObject({ allowed: false });
  });

  it("refuses the deny list at every level, even when the operator allows it", () => {
    expect(decide("webhook.site", "open")).toMatchObject({ allowed: false, reason: "the host is on the deny list" });
    expect(decide("abc.trycloudflare.com", "open")).toMatchObject({ allowed: false });
    expect(decide("api.anthropic.com", "open", 443, ["api.anthropic.com"])).toMatchObject({ allowed: false });
  });

  it("allows other hosts at level open", () => {
    expect(decide("example.org", "open")).toMatchObject({ allowed: true, reason: "the network level is open" });
  });

  it("refuses IP addresses, invalid names and ports other than 443", () => {
    expect(decide("140.82.112.3", "open")).toMatchObject({ allowed: false });
    expect(decide("[::1]", "open")).toMatchObject({ allowed: false });
    expect(decide("localhost", "open")).toMatchObject({ allowed: false });
    expect(decide("gateway", "open")).toMatchObject({ allowed: false });
    expect(decide("registry.npmjs.org", "registries", 22)).toMatchObject({ allowed: false });
    expect(decide("registry.npmjs.org", "registries", 80)).toMatchObject({ allowed: false });
  });
});

describe("normalizeHost and matchesList", () => {
  it("normalizes host names", () => {
    expect(normalizeHost(" GitHub.com. ")).toBe("github.com");
    expect(normalizeHost("a_b.example.org")).toBeUndefined();
    expect(normalizeHost("")).toBeUndefined();
  });

  it("matches exact entries and dot entries", () => {
    expect(matchesList("example.org", [".example.org"])).toBe(true);
    expect(matchesList("a.b.example.org", [".example.org"])).toBe(true);
    expect(matchesList("notexample.org", [".example.org"])).toBe(false);
    expect(matchesList("a.example.org", ["example.org"])).toBe(false);
  });
});

describe("isPublicAddress", () => {
  it("accepts public addresses", () => {
    expect(isPublicAddress("104.16.0.35")).toBe(true);
    expect(isPublicAddress("2606:4700::6810:84e5")).toBe(true);
  });

  it("refuses private, loopback, link-local, metadata and mapped addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.17.0.1",
      "192.168.65.254",
      "169.254.169.254",
      "100.100.100.200",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:8.8.8.8",
      "not an address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});
