// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, stat } from "node:fs/promises";
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
import { Deferred } from "../common/deferred.js";
import { CONFIG, type Config } from "../config.js";
import { PrismaService } from "../prisma.service.js";
import { DomainError } from "../runs/decider.js";
import { EventStore } from "../runs/event-store.service.js";
import { SANDBOX_BACKEND, shortId, type SandboxBackend } from "./backend.js";
import { EgressBudget } from "./egress-policy.js";

/** How long a stage waits before it checks again for room for its sandbox. */
export const WAIT_FOR_ROOM_MS = 30_000;
/** Key of the PostgreSQL advisory lock under which sessions are admitted. */
const ADMISSION_LOCK = 0x6f706966;
const BUSY = ["starting", "running"];
/** Progress events kept per stage; more are dropped. */
const MAX_EVENTS_PER_SESSION = 3000;
/** Lines written to a session's egress log; more are dropped. */
const MAX_EGRESS_LOG_LINES = 10_000;

type ActiveSession = {
  sessionId: string;
  runId: string;
  orgId: string;
  stage: Stage;
  network: RunnerTask["network"];
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
 * Sandbox sessions: one sandbox for one stage of a run. This service starts
 * and watches sandboxes, and speaks the runner protocol with them.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly active = new Map<string, ActiveSession>();
  /** Hashes of the egress proxy tokens, by session. Kept apart from the runner token. */
  private readonly egressTokens = new Map<string, string>();
  /** What each session may still do through the egress proxy. */
  private readonly egressBudgets = new Map<string, EgressBudget>();
  private readonly egressLogLines = new Map<string, number>();
  /** Hosts already shown in the timeline, by session, so a retry loop does not flood it. */
  private readonly egressShown = new Map<string, Set<string>>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly prisma: PrismaService,
    @Inject(SANDBOX_BACKEND) private readonly sandboxes: SandboxBackend,
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
    return dirs;
  }

  /** Whether `limit` sandboxes are starting or running already. A hint only: `create` decides. */
  async full(limit: number): Promise<boolean> {
    return (await this.prisma.sandboxSession.count({ where: { status: { in: BUSY } } })) >= limit;
  }

  /**
   * Records a session and returns its secret token, if fewer than `limit`
   * sandboxes are starting or running; otherwise throws `Deferred`. Workers
   * admit sessions one at a time under a database lock, so the limit holds
   * across all of them.
   */
  async create(input: { sessionId: string; orgId: string; runId: string; stage: Stage; task: RunnerTask; limit: number }): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMISSION_LOCK}::bigint)`;
      const busy = await tx.sandboxSession.count({ where: { status: { in: BUSY } } });
      if (busy >= input.limit) throw new Deferred(`all ${input.limit} sandboxes are busy`, WAIT_FOR_ROOM_MS);
      await tx.sandboxSession.create({
        data: {
          id: input.sessionId,
          orgId: input.orgId,
          runId: input.runId,
          stage: input.stage,
          tokenHash: hashToken(token),
          task: input.task,
        },
      });
    });
    return token;
  }

  async discard(sessionId: string): Promise<void> {
    await this.prisma.sandboxSession.update({ where: { id: sessionId }, data: { status: "discarded", endedAt: new Date() } });
  }

  /** Starts the container for a session and watches it until it exits. */
  async launch(sessionId: string, token: string): Promise<void> {
    const session = await this.prisma.sandboxSession.findUniqueOrThrow({ where: { id: sessionId } });
    const { base } = this.dirs(session.runId, session.id);
    const gateway = this.sandboxes.gatewayUrl;
    const task = RunnerTask.parse(session.task);
    const env: Record<string, string> = {
      OPIFICIA_RUNNER_URL: `ws://${gateway}/runner`,
      OPIFICIA_RUNNER_TOKEN: token,
      ANTHROPIC_BASE_URL: `http://${gateway}/model/${sessionId}`,
      ANTHROPIC_AUTH_TOKEN: token,
    };
    // The egress proxy has its own token, so the agent's tools can use the
    // proxy without holding the runner token.
    if (task.network !== "none") {
      const egressToken = randomBytes(32).toString("base64url");
      this.egressTokens.set(sessionId, hashToken(egressToken));
      this.egressBudgets.set(sessionId, new EgressBudget());
      env.OPIFICIA_EGRESS_PROXY = `http://${sessionId}:${egressToken}@${gateway}`;
    }
    const containerId = await this.sandboxes.startSandbox({
      sessionId,
      runId: session.runId,
      image: this.config.OPIFICIA_SANDBOX_IMAGE,
      env,
    });
    await this.prisma.sandboxSession.update({ where: { id: sessionId }, data: { containerId } });
    this.logger.log(`run ${session.runId}: started ${session.stage} sandbox ${shortId(containerId)}`);

    const helloTimer = setTimeout(() => {
      void this.prisma.sandboxSession
        .findUnique({ where: { id: sessionId } })
        .then(async (s) => {
          if (s?.status === "starting") {
            this.logger.warn(`session ${sessionId} did not connect in time`);
            await this.sandboxes.stop(containerId);
          }
        })
        .catch((error: Error) => this.logger.error(`checking session ${sessionId}: ${error.message}`));
    }, this.sandboxes.helloTimeoutMs);

    void this.sandboxes
      .waitForExit(containerId)
      .then(async (exitCode) => {
        clearTimeout(helloTimer);
        await this.sandboxes.saveLogs(containerId, join(base, "container.log")).catch(() => undefined);
        await this.sandboxes.remove(containerId);
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
    this.egressTokens.delete(sessionId);
    this.egressBudgets.delete(sessionId);
    this.egressLogLines.delete(sessionId);
    this.egressShown.delete(sessionId);
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
      if (session.containerId) await this.sandboxes.stop(session.containerId);
    }
  }

  /** After a restart, nothing watches old sandboxes. Stop them and fail their runs. */
  async reconcile(): Promise<void> {
    for (const container of await this.sandboxes.listSandboxes()) await this.sandboxes.remove(container.id);
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

  /**
   * Checks a runner token, for the file transfers of a session that said
   * hello. Like the model proxy, it accepts the token after the hello.
   */
  authorizeRunner(token: string): ActiveSession | undefined {
    const hash = hashToken(token);
    for (const session of this.active.values()) if (sameHash(session.tokenHash, hash)) return session;
    return undefined;
  }

  /**
   * Checks an egress proxy token. Only running sessions with a network level
   * above `none` have one.
   */
  authorizeEgress(
    sessionId: string,
    token: string,
  ): { runId: string; orgId: string; network: RunnerTask["network"]; budget: EgressBudget } | undefined {
    const hash = this.egressTokens.get(sessionId);
    const budget = this.egressBudgets.get(sessionId);
    const session = this.active.get(sessionId);
    if (!hash || !budget || !session || !sameHash(hash, hashToken(token))) return undefined;
    return { runId: session.runId, orgId: session.orgId, network: session.network, budget };
  }

  /**
   * Records an egress decision: every decision in the session's egress log,
   * and the first decision per host and outcome in the run timeline.
   */
  async recordEgress(sessionId: string, entry: { host: string; port: number; allowed: boolean; reason: string; sent?: number; received?: number }): Promise<void> {
    const session = this.active.get(sessionId);
    if (!session) return;
    const lines = (this.egressLogLines.get(sessionId) ?? 0) + 1;
    this.egressLogLines.set(sessionId, lines);
    if (lines > MAX_EGRESS_LOG_LINES) return;
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
    await appendFile(join(this.dirs(session.runId, sessionId).base, "egress.log"), `${line}\n`).catch(() => undefined);
    if (entry.sent !== undefined) return;
    const key = `${entry.allowed ? "allow" : "refuse"} ${entry.host}`;
    const shown = this.egressShown.get(sessionId) ?? new Set<string>();
    this.egressShown.set(sessionId, shown);
    if (shown.has(key) || shown.size >= 200) return;
    shown.add(key);
    await this.progress(session, {
      kind: "tool",
      tool: "network",
      summary: `${entry.allowed ? "allowed" : "refused"} ${entry.host}:${entry.port}: ${entry.reason}`,
    });
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
      })().catch((e: Error) => this.logger.error(`closing session ${s.sessionId}: ${e.message}`));
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
        network: RunnerTask.parse(session.task).network,
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
