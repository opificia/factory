// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { writeFile } from "node:fs/promises";
import { Inject, Injectable, Logger } from "@nestjs/common";
import Docker from "dockerode";
import { CONFIG, DEFAULT_SANDBOX_IMAGE, type Config } from "../config.js";
import type { SandboxBackend, SandboxSpec } from "./backend.js";

export const SANDBOX_NETWORK = "opificia-sandbox";
export const GATEWAY_CONTAINER = "opificia-gateway";
/** node 24.22.0, Debian bookworm slim; the same image the harness builds on. */
export const GATEWAY_IMAGE = "node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5";
const GATEWAY_PORT = 8080;

/**
 * The gateway: a TCP forwarder that is the only member of the sandbox network
 * with a route out. It forwards to the control plane's sandbox port and
 * nowhere else. Sandboxes reach it as `gateway:8080`.
 */
const FORWARDER = `
const net = require("node:net");
const host = process.env.TARGET_HOST, port = Number(process.env.TARGET_PORT);
net.createServer((client) => {
  const upstream = net.connect(port, host);
  client.pipe(upstream).pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
}).listen(${GATEWAY_PORT}, () => console.log("gateway forwarding to " + host + ":" + port));
`;

/** Sandboxes as containers on the local Docker engine, for single-node installs. */
@Injectable()
export class DockerService implements SandboxBackend {
  private readonly logger = new Logger(DockerService.name);
  private readonly docker = new Docker();

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  readonly gatewayUrl = `gateway:${GATEWAY_PORT}`;
  readonly helloTimeoutMs = 3 * 60 * 1000;

  /** Creates the internal network and (re)starts the gateway. */
  async prepare(): Promise<void> {
    await this.docker.ping();
    if (!(await this.imageExists(this.config.OPIFICIA_SANDBOX_IMAGE))) {
      const image = this.config.OPIFICIA_SANDBOX_IMAGE;
      // `pnpm sandbox:build` builds the default image only.
      const hint = image === DEFAULT_SANDBOX_IMAGE ? "build it with: pnpm sandbox:build" : "build it, or pull it from your registry";
      this.logger.warn(`the sandbox image ${image} is missing; ${hint}`);
    }
    const networks = await this.docker.listNetworks({ filters: { name: [SANDBOX_NETWORK] } });
    if (!networks.some((n) => n.Name === SANDBOX_NETWORK)) {
      await this.docker.createNetwork({ Name: SANDBOX_NETWORK, Driver: "bridge", Internal: true, Labels: { "opificia.role": "sandbox-network" } });
      this.logger.log(`created internal network ${SANDBOX_NETWORK}`);
    }
    await this.pullIfMissing(GATEWAY_IMAGE);
    await this.removeIfExists(GATEWAY_CONTAINER);
    const gateway = await this.docker.createContainer({
      name: GATEWAY_CONTAINER,
      Image: GATEWAY_IMAGE,
      Cmd: ["node", "-e", FORWARDER],
      User: "1000:1000",
      Env: ["TARGET_HOST=host.docker.internal", `TARGET_PORT=${this.config.OPIFICIA_SANDBOX_PORT}`],
      Labels: { "opificia.role": "gateway" },
      HostConfig: {
        NetworkMode: "bridge",
        ExtraHosts: ["host.docker.internal:host-gateway"],
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        ReadonlyRootfs: true,
        Memory: 128 * 1024 * 1024,
        PidsLimit: 64,
        RestartPolicy: { Name: "unless-stopped" },
      },
    });
    await this.docker.getNetwork(SANDBOX_NETWORK).connect({ Container: gateway.id, EndpointConfig: { Aliases: ["gateway"] } });
    await gateway.start();
    this.logger.log(`gateway started on ${SANDBOX_NETWORK}, forwarding to the sandbox port ${this.config.OPIFICIA_SANDBOX_PORT}`);
  }

  async imageExists(image: string): Promise<boolean> {
    return this.docker.getImage(image).inspect().then(
      () => true,
      () => false,
    );
  }

  private async pullIfMissing(image: string): Promise<void> {
    if (await this.imageExists(image)) return;
    const stream = await this.docker.pull(image);
    await new Promise((resolve, reject) => this.docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve(null))));
  }

  private async removeIfExists(name: string): Promise<void> {
    await this.docker.getContainer(name).remove({ force: true }).catch(() => undefined);
  }

  /**
   * Starts a sandbox: no route to the internet, no capabilities, a read-only
   * root file system, limits on memory, CPU and processes. Nothing of the
   * host is mounted: files travel over the gateway (ADR-0010).
   */
  async startSandbox(spec: SandboxSpec): Promise<string> {
    const container = await this.docker.createContainer({
      name: `opificia-run-${spec.sessionId}`,
      Image: spec.image,
      User: "1000:1000",
      Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
      Labels: { "opificia.role": "sandbox", "opificia.run": spec.runId, "opificia.session": spec.sessionId },
      HostConfig: {
        NetworkMode: SANDBOX_NETWORK,
        Tmpfs: {
          "/work": "rw,exec,size=4g,mode=1777",
          "/tmp": "rw,exec,size=1g,mode=1777",
          "/home/node": "rw,exec,size=1g,mode=1777",
        },
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        Memory: 4 * 1024 * 1024 * 1024,
        NanoCpus: 2_000_000_000,
        PidsLimit: 1024,
      },
    });
    await container.start();
    return container.id;
  }

  async waitForExit(containerId: string): Promise<number> {
    const result = (await this.docker.getContainer(containerId).wait()) as { StatusCode: number };
    return result.StatusCode;
  }

  async saveLogs(containerId: string, file: string): Promise<void> {
    const logs = await this.docker.getContainer(containerId).logs({ stdout: true, stderr: true, follow: false, timestamps: true });
    await writeFile(file, demux(logs as unknown as Buffer));
  }

  async remove(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).remove({ force: true }).catch(() => undefined);
  }

  async stop(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).stop({ t: 5 }).catch(() => undefined);
  }

  async listSandboxes(): Promise<Array<{ id: string; sessionId: string }>> {
    const containers = await this.docker.listContainers({ all: true, filters: { label: ["opificia.role=sandbox"] } });
    return containers.map((c) => ({ id: c.Id, sessionId: c.Labels["opificia.session"] ?? "" }));
  }
}

/** Strips Docker's 8-byte stream headers from non-TTY log output. */
function demux(buffer: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return offset === buffer.length ? Buffer.concat(chunks) : buffer;
}
