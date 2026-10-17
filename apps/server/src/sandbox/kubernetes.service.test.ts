// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SandboxPodSettings, type Config } from "../config.js";
import { KubernetesService, probePod, sandboxPod, sandboxSecret } from "./kubernetes.service.js";

const settings = (json = "{}") => SandboxPodSettings.parse(json);
const spec = { sessionId: "5b0c7d1e-0000-4000-8000-000000000001", runId: "r1", image: "registry.example/harness:1", env: { A: "b" } };

describe("sandboxPod", () => {
  const pod = sandboxPod(spec, { gatewayIp: "10.0.0.7", settings: settings(), deadlineSeconds: 3600 });

  it("locks the pod down like the Docker container", () => {
    expect(pod.spec.automountServiceAccountToken).toBe(false);
    expect(pod.spec.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: "RuntimeDefault" } });
    expect(pod.spec.containers[0]!.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ["ALL"] },
    });
    expect(pod.spec.restartPolicy).toBe("Never");
    expect(pod.spec.activeDeadlineSeconds).toBe(3600);
  });

  it("reaches the gateway by name, without DNS", () => {
    expect(pod.spec.hostAliases).toEqual([{ ip: "10.0.0.7", hostnames: ["gateway"] }]);
    expect(pod.spec.dnsPolicy).toBe("None");
    expect(pod.spec.enableServiceLinks).toBe(false);
  });

  it("carries the labels of the network policy and keeps its node", () => {
    expect(pod.metadata.labels).toMatchObject({ "opificia.role": "sandbox", "opificia.session": spec.sessionId, "opificia.run": "r1" });
    expect(pod.metadata.annotations["cluster-autoscaler.kubernetes.io/safe-to-evict"]).toBe("false");
  });

  it("asks for its resources, so a node autoscaler can make room", () => {
    expect(pod.spec.containers[0]).toMatchObject({ resources: { requests: { cpu: "2", memory: "4Gi" }, limits: { cpu: "2", memory: "4Gi" } } });
  });

  it("keeps the tokens out of the pod spec, in a secret the pod owns", () => {
    expect(JSON.stringify(pod)).not.toContain('"b"');
    expect(pod.spec.containers[0]).toMatchObject({ envFrom: [{ secretRef: { name: pod.metadata.name } }] });
    const secret = sandboxSecret(pod, "uid-1", spec.env);
    expect(secret.metadata.name).toBe(pod.metadata.name);
    expect(secret.metadata.ownerReferences).toEqual([{ apiVersion: "v1", kind: "Pod", name: pod.metadata.name, uid: "uid-1" }]);
    expect(secret.stringData).toEqual({ A: "b" });
  });

  it("takes the operator's runtime, nodes and pull secrets", () => {
    const custom = sandboxPod(spec, {
      gatewayIp: "10.0.0.7",
      deadlineSeconds: 60,
      settings: settings(
        JSON.stringify({
          runtimeClassName: "gvisor",
          nodeSelector: { "opificia.ai/pool": "sandbox" },
          tolerations: [{ key: "opificia.ai/sandbox", operator: "Exists", effect: "NoSchedule" }],
          imagePullSecrets: ["registry"],
          cpu: "1",
        }),
      ),
    });
    expect(custom.spec).toMatchObject({
      runtimeClassName: "gvisor",
      nodeSelector: { "opificia.ai/pool": "sandbox" },
      tolerations: [{ key: "opificia.ai/sandbox" }],
      imagePullSecrets: [{ name: "registry" }],
    });
    expect(custom.spec.containers[0]).toMatchObject({ resources: { requests: { cpu: "1" } } });
  });

  it("rejects settings it does not know", () => {
    expect(() => settings(JSON.stringify({ privileged: true }))).toThrow();
    expect(() => settings("not json")).toThrow();
  });
});

describe("probePod", () => {
  it("runs like a sandbox, on a sandbox node with the sandbox labels", () => {
    const pod = probePod({
      name: "p",
      image: "server:1",
      gatewayIp: "10.0.0.7",
      gatewayPort: 3001,
      targets: ["1.1.1.1:443"],
      settings: settings('{"nodeSelector":{"a":"b"},"runtimeClassName":"gvisor"}'),
    });
    expect(pod.metadata.labels["opificia.role"]).toBe("sandbox");
    expect(pod.spec).toMatchObject({ nodeSelector: { a: "b" }, runtimeClassName: "gvisor", hostAliases: [{ ip: "10.0.0.7" }] });
    expect(pod.spec.containers[0]).toMatchObject({
      command: ["node", "-e", expect.stringContaining("net.connect")],
      env: [
        { name: "PROBE_GATEWAY", value: "gateway:3001" },
        { name: "PROBE_TARGETS", value: '["1.1.1.1:443"]' },
      ],
    });
  });
});

