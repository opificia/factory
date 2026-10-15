// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { RunSummary } from "@opificia/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useNow } from "./hooks.ts";
import { api, authClient } from "./lib.ts";
import { DONE_PAGE, groupRuns, repositories, shortAge } from "./run-list.ts";
import { STATE_META, TONE_CLASSES } from "./status.ts";
import { ErrorText, Kbd, Mark, StatusDot, ThemeSwitch } from "./ui.tsx";

export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: () => api("/runs", z.array(RunSummary)),
    refetchInterval: 5000,
  });
}

function RunRow({ run, current, now }: { run: RunSummary; current: boolean; now: number }) {
  const meta = STATE_META[run.state];
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: run.id }}
      title={run.issueTitle}
      aria-current={current ? "page" : undefined}
      className={`group relative block rounded-lg px-2.5 py-2 transition-colors ${
        current ? "bg-sunken" : "hover:bg-sunken/60"
      } ${meta.tone === "quiet" || meta.tone === "done" ? "opacity-80 hover:opacity-100" : ""}`}
    >
      {current && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-ink" aria-hidden />}
      <span className="flex items-center gap-2">
        <StatusDot state={run.state} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{run.issueTitle}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{shortAge(run.updatedAt, now)}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 pl-4 text-[11px]">
        <span className="min-w-0 truncate text-ink-faint">
          {run.repo.split("/")[1]}#{run.issueNumber}
        </span>
        <span className="text-line-strong">·</span>
        <span className={`shrink-0 font-medium ${TONE_CLASSES[meta.tone].text}`}>{meta.short}</span>
      </span>
    </Link>
  );
}

function Section({ title, count, accent, children }: { title: string; count: number; accent?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 flex items-center gap-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        {accent && <span className={`h-1.5 w-1.5 rounded-full ${accent}`} aria-hidden />}
        {title}
        <span className="ml-auto font-medium tabular-nums">{count}</span>
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

/** Alt+Up and Alt+Down move between the runs in the order the sidebar shows them. */
function useRunKeys(order: RunSummary[], runId: string | undefined) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || order.length === 0) return;
      e.preventDefault();
      const i = order.findIndex((r) => r.id === runId);
      const next = e.key === "ArrowDown" ? (i < 0 ? 0 : Math.min(order.length - 1, i + 1)) : Math.max(0, i - 1);
      void navigate({ to: "/runs/$runId", params: { runId: order[next]!.id } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, runId, navigate]);
}

export function Sidebar({ userName }: { userName: string }) {
  const runs = useRuns();
  const organization = authClient.useActiveOrganization();
  const { runId } = useParams({ strict: false });
  const [selectedRepo, setRepo] = useState<string | null>(null);
  const [doneShown, setDoneShown] = useState(DONE_PAGE);
  const now = useNow();

  const all = runs.data ?? [];
  const repos = repositories(all);
  const repo = selectedRepo !== null && repos.includes(selectedRepo) ? selectedRepo : null;
  const groups = groupRuns(all, repo);
  const done = groups.done.slice(0, doneShown);
  useRunKeys([...groups.needsYou, ...groups.working, ...done], runId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-4 pb-3">
        <Link to="/" className="flex items-center gap-2.5 rounded-md">
          <Mark />
          <span className="min-w-0">
            <span className="block text-[15px] leading-tight font-semibold tracking-tight">Opificia</span>
            {organization.data?.name && organization.data.name !== "Opificia" && (
              <span className="block truncate text-[11px] leading-tight text-ink-faint">{organization.data.name}</span>
            )}
          </span>
        </Link>
        {repos.length > 1 && (
          <label className="relative mt-4 block">
            <span className="sr-only">Repository</span>
            <select
              className="h-8 w-full appearance-none rounded-md border border-line bg-surface pr-7 pl-2.5 text-xs text-ink-muted hover:border-line-strong focus:border-ink focus:outline-none"
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
            <ChevronDown className="pointer-events-none absolute top-2 right-2 h-4 w-4 text-ink-faint" aria-hidden />
          </label>
        )}
      </div>

      <nav aria-label="Runs" className="min-h-0 flex-1 overflow-y-auto px-2 pt-1">
        <ErrorText error={runs.error} />
        {groups.needsYou.length > 0 && (
          <Section title="Needs you" count={groups.needsYou.length} accent="bg-gold">
            {groups.needsYou.map((run) => (
              <RunRow key={run.id} run={run} current={run.id === runId} now={now} />
            ))}
          </Section>
        )}
        {groups.working.length > 0 && (
          <Section title="Working" count={groups.working.length} accent="bg-run">
            {groups.working.map((run) => (
              <RunRow key={run.id} run={run} current={run.id === runId} now={now} />
            ))}
          </Section>
        )}
        {groups.done.length > 0 && (
          <Section title="Done" count={groups.done.length}>
            {done.map((run) => (
              <RunRow key={run.id} run={run} current={run.id === runId} now={now} />
            ))}
            {groups.done.length > doneShown && (
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-ink-muted hover:bg-sunken" onClick={() => setDoneShown(doneShown + DONE_PAGE)}>
                Show {Math.min(DONE_PAGE, groups.done.length - doneShown)} more
              </button>
            )}
          </Section>
        )}
        {runs.data?.length === 0 && <p className="px-2.5 text-xs leading-relaxed text-ink-faint">No runs yet.</p>}
      </nav>

      <div className="border-t border-line px-2 py-2">
        <div className="flex items-center gap-1 px-2.5 pb-2 text-[11px] text-ink-faint">
          <Kbd>⌥</Kbd>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span className="ml-1">runs</span>
          <span className="ml-auto">
            <ThemeSwitch />
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/settings"
            className="flex flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-ink-muted hover:bg-sunken hover:text-ink"
            activeProps={{ className: "bg-sunken text-ink" }}
          >
            <Settings className="h-4 w-4" aria-hidden />
            Settings
          </Link>
          <span
            className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-ink"
            title={userName}
            aria-label={`Signed in as ${userName}`}
          >
            {userName.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <button
            className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink"
            title="Sign out"
            aria-label="Sign out"
            onClick={() => void authClient.signOut().then(() => location.assign("/"))}
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
