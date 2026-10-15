// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

// Pure logic for the run timeline. Keep this free of DOM and of `lib.ts`,
// which reads `window` when it loads.

import type { RunEventDto } from "@opificia/contracts";

export type StageName = "Plan" | "Implement" | "Result";

export type Item =
  | { kind: "event"; event: RunEventDto }
  | { kind: "tools"; id: string; summary: string; calls: RunEventDto[]; last?: RunEventDto }
  | { kind: "refused"; event: RunEventDto };

export interface Stage {
  kind: "stage";
  id: string;
  name: StageName;
  startedAt: string;
  endedAt?: string;
  status: "running" | "finished" | "failed";
  /** The event that ended the stage: `plan.proposed`, `implementation.finished` or `run.failed`. */
  outcome?: RunEventDto;
  items: Item[];
}

export interface Timeline {
  /** Events before the first stage, such as `run.queued`. */
  before: RunEventDto[];
  stages: Stage[];
}

/** Events that stay in view when a stage is folded. */
const PINNED = new Set<RunEventDto["type"]>([
  "plan.approved",
  "plan.changes_requested",
  "checks.completed",
  "pr.opened",
  "run.failed",
  "run.cancelled",
]);

export function pinned(event: RunEventDto): boolean {
  return PINNED.has(event.type);
}

/**
 * The sandbox writes a refused host as an `agent.tool` event with the tool
 * `network` and a summary that starts with "refused"
 * (apps/server/src/sandbox/sessions.service.ts, `progress` call after the egress log).
 */
function isRefused(event: RunEventDto): boolean {
  return event.type === "agent.tool" && event.data.tool === "network" && event.data.summary.startsWith("refused");
}

type Kind = "read" | "run" | "edit" | "network" | "other";

const KINDS: Kind[] = ["read", "run", "edit", "network", "other"];

function kindOf(tool: string): Kind {
  switch (tool) {
    case "Read":
    case "Glob":
    case "Grep":
      return "read";
    case "Bash":
      return "run";
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return "edit";
    case "network":
      return "network";
    default:
      return "other";
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const PHRASES: Record<Kind, (n: number) => string> = {
  read: (n) => `read ${plural(n, "file", "files")}`,
  run: (n) => `ran ${plural(n, "command", "commands")}`,
  edit: (n) => `edited ${plural(n, "file", "files")}`,
  network: (n) => `made ${plural(n, "network decision", "network decisions")}`,
  other: (n) => `took ${plural(n, "action", "actions")}`,
};

/** One sentence for a run of tool calls. Names at most two kinds. */
export function summarise(calls: RunEventDto[]): string {
  const counts = new Map<Kind, number>();
  for (const call of calls) {
    if (call.type !== "agent.tool") continue;
    const kind = kindOf(call.data.tool);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  // Most common first; the fixed order breaks ties.
  const ranked = KINDS.filter((k) => counts.has(k)).sort((a, b) => counts.get(b)! - counts.get(a)!);
  const parts = ranked.slice(0, 2).map((k) => PHRASES[k](counts.get(k)!));
  const rest = ranked.slice(2).reduce((sum, k) => sum + counts.get(k)!, 0);
  if (rest > 0) parts.push(`${plural(rest, "other action", "other actions")}`);
  if (parts.length === 0) return "No actions";
  const sentence = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** How long a stage took, up to its end or its latest event. */
export function stageDuration(stage: Stage): number {
  const end = stage.endedAt ?? lastTime(stage) ?? stage.startedAt;
  return Date.parse(end) - Date.parse(stage.startedAt);
}

function lastTime(stage: Stage): string | undefined {
  const last = stage.items[stage.items.length - 1];
  if (!last) return undefined;
  return last.kind === "tools" ? last.calls[last.calls.length - 1]?.at : last.event.at;
}

/** Turns the events of a run into stage sections with folded tool calls. */
export function buildTimeline(events: RunEventDto[], options: { active: boolean }): Timeline {
  const before: RunEventDto[] = [];
  const stages: Stage[] = [];
  let current: Stage | undefined; // the stage that has not ended yet
  let resultFrom: RunEventDto | undefined; // set after `implementation.finished`
  let group: RunEventDto[] = [];

  const flush = () => {
    const target = stages[stages.length - 1];
    if (group.length > 0 && target) {
      target.items.push({ kind: "tools", id: `tools-${group[0]!.seq}`, summary: summarise(group), calls: group });
    }
    group = [];
  };

  const end = (stage: Stage, event: RunEventDto, status: Stage["status"]) => {
    stage.outcome = event;
    stage.endedAt = event.at;
    stage.status = status;
    current = undefined;
  };

  for (const event of events) {
    if (event.type === "stage.started") {
      flush();
      resultFrom = undefined;
      current = {
        kind: "stage",
        id: `stage-${event.seq}`,
        name: event.data.stage === "plan" ? "Plan" : "Implement",
        startedAt: event.at,
        status: "running",
        items: [],
      };
      stages.push(current);
      continue;
    }

    // The first event after the implementation opens the result section.
    if (resultFrom && !current) {
      flush();
      current = { kind: "stage", id: `result-${resultFrom.seq}`, name: "Result", startedAt: resultFrom.at, status: "finished", items: [] };
      stages.push(current);
      resultFrom = undefined;
    }

    const target = current ?? stages[stages.length - 1];
    if (!target) {
      before.push(event);
      continue;
    }

    if (event.type === "agent.tool" && !isRefused(event) && current) {
      group.push(event);
      continue;
    }
    flush();

    if (event.type === "agent.tool") {
      target.items.push({ kind: isRefused(event) ? "refused" : "event", event });
    } else if (current && current.name !== "Result" && event.type === "plan.proposed") {
      end(current, event, "finished");
    } else if (current && current.name !== "Result" && event.type === "implementation.finished") {
      end(current, event, "finished");
      resultFrom = event;
    } else if (current && event.type === "run.failed") {
      const stage = current;
      if (stage.name === "Result") stage.endedAt = event.at;
      end(stage, event, "failed");
    } else if (current && event.type === "run.cancelled") {
      end(current, event, "finished");
    } else {
      if (current?.name === "Result") current.endedAt = event.at;
      target.items.push({ kind: "event", event });
    }
  }
  flush();

  // Fix up the running state and the last tool call.
  for (const stage of stages) {
    if (stage.status !== "running") continue;
    if (stage.name === "Result" || !options.active) {
      stage.status = "finished";
      continue;
    }
    const final = stage.items[stage.items.length - 1];
    if (final?.kind === "tools") final.last = final.calls[final.calls.length - 1];
  }
  return { before, stages };
}

const seqOf = (item: Item): number => (item.kind === "tools" ? item.calls[0]!.seq : item.event.seq);

/** The items a stage shows. A folded stage shows its outcome, pinned events and refused hosts. */
export function visibleItems(stage: Stage, open: boolean): Item[] {
  const items = open
    ? stage.items
    : stage.items.filter((i) => i.kind === "refused" || (i.kind === "event" && pinned(i.event)));
  if (!stage.outcome) return items;
  return [...items, { kind: "event" as const, event: stage.outcome }].sort((a, b) => seqOf(a) - seqOf(b));
}

/** Running and failed stages are always open. */
export function isOpen(stage: Stage, opened: ReadonlySet<string>): boolean {
  return stage.status !== "finished" || opened.has(stage.id);
}
