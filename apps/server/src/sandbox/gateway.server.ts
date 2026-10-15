// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { lookup } from "node:dns/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { WebSocketServer } from "ws";
import { CONFIG, type Config } from "../config.js";
import { decideHost, isPublicAddress } from "./egress-policy.js";
import { SessionsService } from "./sessions.service.js";

/** Model API paths a sandbox may call. Everything else is refused. */
const ALLOWED_MODEL_PATHS = [/^\/v1\/messages(\?.*)?$/, /^\/v1\/messages\/count_tokens(\?.*)?$/];
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const DROP_REQUEST_HEADERS = new Set([
  "host",
  "authorization",
  "x-api-key",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
  "keep-alive",
  "proxy-authorization",
]);
const DROP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);
/** An egress connection with no traffic for this long is closed. */
const EGRESS_IDLE_MS = 5 * 60 * 1000;
const EGRESS_CONNECT_TIMEOUT_MS = 15_000;

/**
 * The server sandboxes talk to, on its own port, apart from the API that
 * people use. It serves two things:
 *
 * - `/runner`: the runner protocol, over a WebSocket;
 * - `/model/<session>/...`: a pass-through proxy to the model API that adds
 *   the operator's API key. The key never enters a sandbox;
 * - `CONNECT host:443`: the egress proxy (ADR-0007). It applies the network
 *   policy of the session, refuses hosts that resolve to non-public addresses,
 *   and does not decrypt HTTPS.
 */
@Injectable()
export class SandboxGateway implements OnModuleDestroy {
  private readonly logger = new Logger(SandboxGateway.name);
  private server?: Server;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly sessions: SessionsService,
  ) {}

  async listen(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleHttp(req, res).catch((error: Error) => {
        // A sandbox that stops mid-request aborts the upstream call; that is expected.
        if (res.destroyed || error.name === "AbortError") return;
        this.logger.error(`model proxy: ${error.message}`);
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "upstream request failed" } }));
      });
    });
    this.server.on("connect", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.handleConnect(req, socket as Socket, head).catch((error: Error) => {
        this.logger.warn(`egress proxy: ${error.message}`);
        socket.destroy();
      });
    });
    this.server.on("upgrade", (req, socket, head) => {
      if (req.url !== "/runner") {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.sessions.handleConnection(ws));
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(this.config.OPIFICIA_SANDBOX_PORT, this.config.OPIFICIA_SANDBOX_BIND, () => resolve()),
    );
    this.logger.log(`sandbox gateway listening on ${this.config.OPIFICIA_SANDBOX_BIND}:${this.config.OPIFICIA_SANDBOX_PORT}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.wss.close();
    await new Promise((resolve) => (this.server ? this.server.close(resolve) : resolve(null)));
  }

  private async handleConnect(req: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    const refuse = (status: 403 | 407 | 502 | 504, text: string) => {
      const reason = { 403: "Forbidden", 407: "Proxy Authentication Required", 502: "Bad Gateway", 504: "Gateway Timeout" }[status];
      client.end(`HTTP/1.1 ${status} ${reason}\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\nOpificia egress proxy: ${text}\n`);
    };
    const credentials = /^Basic\s+(.+)$/i.exec(req.headers["proxy-authorization"] ?? "")?.[1];
    const [sessionId = "", token = ""] = credentials ? Buffer.from(credentials, "base64").toString("utf8").split(":") : [];
    const access = this.sessions.authorizeEgress(sessionId, token);
    if (!access) return refuse(407, "unknown sandbox session");

    const target = /^([^:\s]+|\[[0-9a-fA-F:.]+\]):(\d{1,5})$/.exec(req.url ?? "");
    const host = (target?.[1] ?? "").toLowerCase();
    const port = Number(target?.[2] ?? 0);
    const decision = decideHost({ host, port, level: access.network, extraHosts: this.config.OPIFICIA_EGRESS_ALLOW });
    if (!decision.allowed) {
      await this.sessions.recordEgress(sessionId, { host, port, allowed: false, reason: decision.reason });
      return refuse(403, `${host}:${port} refused: ${decision.reason}`);
    }

    // Resolve here and connect to the address we checked, so a second lookup
    // cannot point the connection somewhere else.
    const addresses = await lookup(host, { all: true }).catch(() => []);
    if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
      const reason = addresses.length === 0 ? "the host name does not resolve" : "the host resolves to a non-public address";
      await this.sessions.recordEgress(sessionId, { host, port, allowed: false, reason });
      return refuse(403, `${host}:${port} refused: ${reason}`);
    }
    await this.sessions.recordEgress(sessionId, { host, port, allowed: true, reason: decision.reason });

    const upstream = connect({ host: addresses[0]!.address, port, timeout: EGRESS_CONNECT_TIMEOUT_MS });
    let sent = head.length;
    let received = 0;
    let connected = false;
    upstream.once("connect", () => {
      connected = true;
      upstream.setTimeout(EGRESS_IDLE_MS);
      client.setTimeout(EGRESS_IDLE_MS);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      client.on("data", (chunk: Buffer) => (sent += chunk.length));
      upstream.on("data", (chunk: Buffer) => (received += chunk.length));
      client.pipe(upstream).pipe(client);
    });
    const close = () => {
      upstream.destroy();
      client.destroy();
    };
    upstream.on("timeout", () => {
      if (connected) return close();
      refuse(504, `${host}:${port} did not answer in time`);
      upstream.destroy();
    });
    client.on("timeout", close);
    upstream.on("error", () => {
      if (!connected) {
        refuse(502, `${host}:${port} could not be reached`);
        upstream.destroy();
        return;
      }
      close();
    });
    client.on("error", close);
    upstream.once("close", () => {
      if (!connected) return;
      client.destroy();
      void this.sessions.recordEgress(sessionId, { host, port, allowed: true, reason: "closed", sent, received });
    });
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const match = /^\/model\/([0-9a-f-]{36})(\/.*)$/.exec(req.url ?? "");
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const [, sessionId, path] = match as unknown as [string, string, string];
    const presented = req.headers["x-api-key"] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const access = typeof presented === "string" ? this.sessions.authorizeModel(sessionId, presented) : undefined;
    if (!access) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "unknown sandbox session" } }));
      return;
    }
    const { session } = access;
    if (access.overLimit) {
      this.logger.warn(`run ${session.runId}: refused a model request over the limit for this stage`);
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "this run has used all its model requests" } }));
      return;
    }
    if (!ALLOWED_MODEL_PATHS.some((p) => p.test(path))) {
      this.logger.warn(`run ${session.runId}: refused model path ${req.method} ${path}`);
      res.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_REQUEST_BYTES) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk as Buffer);
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || DROP_REQUEST_HEADERS.has(name)) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("x-api-key", this.config.ANTHROPIC_API_KEY);
    headers.set("accept-encoding", "identity");

    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const upstream = await fetch(new URL(path, this.config.OPIFICIA_ANTHROPIC_UPSTREAM), {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
      signal: abort.signal,
    });

    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, name) => {
      if (!DROP_RESPONSE_HEADERS.has(name)) responseHeaders[name] = value;
    });
    res.writeHead(upstream.status, responseHeaders);
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  }
}
