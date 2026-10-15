// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunEventDto } from "@opificia/contracts";
import { describe, expect, it } from "vitest";
import { buildTimeline, formatDuration, isOpen, kindOf, outcomeText, pinned, repoPaths, stageCalls, stageDuration, summarise, splitStage } from "./timeline.ts";

let seq = 0;
const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s)).toISOString();
const make = (s: number, type: string, data: unknown) => ({ seq: ++seq, at: at(s), type, data }) as RunEventDto;
const queued = (s = 0) =>
  make(s, "run.queued", {
    repo: "o/r",
    installationId: 1,
    issue: { number: 1, title: "t", body: "", url: "https://example.com/1" },
    budgetUsd: 1,
    deadlineAt: at(9999),
  });
const started = (s: number, stage: "plan" | "implement") => make(s, "stage.started", { stage, sessionId: "s", baseSha: "abcdef0123" });
const tool = (s: number, name: string, summary = "x") => make(s, "agent.tool", { stage: "implement", tool: name, summary });
const message = (s: number, text = "hello") => make(s, "agent.message", { stage: "implement", text });
const proposed = (s: number) => make(s, "plan.proposed", { plan: "p", costUsd: 0.1 });
const approved = (s: number) => make(s, "plan.approved", { by: "ana" });
const finished = (s: number) => make(s, "implementation.finished", { headSha: "abcdef0123", costUsd: 0.2 });
const checks = (s: number) =>
  make(s, "checks.completed", { passed: true, files: 1, additions: 1, deletions: 0, findings: [] });
const failed = (s: number, reason = "boom") => make(s, "run.failed", { reason });

const fullRun = () => [
  queued(),
  started(1, "plan"),
  tool(2, "Read"),
  proposed(10),
  approved(20),
  started(21, "implement"),
  tool(22, "Read"),
  tool(23, "Bash"),
  message(24),
  tool(25, "Edit"),
  finished(400),
  checks(410),
  make(420, "pr.opened", { number: 5, url: "https://example.com/pull/5", branch: "b" }),
];

describe("buildTimeline", () => {
  it("groups events into Plan, Implement and Result", () => {
    const { before, stages } = buildTimeline(fullRun(), { active: false });
    expect(before.map((e) => e.type)).toEqual(["run.queued"]);
    expect(stages.map((s) => s.name)).toEqual(["Plan", "Implement", "Result"]);
    expect(stages[0]!.outcome?.type).toBe("plan.proposed");
    expect(stages[0]!.items.map((i) => (i.kind === "event" ? i.event.type : i.kind))).toEqual(["tools", "plan.approved"]);
    expect(stages[1]!.outcome?.type).toBe("implementation.finished");
    expect(stages[2]!.items.map((i) => (i.kind === "event" ? i.event.type : i.kind))).toEqual(["checks.completed", "pr.opened"]);
  });

  it("takes durations from the event times", () => {
    const { stages } = buildTimeline(fullRun(), { active: false });
    expect(formatDuration(stageDuration(stages[0]!))).toBe("9s");
    expect(formatDuration(stageDuration(stages[1]!))).toBe("6m 19s");
    expect(stages[2]!.startedAt).toBe(at(400));
    expect(stages[2]!.endedAt).toBe(at(420));
  });

  it("starts a second Plan stage after a change request", () => {
    const events = [started(1, "plan"), proposed(5), make(6, "plan.changes_requested", { by: "ana", feedback: "f" }), started(7, "plan")];
    const { stages } = buildTimeline(events, { active: true });
    expect(stages.map((s) => s.name)).toEqual(["Plan", "Plan"]);
    expect(stages[0]!.items.map((i) => i.kind)).toEqual(["event"]);
    expect(stages[0]!.id).not.toBe(stages[1]!.id);
  });

  it("ends a tool group at a message and at other events", () => {
    const { stages } = buildTimeline([started(1, "implement"), tool(2, "Read"), tool(3, "Read"), message(4), tool(5, "Bash")], { active: true });
    expect(stages[0]!.items.map((i) => i.kind)).toEqual(["tools", "event", "tools"]);
  });

  it("keeps a failed stage open and shows the reason", () => {
    const { stages } = buildTimeline([started(1, "implement"), tool(2, "Read"), failed(30, "out of budget")], { active: false });
    const stage = stages[0]!;
    expect(stage.status).toBe("failed");
    expect(isOpen(stage, new Map())).toBe(true);
    expect(isOpen(stage, new Map([[stage.id, false]]))).toBe(false);
    const last = splitStage(stage).after.at(-1)!;
    expect(last.type === "run.failed" && last.data.reason).toBe("out of budget");
  });

  it("marks a stage running only while the run is active", () => {
    const events = [started(1, "implement"), tool(2, "Read"), tool(3, "Bash")];
    const running = buildTimeline(events, { active: true }).stages[0]!;
    expect(running.status).toBe("running");
    expect(isOpen(running, new Map())).toBe(true);
    const item = running.items[0]!;
    expect(item.kind === "tools" && item.last?.seq).toBe(events[2]!.seq);
    const done = buildTimeline(events, { active: false }).stages[0]!;
    expect(done.status).toBe("finished");
    expect(isOpen(done, new Map())).toBe(false);
    expect(isOpen(done, new Map([[done.id, true]]))).toBe(true);
    expect(done.items[0]!.kind === "tools" && (done.items[0] as { last?: unknown }).last).toBeFalsy();
  });

  it("shows a refused network decision as its own row in the work", () => {
    const events = [
      started(1, "implement"),
      tool(2, "Read"),
      tool(3, "network", "allowed registry.example:443: ok"),
      tool(4, "network", "refused evil.example:443: not listed"),
      tool(5, "Bash"),
      finished(9),
    ];
    const stage = buildTimeline(events, { active: false }).stages[0]!;
    expect(stage.items.map((i) => i.kind)).toEqual(["tools", "refused", "tools"]);
    const first = stage.items[0]!;
    expect(first.kind === "tools" && first.calls).toHaveLength(2);
    const { work, after } = splitStage(stage);
    expect(work.map((i) => i.kind)).toEqual(["tools", "refused", "tools"]);
    expect(after.map((e) => e.type)).toEqual(["implementation.finished"]);
  });

  it("never folds the pinned events", () => {
    const { stages } = buildTimeline(fullRun(), { active: false });
    const types = stages.flatMap((s) => splitStage(s).after).map((e) => e.type);
    expect(types).toEqual(["plan.proposed", "plan.approved", "implementation.finished", "checks.completed", "pr.opened"]);
    for (const e of [approved(1), checks(1), failed(1), make(1, "run.cancelled", { by: "ana" }), make(1, "plan.changes_requested", { by: "a", feedback: "f" })]) {
      expect(pinned(e)).toBe(true);
    }
    expect(pinned(message(1))).toBe(false);
  });

  it("closes the stage on cancel", () => {
    const stage = buildTimeline([started(1, "plan"), make(5, "run.cancelled", { by: "ana" })], { active: false }).stages[0]!;
    expect(stage.outcome?.type).toBe("run.cancelled");
    expect(stage.endedAt).toBe(at(5));
  });

  it("puts a failure from the checks into Result", () => {
    const { stages } = buildTimeline([started(1, "implement"), finished(5), failed(8)], { active: false });
    expect(stages.map((s) => s.name)).toEqual(["Implement", "Result"]);
    expect(stages[1]!.status).toBe("failed");
  });
});

