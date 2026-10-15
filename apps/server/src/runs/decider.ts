// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The run lifecycle as pure functions, following the decider pattern:
 *
 * - `decide(state, command)` checks a command against the current state and
 *   returns the events it causes, or throws a `DomainError`;
 * - `evolve(state, event)` applies one event to the state;
 * - `react(event, state)` lists the side effects an event asks for. The
 *   outbox worker performs them after the events are stored.
 *
 * Nothing here touches the database, the network or the clock.
 */

import {
  TERMINAL_STATES,
  type CheckFinding,
  type IssueRef,
  type PrState,
  type RunEventBody,
  type RunEventOf,
  type RunState,
  type RunnerCompleteParams,
  type RunnerEventParams,
  type Stage,
} from "@opificia/contracts";

export type Revision = { plan: string; feedback: string };

export type RunSnapshot = {
  id: string;
  state: RunState;
  repo: string;
  installationId: number;
  issue: IssueRef;
  branch: string;
  sessionId: string | null;
  baseSha: string | null;
  plan: string | null;
  revisions: Revision[];
  headSha: string | null;
  prUrl: string | null;
  prNumber: number | null;
  prState: PrState | null;
  costUsd: number;
  budgetUsd: number;
  deadlineAt: string;
};

export type Command =
  | {
      type: "StartRun";
      repo: string;
      installationId: number;
      issue: IssueRef;
      budgetUsd: number;
      deadlineAt: string;
    }
  | { type: "StartStage"; stage: Stage; sessionId: string; baseSha: string }
  | { type: "RecordActivity"; sessionId: string; stage: Stage; activity: RunnerEventParams }
  | { type: "CompleteStage"; sessionId: string; stage: Stage; result: RunnerCompleteParams }
  // The time limit covers the agents' work, not the wait for a person, so
  // approving or asking for changes sets a new deadline.
  | { type: "ApprovePlan"; by: string; deadlineAt: string }
  | { type: "RequestChanges"; by: string; feedback: string; deadlineAt: string }
  | {
      type: "RecordChecks";
      passed: boolean;
      findings: CheckFinding[];
      files: number;
      additions: number;
      deletions: number;
    }
  | { type: "RecordPullRequest"; url: string; number: number }
  // What a person did with the pull request on GitHub, seen by the poller.
  | { type: "RecordPullRequestState"; state: PrState; mergedBy: string | null }
  | { type: "Fail"; reason: string; stage?: Stage }
  | { type: "Cancel"; by: string };

export type Effect =
  | { type: "start_stage"; stage: Stage }
  | { type: "post_comment"; kind: "plan" | "failed" }
  | { type: "run_checks" }
  | { type: "publish" }
  | { type: "stop_sandbox" };

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function branchFor(runId: string, issueNumber: number): string {
  return `opificia/issue-${issueNumber}-${runId.slice(0, 8)}`;
}

function expectState(run: RunSnapshot, allowed: RunState[], action: string): void {
  if (!allowed.includes(run.state)) {
    throw new DomainError(`cannot ${action} while the run is ${run.state.replace("_", " ")}`);
  }
}

function stageState(stage: Stage): RunState {
  return stage === "plan" ? "planning" : "implementing";
}

export function decide(run: RunSnapshot | null, command: Command): RunEventBody[] {
  if (command.type === "StartRun") {
    if (run) throw new DomainError("the run already exists");
    return [
      {
        type: "run.queued",
        data: {
          repo: command.repo,
          installationId: command.installationId,
          issue: command.issue,
          budgetUsd: command.budgetUsd,
          deadlineAt: command.deadlineAt,
        },
      },
    ];
  }
  if (!run) throw new DomainError("the run does not exist");

  switch (command.type) {
    case "StartStage": {
      // A plan starts from "queued"; an implementation from "implementing",
      // which the run enters when the plan is approved.
      expectState(run, [command.stage === "plan" ? "queued" : "implementing"], `start the ${command.stage} stage`);
      if (command.stage === "implement" && run.sessionId) throw new DomainError("the implement stage already started");
      return [
        { type: "stage.started", data: { stage: command.stage, sessionId: command.sessionId, baseSha: command.baseSha } },
      ];
    }
    case "RecordActivity": {
      // Late progress from a sandbox that is no longer current is dropped.
      if (run.sessionId !== command.sessionId || run.state !== stageState(command.stage)) return [];
      const a = command.activity;
      return a.kind === "message"
        ? [{ type: "agent.message", data: { stage: command.stage, text: a.text } }]
        : [{ type: "agent.tool", data: { stage: command.stage, tool: a.tool, summary: a.summary } }];
    }
    case "CompleteStage": {
      if (run.sessionId !== command.sessionId) throw new DomainError("the sandbox session is not current");
      expectState(run, [stageState(command.stage)], `complete the ${command.stage} stage`);
      const r = command.result;
      if (r.outcome === "failed") {
        return [{ type: "run.failed", data: { reason: r.error, stage: command.stage, costUsd: r.costUsd } }];
      }
      if (r.outcome === "plan_ready") {
        if (command.stage !== "plan") throw new DomainError("a plan can only come from the plan stage");
        return [{ type: "plan.proposed", data: { plan: r.plan, costUsd: r.costUsd } }];
      }
      if (command.stage !== "implement") throw new DomainError("an implementation can only come from the implement stage");
      return [
        { type: "implementation.finished", data: { summary: r.summary, costUsd: r.costUsd, headSha: r.headSha } },
      ];
    }
    case "ApprovePlan":
      expectState(run, ["awaiting_approval"], "approve the plan");
      return [{ type: "plan.approved", data: { by: command.by, deadlineAt: command.deadlineAt } }];
    case "RequestChanges":
      expectState(run, ["awaiting_approval"], "request changes");
      return [
        { type: "plan.changes_requested", data: { by: command.by, feedback: command.feedback, deadlineAt: command.deadlineAt } },
      ];
    case "RecordChecks": {
      expectState(run, ["checking"], "record checks");
      const { type: _type, ...data } = command;
      const events: RunEventBody[] = [{ type: "checks.completed", data }];
      if (!command.passed) {
        const n = command.findings.length;
        events.push({ type: "run.failed", data: { reason: `the checks found ${n} problem${n === 1 ? "" : "s"}` } });
      }
      return events;
    }
    case "RecordPullRequest":
      expectState(run, ["publishing"], "record the pull request");
      return [{ type: "pr.opened", data: { url: command.url, number: command.number, branch: run.branch } }];
    case "RecordPullRequestState": {
      expectState(run, ["pr_opened"], "record the state of the pull request");
      // A merge is final; otherwise only a change is an event.
      if (run.prState === "merged" || run.prState === command.state) return [];
      if (command.state === "merged") return [{ type: "pr.merged", data: { by: command.mergedBy } }];
      if (command.state === "closed") return [{ type: "pr.closed", data: {} }];
      return [{ type: "pr.reopened", data: {} }];
    }
    case "Fail":
      if (isTerminal(run.state)) return [];
      return [{ type: "run.failed", data: { reason: command.reason, ...(command.stage ? { stage: command.stage } : {}) } }];
    case "Cancel":
      if (isTerminal(run.state)) throw new DomainError(`the run is already ${run.state.replace("_", " ")}`);
      return [{ type: "run.cancelled", data: { by: command.by } }];
  }
}

