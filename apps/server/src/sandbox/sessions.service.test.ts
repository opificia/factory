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
      count: vi.fn(() => (calls.push("count"), Promise.resolve(busy))),
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
    expect(calls).toEqual(["SELECT pg_advisory_xact_lock(?::bigint)", "count", "create"]);
  });

  it("defers a session when every sandbox is busy, and records nothing", async () => {
    const { service, calls } = sessions(4);
    await expect(service.create(input)).rejects.toBeInstanceOf(Deferred);
    expect(calls).not.toContain("create");
  });
});
