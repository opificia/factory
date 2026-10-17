// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { EventStore } from "../runs/event-store.service.js";
import { Deferred, EffectsService, type StoredEffect } from "./effects.service.js";

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 5;
const IDLE_MS = 1000;
const DEADLINE_SWEEP_MS = 30_000;

type ClaimedRow = { id: bigint; org_id: string; run_id: string; type: string; payload: unknown; attempts: number };

/**
 * Performs queued effects. Several workers can share the outbox: each claims
 * one effect at a time with `FOR UPDATE SKIP LOCKED` and a lease. Failed
 * effects are retried with backoff; after the last attempt the run fails.
 * Deferred effects, such as a stage waiting for room for its sandbox, wait
 * without using up an attempt.
 * The worker also fails runs that pass their deadline.
 */
@Injectable()
export class OutboxWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private running = false;
  private wake?: () => void;
  private loops: Promise<void>[] = [];
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventStore,
    private readonly effects: EffectsService,
  ) {}

  start(): void {
    this.running = true;
    this.events.signals.on("effects", () => this.wake?.());
    this.loops = Array.from({ length: CONCURRENCY }, () => this.loop());
    // Like the claim loop, the sweep logs a failure and tries again later, so
    // the server outlives a database that is briefly unavailable.
    const sweep = () =>
      void this.sweepDeadlines().catch((error: Error) => this.logger.error(`checking deadlines: ${error.message}`));
    this.sweepTimer = setInterval(sweep, DEADLINE_SWEEP_MS);
    sweep();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    clearInterval(this.sweepTimer);
    this.wake?.();
    await Promise.allSettled(this.loops);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const effect = await this.claim().catch((error: Error) => {
        this.logger.error(`claiming an effect: ${error.message}`);
        return undefined;
      });
      if (!effect) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, IDLE_MS);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        continue;
      }
      await this.handle(effect);
    }
  }

  private async claim(): Promise<ClaimedRow | undefined> {
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_effects
      SET status = 'running', attempts = attempts + 1, lease_until = now() + interval '15 minutes'
      WHERE id = (
        SELECT id FROM outbox_effects
        WHERE (status = 'pending' AND available_at <= now())
           OR (status = 'running' AND lease_until < now())
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, org_id, run_id, type, payload, attempts`;
    return rows[0];
  }

  private async handle(row: ClaimedRow): Promise<void> {
    const effect: StoredEffect = { id: row.id, orgId: row.org_id, runId: row.run_id, type: row.type, payload: row.payload };
    try {
      await this.effects.perform(effect);
      await this.prisma.outboxEffect.update({ where: { id: row.id }, data: { status: "done", doneAt: new Date(), leaseUntil: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Deferred) {
        this.logger.log(`run ${row.run_id}: ${row.type} waits: ${message}`);
        await this.prisma.outboxEffect.update({
          where: { id: row.id },
          data: { status: "pending", attempts: row.attempts - 1, lastError: message, leaseUntil: null, availableAt: new Date(Date.now() + error.delayMs) },
        });
        return;
      }
      const last = row.attempts >= MAX_ATTEMPTS;
      this.logger.warn(`run ${row.run_id}: ${row.type} failed (attempt ${row.attempts}): ${message}`);
      await this.prisma.outboxEffect.update({
        where: { id: row.id },
        data: {
          status: last ? "dead" : "pending",
          lastError: message.slice(0, 4000),
          leaseUntil: null,
          availableAt: new Date(Date.now() + 5000 * 2 ** row.attempts),
        },
      });
      if (last) {
        await this.events
          .dispatch(row.org_id, row.run_id, { type: "Fail", reason: `${row.type.replace("_", " ")} failed: ${message}` })
          .catch(() => undefined);
      }
    }
  }

  private async sweepDeadlines(): Promise<void> {
    const overdue = await this.prisma.run.findMany({
      where: { deadlineAt: { lt: new Date() }, state: { notIn: ["awaiting_approval", "pr_opened", "failed", "cancelled"] } },
      select: { id: true, orgId: true },
    });
    for (const run of overdue) {
      await this.events
        .dispatch(run.orgId, run.id, { type: "Fail", reason: "the run reached its time limit" })
        .catch((error: Error) => this.logger.warn(`deadline for ${run.id}: ${error.message}`));
    }
  }
}
