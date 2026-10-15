// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { PrState, RunEventDto, RunState } from "@opificia/contracts";

/**
 * How the web app speaks about a run's state. Colour is kept for three things:
 * a run that needs a person (`attention`), a run that is moving (`moving`) and
 * a run that broke (`broken`). Everything else is quiet.
 */
export type Tone = "attention" | "moving" | "broken" | "done" | "quiet";

export type StateMeta = {
  /** A few words, for headers and the home page. */
  label: string;
  /** One word, for sidebar rows. */
  short: string;
  tone: Tone;
};

export const STATE_META: Record<RunState, StateMeta> = {
  queued: { label: "Queued", short: "Queued", tone: "moving" },
  planning: { label: "Planning", short: "Planning", tone: "moving" },
  awaiting_approval: { label: "Plan ready for review", short: "Review", tone: "attention" },
  implementing: { label: "Implementing", short: "Building", tone: "moving" },
  checking: { label: "Checking the result", short: "Checking", tone: "moving" },
  publishing: { label: "Opening the pull request", short: "Publishing", tone: "moving" },
  pr_opened: { label: "Pull request opened", short: "PR opened", tone: "done" },
  failed: { label: "Failed", short: "Failed", tone: "broken" },
  cancelled: { label: "Cancelled", short: "Cancelled", tone: "quiet" },
};

const PR_META: Record<PrState, StateMeta> = {
  open: { label: "Pull request ready for your review", short: "Review PR", tone: "attention" },
  merged: { label: "Merged", short: "Merged", tone: "done" },
  closed: { label: "Closed without merging", short: "Closed", tone: "quiet" },
};

/** How to speak about a run: by its state, and once its pull request is open, by what happened to it. */
export function runMeta(state: RunState, prState?: PrState | null): StateMeta {
  return state === "pr_opened" && prState ? PR_META[prState] : STATE_META[state];
}

/** Text and soft background classes for each tone. */
export const TONE_CLASSES: Record<Tone, { text: string; soft: string; dot: string }> = {
  attention: { text: "text-gold-ink", soft: "bg-gold-soft text-gold-ink", dot: "bg-gold" },
  moving: { text: "text-run", soft: "bg-run-soft text-run", dot: "bg-run" },
  broken: { text: "text-bad", soft: "bg-bad-soft text-bad", dot: "bg-bad" },
  done: { text: "text-ok", soft: "bg-ok-soft text-ok", dot: "bg-ok" },
  quiet: { text: "text-ink-faint", soft: "bg-sunken text-ink-muted", dot: "bg-ink-faint" },
};

/** The steps of a run, as the header shows them. */
export const STEPS = ["Plan", "Review", "Implement", "Checks", "Pull request"] as const;
export type Step = (typeof STEPS)[number];
export type StepStatus = "done" | "current" | "waiting" | "failed" | "pending" | "skipped";

/**
 * The status of each step for a run state. `failedStage` says where a failed
 * or cancelled run stopped, when the events tell us.
 */
export function stepStatuses(state: RunState, stoppedAt?: Step): Record<Step, StepStatus> {
  const order: Record<RunState, number> = {
    queued: 0,
    planning: 0,
    awaiting_approval: 1,
    implementing: 2,
    checking: 3,
    publishing: 4,
    pr_opened: 5,
    failed: -1,
    cancelled: -1,
  };
  const result = {} as Record<Step, StepStatus>;
  if (state === "failed" || state === "cancelled") {
    const stop = STEPS.indexOf(stoppedAt ?? "Plan");
    STEPS.forEach((step, i) => {
      result[step] = i < stop ? "done" : i === stop ? (state === "failed" ? "failed" : "skipped") : "pending";
    });
    return result;
  }
  const at = order[state];
  STEPS.forEach((step, i) => {
    result[step] = i < at ? "done" : i === at ? (state === "awaiting_approval" ? "waiting" : "current") : "pending";
  });
  return result;
}

/** Where a run stopped, from its events. */
export function stoppedAt(events: readonly RunEventDto[]): Step {
  const has = (t: RunEventDto["type"]) => events.some((e) => e.type === t);
  const checks = events.findLast((e) => e.type === "checks.completed");
  if (checks?.type === "checks.completed") return checks.data.passed ? "Pull request" : "Checks";
  if (has("implementation.finished")) return "Checks";
  if (has("plan.approved")) return "Implement";
  if (has("plan.proposed")) return "Review";
  return "Plan";
}
