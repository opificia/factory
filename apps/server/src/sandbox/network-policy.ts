// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

type LabelSelector = {
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
};

type Peer = { podSelector?: LabelSelector; namespaceSelector?: LabelSelector; ipBlock?: unknown };

export type NetworkPolicy = {
  metadata: { name: string };
  spec: {
    podSelector?: LabelSelector;
    policyTypes?: string[];
    egress?: Array<{ to?: Peer[]; ports?: Array<{ port?: number | string; protocol?: string; endPort?: number }> }>;
  };
};

/**
 * Whether a label selector selects a pod with these labels. An empty selector
 * selects every pod. Labels in `anyValue` are on every such pod, but with
 * values that differ from pod to pod, such as a sandbox's run: a requirement
 * on their value may hold for some pod, so it counts as met.
 */
export function selects(selector: LabelSelector | undefined, labels: Record<string, string>, anyValue: readonly string[] = []): boolean {
  for (const [key, value] of Object.entries(selector?.matchLabels ?? {})) {
    if (anyValue.includes(key)) continue;
    if (!Object.hasOwn(labels, key) || labels[key] !== value) return false;
  }
  for (const { key, operator, values = [] } of selector?.matchExpressions ?? []) {
    if (anyValue.includes(key)) {
      if (operator === "DoesNotExist") return false;
      continue;
    }
    const has = Object.hasOwn(labels, key);
    const ok =
      operator === "In" ? has && values.includes(labels[key]!) :
      operator === "NotIn" ? !has || !values.includes(labels[key]!) :
      operator === "Exists" ? has :
      operator === "DoesNotExist" ? !has :
      // An operator Kubernetes does not know counts as met: better to check
      // a policy that may not apply than to skip one that does.
      true;
    if (!ok) return false;
  }
  return true;
}

function hasEgress(policy: NetworkPolicy): boolean {
  return policy.spec.policyTypes ? policy.spec.policyTypes.includes("Egress") : policy.spec.egress !== undefined;
}

/** Whether a peer selects only pods that carry every label of the gateway service's selector. */
function onlyGateway(peer: LabelSelector, gateway: Record<string, string>): boolean {
  return Object.entries(gateway).every(
    ([key, value]) =>
      peer.matchLabels?.[key] === value ||
      (peer.matchExpressions ?? []).some((e) => e.key === key && e.operator === "In" && e.values?.length === 1 && e.values[0] === value),
  );
}

/**
 * What the network policies of the namespace let a sandbox reach, beyond the
 * worker's sandbox port (ADR-0010). Policies add up: a sandbox may make a
 * connection that any policy selecting it allows. So every egress rule of
 * every policy that selects sandboxes must allow only the pods behind the
 * gateway service, on the sandbox port, over TCP. Returns the problems; none
 * means the policies are as tight as the chart makes them.
 */
export function sandboxEgressProblems(
  policies: NetworkPolicy[],
  sandbox: { labels: Record<string, string>; anyValue: readonly string[] },
  gateway: { selector: Record<string, string>; port: number },
): string[] {
  if (Object.keys(gateway.selector).length === 0) return ["the gateway service selects no pods by label, so the policies cannot be checked against it"];
  const port = gateway.port;
  const selecting = policies.filter((p) => selects(p.spec.podSelector, sandbox.labels, sandbox.anyValue));
  const restricting = selecting.filter(hasEgress);
  if (restricting.length === 0) return ["no NetworkPolicy restricts the egress of sandbox pods"];
  const problems: string[] = [];
  for (const policy of restricting) {
    const name = policy.metadata.name;
    for (const rule of policy.spec.egress ?? []) {
      if (!rule.to?.length) problems.push(`${name} lets sandboxes reach any address`);
      else if (rule.to.some((peer) => peer.ipBlock !== undefined || peer.namespaceSelector !== undefined || peer.podSelector === undefined)) {
        problems.push(`${name} lets sandboxes reach addresses or namespaces outside their own`);
      } else if (rule.to.some((peer) => !onlyGateway(peer.podSelector!, gateway.selector))) {
        problems.push(`${name} lets sandboxes reach pods other than the worker's`);
      }
      const ports = rule.ports ?? [];
      if (ports.length === 0) problems.push(`${name} lets sandboxes use any port`);
      else if (ports.some((p) => p.port !== port || p.endPort !== undefined || (p.protocol ?? "TCP") !== "TCP")) {
        problems.push(`${name} lets sandboxes use a port other than TCP ${port}`);
      }
    }
  }
  return [...new Set(problems)];
}

/** The parts of a CiliumNetworkPolicy (cilium.io/v2) that say whom it applies to and whether it allows egress. */
export type CiliumNetworkPolicy = {
  metadata: { name: string };
  spec?: CiliumRule;
  specs?: CiliumRule[];
};
type CiliumRule = { endpointSelector?: LabelSelector; egress?: unknown[] };

/**
 * Cilium labels that every pod carries besides its own, such as its namespace
 * and service account. A selector may require them; their values are not
 * checked.
 */
const CILIUM_POD_LABELS = /^(io\.kubernetes\.|io\.cilium\.)/;

/** A Cilium selector in Kubernetes terms: without the "k8s:" or "any:" source prefix. */
function plainSelector(selector: LabelSelector | undefined): LabelSelector | undefined {
  const plain = (key: string) => key.replace(/^(k8s|any):/, "");
  return {
    matchLabels: Object.fromEntries(Object.entries(selector?.matchLabels ?? {}).map(([k, v]) => [plain(k), v])),
    matchExpressions: (selector?.matchExpressions ?? []).map((e) => ({ ...e, key: plain(e.key) })),
  };
}

/**
 * Cilium enforces its own policies alongside NetworkPolicies, and they add up
 * in the same way: one that applies to sandboxes and allows egress can open
 * what the NetworkPolicy closes. The worker does not check Cilium's rules, so
 * any such policy is a problem. Policies that only deny (`egressDeny`) are not.
 *
 * Cluster-wide policies, such as CiliumClusterwideNetworkPolicy and
 * AdminNetworkPolicy, need permissions beyond the worker's namespace, so the
 * worker cannot read them. For those, the network probe is the only check.
 */
export function ciliumEgressProblems(policies: CiliumNetworkPolicy[], sandbox: { labels: Record<string, string>; anyValue: readonly string[] }): string[] {
  const problems: string[] = [];
  for (const policy of policies) {
    for (const rule of [policy.spec, ...(policy.specs ?? [])]) {
      if (!rule?.egress) continue;
      const selector = plainSelector(rule.endpointSelector);
      const keys = [...Object.keys(selector?.matchLabels ?? {}), ...(selector?.matchExpressions ?? []).map((e) => e.key)];
      const anyValue = [...sandbox.anyValue, ...keys.filter((k) => CILIUM_POD_LABELS.test(k))];
      const labels = { ...sandbox.labels, ...Object.fromEntries(anyValue.map((k) => [k, ""])) };
      if (selects(selector, labels, anyValue)) {
        problems.push(`the CiliumNetworkPolicy ${policy.metadata.name} applies to sandbox pods and allows egress, which the worker cannot check`);
        break;
      }
    }
  }
  return problems;
}
