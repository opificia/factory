// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import type { EventStore } from "../runs/event-store.service.js";
import type { EffectsService } from "./effects.service.js";
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
});
