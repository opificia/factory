// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/** The states a run moves through. See apps/server/src/runs/decider.ts. */
export const RunState = z.enum([
  "queued",
  "planning",
  "awaiting_approval",
  "implementing",
  "checking",
  "publishing",
  "pr_opened",
  "failed",
  "cancelled",
]);
export type RunState = z.infer<typeof RunState>;

export const TERMINAL_STATES: readonly RunState[] = ["pr_opened", "failed", "cancelled"];

/**
 * What happened to a run's pull request after Opificia opened it. The run stays
 * `pr_opened`; this says whether a person merged it, closed it or has not
 * decided yet.
 */
export const PrState = z.enum(["open", "merged", "closed"]);
export type PrState = z.infer<typeof PrState>;

export const Stage = z.enum(["plan", "implement"]);
export type Stage = z.infer<typeof Stage>;

export const IssueRef = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
});
export type IssueRef = z.infer<typeof IssueRef>;

export const CheckFinding = z.object({
  rule: z.enum(["protected_path", "size", "secret", "hidden_unicode", "submodule", "history", "commit"]),
  path: z.string().optional(),
  message: z.string(),
});
export type CheckFinding = z.infer<typeof CheckFinding>;

/**
 * The events stored for a run, in order. Each has a type and data. Events are
 * the source of truth; the run row is a projection of them.
 */
export const RunEventBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.queued"),
    data: z.object({
      repo: z.string(),
      installationId: z.number().int(),
      issue: IssueRef,
      budgetUsd: z.number(),
      deadlineAt: z.iso.datetime(),
    }),
  }),
  z.object({
    type: z.literal("stage.started"),
    data: z.object({ stage: Stage, sessionId: z.string(), baseSha: z.string() }),
  }),
  z.object({
    type: z.literal("agent.message"),
    data: z.object({ stage: Stage, text: z.string() }),
  }),
  z.object({
    type: z.literal("agent.tool"),
    data: z.object({ stage: Stage, tool: z.string(), summary: z.string() }),
  }),
  z.object({
    type: z.literal("plan.proposed"),
    data: z.object({ plan: z.string(), costUsd: z.number() }),
  }),
  z.object({
    type: z.literal("plan.approved"),
    data: z.object({ by: z.string(), deadlineAt: z.iso.datetime() }),
  }),
  z.object({
    type: z.literal("plan.changes_requested"),
    data: z.object({ by: z.string(), feedback: z.string(), deadlineAt: z.iso.datetime() }),
  }),
  z.object({
    type: z.literal("implementation.finished"),
    data: z.object({ summary: z.string(), costUsd: z.number(), headSha: z.string() }),
  }),
  z.object({
    type: z.literal("checks.completed"),
    data: z.object({
      passed: z.boolean(),
      findings: z.array(CheckFinding),
      files: z.number().int(),
      additions: z.number().int(),
      deletions: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal("pr.opened"),
    data: z.object({ url: z.url(), number: z.number().int(), branch: z.string() }),
  }),
  z.object({
    type: z.literal("pr.merged"),
    data: z.object({ by: z.string().nullable() }),
  }),
  z.object({
    type: z.literal("pr.closed"),
    data: z.object({}),
  }),
  z.object({
    type: z.literal("pr.reopened"),
    data: z.object({}),
  }),
  z.object({
    type: z.literal("run.failed"),
    data: z.object({ reason: z.string(), stage: Stage.optional(), costUsd: z.number().optional() }),
  }),
  z.object({
    type: z.literal("run.cancelled"),
    data: z.object({ by: z.string() }),
  }),
]);
export type RunEventBody = z.infer<typeof RunEventBody>;
export type RunEventType = RunEventBody["type"];
export type RunEventOf<T extends RunEventType> = Extract<RunEventBody, { type: T }>;
