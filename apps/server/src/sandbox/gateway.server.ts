// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { WebSocketServer } from "ws";
import { CONFIG, type Config } from "../config.js";
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

/**
 * The server sandboxes talk to, on its own port, apart from the API that
 * people use. It serves two things:
 *
 * - `/runner`: the runner protocol, over a WebSocket;
 * - `/model/<session>/...`: a pass-through proxy to the model API that adds
 *   the operator's API key. The key never enters a sandbox.
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