export function evolve(run: RunSnapshot | null, event: RunEventBody, runId: string): RunSnapshot {
  if (event.type === "run.queued") {
    return {
      id: runId,
      state: "queued",
      repo: event.data.repo,
      installationId: event.data.installationId,
      issue: event.data.issue,
      branch: branchFor(runId, event.data.issue.number),
      sessionId: null,
      baseSha: null,
      plan: null,
      revisions: [],
      headSha: null,
      prUrl: null,
      prNumber: null,
      prState: null,
      costUsd: 0,
      budgetUsd: event.data.budgetUsd,
      deadlineAt: event.data.deadlineAt,
    };
  }
  if (!run) throw new DomainError(`${event.type} before run.queued`);

  switch (event.type) {
    case "stage.started":
      return { ...run, state: stageState(event.data.stage), sessionId: event.data.sessionId, baseSha: event.data.baseSha };
    case "agent.message":
    case "agent.tool":
      return run;
    case "plan.proposed":
      return { ...run, state: "awaiting_approval", plan: event.data.plan, costUsd: run.costUsd + event.data.costUsd, sessionId: null };
    case "plan.approved":
      return { ...run, state: "implementing", deadlineAt: event.data.deadlineAt };
    case "plan.changes_requested":
      return {
        ...run,
        state: "queued",
        deadlineAt: event.data.deadlineAt,
        revisions: [...run.revisions, { plan: run.plan ?? "", feedback: event.data.feedback }],
        plan: null,
      };
    case "implementation.finished":
      return { ...run, state: "checking", headSha: event.data.headSha, costUsd: run.costUsd + event.data.costUsd, sessionId: null };
    case "checks.completed":
      return event.data.passed ? { ...run, state: "publishing" } : run;
    case "pr.opened":
      return { ...run, state: "pr_opened", prUrl: event.data.url, prNumber: event.data.number, prState: "open" };
    case "pr.merged":
      return { ...run, prState: "merged" };
    case "pr.closed":
      return { ...run, prState: "closed" };
    case "pr.reopened":
      return { ...run, prState: "open" };
    case "run.failed":
      return { ...run, state: "failed", costUsd: run.costUsd + (event.data.costUsd ?? 0) };
    case "run.cancelled":
      return { ...run, state: "cancelled" };
  }
}

/** The side effects an event asks for, given the state after it. */
export function react(event: RunEventBody, run: RunSnapshot): Effect[] {
  switch (event.type) {
    case "run.queued":
    case "plan.changes_requested":
      return [{ type: "start_stage", stage: "plan" }];
    case "plan.proposed":
      return [{ type: "post_comment", kind: "plan" }];
    case "plan.approved":
      return [{ type: "start_stage", stage: "implement" }];
    case "implementation.finished":
      return [{ type: "run_checks" }];
    case "checks.completed":
      return event.data.passed && run.state === "publishing" ? [{ type: "publish" }] : [];
    case "run.failed":
      return [{ type: "stop_sandbox" }, { type: "post_comment", kind: "failed" }];
    case "run.cancelled":
      return [{ type: "stop_sandbox" }];
    default:
      return [];
  }
}

/** Applies a list of events in order. */
export function fold(events: RunEventBody[], runId: string, initial: RunSnapshot | null = null): RunSnapshot | null {
  return events.reduce<RunSnapshot | null>((state, event) => evolve(state, event, runId), initial);
}

export type { RunEventOf };
