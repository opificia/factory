// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunSummary } from "@opificia/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowRight, GitPullRequest, Tag } from "lucide-react";
import { usd } from "../format.ts";
import { useNow } from "../hooks.ts";
import { groupRuns, shortAge } from "../run-list.ts";
import { useRuns } from "../sidebar.tsx";
import { STATE_META, TONE_CLASSES } from "../status.ts";
import { ErrorText, Mark, StatusDot } from "../ui.tsx";

const WEEK = 7 * 86_400_000;

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-ink-faint uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function RunCard({ run, now }: { run: RunSummary; now: number }) {
  const meta = STATE_META[run.state];
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: run.id }}
      className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-line-strong"
    >
      <StatusDot state={run.state} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{run.issueTitle}</span>
        <span className="block truncate text-xs text-ink-faint">
          {run.repo}#{run.issueNumber} · <span className={TONE_CLASSES[meta.tone].text}>{meta.label}</span> · {shortAge(run.updatedAt, now)} ago
        </span>
      </span>
      {run.prUrl && <GitPullRequest className="h-4 w-4 shrink-0 text-ok" aria-label="Pull request opened" />}
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

function Empty() {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-8 py-12 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-sunken">
        <Tag className="h-5 w-5 text-ink-muted" aria-hidden />
      </div>
      <h2 className="mt-4 text-base font-semibold">Give Opificia its first issue</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
        Link a GitHub installation in{" "}
        <Link to="/settings" className="font-medium text-ink underline underline-offset-2">
          Settings
        </Link>
        , then add the label <code className="rounded bg-sunken px-1 font-mono text-xs">opificia</code> to an open issue. Opificia
        checks for new issues every 30 seconds, writes a plan and waits for you to approve it.
      </p>
    </div>
  );
}

export function HomePage() {
  const runs = useRuns();
  const now = useNow();
  const all = runs.data ?? [];
  const groups = groupRuns(all, null);
  const thisWeek = all.filter((r) => now - Date.parse(r.createdAt) < WEEK);
  const opened = thisWeek.filter((r) => r.state === "pr_opened").length;
  const spend = thisWeek.reduce((sum, r) => sum + r.costUsd, 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center gap-3">
        <span className="md:hidden">
          <Mark size={28} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
      </div>
      <p className="mt-1 text-sm text-ink-muted">Issues Opificia is working on, and what it needs from you.</p>
      <div className="mt-4">
        <ErrorText error={runs.error} />
      </div>

      {runs.data && all.length === 0 && (
        <div className="mt-6">
          <Empty />
        </div>
      )}

      {all.length > 0 && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Needs you" value={groups.needsYou.length} hint={groups.needsYou.length ? "plans to review" : "nothing waiting"} />
            <Stat label="Working" value={groups.working.length} />
            <Stat label="Pull requests" value={opened} hint="this week" />
            <Stat label="Spend" value={spend.toFixed(2)} hint={`USD this week`} />
          </div>

          {groups.needsYou.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
                Needs you
              </h2>
              <div className="space-y-2">
                {groups.needsYou.map((run) => (
                  <RunCard key={run.id} run={run} now={now} />
                ))}
              </div>
            </section>
          )}

          {groups.working.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-ink-faint uppercase">Working</h2>
              <div className="space-y-2">
                {groups.working.map((run) => (
                  <RunCard key={run.id} run={run} now={now} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-ink-faint uppercase">Recently done</h2>
            <div className="space-y-2">
              {groups.done.slice(0, 8).map((run) => (
                <RunCard key={run.id} run={run} now={now} />
              ))}
            </div>
            {groups.done.length === 0 && <p className="text-sm text-ink-faint">Nothing finished yet.</p>}
          </section>
          <p className="mt-8 text-xs text-ink-faint">Total spend on the runs shown: {usd(all.reduce((s, r) => s + r.costUsd, 0))}.</p>
        </>
      )}
    </div>
  );
}
