// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CONFIG, type Config, type SandboxPodSettings } from "../config.js";
import type { SandboxBackend, SandboxSpec } from "./backend.js";
import { KubeApi, KubeApiError } from "./kube-api.js";
import { ciliumEgressProblems, sandboxEgressProblems, type CiliumNetworkPolicy, type NetworkPolicy } from "./network-policy.js";

const POLL_MS = 5000;
/** How long the network probe may take, including a new sandbox node and pulling its image. */
const PROBE_TIMEOUT_MS = 15 * 60 * 1000;
/**
 * What a sandbox must not reach directly: public hosts over TCP and UDP (a
 * DNS query), and the cloud metadata service. The probe adds the Kubernetes
 * API server itself, from its own environment.
 */
const PROBE_TARGETS = ["1.1.1.1:443", "9.9.9.9:443", "8.8.8.8:53", "udp:8.8.8.8:53", "udp:1.1.1.1:53", "169.254.169.254:80"];
/** Exit code reported for a pod that is gone or was stopped before its container ended. */
const GONE_EXIT_CODE = 137;

/** The end of a sandbox's log that the worker keeps, within the API client's limit. */
const LOG_QUERY = `timestamps=true&tailLines=20000&limitBytes=${8 * 1024 * 1024}`;

/** Labels on every sandbox pod whose values differ per pod. */
const PER_POD_LABELS = ["opificia.run", "opificia.session"] as const;

const LABELS = { "app.kubernetes.io/part-of": "opificia", "opificia.role": "sandbox" };

type Pod = {
  metadata: { name: string; uid?: string; labels?: Record<string, string> };
  spec?: { nodeName?: string };
  status?: {
    phase?: string;
    reason?: string;
    containerStatuses?: Array<{ state?: { terminated?: { exitCode: number } } }>;
  };
};

/** What every sandbox pod has, whatever runs in it (ADR-0010). */
function basePod(input: {
  name: string;
  labels: Record<string, string>;
  image: string;
  gatewayIp: string;
  settings: SandboxPodSettings;
  deadlineSeconds: number;
}) {
  const { settings } = input;
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: input.name,
      labels: { ...LABELS, ...input.labels },
      // The Cluster Autoscaler and Karpenter must not remove a node while a run works on it.
      annotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false", "karpenter.sh/do-not-disrupt": "true" },
    },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: input.deadlineSeconds,
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      // No DNS: the network policy blocks it anyway, and `gateway` is in /etc/hosts.
      dnsPolicy: "None",
      dnsConfig: { nameservers: ["127.0.0.1"] },
      hostAliases: [{ ip: input.gatewayIp, hostnames: ["gateway"] }],
      ...(settings.runtimeClassName ? { runtimeClassName: settings.runtimeClassName } : {}),
      nodeSelector: settings.nodeSelector,
      tolerations: settings.tolerations,
      imagePullSecrets: settings.imagePullSecrets.map((name) => ({ name })),
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1000,
        runAsGroup: 1000,
        fsGroup: 1000,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "sandbox",
          image: input.image,
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: { drop: ["ALL"] },
          },
        },
      ],
    },
  };
}

/**
 * The pod for one stage of a run. Its environment holds the session's tokens,
 * so it comes from a secret of the same name, not from the pod spec, which
 * anyone who may read pods can see.
 */
export function sandboxPod(spec: SandboxSpec, options: { gatewayIp: string; settings: SandboxPodSettings; deadlineSeconds: number }) {
  const pod = basePod({
    name: `opificia-run-${spec.sessionId}`,
    labels: { "opificia.run": spec.runId, "opificia.session": spec.sessionId },
    image: spec.image,
    ...options,
  });
  const { cpu, memory, workSize } = options.settings;
  Object.assign(pod.spec.containers[0]!, {
    envFrom: [{ secretRef: { name: pod.metadata.name } }],
    resources: { requests: { cpu, memory }, limits: { cpu, memory } },
    volumeMounts: [
      { name: "work", mountPath: "/work" },
      { name: "tmp", mountPath: "/tmp" },
      { name: "home", mountPath: "/home/node" },
    ],
  });
  Object.assign(pod.spec, {
    volumes: [
      { name: "work", emptyDir: { sizeLimit: workSize } },
      { name: "tmp", emptyDir: { sizeLimit: "1Gi" } },
      { name: "home", emptyDir: { sizeLimit: "1Gi" } },
    ],
  });
  return pod;
}

