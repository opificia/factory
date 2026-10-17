// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunnerTask } from "@opificia/contracts";
import { describe, expect, it, vi } from "vitest";
import { Deferred } from "../common/deferred.js";
import type { Config } from "../config.js";
import type { PrismaService } from "../prisma.service.js";
import type { EventStore } from "../runs/event-store.service.js";
import type { SandboxBackend } from "./backend.js";
import { SessionsService } from "./sessions.service.js";

function sessions(busy: number) {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn((parts: TemplateStringsArray) => (calls.push(parts.join("?")), Promise.resolve(1))),
    sandboxSession: {
      count: vi.fn((query: unknown) => (calls.push(`count ${JSON.stringify(query)}`), Promise.resolve(busy))),
      create: vi.fn(() => (calls.push("create"), Promise.resolve({}))),
    },
  };
  const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as unknown as PrismaService;
  const service = new SessionsService({} as Config, prisma, {} as SandboxBackend, {} as EventStore);
  return { service, calls };
}

const input = { sessionId: "s", orgId: "o", runId: "r", stage: "plan" as const, task: {} as RunnerTask, limit: 4 };

describe("SessionsService.create", () => {
  it("admits a session under the lock while there is room", async () => {
    const { service, calls } = sessions(3);
    await expect(service.create(input)).resolves.toMatch(/^[\w-]{43}$/);
    // A session counts until its sandbox is gone, whatever its status.
    expect(calls).toEqual(["SELECT pg_advisory_xact_lock(?::bigint)", 'count {"where":{"endedAt":null}}', "create"]);
  });

  it("defers a session when every sandbox is busy, and records nothing", async () => {
    const { service, calls } = sessions(4);
    await expect(service.create(input)).rejects.toBeInstanceOf(Deferred);
    expect(calls).not.toContain("create");
  });
});

describe("SessionsService.stopRun", () => {
  it("keeps a stopped session counted until its sandbox exits", async () => {
    const update = vi.fn(() => Promise.resolve({}));
    const prisma = {
      sandboxSession: { findMany: vi.fn(() => Promise.resolve([{ id: "s", containerId: "c" }])), update },
    } as unknown as PrismaService;
    const backend = { stop: vi.fn(() => Promise.resolve()) } as unknown as SandboxBackend;
    await new SessionsService({} as Config, prisma, backend, {} as EventStore).stopRun("r", "cancelled");
    expect(update).toHaveBeenCalledWith({ where: { id: "s" }, data: { status: "stopped" } });
    expect(backend.stop).toHaveBeenCalledWith("c");
  });
});
