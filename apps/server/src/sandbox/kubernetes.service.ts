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
/** How long the network probe may take, including pulling its image. */
const PROBE_TIMEOUT_MS = 5 * 60 * 1000;
/** Exit code reported for a pod that is gone or was stopped before its container ended. */
const GONE_EXIT_CODE = 137;

const LABELS = { "app.kubernetes.io/part-of": "opificia", "opificia.role": "sandbox" };

type Pod = {
  metadata: { name: string; labels?: Record<string, string> };
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

/** The pod for one stage of a run. */
export function sandboxPod(spec: SandboxSpec, options: { gatewayIp: string; settings: SandboxPodSettings; deadlineSeconds: number }) {
  const pod = basePod({
    name: `opificia-run-${spec.sessionId}`,
    labels: { "opificia.run": spec.runId, "opificia.session": spec.sessionId },
    image: spec.image,
    ...options,
  });
  const { cpu, memory, workSize } = options.settings;
  Object.assign(pod.spec.containers[0]!, {
    env: Object.entries(spec.env).map(([name, value]) => ({ name, value })),
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

/**
 * Tries to reach the internet without the egress proxy, with the labels of a
 * sandbox, so the sandbox network policy applies. Exits with 0 when every
 * attempt fails, and with 1 when one gets through.
 */
const PROBE = `
const net = require("node:net");
const targets = [["1.1.1.1", 443], ["8.8.8.8", 53], ["9.9.9.9", 443]];
const attempt = ([host, port]) => new Promise((done) => {
  const socket = net.connect({ host, port, timeout: 5000 });
  socket.once("connect", () => { socket.destroy(); done(host + ":" + port); });
  socket.once("timeout", () => { socket.destroy(); done(null); });
  socket.once("error", () => done(null));
});
Promise.all(targets.map(attempt)).then((reached) => {
  const open = reached.filter(Boolean);
  console.log(open.length ? "reached " + open.join(", ") : "no direct route out");
  process.exit(open.length ? 1 : 0);
});
`;

export function probePod(options: { name: string; image: string; gatewayIp: string; settings: SandboxPodSettings }) {
  // The probe needs no sandbox node: the policy follows the labels.
  const settings = { ...options.settings, nodeSelector: {}, tolerations: [] };
  const pod = basePod({ ...options, settings, labels: { "opificia.probe": "network" }, deadlineSeconds: PROBE_TIMEOUT_MS / 1000 });
  Object.assign(pod.spec.containers[0]!, {
    command: ["node", "-e", PROBE],
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
    const pod = probePod({
      name: `opificia-network-probe-${randomBytes(4).toString("hex")}`,
      image: this.config.OPIFICIA_KUBERNETES_PROBE_IMAGE ?? this.config.OPIFICIA_SANDBOX_IMAGE,
      gatewayIp: this.gateway!.ip,
      settings: this.config.OPIFICIA_KUBERNETES_SANDBOX_POD,
    });
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
      if (code !== 0) {
        throw new Error(
          `a pod with the sandbox labels can reach the internet directly (${log || `exit code ${code}`}). ` +
            "The cluster does not enforce the sandbox NetworkPolicy, so sandboxes would bypass the egress proxy. " +
            "Use a network plugin that enforces network policies, such as Cilium or Calico.",
        );
      }
      this.logger.log(`network probe: ${log || "no direct route out"}`);
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
    await this.api.json("POST", this.path("pods"), pod);
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