describe("summarise", () => {
  const calls = (...names: string[]) => names.map((n, i) => tool(i, n));

  it("counts kinds by tool name", () => {
    expect(summarise(calls("Read", "Glob", "Grep", "Read", "Bash", "Bash"))).toBe("Read 4 files and ran 2 commands");
    expect(summarise(calls("Edit", "Write", "NotebookEdit"))).toBe("Edited 3 files");
  });

  it("uses singular forms", () => {
    expect(summarise(calls("Read"))).toBe("Read 1 file");
    expect(summarise(calls("Bash"))).toBe("Ran 1 command");
  });

  it("names at most two kinds, then the other actions", () => {
    expect(summarise(calls("Read", "Read", "Read", "Read", "Bash", "Bash", "Edit"))).toBe("Read 4 files, ran 2 commands and 1 other action");
    expect(summarise(calls("Read", "Bash", "Edit", "network", "WebFetch"))).toBe("Read 1 file, ran 1 command and 3 other actions");
  });

  it("counts unknown tools and network decisions", () => {
    expect(summarise(calls("WebFetch", "Task"))).toBe("Took 2 actions");
    expect(summarise(calls("network"))).toBe("Made 1 network decision");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(372_000)).toBe("6m 12s");
    expect(formatDuration(3_780_000)).toBe("1h 3m");
  });
});

describe("repeated messages and paths", () => {
  it("drops the agent's final message when it repeats the plan, with or without a title line", () => {
    const plan = "## Summary\n\nDo it.";
    const events = [
      queued(),
      started(1, "plan"),
      message(2, "Looking around."),
      message(3, plan),
      message(4, `Title: feat: do it\n\n${plan}`),
      make(5, "plan.proposed", { plan, costUsd: 0.1 }),
    ];
    const [stage] = buildTimeline(events, { active: true }).stages;
    const texts = stage!.items.flatMap((i) => (i.kind === "event" && i.event.type === "agent.message" ? [i.event.data.text] : []));
    expect(texts).toEqual(["Looking around."]);
    expect(outcomeText(stage!.outcome)).toBe(plan);
  });

  it("shows paths relative to the repository", () => {
    expect(repoPaths("/work/repo/apps/web/src/lib.ts")).toBe("apps/web/src/lib.ts");
    expect(repoPaths("cd /work/repo && pnpm test")).toBe("cd . && pnpm test");
  });

  it("collects every tool call of a stage, refused ones included", () => {
    const events = [queued(), started(1, "implement"), tool(2, "Read"), tool(3, "network", "refused example.org:443: no"), tool(4, "Bash")];
    const [stage] = buildTimeline(events, { active: true }).stages;
    expect(stageCalls(stage!)).toHaveLength(3);
    expect(kindOf("Grep")).toBe("read");
  });
});