/** The secret with a sandbox's environment. It belongs to the pod, so Kubernetes deletes it with the pod. */
export function sandboxSecret(pod: { metadata: { name: string; labels: Record<string, string> } }, uid: string, env: Record<string, string>) {
  return {
    apiVersion: "v1",
    kind: "Secret",
    type: "Opaque",
    metadata: {
      name: pod.metadata.name,
      labels: pod.metadata.labels,
      ownerReferences: [{ apiVersion: "v1", kind: "Pod", name: pod.metadata.name, uid }],
    },
    stringData: env,
  };
}

/**
 * Tries to reach each target directly, and the gateway if asked, and prints
 * what it reached as JSON. The worker runs it twice on a sandbox node: as a
 * sandbox, under the sandbox network policy, and as a control pod outside it.
 */
const PROBE = `
const net = require("node:net");
const dgram = require("node:dgram");
// A DNS query for example.com: any answer means the packet got out and back.
const DNS_QUERY = Buffer.from("abcd01000001000000000000076578616d706c6503636f6d0000010001", "hex");
const split = (target) => {
  const i = target.lastIndexOf(":");
  return [target.slice(0, i).replace(/^\\[|\\]$/g, ""), Number(target.slice(i + 1))];
};
const tcp = (target) => new Promise((done) => {
  const [host, port] = split(target);
  const socket = net.connect({ host, port, timeout: 5000 });
  socket.once("connect", () => { socket.destroy(); done(true); });
  socket.once("timeout", () => { socket.destroy(); done(false); });
  socket.once("error", () => done(false));
});
const udp = (target) => new Promise((done) => {
  const [host, port] = split(target);
  const socket = dgram.createSocket(net.isIPv6(host) ? "udp6" : "udp4");
  const finish = (reached) => { clearTimeout(timer); socket.close(); done(reached); };
  const timer = setTimeout(() => finish(false), 5000);
  socket.once("message", () => finish(true));
  socket.once("error", () => finish(false));
  socket.send(DNS_QUERY, port, host);
});
const attempt = (target) => (target.startsWith("udp:") ? udp(target.slice(4)) : tcp(target));
// The worker's service may need a moment to route to it; try for a minute.
const reachGateway = async (gateway) => {
  if (!gateway) return false;
  for (let i = 0; i < 20; i++) {
    if (await tcp(gateway)) return true;
    await new Promise((done) => setTimeout(done, 3000));
  }
  return false;
};
const targets = JSON.parse(process.env.PROBE_TARGETS);
// Kubernetes gives every pod the API server's address.
const api = process.env.KUBERNETES_SERVICE_HOST;
if (api) targets.push((api.includes(":") ? "[" + api + "]" : api) + ":" + (process.env.KUBERNETES_SERVICE_PORT || "443"));
Promise.all([reachGateway(process.env.PROBE_GATEWAY), ...targets.map(attempt)]).then(([gateway, ...reached]) => {
  console.log(JSON.stringify({ gateway, reached: targets.filter((_, i) => reached[i]) }));
});
`;

export type ProbeResult = { gateway: boolean; reached: string[] };

export function probePod(options: {
  name: string;
  image: string;
  gatewayIp: string;
  gatewayPort: number;
  targets: string[];
  settings: SandboxPodSettings;
  /** The control pod runs outside the sandbox network policy. */
  control?: boolean;
  /** Runs the pod on this node, so both probes test the same one. */
  nodeName?: string;
}) {
  // The probe carries exactly the labels of a sandbox, with fresh IDs like a
  // run's, so no policy can tell it apart: one that selects sandboxes but not
  // the probe could open the network while the probe passes. The control's
  // role does not match the sandbox policy's selector.
  const labels: Record<string, string> = options.control
    ? { "opificia.role": "network-control", "opificia.probe": "network" }
    : Object.fromEntries(PER_POD_LABELS.map((key) => [key, randomUUID()]));
  const pod = basePod({ ...options, labels, deadlineSeconds: PROBE_TIMEOUT_MS / 1000 });
  Object.assign(pod.spec.containers[0]!, {
    command: ["node", "-e", PROBE],
    env: [
      ...(options.control ? [] : [{ name: "PROBE_GATEWAY", value: `gateway:${options.gatewayPort}` }]),
      { name: "PROBE_TARGETS", value: JSON.stringify(options.targets) },
    ],
    resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "200m", memory: "128Mi" } },
  });
  if (options.nodeName) Object.assign(pod.spec, { nodeName: options.nodeName });
  return pod;
}

