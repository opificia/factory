// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import type { GitHubService } from "../github/github.service.js";
import type { PrismaService } from "../prisma.service.js";
import type { EventStore } from "../runs/event-store.service.js";
import type { SessionsService } from "../sandbox/sessions.service.js";
import { Deferred, EffectsService } from "./effects.service.js";
import { OutboxWorker } from "./outbox.worker.js";

afterEach(() => vi.restoreAllMocks());

describe("OutboxWorker", () => {
  it("keeps running while the database is unreachable", async () => {
    const down = () => Promise.reject(new Error("Can't reach database server"));
    const prisma = { $queryRaw: vi.fn(down), run: { findMany: vi.fn(down) } } as unknown as PrismaService;
    const events = { signals: new EventEmitter() } as unknown as EventStore;
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const worker = new OutboxWorker(prisma, events, {} as EffectsService);
    worker.start();
    await vi.waitFor(() => expect(prisma.run.findMany).toHaveBeenCalled());
    await worker.onApplicationShutdown();

    // An unhandled rejection would fail the test run; the failures are logged instead.
    expect(errors.mock.calls.map(([message]) => String(message))).toContain("checking deadlines: Can't reach database server");
  });

  it("lets a deferred effect wait without using up an attempt", async () => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const row = { id: 7n, org_id: "o", run_id: "r", type: "start_stage", payload: { stage: "plan" }, attempts: 3 };
    let claimed = false;
    const update = vi.fn(() => Promise.resolve({}));
    const prisma = {
      $queryRaw: vi.fn(() => Promise.resolve(claimed ? [] : ((claimed = true), [row]))),
      run: { findMany: vi.fn(() => Promise.resolve([])) },
      outboxEffect: { update },
    } as unknown as PrismaService;
    const effects = { perform: vi.fn(() => Promise.reject(new Deferred("all 4 sandboxes are busy", 30_000))) } as unknown as EffectsService;

    const worker = new OutboxWorker(prisma, { signals: new EventEmitter() } as unknown as EventStore, effects);
    worker.start();
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    await worker.onApplicationShutdown();

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: expect.objectContaining({ status: "pending", attempts: 2, lastError: "all 4 sandboxes are busy" }),
    });
  });
});

describe("EffectsService", () => {
  it("defers a stage while every sandbox is busy", async () => {
    const run = { id: "r", orgId: "o", state: "queued", budgetUsd: 15, costUsd: 0, sessionId: null };
    const prisma = {
      run: { findFirst: vi.fn(() => Promise.resolve(run)) },
      sandboxSession: { count: vi.fn(() => Promise.resolve(4)) },
    } as unknown as PrismaService;
    const github = { repoToken: vi.fn() } as unknown as GitHubService;
    const effects = new EffectsService({ OPIFICIA_MAX_SANDBOXES: 4 } as Config, prisma, github, {} as EventStore, {} as SessionsService);

    const start = effects.perform({ id: 1n, orgId: "o", runId: "r", type: "start_stage", payload: { stage: "plan" } });
    await expect(start).rejects.toBeInstanceOf(Deferred);
    expect(github.repoToken).not.toHaveBeenCalled();
  });
});
