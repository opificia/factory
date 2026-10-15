// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { RunSummary } from "@opificia/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { api, authClient } from "./lib.ts";
import { DONE_PAGE, SHORT_STATE, groupRuns, repositories, shortAge } from "./run-list.ts";
import { ErrorText } from "./ui.tsx";

export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: () => api("/runs", z.array(RunSummary)),
    refetchInterval: 5000,
  });
}

function RunRow({ run, current, showAge }: { run: RunSummary; current: boolean; showAge: boolean }) {
  const working = !["awaiting_approval", "pr_opened", "failed", "cancelled"].includes(run.state);
  const statusStyle =
    run.state === "awaiting_approval" ? "text-amber-700" : working ? "text-blue-700" : run.state === "failed" ? "text-red-700" : "text-slate-500";
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: run.id }}
      title={run.issueTitle}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100 ${current ? "bg-slate-100" : ""}`}
    >
      {working && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />}
      <span className="min-w-0 flex-1 truncate text-slate-900">{run.issueTitle}</span>
      <span className="shrink-0 text-xs text-slate-500">
        {run.repo}#{run.issueNumber}
      </span>
      <span className={`shrink-0 text-xs font-medium ${statusStyle}`}>{SHORT_STATE[run.state]}</span>
      {showAge && <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">{shortAge(run.updatedAt, Date.now())}</span>}
    </Link>
  );
}

function Section({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className={`px-2 pb-1 text-xs font-semibold uppercase tracking-wide ${className}`}>{title}</h2>
      {children}
    </section>
  );
}

export function Sidebar({ userName }: { userName: string }) {
  const runs = useRuns();
  const { runId } = useParams({ strict: false });
  const [selectedRepo, setRepo] = useState<string | null>(null);
  const [doneShown, setDoneShown] = useState(DONE_PAGE);

  const all = runs.data ?? [];
  const repos = repositories(all);
  const repo = selectedRepo !== null && repos.includes(selectedRepo) ? selectedRepo : null;
  const groups = groupRuns(all, repo);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <Link to="/" className="text-lg font-semibold text-brand">
          Opificia
        </Link>
        <select
          aria-label="Repository"
          className="mt-3 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          value={repo ?? ""}
          onChange={(e) => setRepo(e.target.value || null)}
        >
          <option value="">All repositories</option>
          {repos.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <nav className="mt-4 flex-1 overflow-y-auto px-2">
        <ErrorText error={runs.error} />
        {groups.needsYou.length > 0 && (
          <Section title="Needs you" className="text-amber-700">
            {groups.needsYou.map((run) => (
              <RunRow key={run.id} run={run} current={run.id === runId} showAge={false} />
            ))}
          </Section>
        )}
        {groups.working.length > 0 && (
          <Section title="Working" className="text-blue-700">
            {groups.working.map((run) => (
              <RunRow key={run.id} run={run} current={run.id === runId} showAge />
            ))}
          </Section>
        )}
        {groups.done.length > 0 && (
          <Section title="Done" className="text-slate-500">
            {groups.done.slice(0, doneShown).map((run) => (
              <RunRow key={run.id} run={run} current={run.id === runId} showAge />
            ))}
            {groups.done.length > doneShown && (
              <button className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900" onClick={() => setDoneShown(doneShown + DONE_PAGE)}>
                Show more
              </button>
            )}
          </Section>
        )}
      </nav>
      <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-3 text-sm">
        <Link to="/settings" className="text-slate-600 hover:text-slate-900" activeProps={{ className: "font-medium text-slate-900" }}>
          Settings
        </Link>
        <span className="ml-auto truncate text-slate-500">{userName}</span>
        <button className="text-slate-600 hover:text-slate-900" onClick={() => void authClient.signOut().then(() => location.assign("/"))}>
          Sign out
        </button>
      </div>
    </div>
  );
}