/**
 * Whether sandboxes may start, from the two probes. The sandbox must reach
 * the gateway and none of the targets. The control must reach at least one
 * target, or the result proves nothing: a firewall may block the targets
 * for every pod, whether the cluster enforces network policies or not.
 */
export function judgeProbe(sandbox: ProbeResult, control: ProbeResult, gatewayService: string): { ok: true; summary: string } | { ok: false; reason: string } {
  if (sandbox.reached.length > 0) {
    return {
      ok: false,
      reason:
        `a sandbox can reach ${sandbox.reached.join(", ")} directly, which it may reach only through the egress proxy, or not at all. ` +
        "The cluster does not enforce the sandbox NetworkPolicy. Use a network plugin that enforces network policies, such as Cilium or Calico.",
    };
  }
  if (!sandbox.gateway) {
    return { ok: false, reason: `a sandbox cannot reach the worker. Check the sandbox NetworkPolicy and the service ${gatewayService}.` };
  }
  if (control.reached.length === 0) {
    return {
      ok: false,
      reason:
        "the network probe is inconclusive: a pod outside the sandbox policy could not reach any target either, so the probe cannot tell whether the policy is enforced. " +
        "Allow the control pod to reach the Kubernetes API, or check the network another way and set OPIFICIA_KUBERNETES_NETWORK_PROBE=off.",
    };
  }
  return { ok: true, summary: `the sandbox policy blocks ${control.reached.join(", ")}, which a pod outside it reaches, and lets sandboxes reach the gateway` };
}

function exitCodeOf(pod: Pod): number | undefined {
  const phase = pod.status?.phase;
  if (phase !== "Succeeded" && phase !== "Failed") return undefined;
  const code = pod.status?.containerStatuses?.[0]?.state?.terminated?.exitCode;
  return code ?? (phase === "Succeeded" ? 0 : GONE_EXIT_CODE);
}

/**
 * Sandboxes as pods in a Kubernetes cluster (ADR-0010). The worker creates one
 * pod per stage in its namespace. The cluster's node autoscaler provides the
 * nodes; nothing here depends on a provider.
 */
@Injectable()
export class KubernetesService implements SandboxBackend {
  private readonly logger = new Logger(KubernetesService.name);
  private readonly api: KubeApi;
  private readonly namespace: string;
  private gateway?: { ip: string; port: number; selector: Record<string, string> };

