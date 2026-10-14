// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  JsonRpcNotification,
  JsonRpcRequest,
  RunnerCompleteParams,
  RunnerEventParams,
  RunnerHelloParams,
  RunnerMethods,
  RunnerTask,
  type Stage,
} from "@opificia/contracts";
import type { WebSocket } from "ws";
import { CONFIG, type Config } from "../config.js";
import { PrismaService } from "../prisma.service.js";
import { DomainError } from "../runs/decider.js";
import { EventStore } from "../runs/event-store.service.js";
import { DockerService } from "./docker.service.js";

/** How long a sandbox may take to connect after it starts. */
const HELLO_TIMEOUT_MS = 3 * 60 * 1000;
/** Progress events kept per stage; more are dropped. */
const MAX_EVENTS_PER_SESSION = 3000;

type ActiveSession = {
  sessionId: string;
  runId: string;
  orgId: string;
  stage: Stage;
  tokenHash: string;
  socket?: WebSocket;
  events: number;
  modelRequests: number;
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Sandbox sessions: one container for one stage of a run. This service starts
 * and watches containers, and speaks the runner protocol with them.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly active = new Map<string, ActiveSession>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly events: EventStore,
  ) {}

  dirs(runId: string, sessionId: string) {
    const base = join(this.config.OPIFICIA_DATA_DIR, "runs", runId, sessionId);
    return { base, inDir: join(base, "in"), outDir: join(base, "out") };
  }

  async makeDirs(runId: string, sessionId: string) {
    const dirs = this.dirs(runId, sessionId);
    await mkdir(dirs.inDir, { recursive: true });
    await mkdir(dirs.outDir, { recursive: true });
    // The sandbox user is not the host user; let it write its result.
    await chmod(dirs.outDir, 0o777);
    return dirs;
  }

  /** Records a session and returns its secret token. */
  async create(input: { sessionId: string; orgId: string; runId: string; stage: Stage; task: RunnerTask }): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.sandboxSession.create({
      data: {
        id: input.sessionId,
        orgId: input.orgId,
        runId: input.runId,
        stage: input.stage,
        tokenHash: hashToken(token),
        task: input.task,
      },
    });
    return token;
  }

  async discard(sessionId: string): Promise<void> {
    await this.prisma.sandboxSession.update({ where: { id: sessionId }, data: { status: "discarded", endedAt: new Date() } });
  }

  /** Starts the container for a session and watches it until it exits. */
  async launch(sessionId: string, token: string): Promise<void> {
    const session = await this.prisma.sandboxSession.findUniqueOrThrow({ where: { id: sessionId } });
    const { inDir, outDir, base } = this.dirs(session.runId, session.id);
    const gateway = this.docker.gatewayUrl;
    const containerId = await this.docker.startSandbox({
      sessionId,
      runId: session.runId,
      image: this.config.OPIFICIA_SANDBOX_IMAGE,
      inDir,
      outDir,
      env: {
        OPIFICIA_RUNNER_URL: `ws://${gateway}/runner`,
        OPIFICIA_RUNNER_TOKEN: token,
        ANTHROPIC_BASE_URL: `http://${gateway}/model/${sessionId}`,
        ANTHROPIC_AUTH_TOKEN: token,
      },
    });
    await this.prisma.sandboxSession.update({ where: { id: sessionId }, data: { containerId } });
    this.logger.log(`run ${session.runId}: started ${session.stage} sandbox ${containerId.slice(0, 12)}`);

    const helloTimer = setTimeout(() => {
      void this.prisma.sandboxSession.findUnique({ where: { id: sessionId } }).then(async (s) => {
        if (s?.status === "starting") {
          this.logger.warn(`session ${sessionId} did not connect in time`);
          await this.docker.stop(containerId);
        }
      });
    }, HELLO_TIMEOUT_MS);

    void this.docker
      .waitForExit(containerId)
      .then(async (exitCode) => {
        clearTimeout(helloTimer);
        await this.docker.saveLogs(containerId, join(base, "container.log")).catch(() => undefined);
        await this.docker.remove(containerId);
        await this.onExit(sessionId, exitCode);
      })
      .catch((error: Error) => this.logger.error(`watching ${containerId}: ${error.message}`));
  }

  private async onExit(sessionId: string, exitCode: number): Promise<void> {
    const session = await this.prisma.sandboxSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    const unfinished = session.status === "starting" || session.status === "running";
    await this.prisma.sandboxSession.update({
      where: { id: sessionId },
      data: { exitCode, endedAt: new Date(), ...(unfinished ? { status: "failed" } : {}) },
    });
    this.active.delete(sessionId);
    if (unfinished) {
      await this.fail(session.orgId, session.runId, `the sandbox stopped before it finished (exit code ${exitCode})`, session.stage as Stage, session.id);
    }
  }

  /** Fails the run, unless it has moved on to another sandbox. */
  private async fail(orgId: string, runId: string, reason: string, stage?: Stage, sessionId?: string): Promise<void> {
    if (sessionId) {
      const run = await this.prisma.run.findUnique({ where: { id: runId } });
      if (run?.sessionId !== sessionId) return;
    }
    await this.events.dispatch(orgId, runId, { type: "Fail", reason, ...(stage ? { stage } : {}) }).catch((error: Error) => {
      this.logger.warn(`could not fail run ${runId}: ${error.message}`);
    });
  }

  /** Stops every sandbox of a run, for example when it is cancelled. */
  async stopRun(runId: string, reason: string): Promise<void> {
    const sessions = await this.prisma.sandboxSession.findMany({ where: { runId, status: { in: ["starting", "running"] } } });
    for (const session of sessions) {
      await this.prisma.sandboxSession.update({ where: { id: session.id }, data: { status: "stopped", endedAt: new Date() } });
      const active = this.active.get(session.id);
      active?.socket?.send(JSON.stringify({ jsonrpc: "2.0", method: RunnerMethods.cancel, params: { reason } }));
      this.active.delete(session.id);
      if (session.containerId) await this.docker.stop(session.containerId);
    }
  }

  /** After a restart, nothing watches old sandboxes. Stop them and fail their runs. */
  async reconcile(): Promise<void> {
    for (const container of await this.docker.listSandboxes()) await this.docker.remove(container.id);
    const stale = await this.prisma.sandboxSession.findMany({ where: { status: { in: ["starting", "running"] } } });
    for (const session of stale) {
      await this.prisma.sandboxSession.update({ where: { id: session.id }, data: { status: "failed", endedAt: new Date() } });
      await this.fail(session.orgId, session.runId, "the server restarted while the sandbox was running", session.stage as Stage, session.id);
    }
  }

  /**
   * Checks a model request's token. Only sessions that said hello may use the
   * model, and only up to a fixed number of requests. The harness enforces the
   * USD budget itself; this cap holds even if the agent bypasses the harness
   * and calls the proxy directly.
   */
  authorizeModel(sessionId: string, token: string): { session: ActiveSession; overLimit: boolean } | undefined {
    const session = this.active.get(sessionId);
    if (!session || !sameHash(session.tokenHash, hashToken(token))) return undefined;
    session.modelRequests += 1;
    return { session, overLimit: session.modelRequests > this.config.OPIFICIA_MAX_MODEL_REQUESTS };
  }

  /** Serves the runner protocol on one WebSocket connection. */
  handleConnection(socket: WebSocket): void {
    let session: ActiveSession | undefined;
    const timer = setTimeout(() => socket.close(4001, "no hello"), 30_000);

    const reply = (id: string | number, result: unknown) => socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    const error = (id: string | number | null, code: number, message: string) =>
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));

    socket.on("message", (raw) => {
      void (async () => {
        let message: unknown;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return error(null, -32700, "parse error");
        }
        const request = JsonRpcRequest.safeParse(message);
        if (request.success) {
          const { id, method, params } = request.data;
          try {
            if (method === RunnerMethods.hello) {
              if (session) return error(id, -32600, "already introduced");
              const result = await this.hello(params);
              session = { ...result.session, socket };
              this.active.set(session.sessionId, session);
              clearTimeout(timer);
              return reply(id, result.task);
            }
            if (!session) return error(id, -32001, "say hello first");
            if (method === RunnerMethods.complete) {
              await this.complete(session, params);
              return reply(id, { ok: true });
            }
            return error(id, -32601, `unknown method ${method}`);
          } catch (e) {
            const text = e instanceof Error ? e.message : String(e);
            return error(id, e instanceof DomainError ? -32002 : -32603, text);
          }
        }
        const notification = JsonRpcNotification.safeParse(message);
        if (notification.success && notification.data.method === RunnerMethods.event && session) {
          await this.progress(session, notification.data.params);
        }
      })().catch((e: Error) => this.logger.warn(`runner message: ${e.message}`));
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!session) return;
      const s = session;
      void (async () => {
        const updated = await this.prisma.sandboxSession.updateMany({
          where: { id: s.sessionId, status: "running" },
          data: { status: "failed", endedAt: new Date() },
        });
        this.active.delete(s.sessionId);
        if (updated.count > 0) await this.fail(s.orgId, s.runId, "the sandbox disconnected before it finished", s.stage, s.sessionId);
      })();
    });
  }

  private async hello(params: unknown): Promise<{ task: RunnerTask; session: Omit<ActiveSession, "socket"> }> {
    const hello = RunnerHelloParams.parse(params);
    const tokenHash = hashToken(hello.token);
    const session = await this.prisma.sandboxSession.findUnique({ where: { tokenHash } });
    if (!session) throw new Error("unknown token");
    // A token works for one connection only.
    const claimed = await this.prisma.sandboxSession.updateMany({
      where: { id: session.id, status: "starting" },
      data: { status: "running", helloAt: new Date() },
    });
    if (claimed.count === 0) throw new Error("this session is not waiting for a runner");
    const run = await this.prisma.run.findUnique({ where: { id: session.runId } });
    if (run?.sessionId !== session.id) throw new DomainError("this sandbox is no longer current");
    this.logger.log(`run ${session.runId}: ${hello.harness.name} ${hello.harness.version} connected for ${session.stage}`);
    return {
      task: RunnerTask.parse(session.task),
      session: {
        sessionId: session.id,
        runId: session.runId,
        orgId: session.orgId,
        stage: session.stage as Stage,
        tokenHash,
        events: 0,
        modelRequests: 0,
      },
    };
  }

  private async progress(session: ActiveSession, params: unknown): Promise<void> {
    const event = RunnerEventParams.safeParse(params);
    if (!event.success || ++session.events > MAX_EVENTS_PER_SESSION) return;
    await this.events
      .dispatch(session.orgId, session.runId, {
        type: "RecordActivity",
        sessionId: session.sessionId,
        stage: session.stage,
        activity: event.data,
      })
      .catch((e: Error) => this.logger.warn(`progress for run ${session.runId}: ${e.message}`));
  }

  private async complete(session: ActiveSession, params: unknown): Promise<void> {
    const result = RunnerCompleteParams.parse(params);
    if (result.outcome === "implementation_ready") {
      const file = join(this.dirs(session.runId, session.sessionId).outDir, result.bundle);
      const info = await stat(file).catch(() => undefined);
      if (!info?.isFile()) throw new Error(`the bundle ${result.bundle} is missing`);
    }
    const claimed = await this.prisma.sandboxSession.updateMany({
      where: { id: session.sessionId, status: "running" },
      data: { status: "completed" },
    });
    if (claimed.count === 0) throw new DomainError("this session is no longer running");
    this.active.delete(session.sessionId);
    await this.events.dispatch(session.orgId, session.runId, {
      type: "CompleteStage",
      sessionId: session.sessionId,
      stage: session.stage,
      result,
    });
  }
}
