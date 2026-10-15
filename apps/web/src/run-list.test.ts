// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunState, RunSummary } from "@opificia/contracts";
import { describe, expect, it } from "vitest";
import { groupRuns, repositories, shortAge } from "./run-list.ts";

const NOW = Date.parse("2026-01-10T12:00:00.000Z");

function run(id: string, state: RunState, updatedAt: string, extra: Partial<RunSummary> = {}): RunSummary {
  return {
    id,
    repo: "acme/app",
    issueNumber: 1,
    issueTitle: `Issue ${id}`,
    issueUrl: "https://github.com/acme/app/issues/1",
    state,
    costUsd: 0,
    prUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    ...extra,
  };
}

const ids = (runs: RunSummary[]) => runs.map((r) => r.id);

describe("groupRuns", () => {
  it("puts each state in its section", () => {
    const states: RunState[] = [
      "queued", "planning", "awaiting_approval", "implementing", "checking", "publishing", "pr_opened", "failed", "cancelled",
    ];
    const groups = groupRuns(
      states.map((s) => run(s, s, "2026-01-02T00:00:00.000Z")),
      null,
    );
    expect(ids(groups.needsYou)).toEqual(["awaiting_approval"]);
    expect(ids(groups.working).sort()).toEqual(["checking", "implementing", "planning", "publishing", "queued"]);
    expect(ids(groups.done).sort()).toEqual(["cancelled", "failed", "pr_opened"]);
  });

  it("orders needs-you runs by longest waiting first", () => {
    const groups = groupRuns(
      [
        run("new", "awaiting_approval", "2026-01-03T00:00:00.000Z"),
        run("old", "awaiting_approval", "2026-01-02T00:00:00.000Z"),
      ],
      null,
    );
    expect(ids(groups.needsYou)).toEqual(["old", "new"]);
  });

  it("orders working and done runs by most recent update first", () => {
    const groups = groupRuns(
      [
        run("w1", "planning", "2026-01-02T00:00:00.000Z"),
        run("w2", "queued", "2026-01-03T00:00:00.000Z"),
        run("d1", "failed", "2026-01-02T00:00:00.000Z"),
        run("d2", "pr_opened", "2026-01-04T00:00:00.000Z"),
        run("d3", "cancelled", "2026-01-03T00:00:00.000Z"),
      ],
      null,
    );
    expect(ids(groups.working)).toEqual(["w2", "w1"]);
    expect(ids(groups.done)).toEqual(["d2", "d3", "d1"]);
  });

  it("breaks ties by createdAt, then id", () => {
    const at = "2026-01-02T00:00:00.000Z";
    const groups = groupRuns(
      [
        run("b", "failed", at),
        run("a", "failed", at),
        run("c", "failed", at, { createdAt: "2026-01-05T00:00:00.000Z" }),
      ],
      null,
    );
    expect(ids(groups.done)).toEqual(["c", "b", "a"]);
  });

  it("filters by repository", () => {
    const runs = [
      run("a", "queued", "2026-01-02T00:00:00.000Z"),
      run("b", "queued", "2026-01-02T00:00:00.000Z", { repo: "acme/web" }),
    ];
    expect(ids(groupRuns(runs, null).working)).toEqual(["b", "a"]);
    expect(ids(groupRuns(runs, "acme/web").working)).toEqual(["b"]);
    expect(groupRuns(runs, "acme/none")).toEqual({ needsYou: [], working: [], done: [] });
  });
});

describe("repositories", () => {
  it("returns distinct repositories, sorted", () => {
    const at = "2026-01-02T00:00:00.000Z";
    const runs = [
      run("1", "queued", at, { repo: "b/z" }),
      run("2", "queued", at, { repo: "a/y" }),
      run("3", "queued", at, { repo: "b/z" }),
    ];
    expect(repositories(runs)).toEqual(["a/y", "b/z"]);
  });
});

describe("shortAge", () => {
  const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

  it("formats now, minutes, hours and days", () => {
    expect(shortAge(ago(0), NOW)).toBe("now");
    expect(shortAge(ago(59), NOW)).toBe("now");
    expect(shortAge(ago(60), NOW)).toBe("1m");
    expect(shortAge(ago(59 * 60), NOW)).toBe("59m");
    expect(shortAge(ago(60 * 60), NOW)).toBe("1h");
    expect(shortAge(ago(23 * 3600), NOW)).toBe("23h");
    expect(shortAge(ago(24 * 3600), NOW)).toBe("1d");
    expect(shortAge(ago(2 * 24 * 3600), NOW)).toBe("2d");
  });

  it("treats future times as now", () => {
    expect(shortAge(ago(-300), NOW)).toBe("now");
  });
});
