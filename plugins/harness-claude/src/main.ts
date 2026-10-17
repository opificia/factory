#!/usr/bin/env node
// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `claude` harness adapter (ADR-0004). It runs inside a sandbox, receives
 * one task over the runner protocol and drives Claude Code through the Agent
 * SDK: a read-only planning stage, or an implementation stage with a
 * self-review turn.
 */

import { join } from "node:path";
import { conventionalTitle, type RunnerCompleteParams, type RunnerTask } from "@opificia/contracts";
import {
  bundleBranch,
  commitAll,
  commitCount,
  headSha,
  prepareWorkspace,
  runHarness,
  type HarnessContext,
} from "@opificia/runner";
import { READ_ONLY_TOOLS, WRITE_TOOLS, runTurn } from "./claude.js";
import { REVIEW_PROMPT, implementPrompt, planPrompt, splitTitle } from "./prompts.js";

const NAME = "claude";
const VERSION = "0.0.0";
/** Below this remaining budget the self-review turn is skipped. */
const MIN_REVIEW_BUDGET_USD = 0.5;

async function plan(task: RunnerTask, repoDir: string, context: HarnessContext): Promise<RunnerCompleteParams> {
  const turn = await runTurn({
    prompt: planPrompt(task),
    repoDir,
    model: task.model,
    tools: READ_ONLY_TOOLS,
    maxTurns: task.maxTurns,
    maxBudgetUsd: task.maxBudgetUsd,
    protectedPaths: task.protectedPaths,
    network: task.network,
    emit: context.emit,
    signal: context.signal,
  });
  if (!turn.ok || !turn.text.trim()) {
    return { outcome: "failed", error: `planning failed: ${turn.error ?? "empty plan"}`, costUsd: turn.costUsd };
  }
  return { outcome: "plan_ready", plan: turn.text.trim(), costUsd: turn.costUsd };
}

async function implement(task: RunnerTask, repoDir: string, context: HarnessContext): Promise<RunnerCompleteParams> {
  const common = {
    repoDir,
    model: task.model,
    tools: WRITE_TOOLS,
    maxTurns: task.maxTurns,
    protectedPaths: task.protectedPaths,
    network: task.network,
    emit: context.emit,
    signal: context.signal,
  };
  const work = await runTurn({ ...common, prompt: implementPrompt(task), maxBudgetUsd: task.maxBudgetUsd });
  let costUsd = work.costUsd;
  if (!work.ok) {
    return { outcome: "failed", error: `implementation failed: ${work.error ?? "unknown error"}`, costUsd };
  }

  let summary = work.text.trim();
  const remaining = task.maxBudgetUsd - costUsd;
  if (work.sessionId && remaining >= MIN_REVIEW_BUDGET_USD) {
    context.emit({ kind: "message", text: "Reviewing the change before handing it over." });
    const review = await runTurn({ ...common, prompt: REVIEW_PROMPT, maxBudgetUsd: remaining, resume: work.sessionId });
    costUsd += review.costUsd;
    if (review.ok && review.text.trim()) summary = review.text.trim();
  }

  // The title becomes the commit subject, and the control plane uses the
  // subject as the pull request title.
  const reply = splitTitle(summary);
  summary = reply.description;
  const title = conventionalTitle(reply.title, task.issue.title);
  const message = [title, "", `Implements #${task.issue.number}.`, "", ...task.commit.trailers].join("\n");
  await commitAll(repoDir, message);
  if ((await commitCount(repoDir, task.repo.baseSha)) === 0) {
    return { outcome: "failed", error: "the agent made no changes", costUsd };
  }

  const bundle = "result.bundle";
  await bundleBranch(repoDir, task.branch, task.repo.baseSha, join(context.outDir, bundle));
  return { outcome: "implementation_ready", summary, bundle, headSha: await headSha(repoDir), costUsd };
}

const exitCode = await runHarness({
  name: NAME,
  version: VERSION,
  async run(task, context) {
    const repoDir = join(context.workDir, "repo");
    await prepareWorkspace({
      bundlePath: join(context.inDir, "repo.bundle"),
      dir: repoDir,
      defaultBranch: task.repo.defaultBranch,
      baseSha: task.repo.baseSha,
      branch: task.branch,
      authorName: task.commit.authorName,
      authorEmail: task.commit.authorEmail,
    });
    return task.stage === "plan" ? plan(task, repoDir, context) : implement(task, repoDir, context);
  },
});
process.exit(exitCode);
