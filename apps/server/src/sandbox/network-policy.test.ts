// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { sandboxEgressProblems, selects, type NetworkPolicy } from "./network-policy.js";

const labels = { "app.kubernetes.io/part-of": "opificia", "opificia.role": "sandbox" };
const sandbox = { labels, anyValue: ["opificia.run", "opificia.session"] };
const worker = { "app.kubernetes.io/component": "worker" };
const gateway = { selector: worker, port: 3001 };
const policy = (name: string, spec: NetworkPolicy["spec"]): NetworkPolicy => ({ metadata: { name }, spec });
/** The policy the chart creates. */
const chart = policy("opificia-sandbox", {
  podSelector: { matchLabels: { "opificia.role": "sandbox" } },
  policyTypes: ["Ingress", "Egress"],
  egress: [{ to: [{ podSelector: { matchLabels: worker } }], ports: [{ port: 3001, protocol: "TCP" }] }],
});
const openAll = (podSelector: NetworkPolicy["spec"]["podSelector"]) => policy("open", { podSelector, policyTypes: ["Egress"], egress: [{}] });

describe("selects", () => {
  it("matches labels, and an empty selector selects every pod", () => {
    expect(selects({ matchLabels: { "opificia.role": "sandbox" } }, labels)).toBe(true);
    expect(selects({ matchLabels: { "opificia.role": "worker" } }, labels)).toBe(false);
    expect(selects({}, labels)).toBe(true);
    expect(selects(undefined, labels)).toBe(true);
  });

  it("evaluates every operator", () => {
    const expr = (operator: string, key = "opificia.role", values?: string[]) => ({ matchExpressions: [{ key, operator, ...(values ? { values } : {}) }] });
    expect(selects(expr("In", "opificia.role", ["sandbox", "x"]), labels)).toBe(true);
    expect(selects(expr("In", "opificia.role", ["worker"]), labels)).toBe(false);
    expect(selects(expr("NotIn", "opificia.role", ["worker"]), labels)).toBe(true);
    expect(selects(expr("NotIn", "opificia.role", ["sandbox"]), labels)).toBe(false);
    expect(selects(expr("NotIn", "missing", ["a"]), labels)).toBe(true);
    expect(selects(expr("Exists"), labels)).toBe(true);
    expect(selects(expr("Exists", "missing"), labels)).toBe(false);
    expect(selects(expr("DoesNotExist", "missing"), labels)).toBe(true);
    expect(selects(expr("DoesNotExist"), labels)).toBe(false);
  });

  it("does not take inherited properties for labels", () => {
    expect(selects({ matchExpressions: [{ key: "constructor", operator: "DoesNotExist" }] }, labels)).toBe(true);
    expect(selects({ matchExpressions: [{ key: "toString", operator: "Exists" }] }, labels)).toBe(false);
  });

  it("counts a requirement on a per-pod label as met, unless it says the label is missing", () => {
    const anyValue = ["opificia.run"];
    expect(selects({ matchLabels: { "opificia.run": "some-run" } }, labels, anyValue)).toBe(true);
    expect(selects({ matchExpressions: [{ key: "opificia.run", operator: "Exists" }] }, labels, anyValue)).toBe(true);
    expect(selects({ matchExpressions: [{ key: "opificia.run", operator: "DoesNotExist" }] }, labels, anyValue)).toBe(false);
  });
});

describe("sandboxEgressProblems", () => {
  it("accepts the chart's policy", () => {
    expect(sandboxEgressProblems([chart], sandbox, gateway)).toEqual([]);
  });

  it("needs a policy that restricts sandbox egress", () => {
    expect(sandboxEgressProblems([], sandbox, gateway)).toEqual(["no NetworkPolicy restricts the egress of sandbox pods"]);
    const ingressOnly = policy("ingress", { podSelector: {}, policyTypes: ["Ingress"] });
    expect(sandboxEgressProblems([ingressOnly], sandbox, gateway)).toHaveLength(1);
  });

  it("finds a second policy that opens the network, because policies add up", () => {
    expect(sandboxEgressProblems([chart, openAll({})], sandbox, gateway)).toEqual(["open lets sandboxes reach any address", "open lets sandboxes use any port"]);
  });

  it("finds an open policy that selects sandboxes by their run", () => {
    const byRun = openAll({ matchExpressions: [{ key: "opificia.run", operator: "Exists" }] });
    expect(sandboxEgressProblems([chart, byRun], sandbox, gateway)).toContain("open lets sandboxes reach any address");
    const oneRun = openAll({ matchLabels: { "opificia.role": "sandbox", "opificia.run": "8d1c" } });
    expect(sandboxEgressProblems([chart, oneRun], sandbox, gateway)).toContain("open lets sandboxes reach any address");
  });

  it("refuses peers other than the worker's pods", () => {
    const anyPod = policy("any-pod", {
      podSelector: { matchLabels: { "opificia.role": "sandbox" } },
      egress: [{ to: [{ podSelector: {} }], ports: [{ port: 3001 }] }],
    });
    expect(sandboxEgressProblems([anyPod], sandbox, gateway)).toEqual(["any-pod lets sandboxes reach pods other than the worker's"]);
    const byExpression = policy("by-expression", {
      podSelector: { matchLabels: { "opificia.role": "sandbox" } },
      egress: [{ to: [{ podSelector: { matchExpressions: [{ key: "app.kubernetes.io/component", operator: "In", values: ["worker"] }] } }], ports: [{ port: 3001 }] }],
    });
    expect(sandboxEgressProblems([byExpression], sandbox, gateway)).toEqual([]);
  });

  it("refuses address blocks, other namespaces and other ports", () => {
    const loose = policy("loose", {
      podSelector: { matchLabels: { "opificia.role": "sandbox" } },
      egress: [
        { to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [{ port: 3001 }] },
        { to: [{ namespaceSelector: {}, podSelector: { matchLabels: worker } }], ports: [{ port: 3001 }] },
        { to: [{ podSelector: { matchLabels: worker } }], ports: [{ port: 53, protocol: "UDP" }] },
      ],
    });
    expect(sandboxEgressProblems([loose], sandbox, gateway)).toEqual([
      "loose lets sandboxes reach addresses or namespaces outside their own",
      "loose lets sandboxes use a port other than TCP 3001",
    ]);
  });

  it("ignores policies for other pods", () => {
    const forWorker = openAll({ matchLabels: { "opificia.role": "worker" } });
    expect(sandboxEgressProblems([chart, forWorker], sandbox, gateway)).toEqual([]);
  });

  it("needs a gateway service that selects pods by label", () => {
    expect(sandboxEgressProblems([chart], sandbox, { selector: {}, port: 3001 })).toHaveLength(1);
  });
});
