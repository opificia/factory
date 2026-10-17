// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CONFIG, type Config, type SandboxPodSettings } from "../config.js";
import type { SandboxBackend, SandboxSpec } from "./backend.js";
import { KubeApi, KubeApiError } from "./kube-api.js";

const POLL_MS = 5000;
/** How long the network probe may take, including a new sandbox node and pulling its image. */
const PROBE_TIMEOUT_MS = 15 * 60 * 1000;
/** Addresses a sandbox must not reach directly: public hosts and the cloud metadata service. */
const PROBE_TARGETS = ["1.1.1.1:443", "8.8.8.8:53", "9.9.9.9:443", "169.254.169.254:80"];
/** Exit code reported for a pod that is gone or was stopped before its container ended. */
const GONE_EXIT_CODE = 137;

const LABELS = { "app.kubernetes.io/part-of": "opificia", "opificia.role": "sandbox" };

type Pod = {
  metadata: { name: string; uid?: string; labels?: Record<string, string> };
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
      // A node autoscaler must not remove a node while a run works on it.
      annotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" },
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
 * Runs like a sandbox, on a sandbox node with the sandbox labels, so the
 * sandbox network policy applies as it would to a run. It must reach the
 * gateway, and nothing else directly: not the internet, not the cloud
 * metadata service and not the Kubernetes API. Exits with 0 when that holds,
 * 1 when it reached something it should not, and 2 when it cannot reach the
 * gateway.
 */
const PROBE = `
const net = require("node:net");
const attempt = (target) => new Promise((done) => {
  const i = target.lastIndexOf(":");
  const socket = net.connect({ host: target.slice(0, i).replace(/^\\[|\\]$/g, ""), port: Number(target.slice(i + 1)), timeout: 5000 });
  socket.once("connect", () => { socket.destroy(); done(true); });
  socket.once("timeout", () => { socket.destroy(); done(false); });
  socket.once("error", () => done(false));
});
const targets = JSON.parse(process.env.PROBE_TARGETS);
Promise.all([attempt(process.env.PROBE_GATEWAY), ...targets.map(attempt)]).then(([gateway, ...reached]) => {
  const open = targets.filter((_, i) => reached[i]);
  if (open.length) { console.log("reached " + open.join(", ")); process.exit(1); }
  if (!gateway) { console.log("could not reach the gateway at " + process.env.PROBE_GATEWAY); process.exit(2); }
  console.log("reached the gateway and nothing else");
  process.exit(0);
});
`;

export function probePod(options: { name: string; image: string; gatewayIp: string; gatewayPort: number; targets: string[]; settings: SandboxPodSettings }) {
  const pod = basePod({ ...options, labels: { "opificia.probe": "network" }, deadlineSeconds: PROBE_TIMEOUT_MS / 1000 });
  Object.assign(pod.spec.containers[0]!, {
    command: ["node", "-e", PROBE],
    env: [
      { name: "PROBE_GATEWAY", value: `gateway:${options.gatewayPort}` },
      { name: "PROBE_TARGETS", value: JSON.stringify(options.targets) },
    ],
    resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "200m", memory: "128Mi" } },
  });
  return pod;
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
  private gateway?: { ip: string; port: number };

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
    const service = await this.api.json<{ spec?: { clusterIP?: string; ports?: Array<{ port: number }> } }>("GET", this.path(`services/${name}`));
    const ip = service.spec?.clusterIP;
    const port = service.spec?.ports?.[0]?.port;
    if (!ip || ip === "None" || !port) throw new Error(`the service ${name} has no cluster IP and port; sandboxes reach the worker through it`);
    this.gateway = { ip, port };
    this.logger.log(`sandboxes run as pods in the namespace ${this.namespace} and reach the worker at ${ip}:${port}`);
    if (this.config.OPIFICIA_KUBERNETES_NETWORK_PROBE === "on") await this.probeNetwork();
    else this.logger.warn("the network probe is off; make sure the cluster enforces the sandbox network policy");
  }

  private async probeNetwork(): Promise<void> {
    const api = process.env.KUBERNETES_SERVICE_HOST;
    const targets = [...PROBE_TARGETS, ...(api ? [`${api}:${process.env.KUBERNETES_SERVICE_PORT ?? "443"}`] : [])];
    const pod = probePod({
      name: `opificia-network-probe-${randomBytes(4).toString("hex")}`,
      image: this.config.OPIFICIA_KUBERNETES_PROBE_IMAGE ?? this.config.OPIFICIA_SANDBOX_IMAGE,
      gatewayIp: this.gateway!.ip,
      gatewayPort: this.gateway!.port,
      targets,
      settings: this.config.OPIFICIA_KUBERNETES_SANDBOX_POD,
    });
    this.logger.log(`checking the sandbox network with ${pod.metadata.name}; on a new sandbox node this takes a few minutes`);
    await this.api.json("POST", this.path("pods"), pod);
    const name = pod.metadata.name;
    try {
      const deadline = Date.now() + PROBE_TIMEOUT_MS;
      let code: number | undefined;
      while (code === undefined) {
        if (Date.now() > deadline) throw new Error(`the network probe ${name} did not finish in ${PROBE_TIMEOUT_MS / 60_000} minutes`);
        await sleep(POLL_MS / 5);
        code = exitCodeOf(await this.api.json<Pod>("GET", this.path(`pods/${name}`)));
      }
      const log = (await this.api.text(this.path(`pods/${name}/log`)).catch(() => "")).trim();
      if (code === 2) {
        throw new Error(`a sandbox cannot reach the worker (${log}). Check the sandbox NetworkPolicy and the service ${this.config.OPIFICIA_KUBERNETES_GATEWAY_SERVICE}.`);
      }
      if (code !== 0) {
        throw new Error(
          `a sandbox can reach addresses directly that it must reach only through the egress proxy, or not at all (${log || `exit code ${code}`}). ` +
            "The cluster does not enforce the sandbox NetworkPolicy. Use a network plugin that enforces network policies, such as Cilium or Calico.",
        );
      }
      this.logger.log(`network probe: ${log}`);
    } finally {
      await this.remove(name);
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
    await writeFile(file, await this.api.text(this.path(`pods/${id}/log?timestamps=true`)));
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
