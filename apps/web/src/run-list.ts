// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunState, RunSummary } from "@opificia/contracts";

export const DONE_PAGE = 20;

export const SECTIONS = {
  needs_you: ["awaiting_approval"],
  working: ["queued", "planning", "implementing", "checking", "publishing"],
  done: ["pr_opened", "failed", "cancelled"],
} as const satisfies Record<string, readonly RunState[]>;

export interface RunGroups {
  needsYou: RunSummary[];
  working: RunSummary[];
  done: RunSummary[];
}

/** The distinct repositories of the runs, sorted alphabetically. */
export function repositories(runs: readonly RunSummary[]): string[] {
  return [...new Set(runs.map((run) => run.repo))].sort((a, b) => a.localeCompare(b));
}

const time = (iso: string) => new Date(iso).getTime();

/** Ascending or descending by `updatedAt`, with ties broken by `createdAt`, then `id`, so polls keep the order. */
function byUpdated(direction: 1 | -1) {
  return (a: RunSummary, b: RunSummary) =>
    direction * (time(a.updatedAt) - time(b.updatedAt)) ||
    direction * (time(a.createdAt) - time(b.createdAt)) ||
    direction * a.id.localeCompare(b.id);
}

/** Sorts runs into the sidebar sections, optionally for one repository only. */
export function groupRuns(runs: readonly RunSummary[], repo: string | null): RunGroups {
  const shown = repo === null ? runs : runs.filter((run) => run.repo === repo);
  const inSection = (states: readonly RunState[]) => shown.filter((run) => states.includes(run.state));
  return {
    needsYou: inSection(SECTIONS.needs_you).sort(byUpdated(1)),
    working: inSection(SECTIONS.working).sort(byUpdated(-1)),
    done: inSection(SECTIONS.done).sort(byUpdated(-1)),
  };
}

/** A short age such as "now", "5m", "3h" or "2d". Future times count as "now". */
export function shortAge(iso: string, now: number): string {
  const seconds = Math.floor((now - time(iso)) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
