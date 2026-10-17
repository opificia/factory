// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { sandboxEgressProblems, selects, type NetworkPolicy } from "./network-policy.js";

const sandbox = { "app.kubernetes.io/part-of": "opificia", "opificia.role": "sandbox" };
const policy = (name: string, spec: NetworkPolicy["spec"]): NetworkPolicy => ({ metadata: { name }, spec });
/** The policy the chart creates. */
const chart = policy("opificia-sandbox", {
  podSelector: { matchLabels: { "opificia.role": "sandbox" } },
  policyTypes: ["Ingress", "Egress"],
  egress: [{ to: [{ podSelector: { matchLabels: { "app.kubernetes.io/component": "worker" } } }], ports: [{ port: 3001, protocol: "TCP" }] }],
});

describe("selects", () => {
  it("matches labels and expressions, and an empty selector selects every pod", () => {
    expect(selects({ matchLabels: { "opificia.role": "sandbox" } }, sandbox)).toBe(true);
    expect(selects({ matchLabels: { "opificia.role": "worker" } }, sandbox)).toBe(false);
    expect(selects({ matchExpressions: [{ key: "opificia.role", operator: "In", values: ["sandbox"] }] }, sandbox)).toBe(true);
    expect(selects({ matchExpressions: [{ key: "x", operator: "DoesNotExist" }] }, sandbox)).toBe(true);
    expect(selects({}, sandbox)).toBe(true);
    expect(selects(undefined, sandbox)).toBe(true);
  });
});

describe("sandboxEgressProblems", () => {
  it("accepts the chart's policy", () => {
    expect(sandboxEgressProblems([chart], sandbox, 3001)).toEqual([]);
  });

  it("needs a policy that restricts sandbox egress", () => {
    expect(sandboxEgressProblems([], sandbox, 3001)).toEqual(["no NetworkPolicy restricts the egress of sandbox pods"]);
    const ingressOnly = policy("ingress", { podSelector: {}, policyTypes: ["Ingress"] });
    expect(sandboxEgressProblems([ingressOnly], sandbox, 3001)).toHaveLength(1);
  });

  it("finds a second policy that opens the network, because policies add up", () => {
    const open = policy("allow-all-egress", { podSelector: {}, policyTypes: ["Egress"], egress: [{}] });
    expect(sandboxEgressProblems([chart, open], sandbox, 3001)).toEqual([
      "allow-all-egress lets sandboxes reach any address",
      "allow-all-egress lets sandboxes use any port",
    ]);
  });

  it("refuses address blocks, other namespaces and other ports", () => {
    const loose = policy("loose", {
      podSelector: { matchLabels: { "opificia.role": "sandbox" } },
      egress: [
        { to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [{ port: 3001 }] },
        { to: [{ namespaceSelector: {}, podSelector: {} }], ports: [{ port: 3001 }] },
        { to: [{ podSelector: {} }], ports: [{ port: 53, protocol: "UDP" }] },
      ],
    });
    expect(sandboxEgressProblems([loose], sandbox, 3001)).toEqual([
      "loose lets sandboxes reach addresses or namespaces outside their own",
      "loose lets sandboxes use a port other than TCP 3001",
    ]);
  });

  it("ignores policies for other pods", () => {
    const worker = policy("worker", { podSelector: { matchLabels: { "opificia.role": "worker" } }, egress: [{}] });
    expect(sandboxEgressProblems([chart, worker], sandbox, 3001)).toEqual([]);
  });
});
