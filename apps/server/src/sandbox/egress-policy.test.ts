// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { EgressBudget, decideHost, isPublicAddress, matchesList, normalizeHost } from "./egress-policy.js";

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

  it("allows GitHub's download hosts but not the forges, which accept pushes", () => {
    expect(decide("codeload.github.com")).toMatchObject({ allowed: true });
    for (const forge of ["github.com", "gitlab.com", "codeberg.org"]) {
      expect(decide(forge), forge).toMatchObject({ allowed: false });
    }
    expect(decide("github.com", "registries", 443, ["github.com"])).toMatchObject({ allowed: true });
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

describe("EgressBudget", () => {
  const limits = { maxOpen: 2, maxTotal: 3, maxSentPerConnection: 100, maxSentPerSession: 150 };

  it("limits open and total connections", () => {
    const budget = new EgressBudget(limits);
    expect(budget.openConnection().ok).toBe(true);
    expect(budget.openConnection().ok).toBe(true);
    expect(budget.openConnection()).toMatchObject({ ok: false, reason: "the session has 2 connections open" });
    budget.closeConnection();
    expect(budget.openConnection().ok).toBe(true);
    budget.closeConnection();
    expect(budget.openConnection()).toMatchObject({ ok: false, reason: "the session has used its 3 connections" });
  });

  it("limits bytes sent per connection and per session", () => {
    const budget = new EgressBudget(limits);
    expect(budget.addSent(90, 90)).toBeUndefined();
    expect(budget.addSent(20, 110)).toBe("the connection sent more than 100 bytes");
    expect(budget.addSent(30, 30)).toBeUndefined();
    expect(budget.addSent(20, 50)).toBe("the session sent more than 150 bytes");
  });

  it("lets a new connection wait for a free one instead of refusing it", async () => {
    const budget = new EgressBudget({ ...limits, maxTotal: 10 });
    budget.openConnection();
    budget.openConnection();
    const waiting = budget.waitForConnection(1000);
    setTimeout(() => budget.closeConnection(), 10);
    expect(await waiting).toEqual({ ok: true });
  });

  it("gives up when no connection closes in time, or when the wait is cancelled", async () => {
    const budget = new EgressBudget({ ...limits, maxTotal: 10 });
    budget.openConnection();
    budget.openConnection();
    expect(await budget.waitForConnection(20)).toMatchObject({ ok: false, reason: "the session has 2 connections open and none closed within 0 s" });
    const cancel = new AbortController();
    const waiting = budget.waitForConnection(1000, cancel.signal);
    cancel.abort();
    expect(await waiting).toMatchObject({ ok: false });
    // A cancelled wait does not take the next free connection.
    budget.closeConnection();
    expect(budget.openConnection().ok).toBe(true);
  });

  it("does not wait when the session has used all its connections", async () => {
    const budget = new EgressBudget(limits);
    for (let i = 0; i < 3; i++) {
      budget.openConnection();
      budget.closeConnection();
    }
    expect(await budget.waitForConnection(1000)).toMatchObject({ ok: false, reason: "the session has used its 3 connections" });
  });
});
