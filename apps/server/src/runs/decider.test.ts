// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { DomainError, decide, evolve, react, type Command, type RunSnapshot } from "./decider.js";

const RUN_ID = "0b9b3b3e-1111-4222-8333-444455556666";
const start: Command = {
  type: "StartRun",
  repo: "opificia/playground",
  installationId: 1,
  issue: { number: 7, title: "Add a word counter", url: "https://github.com/opificia/playground/issues/7" },
  budgetUsd: 15,
  deadlineAt: "2026-10-15T12:00:00.000Z",
};

/** Applies commands in order and returns the state and every event. */
function play(commands: Command[]) {
  let state: RunSnapshot | null = null;
  const events = [];
  for (const command of commands) {
    for (const event of decide(state, command)) {
      state = evolve(state, event, RUN_ID);
      events.push(event);
    }
  }
  return { state: state!, events };
}

const planned: Command[] = [
  start,
  { type: "StartStage", stage: "plan", sessionId: "s1", baseSha: "abc" },
  { type: "CompleteStage", stage: "plan", sessionId: "s1", result: { outcome: "plan_ready", plan: "1. Do it", costUsd: 0.5 } },
];

describe("decider", () => {
  it("queues a run and asks for a plan", () => {
    const { state, events } = play([start]);
    expect(state.state).toBe("queued");
    expect(state.branch).toBe("opificia/issue-7-0b9b3b3e");
    expect(react(events[0]!, state)).toEqual([{ type: "start_stage", stage: "plan" }]);
  });

  it("refuses to start the same run twice", () => {
    const { state } = play([start]);
    expect(() => decide(state, start)).toThrow(DomainError);
  });

  it("waits for approval after the plan", () => {
    const { state, events } = play(planned);
    expect(state.state).toBe("awaiting_approval");
    expect(state.plan).toBe("1. Do it");
    expect(state.costUsd).toBe(0.5);
    expect(state.baseSha).toBe("abc");
    expect(react(events.at(-1)!, state)).toEqual([{ type: "post_comment", kind: "plan" }]);
  });

  it("goes through the whole loop to a pull request", () => {
    const { state, events } = play([
      ...planned,
      { type: "ApprovePlan", by: "u1", deadlineAt: "2026-10-15T13:00:00.000Z" },
      { type: "StartStage", stage: "implement", sessionId: "s2", baseSha: "abc" },
      { type: "RecordActivity", stage: "implement", sessionId: "s2", activity: { kind: "tool", tool: "Edit", summary: "src/a.ts" } },
      {
        type: "CompleteStage",
        stage: "implement",
        sessionId: "s2",
        result: { outcome: "implementation_ready", summary: "Done", bundle: "result.bundle", headSha: "f".repeat(40), costUsd: 2 },
      },
      { type: "RecordChecks", passed: true, findings: [], files: 2, additions: 10, deletions: 1 },
      { type: "RecordPullRequest", url: "https://github.com/opificia/playground/pull/8", number: 8 },
    ]);
    expect(state.state).toBe("pr_opened");
    expect(state.costUsd).toBe(2.5);
    expect(state.prNumber).toBe(8);
    expect(events.map((e) => e.type)).toEqual([
      "run.queued",
      "stage.started",
      "plan.proposed",
      "plan.approved",
      "stage.started",
      "agent.tool",
      "implementation.finished",
      "checks.completed",
      "pr.opened",
    ]);
  });

  it("follows the pull request until a person merges or closes it", () => {
    const opened: Command[] = [
      ...planned,
      { type: "ApprovePlan", by: "u1", deadlineAt: "2026-10-15T13:00:00.000Z" },
      { type: "StartStage", stage: "implement", sessionId: "s2", baseSha: "abc" },
      {
        type: "CompleteStage",
        stage: "implement",
        sessionId: "s2",
        result: { outcome: "implementation_ready", summary: "Done", bundle: "result.bundle", headSha: "f".repeat(40), costUsd: 2 },
      },
      { type: "RecordChecks", passed: true, findings: [], files: 2, additions: 10, deletions: 1 },
      { type: "RecordPullRequest", url: "https://github.com/opificia/playground/pull/8", number: 8 },
    ];
    expect(play(opened).state.prState).toBe("open");

    const unchanged = play([...opened, { type: "RecordPullRequestState", state: "open", mergedBy: null }]);
    expect(unchanged.events.at(-1)!.type).toBe("pr.opened");

    const closed = play([
      ...opened,
      { type: "RecordPullRequestState", state: "closed", mergedBy: null },
      { type: "RecordPullRequestState", state: "open", mergedBy: null },
      { type: "RecordPullRequestState", state: "merged", mergedBy: "ana" },
    ]);
    expect(closed.events.slice(-3)).toEqual([
      { type: "pr.closed", data: {} },
      { type: "pr.reopened", data: {} },
      { type: "pr.merged", data: { by: "ana" } },
    ]);
    expect(closed.state.prState).toBe("merged");
    expect(closed.state.state).toBe("pr_opened");
    expect(react(closed.events.at(-1)!, closed.state)).toEqual([]);

    // A merge is final.
    expect(decide(closed.state, { type: "RecordPullRequestState", state: "closed", mergedBy: null })).toEqual([]);
  });

  it("records the state of a pull request only after one was opened", () => {
    const { state } = play(planned);
    expect(() => decide(state, { type: "RecordPullRequestState", state: "merged", mergedBy: null })).toThrow(DomainError);
  });

  it("plans again with the reviewer's feedback", () => {
    const { state, events } = play([...planned, { type: "RequestChanges", by: "u1", feedback: "Add tests", deadlineAt: "2026-10-15T13:00:00.000Z" }]);
    expect(state.state).toBe("queued");
    expect(state.revisions).toEqual([{ plan: "1. Do it", feedback: "Add tests" }]);
    expect(state.deadlineAt).toBe("2026-10-15T13:00:00.000Z");
    expect(react(events.at(-1)!, state)).toEqual([{ type: "start_stage", stage: "plan" }]);
    const again = decide(state, { type: "StartStage", stage: "plan", sessionId: "s3", baseSha: "def" });
    expect(again[0]!.type).toBe("stage.started");
  });

  it("does not approve a plan that does not exist yet", () => {
    const { state } = play([start]);
    expect(() => decide(state, { type: "ApprovePlan", by: "u1", deadlineAt: "2026-10-15T13:00:00.000Z" })).toThrow(/cannot approve the plan while the run is queued/);
  });

  it("ignores progress and results from a sandbox that is not current", () => {
    const { state } = play(planned.slice(0, 2));
    expect(decide(state, { type: "RecordActivity", stage: "plan", sessionId: "old", activity: { kind: "message", text: "hi" } })).toEqual([]);
    expect(() =>
      decide(state, { type: "CompleteStage", stage: "plan", sessionId: "old", result: { outcome: "plan_ready", plan: "x", costUsd: 0 } }),
    ).toThrow(/not current/);
  });

  it("fails the run when the checks find problems", () => {
    const { state, events } = play([
      ...planned,
      { type: "ApprovePlan", by: "u1", deadlineAt: "2026-10-15T13:00:00.000Z" },
      { type: "StartStage", stage: "implement", sessionId: "s2", baseSha: "abc" },
      {
        type: "CompleteStage",
        stage: "implement",
        sessionId: "s2",
        result: { outcome: "implementation_ready", summary: "Done", bundle: "result.bundle", headSha: "f".repeat(40), costUsd: 1 },
      },
      { type: "RecordChecks", passed: false, findings: [{ rule: "secret", path: "a", message: "key" }], files: 1, additions: 1, deletions: 0 },
    ]);
    expect(state.state).toBe("failed");
    expect(events.at(-1)).toMatchObject({ type: "run.failed", data: { reason: "the checks found 1 problem" } });
    expect(react(events.at(-1)!, state)).toContainEqual({ type: "stop_sandbox" });
  });

  it("counts the cost of a failed stage", () => {
    const { state } = play([
      start,
      { type: "StartStage", stage: "plan", sessionId: "s1", baseSha: "abc" },
      { type: "CompleteStage", stage: "plan", sessionId: "s1", result: { outcome: "failed", error: "budget", costUsd: 3 } },
    ]);
    expect(state.state).toBe("failed");
    expect(state.costUsd).toBe(3);
  });

  it("cancels a run once, and ignores failures after the end", () => {
    const { state } = play([start, { type: "Cancel", by: "u1" }]);
    expect(state.state).toBe("cancelled");
    expect(() => decide(state, { type: "Cancel", by: "u1" })).toThrow(/already cancelled/);
    expect(decide(state, { type: "Fail", reason: "late" })).toEqual([]);
  });
});
