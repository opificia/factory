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

/** Whether a label selector selects a pod with these labels. An empty selector selects every pod. */
export function selects(selector: LabelSelector | undefined, labels: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(selector?.matchLabels ?? {})) if (labels[key] !== value) return false;
  for (const { key, operator, values = [] } of selector?.matchExpressions ?? []) {
    const has = key in labels;
    const ok =
      operator === "In" ? has && values.includes(labels[key]!) :
      operator === "NotIn" ? !has || !values.includes(labels[key]!) :
      operator === "Exists" ? has :
      operator === "DoesNotExist" ? !has :
      false;
    if (!ok) return false;
  }
  return true;
}

function hasEgress(policy: NetworkPolicy): boolean {
  return policy.spec.policyTypes ? policy.spec.policyTypes.includes("Egress") : policy.spec.egress !== undefined;
}

/**
 * What the network policies of the namespace let a sandbox reach, beyond the
 * worker's sandbox port (ADR-0010). Policies add up: a sandbox may make a
 * connection that any policy selecting it allows. So every egress rule of
 * every policy that selects sandboxes must allow only pods of the namespace,
 * on the sandbox port, over TCP. Returns the problems; none means the
 * policies are as tight as the chart makes them.
 */
export function sandboxEgressProblems(policies: NetworkPolicy[], sandboxLabels: Record<string, string>, port: number): string[] {
  const selecting = policies.filter((p) => selects(p.spec.podSelector, sandboxLabels));
  const restricting = selecting.filter(hasEgress);
  if (restricting.length === 0) return ["no NetworkPolicy restricts the egress of sandbox pods"];
  const problems: string[] = [];
  for (const policy of restricting) {
    const name = policy.metadata.name;
    for (const rule of policy.spec.egress ?? []) {
      if (!rule.to?.length) problems.push(`${name} lets sandboxes reach any address`);
      else if (rule.to.some((peer) => peer.ipBlock !== undefined || peer.namespaceSelector !== undefined || peer.podSelector === undefined)) {
        problems.push(`${name} lets sandboxes reach addresses or namespaces outside their own`);
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