  /** Long enough for a new node to start and pull the sandbox image. */
  readonly helloTimeoutMs = 18 * 60 * 1000;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.api = config.OPIFICIA_KUBERNETES_API ? KubeApi.at(config.OPIFICIA_KUBERNETES_API) : KubeApi.inCluster();
    this.namespace = config.OPIFICIA_KUBERNETES_NAMESPACE ?? KubeApi.ownNamespace() ?? "default";
  }

  get gatewayUrl(): string {
    if (!this.gateway) throw new Error("the Kubernetes backend is not prepared");
    return `gateway:${this.gateway.port}`;
  }

  private path(rest = ""): string {
    return `/api/v1/namespaces/${encodeURIComponent(this.namespace)}/${rest}`;
  }

  /** Finds the gateway service and checks that the cluster enforces the sandbox network policy. */
  async prepare(): Promise<void> {
    const name = this.config.OPIFICIA_KUBERNETES_GATEWAY_SERVICE;
    const service = await this.api.json<{ spec?: { clusterIP?: string; ports?: Array<{ port: number }>; selector?: Record<string, string> } }>(
      "GET",
      this.path(`services/${name}`),
    );
    const ip = service.spec?.clusterIP;
    const port = service.spec?.ports?.[0]?.port;
    if (!ip || ip === "None" || !port) throw new Error(`the service ${name} has no cluster IP and port; sandboxes reach the worker through it`);
    this.gateway = { ip, port, selector: service.spec?.selector ?? {} };
    this.logger.log(`sandboxes run as pods in the namespace ${this.namespace} and reach the worker at ${ip}:${port}`);
    if (this.config.OPIFICIA_KUBERNETES_NETWORK_PROBE === "on") {
      await this.checkPolicies();
      await this.probeNetwork();
    }
    else this.logger.warn("the network probe is off; make sure the cluster enforces the sandbox network policy");
  }

  /**
   * Reads the network policies of the namespace: the Kubernetes ones, and
   * Cilium's if the cluster has them. The probe shows that the cluster
   * enforces them; this shows that they allow nothing but the worker.
   * Cluster-wide policies are beyond the worker's Role; see
   * `ciliumEgressProblems`.
   */
  private async checkPolicies(): Promise<void> {
    const ns = encodeURIComponent(this.namespace);
    const sandbox = { labels: { ...LABELS, ...Object.fromEntries(PER_POD_LABELS.map((k) => [k, ""])) }, anyValue: PER_POD_LABELS };
    const read = async <T>(path: string, kind: string): Promise<T[] | undefined> => {
      try {
        return (await this.api.json<{ items: T[] }>("GET", path)).items;
      } catch (error) {
        // No such API: the cluster does not have these policies.
        if (error instanceof KubeApiError && error.status === 404) return undefined;
        if (error instanceof KubeApiError && error.status === 403) throw new Error(`the worker may not read ${kind}; its Role needs get and list on them`);
        throw error;
      }
    };
    const policies = (await read<NetworkPolicy>(`/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`, "networkpolicies")) ?? [];
    const cilium = (await read<CiliumNetworkPolicy>(`/apis/cilium.io/v2/namespaces/${ns}/ciliumnetworkpolicies`, "ciliumnetworkpolicies")) ?? [];
    const problems = [
      ...sandboxEgressProblems(policies, sandbox, { selector: this.gateway!.selector, port: this.config.OPIFICIA_SANDBOX_PORT }),
      ...ciliumEgressProblems(cilium, sandbox),
    ];
    if (problems.length > 0) {
      throw new Error(`the network policies would let sandboxes bypass the egress proxy: ${problems.join("; ")}`);
    }
  }

  private async probeNetwork(): Promise<void> {
    const suffix = randomBytes(4).toString("hex");
    const common = {
      image: this.config.OPIFICIA_KUBERNETES_PROBE_IMAGE ?? this.config.OPIFICIA_SANDBOX_IMAGE,
      gatewayIp: this.gateway!.ip,
      gatewayPort: this.gateway!.port,
      targets: PROBE_TARGETS,
      settings: this.config.OPIFICIA_KUBERNETES_SANDBOX_POD,
    };
    const sandbox = probePod({ ...common, name: `opificia-network-probe-${suffix}` });
    const controlName = `opificia-network-control-${suffix}`;
    this.logger.log(`checking the sandbox network with ${sandbox.metadata.name}; on a new sandbox node this takes a few minutes`);
    const deadline = Date.now() + PROBE_TIMEOUT_MS;
    try {
      await this.api.json("POST", this.path("pods"), sandbox);
      // The control runs on the node the scheduler chose for the sandbox probe.
      const nodeName = await this.nodeOf(sandbox.metadata.name, deadline);
      await this.api.json("POST", this.path("pods"), probePod({ ...common, name: controlName, control: true, nodeName }));
      const [inside, outside] = await Promise.all([this.probeResult(sandbox.metadata.name, deadline), this.probeResult(controlName, deadline)]);
      const verdict = judgeProbe(inside, outside, this.config.OPIFICIA_KUBERNETES_GATEWAY_SERVICE);
      if (!verdict.ok) throw new Error(verdict.reason);
      this.logger.log(`network probe on ${nodeName}: ${verdict.summary}`);
    } finally {
      await this.remove(sandbox.metadata.name);
      await this.remove(controlName);
    }
  }

  /** Waits until a pod is on a node. */
  private async nodeOf(name: string, deadline: number): Promise<string> {
    for (;;) {
      const pod = await this.api.json<Pod>("GET", this.path(`pods/${name}`));
      if (pod.spec?.nodeName) return pod.spec.nodeName;
      if (exitCodeOf(pod) !== undefined) throw new Error(`the network probe ${name} ended before it was scheduled`);
      if (Date.now() > deadline) throw new Error(`the network probe ${name} found no node in ${PROBE_TIMEOUT_MS / 60_000} minutes`);
      await sleep(POLL_MS / 5);
    }
  }

  /** Waits for a probe pod to finish and reads what it reached. */
  private async probeResult(name: string, deadline: number): Promise<ProbeResult> {
    let code: number | undefined;
    while (code === undefined) {
      if (Date.now() > deadline) throw new Error(`the network probe ${name} did not finish in ${PROBE_TIMEOUT_MS / 60_000} minutes`);
      await sleep(POLL_MS / 5);
      code = exitCodeOf(await this.api.json<Pod>("GET", this.path(`pods/${name}`)));
    }
    const log = (await this.api.text(this.path(`pods/${name}/log`)).catch(() => "")).trim();
    try {
      if (code !== 0) throw new Error();
      const result = JSON.parse(log.split("\n").at(-1) ?? "") as ProbeResult;
      if (typeof result.gateway !== "boolean" || !Array.isArray(result.reached)) throw new Error();
      return result;
    } catch {
      throw new Error(`the network probe ${name} failed (exit code ${code}): ${log.slice(0, 500) || "no output"}`);
    }
  }

  async startSandbox(spec: SandboxSpec): Promise<string> {
    if (!this.gateway) throw new Error("the Kubernetes backend is not prepared");
    const pod = sandboxPod(spec, {
      gatewayIp: this.gateway.ip,
      settings: this.config.OPIFICIA_KUBERNETES_SANDBOX_POD,
      deadlineSeconds: Math.ceil(this.config.OPIFICIA_RUN_TIMEOUT_MINUTES * 60),
    });
    const created = await this.api.json<Pod>("POST", this.path("pods"), pod);
    // The pod waits for its secret; the secret needs the pod's ID to belong to it.
    try {
      if (!created?.metadata?.uid) throw new Error("the API server returned no ID for the pod");
      await this.api.json("POST", this.path("secrets"), sandboxSecret(pod, created.metadata.uid, spec.env));
    } catch (error) {
      await this.remove(pod.metadata.name);
      throw error;
    }
    return pod.metadata.name;
  }

  async waitForExit(id: string): Promise<number> {
    for (;;) {
      try {
        const code = exitCodeOf(await this.api.json<Pod>("GET", this.path(`pods/${id}`)));
        if (code !== undefined) return code;
      } catch (error) {
        if (error instanceof KubeApiError && error.status === 404) return GONE_EXIT_CODE;
        this.logger.warn(`checking ${id}: ${(error as Error).message}`);
      }
      await sleep(POLL_MS);
    }
  }

  async saveLogs(id: string, file: string): Promise<void> {
    await writeFile(file, await this.api.text(this.path(`pods/${id}/log?${LOG_QUERY}`)));
  }

  async stop(id: string): Promise<void> {
    await this.delete(id, 5);
  }

  async remove(id: string): Promise<void> {
    await this.delete(id, 0);
  }

  private async delete(id: string, gracePeriodSeconds: number): Promise<void> {
    await this.api.json("DELETE", this.path(`pods/${id}?gracePeriodSeconds=${gracePeriodSeconds}`)).catch((error: Error) => {
      if (!(error instanceof KubeApiError && error.status === 404)) this.logger.warn(`removing ${id}: ${error.message}`);
    });
  }

  async listSandboxes(): Promise<Array<{ id: string; sessionId: string }>> {
    const selector = encodeURIComponent("opificia.role=sandbox");
    const list = await this.api.json<{ items: Pod[] }>("GET", this.path(`pods?labelSelector=${selector}`));
    return list.items.map((pod) => ({ id: pod.metadata.name, sessionId: pod.metadata.labels?.["opificia.session"] ?? "" }));
  }
}