describe("KubernetesService", () => {
  let server: Server;
  let url: string;
  const requests: Array<{ method: string; path: string; body?: { metadata?: { name?: string; ownerReferences?: unknown[] }; stringData?: unknown } }> = [];
  let probeExit = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += String(chunk)));
      req.on("end", () => {
        const path = req.url ?? "";
        requests.push({ method: req.method ?? "", path, body: raw ? JSON.parse(raw) : undefined });
        const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
        if (path === "/api/v1/namespaces/opificia/services/opificia-sandbox") return json(200, { spec: { clusterIP: "10.0.0.7", ports: [{ port: 3001 }] } });
        if (req.method === "POST" && path.endsWith("/pods")) {
          const name = (JSON.parse(raw) as { metadata: { name: string } }).metadata.name;
          return json(201, { metadata: { name, uid: `uid-${name}` } });
        }
        if (req.method === "POST") return json(201, {});
        if (req.method === "DELETE") return json(200, {});
        if (/\/pods\/opificia-network-probe-[0-9a-f]+\/log$/.test(path)) {
          return res.writeHead(200).end(["reached the gateway and nothing else", "reached 1.1.1.1:443", "could not reach the gateway at gateway:3001"][probeExit]);
        }
        if (/\/pods\/opificia-network-probe-/.test(path)) {
          return json(200, { status: { phase: probeExit ? "Failed" : "Succeeded", containerStatuses: [{ state: { terminated: { exitCode: probeExit } } }] } });
        }
        if (path.endsWith("/pods/opificia-run-done")) {
          return json(200, { status: { phase: "Failed", containerStatuses: [{ state: { terminated: { exitCode: 3 } } }] } });
        }
        if (path.includes("/pods?labelSelector=")) {
          return json(200, { items: [{ metadata: { name: "opificia-run-x", labels: { "opificia.session": "x" } } }] });
        }
        json(404, { kind: "Status", message: "pods not found" });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));
  afterEach(() => {
    requests.length = 0;
    vi.restoreAllMocks();
  });

  const service = () =>
    new KubernetesService({
      OPIFICIA_KUBERNETES_API: url,
      OPIFICIA_KUBERNETES_NAMESPACE: "opificia",
      OPIFICIA_KUBERNETES_GATEWAY_SERVICE: "opificia-sandbox",
      OPIFICIA_KUBERNETES_SANDBOX_POD: settings(),
      OPIFICIA_KUBERNETES_NETWORK_PROBE: "on",
      OPIFICIA_KUBERNETES_PROBE_IMAGE: "server:1",
      OPIFICIA_SANDBOX_IMAGE: "harness:1",
      OPIFICIA_RUN_TIMEOUT_MINUTES: 60,
    } as Config);

  it("finds the gateway, probes the network and starts pods", async () => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    probeExit = 0;
    const kube = service();
    await kube.prepare();
    expect(kube.gatewayUrl).toBe("gateway:3001");
    const probe = requests.find((r) => r.method === "POST");
    expect(probe?.body?.metadata?.name).toMatch(/^opificia-network-probe-/);
    expect(requests.some((r) => r.method === "DELETE" && r.path.includes("opificia-network-probe-"))).toBe(true);

    requests.length = 0;
    expect(await kube.startSandbox(spec)).toBe(`opificia-run-${spec.sessionId}`);
    const secret = requests.find((r) => r.path.endsWith("/secrets"));
    expect(secret?.body?.metadata?.ownerReferences).toEqual([
      { apiVersion: "v1", kind: "Pod", name: `opificia-run-${spec.sessionId}`, uid: `uid-opificia-run-${spec.sessionId}` },
    ]);
    expect(secret?.body?.stringData).toEqual({ A: "b" });
    expect(await kube.waitForExit("opificia-run-done")).toBe(3);
    expect(await kube.waitForExit("opificia-run-gone")).toBe(137);
    expect(await kube.listSandboxes()).toEqual([{ id: "opificia-run-x", sessionId: "x" }]);
  });

  it("refuses to run sandboxes when the cluster does not enforce the network policy", async () => {
    probeExit = 1;
    await expect(service().prepare()).rejects.toThrow(/can reach addresses directly .*\(reached 1\.1\.1\.1:443\)/);
    expect(requests.some((r) => r.method === "DELETE" && r.path.includes("opificia-network-probe-"))).toBe(true);
  });

  it("refuses to run sandboxes that cannot reach the worker", async () => {
    probeExit = 2;
    await expect(service().prepare()).rejects.toThrow(/a sandbox cannot reach the worker \(could not reach the gateway at gateway:3001\)/);
  });
});
