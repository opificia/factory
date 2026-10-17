// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SandboxPodSettings, type Config } from "../config.js";
import { KubernetesService, judgeProbe, probePod, sandboxPod, sandboxSecret, type ProbeResult } from "./kubernetes.service.js";

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
    expect(pod.metadata.annotations).toEqual({ "cluster-autoscaler.kubernetes.io/safe-to-evict": "false", "karpenter.sh/do-not-disrupt": "true" });
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

  it("runs the control on the same nodes, outside the sandbox policy and without the gateway", () => {
    const pod = probePod({ name: "c", image: "s", gatewayIp: "10.0.0.7", gatewayPort: 3001, targets: [], settings: settings('{"nodeSelector":{"a":"b"}}'), control: true });
    expect(pod.metadata.labels["opificia.role"]).toBe("network-control");
    expect(pod.spec.nodeSelector).toEqual({ a: "b" });
    expect(pod.spec.containers[0]).toMatchObject({ env: [{ name: "PROBE_TARGETS", value: "[]" }] });
  });
});

describe("judgeProbe", () => {
  const judge = (sandbox: ProbeResult, control: ProbeResult) => judgeProbe(sandbox, control, "opificia-sandbox");

  it("lets sandboxes start when the policy blocks what the control reaches", () => {
    expect(judge({ gateway: true, reached: [] }, { gateway: false, reached: ["10.96.0.1:443"] })).toMatchObject({ ok: true });
  });

  it("refuses when a sandbox reaches a target", () => {
    expect(judge({ gateway: true, reached: ["1.1.1.1:443"] }, { gateway: false, reached: ["1.1.1.1:443"] })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("can reach 1.1.1.1:443 directly"),
    });
  });

  it("refuses when a sandbox cannot reach the worker", () => {
    expect(judge({ gateway: false, reached: [] }, { gateway: false, reached: ["10.96.0.1:443"] })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("cannot reach the worker"),
    });
  });

  it("refuses when a firewall blocks the control too, because that proves nothing", () => {
    expect(judge({ gateway: true, reached: [] }, { gateway: false, reached: [] })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("inconclusive"),
    });
  });
});

describe("KubernetesService", () => {
  let server: Server;
  let url: string;
  const requests: Array<{ method: string; path: string; body?: { metadata?: { name?: string; ownerReferences?: unknown[] }; stringData?: unknown; spec?: unknown } }> = [];
  const tight = {
    metadata: { name: "opificia-sandbox" },
    spec: { podSelector: { matchLabels: { "opificia.role": "sandbox" } }, policyTypes: ["Egress"], egress: [{ to: [{ podSelector: {} }], ports: [{ port: 3001 }] }] },
  };
  let policies: unknown[] = [tight];
  let probes: { sandbox: ProbeResult; control: ProbeResult } = { sandbox: { gateway: true, reached: [] }, control: { gateway: false, reached: ["10.96.0.1:443"] } };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += String(chunk)));
      req.on("end", () => {
        const path = req.url ?? "";
        requests.push({ method: req.method ?? "", path, body: raw ? JSON.parse(raw) : undefined });
        const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
        if (path === "/api/v1/namespaces/opificia/services/opificia-sandbox") return json(200, { spec: { clusterIP: "10.0.0.7", ports: [{ port: 3001 }] } });
        if (path === "/apis/networking.k8s.io/v1/namespaces/opificia/networkpolicies") return json(200, { items: policies });
        if (req.method === "POST" && path.endsWith("/pods")) {
          const name = (JSON.parse(raw) as { metadata: { name: string } }).metadata.name;
          return json(201, { metadata: { name, uid: `uid-${name}` } });
        }
        if (req.method === "POST") return json(201, {});
        if (req.method === "DELETE") return json(200, {});
        const probe = /\/pods\/opificia-network-(probe|control)-[0-9a-f]+(\/log)?$/.exec(path);
        if (probe) {
          const result = probe[1] === "probe" ? probes.sandbox : probes.control;
          if (probe[2]) return res.writeHead(200).end(JSON.stringify(result));
          return json(200, { spec: { nodeName: "sandbox-node-1" }, status: { phase: "Succeeded", containerStatuses: [{ state: { terminated: { exitCode: 0 } } }] } });
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
      OPIFICIA_SANDBOX_PORT: 3001,
    } as Config);

  it("finds the gateway, probes the network and starts pods", async () => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    probes = { sandbox: { gateway: true, reached: [] }, control: { gateway: false, reached: ["10.96.0.1:443"] } };
    const kube = service();
    await kube.prepare();
    expect(kube.gatewayUrl).toBe("gateway:3001");
    const created = requests.filter((r) => r.method === "POST").map((r) => r.body as { metadata: { name: string }; spec: { nodeName?: string } });
    expect(created.map((p) => p.metadata.name)).toEqual([expect.stringMatching(/^opificia-network-probe-/), expect.stringMatching(/^opificia-network-control-/)]);
    // The control runs on the node the sandbox probe got.
    expect(created.map((p) => p.spec.nodeName)).toEqual([undefined, "sandbox-node-1"]);
    const deleted = requests.filter((r) => r.method === "DELETE").map((r) => r.path);
    expect(deleted).toEqual([expect.stringContaining("opificia-network-probe-"), expect.stringContaining("opificia-network-control-")]);

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

  it("refuses to run sandboxes when a network policy lets them out", async () => {
    policies = [tight, { metadata: { name: "allow-all" }, spec: { podSelector: {}, policyTypes: ["Egress"], egress: [{}] } }];
    await expect(service().prepare()).rejects.toThrow(/allow-all lets sandboxes reach any address/);
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    policies = [tight];
  });

  it("refuses to run sandboxes when the cluster does not enforce the network policy", async () => {
    probes = { sandbox: { gateway: true, reached: ["1.1.1.1:443"] }, control: { gateway: false, reached: ["1.1.1.1:443"] } };
    await expect(service().prepare()).rejects.toThrow(/can reach 1\.1\.1\.1:443 directly/);
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(2);
  });
});
