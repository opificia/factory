// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DEFAULT_PROTECTED_PATHS, RunEventBody, conventionalTitle, type RunnerTask, type Stage } from "@opificia/contracts";
import { DEFAULT_LIMITS, checkChange } from "../checks/checker.js";
import { CONFIG, type Config } from "../config.js";
import type { Run } from "../generated/prisma/client.js";
import { bundleForSandbox, git, loadResult, pushBranch, updateCache } from "../github/git.js";
import { GitHubService } from "../github/github.service.js";
import { PrismaService } from "../prisma.service.js";
import { DomainError, type Effect, type Revision } from "../runs/decider.js";
import { EventStore } from "../runs/event-store.service.js";
import { SessionsService } from "../sandbox/sessions.service.js";

/** Below this remaining budget, a run does not start another stage. */
const MIN_STAGE_BUDGET_USD = 0.5;

/** How long a stage waits before it checks again for room for its sandbox. */
const WAIT_FOR_ROOM_MS = 30_000;

export type StoredEffect = { id: bigint; orgId: string; runId: string; type: string; payload: unknown };

/** An effect that cannot happen yet. The outbox tries it again later, without counting an attempt. */
export class Deferred extends Error {
  constructor(
    message: string,
    readonly delayMs: number,
  ) {
    super(message);
  }
}

/**
 * Performs the side effects that run events ask for. Each handler checks the
 * run's current state first, because effects are delivered at least once and
 * may arrive after the run has moved on.
 */
