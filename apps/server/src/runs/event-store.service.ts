// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { PrState, RunEventBody, RunState } from "@opificia/contracts";
import type { Run } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma.service.js";
import { Notifier } from "./notifier.service.js";
import { decide, evolve, react, type Command, type Effect, type Revision, type RunSnapshot } from "./decider.js";

export function toSnapshot(run: Run): RunSnapshot {
  return {
    id: run.id,
    state: run.state as RunState,
    repo: run.repo,
    installationId: Number(run.installationId),
    issue: { number: run.issueNumber, title: run.issueTitle, url: run.issueUrl },
    branch: run.branch,
    sessionId: run.sessionId,
    baseSha: run.baseSha,
    plan: run.plan,
    revisions: run.revisions as Revision[],
    headSha: run.headSha,
    prUrl: run.prUrl,
    prNumber: run.prNumber,
    prState: run.prState as PrState | null,
    costUsd: run.costUsd,
    budgetUsd: run.budgetUsd,
    deadlineAt: run.deadlineAt.toISOString(),
  };
}

function projection(run: RunSnapshot, orgId: string, lastSeq: number) {
  return {
    orgId,
    repo: run.repo,
    installationId: BigInt(run.installationId),
    issueNumber: run.issue.number,
    issueTitle: run.issue.title,
    issueUrl: run.issue.url,
    state: run.state,
    branch: run.branch,
    sessionId: run.sessionId,
    baseSha: run.baseSha,
    plan: run.plan,
    revisions: run.revisions,
    headSha: run.headSha,
    prUrl: run.prUrl,
    prNumber: run.prNumber,
    prState: run.prState,
    costUsd: run.costUsd,
    budgetUsd: run.budgetUsd,
    deadlineAt: new Date(run.deadlineAt),
    lastSeq,
  };
}

export type DispatchResult = { runId: string; events: RunEventBody[]; duplicate: boolean };

/**
 * Handles commands for runs. In one transaction it locks the run, decides,
 * appends the events, updates the projection, queues the effects and records
 * the command receipt. After the commit it notifies listeners.
 */
@Injectable()
export class EventStore {
  /** Emits "effects" when new effects are queued, to wake a local worker. */
  readonly signals = new EventEmitter().setMaxListeners(0);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: Notifier,
  ) {}

  async dispatch(orgId: string, runId: string | null, command: Command, commandId?: string): Promise<DispatchResult> {
    const id = runId ?? randomUUID();
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (commandId) {
        const inserted = await tx.$executeRaw`
          INSERT INTO command_receipts (command_id, org_id, run_id)
          VALUES (${commandId}, ${orgId}, ${id}::uuid)
          ON CONFLICT (command_id) DO NOTHING`;
        if (inserted === 0) {
          const receipt = await tx.commandReceipt.findUnique({ where: { commandId } });
          return { runId: receipt?.runId ?? id, events: [], effects: [] as Effect[], seq: 0, duplicate: true };
        }
      }

      let current: Run | null = null;
      if (runId) {
        await tx.$queryRaw`SELECT id FROM runs WHERE id = ${runId}::uuid AND org_id = ${orgId} FOR UPDATE`;
        current = await tx.run.findFirst({ where: { id: runId, orgId } });
        if (!current) throw new NotFoundException("run not found");
      }

      const events = decide(current ? toSnapshot(current) : null, command);
      if (events.length === 0) return { runId: id, events, effects: [] as Effect[], seq: current?.lastSeq ?? 0, duplicate: false };

      let state = current ? toSnapshot(current) : null;
      let seq = current?.lastSeq ?? 0;
      const effects: Effect[] = [];
      const rows = [];
      for (const event of events) {
        state = evolve(state, event, id);
        seq += 1;
        rows.push({ orgId, runId: id, seq, type: event.type, data: event.data });
        effects.push(...react(event, state));
      }
      await tx.runEvent.createMany({ data: rows });
      const data = projection(state!, orgId, seq);
      await tx.run.upsert({ where: { id }, create: { id, ...data }, update: data });
      if (effects.length > 0) {
        await tx.outboxEffect.createMany({
          data: effects.map(({ type, ...payload }) => ({ orgId, runId: id, type, payload })),
        });
      }
      return { runId: id, events, effects, seq, duplicate: false };
    });

    if (outcome.events.length > 0) await this.notifier.publish(outcome.runId, outcome.seq);
    if (outcome.effects.length > 0) this.signals.emit("effects");
    return { runId: outcome.runId, events: outcome.events, duplicate: outcome.duplicate };
  }
}