@Injectable()
export class EffectsService {
  private readonly logger = new Logger(EffectsService.name);
  /** Stages this worker is starting, which may not have a session yet. */
  private starting = 0;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly events: EventStore,
    private readonly sessions: SessionsService,
  ) {}

  async perform(stored: StoredEffect): Promise<void> {
    const effect = { type: stored.type, ...(stored.payload as object) } as Effect;
    const run = await this.prisma.run.findFirst({ where: { id: stored.runId, orgId: stored.orgId } });
    if (!run) return;
    switch (effect.type) {
      case "start_stage":
        return this.startStage(run, effect.stage);
      case "post_comment":
        return this.postComment(run, effect.kind);
      case "run_checks":
        return this.runChecks(run);
      case "publish":
        return this.publish(run);
      case "stop_sandbox":
        return this.sessions.stopRun(run.id, `the run is ${run.state}`);
    }
  }

  private cacheDir(repo: string): string {
    return join(this.config.OPIFICIA_DATA_DIR, "repos", `${repo.replace("/", "__")}.git`);
  }

  private webUrl(runId: string): string {
    return new URL(`/runs/${runId}`, this.config.BETTER_AUTH_URL).toString();
  }

  private async lastEvent<T extends RunEventBody["type"]>(runId: string, type: T) {
    const row = await this.prisma.runEvent.findFirst({ where: { runId, type }, orderBy: { seq: "desc" } });
    return row ? (RunEventBody.parse({ type: row.type, data: row.data }) as Extract<RunEventBody, { type: T }>) : undefined;
  }

  private async startStage(run: Run, stage: Stage): Promise<void> {
    const expected = stage === "plan" ? "queued" : "implementing";
    if (run.state !== expected || (stage === "implement" && run.sessionId)) {
      this.logger.log(`run ${run.id}: skip starting ${stage}, the run is ${run.state}`);
      return;
    }
    const remaining = run.budgetUsd - run.costUsd;
    if (remaining < MIN_STAGE_BUDGET_USD) {
      await this.events.dispatch(run.orgId, run.id, { type: "Fail", reason: `the budget is used up (${run.costUsd.toFixed(2)} of ${run.budgetUsd} USD)` });
      return;
    }

    // Count the stages starting now too, so concurrent starts see each other.
    this.starting += 1;
    try {
      const busy = await this.prisma.sandboxSession.count({ where: { status: { in: ["starting", "running"] } } });
      const limit = this.config.OPIFICIA_MAX_SANDBOXES;
      if (busy + this.starting > limit) throw new Deferred(`all ${limit} sandboxes are busy`, WAIT_FOR_ROOM_MS);
      await this.launchStage(run, stage, remaining);
    } finally {
      this.starting -= 1;
    }
  }

  private async launchStage(run: Run, stage: Stage, remaining: number): Promise<void> {
    const installationId = Number(run.installationId);
    const token = await this.github.repoToken(installationId, run.repo, false);
    const { defaultBranch } = await this.github.getRepo(installationId, run.repo);
    const cacheDir = this.cacheDir(run.repo);
    const head = await updateCache(cacheDir, run.repo, defaultBranch, token);
    // The implementation builds on the commit the approved plan was made for.
    const baseSha = stage === "implement" && run.baseSha ? run.baseSha : head;
    const issue = await this.github.getIssue(installationId, run.repo, run.issueNumber);

    const sessionId = randomUUID();
    const { inDir } = await this.sessions.makeDirs(run.id, sessionId);
    await bundleForSandbox(cacheDir, defaultBranch, baseSha, join(inDir, "repo.bundle"));

    const model = stage === "plan" ? this.config.OPIFICIA_PLAN_MODEL : this.config.OPIFICIA_IMPLEMENT_MODEL;
    const task: RunnerTask = {
      runId: run.id,
      stage,
      repo: { fullName: run.repo, defaultBranch, baseSha },
      issue: { number: issue.number, title: issue.title, body: issue.body, url: issue.url },
      branch: run.branch,
      ...(stage === "implement" && run.plan ? { plan: run.plan } : {}),
      revisions: run.revisions as Revision[],
      model,
      maxBudgetUsd: Math.round(remaining * 100) / 100,
      maxTurns: this.config.OPIFICIA_MAX_TURNS,
      protectedPaths: [...DEFAULT_PROTECTED_PATHS],
      network: stage === "implement" ? this.config.OPIFICIA_SANDBOX_NETWORK : "none",
      commit: {
        authorName: this.config.OPIFICIA_GIT_AUTHOR_NAME,
        authorEmail: this.config.OPIFICIA_GIT_AUTHOR_EMAIL,
        trailers: [`Assisted-by: Claude Code/${model}`, `Opificia-Run: ${run.id}`],
      },
    };
    const sandboxToken = await this.sessions.create({ sessionId, orgId: run.orgId, runId: run.id, stage, task });

    try {
      await this.events.dispatch(run.orgId, run.id, { type: "StartStage", stage, sessionId, baseSha });
    } catch (error) {
      await this.sessions.discard(sessionId);
      if (error instanceof DomainError) {
        this.logger.log(`run ${run.id}: not starting ${stage}: ${error.message}`);
        return;
      }
      throw error;
    }

    try {
      await this.sessions.launch(sessionId, sandboxToken);
    } catch (error) {
      const reason = `could not start the sandbox: ${(error as Error).message}`;
      await this.events.dispatch(run.orgId, run.id, { type: "Fail", reason, stage });
    }
  }

  private async postComment(run: Run, kind: "plan" | "failed"): Promise<void> {
    let body: string;
    if (kind === "plan") {
      if (run.state !== "awaiting_approval" || !run.plan) return;
      body = [
        "Opificia proposes this plan for the issue.",
        "",
        run.plan,
        "",
        "---",
        "",
        `Approve the plan or ask for changes in Opificia: ${this.webUrl(run.id)}`,
      ].join("\n");
    } else {
      const failed = await this.lastEvent(run.id, "run.failed");
      body = [
        `Opificia could not finish this issue: ${failed?.data.reason ?? "unknown reason"}.`,
        "",
        `Details: ${this.webUrl(run.id)}`,
      ].join("\n");
    }
    await this.github.comment(Number(run.installationId), run.repo, run.issueNumber, body);
  }

  private async runChecks(run: Run): Promise<void> {
    if (run.state !== "checking" || !run.headSha || !run.baseSha) return;
    const session = await this.prisma.sandboxSession.findFirst({
      where: { runId: run.id, stage: "implement", status: "completed" },
      orderBy: { createdAt: "desc" },
    });
    if (!session) throw new Error("no completed implement session");
    const { outDir } = this.sessions.dirs(run.id, session.id);
    const installationId = Number(run.installationId);
    const { defaultBranch } = await this.github.getRepo(installationId, run.repo);

    let summary;
    try {
      summary = await loadResult({
        checkDir: join(this.config.OPIFICIA_DATA_DIR, "runs", run.id, "check.git"),
        cacheDir: this.cacheDir(run.repo),
        defaultBranch,
        baseSha: run.baseSha,
        bundleFile: join(outDir, "result.bundle"),
        branch: run.branch,
        headSha: run.headSha,
      });
    } catch (error) {
      await this.events.dispatch(run.orgId, run.id, {
        type: "RecordChecks",
        passed: false,
        findings: [{ rule: "history", message: `the result could not be read: ${(error as Error).message}` }],
        files: 0,
        additions: 0,
        deletions: 0,
      });
      return;
    }

    const findings = checkChange(summary, {
      ...DEFAULT_LIMITS,
      protectedPaths: DEFAULT_PROTECTED_PATHS,
      commitEmail: this.config.OPIFICIA_GIT_AUTHOR_EMAIL,
    });
    await this.events.dispatch(run.orgId, run.id, {
      type: "RecordChecks",
      passed: findings.length === 0,
      findings,
      files: summary.files.length,
      additions: summary.files.reduce((n, f) => n + f.additions, 0),
      deletions: summary.files.reduce((n, f) => n + f.deletions, 0),
    });
  }

  private async publish(run: Run): Promise<void> {
    if (run.state !== "publishing" || !run.headSha) return;
    const installationId = Number(run.installationId);
    const { defaultBranch } = await this.github.getRepo(installationId, run.repo);
    const token = await this.github.repoToken(installationId, run.repo, true);
    const checkDir = join(this.config.OPIFICIA_DATA_DIR, "runs", run.id, "check.git");
    await pushBranch(checkDir, run.repo, run.headSha, run.branch, token);

    const finished = await this.lastEvent(run.id, "implementation.finished");
    const checks = await this.lastEvent(run.id, "checks.completed");
    const body = [
      `Closes #${run.issueNumber}.`,
      "",
      finished?.data.summary ?? "",
      "",
      "## Approved plan",
      "",
      "<details>",
      "<summary>The plan a person approved before implementation</summary>",
      "",
      run.plan ?? "",
      "",
      "</details>",
      "",
      "## How this was made",
      "",
      `Opificia ran Claude Code in a sandbox for this change. Its deterministic checks passed: ${checks?.data.files ?? 0} files, +${checks?.data.additions ?? 0} −${checks?.data.deletions ?? 0} lines, no protected paths, secrets or hidden characters. Model cost: ${run.costUsd.toFixed(2)} USD.`,
      "",
      `Run: ${this.webUrl(run.id)}`,
    ].join("\n");

    // The agent's commit subject is the title, if it follows Conventional
    // Commits; the pull request title check in CI needs that.
    const subject = await git(checkDir, ["log", "-1", "--format=%s", run.headSha]).catch(() => "");
    const pr = await this.github.openPullRequest(installationId, run.repo, {
      title: conventionalTitle(subject, run.issueTitle),
      body,
      head: run.branch,
      base: defaultBranch,
    });
    await this.events.dispatch(run.orgId, run.id, { type: "RecordPullRequest", url: pr.url, number: pr.number });
  }
}
