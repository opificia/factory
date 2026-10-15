// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { RunDetail, RunEventDto } from "@opificia/contracts";
import {
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  FilePen,
  FileSearch,
  GitPullRequest,
  Globe,
  MessageSquareText,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { Suspense, lazy, useState, type ReactNode } from "react";
import { clock, usd, when } from "../format.ts";
import { useNow } from "../hooks.ts";
import {
  type Item,
  type Kind,
  type Stage,
  formatDuration,
  isOpen,
  kindOf,
  repoPaths,
  stageCalls,
  stageDuration,
  summarise,
  visibleItems,
} from "../timeline.ts";

// The Markdown renderer is large, so it loads only on the run page.
const Markdown = lazy(() => import("../markdown.tsx").then((m) => ({ default: m.Markdown })));

function Prose({ children }: { children: string }) {
  return (
    <div className="prose-run">
      <Suspense fallback={<p className="whitespace-pre-wrap">{children}</p>}>
        <Markdown>{children}</Markdown>
      </Suspense>
    </div>
  );
}

const KIND_ICON: Record<Kind, typeof Wrench> = {
  read: FileSearch,
  run: SquareTerminal,
  edit: FilePen,
  network: Globe,
  other: Wrench,
};

function ToolLine({ call, live = false }: { call: RunEventDto; live?: boolean }) {
  if (call.type !== "agent.tool") return null;
  const Icon = KIND_ICON[kindOf(call.data.tool)];
  const summary = repoPaths(call.data.summary);
  return (
    <li className="flex min-w-0 items-center gap-2 py-0.5 text-xs text-ink-faint" title={`${call.data.tool} ${summary}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="shrink-0 font-medium text-ink-muted">{call.data.tool}</span>
      <span className={`min-w-0 truncate font-mono text-[11px] ${live ? "shimmer" : ""}`}>{summary}</span>
    </li>
  );
}

function WorkGroup({ item, open, onToggle }: { item: Extract<Item, { kind: "tools" }>; open: boolean; onToggle: () => void }) {
  const kinds = [...new Set(item.calls.map((c) => (c.type === "agent.tool" ? kindOf(c.data.tool) : "other")))].slice(0, 3);
  return (
    <div className="py-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="group flex items-center gap-2 rounded-md py-0.5 text-[13px] text-ink-muted hover:text-ink"
      >
        <span className="flex -space-x-1" aria-hidden>
          {kinds.map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <span key={k} className="grid h-5 w-5 place-items-center rounded-full border border-line bg-surface">
                <Icon className="h-3 w-3" />
              </span>
            );
          })}
        </span>
        {item.summary}
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
      </button>
      {open ? (
        <ul className="mt-1 ml-2.5 border-l border-line pl-4">
          {item.calls.map((call) => (
            <ToolLine key={call.seq} call={call} />
          ))}
        </ul>
      ) : (
        item.last && (
          <ul className="mt-0.5 ml-2.5 border-l border-line pl-4">
            <ToolLine call={item.last} live />
          </ul>
        )
      )}
    </div>
  );
}

/** A quiet line for things that happened, with an icon. */
function Note({ icon, tone = "text-ink-muted", children, at }: { icon: ReactNode; tone?: string; children: ReactNode; at?: string }) {
  const now = useNow(60_000);
  return (
    <div className={`flex items-center gap-2 py-1.5 text-[13px] ${tone}`} title={at ? new Date(at).toLocaleString() : undefined}>
      <span className="grid h-5 w-5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0">{children}</span>
      {at && <span className="ml-auto shrink-0 text-[11px] text-ink-faint tabular-nums">{when(at, now)}</span>}
    </div>
  );
}

/** What a person wrote: right-aligned, like a message they sent. */
function HumanMessage({ who, label, at, children }: { who: string; label: string; at: string; children: ReactNode }) {
  const now = useNow(60_000);
  return (
    <div className="flex justify-end py-2">
      <div className="max-w-[85%]">
        <p className="mb-1 text-right text-[11px] text-ink-faint">
          {who} · {label} · {when(at, now)}
        </p>
        <div className="rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-primary-ink">{children}</div>
      </div>
    </div>
  );
}

function PlanCard({ event, version, total, defaultOpen }: { event: RunEventDto; version: number; total: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (event.type !== "plan.proposed") return null;
  const heading = /^#+\s+(.+)$/m.exec(event.data.plan)?.[1];
  return (
    <section className="my-3 overflow-hidden rounded-xl border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 border-b border-line bg-sunken/50 px-4 py-2.5 text-left"
      >
        <MessageSquareText className="h-4 w-4 text-ink-muted" aria-hidden />
        <span className="text-sm font-semibold">Plan{total > 1 ? ` ${version} of ${total}` : ""}</span>
        {heading && !open && <span className="min-w-0 truncate text-xs text-ink-faint">{heading}</span>}
        <span className="ml-auto shrink-0 text-[11px] text-ink-faint tabular-nums">{usd(event.data.costUsd)}</span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="px-5 py-4">
          <Prose>{event.data.plan}</Prose>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="relative block max-h-24 w-full overflow-hidden px-5 pt-3 text-left">
          <Prose>{event.data.plan.split("\n").slice(0, 8).join("\n")}</Prose>
          <span className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent" aria-hidden />
        </button>
      )}
    </section>
  );
}

/** Long text in a card: a preview with a fade, and a button to show all of it. */
function Expandable({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="relative">
      <div className={open ? "" : "max-h-56 overflow-hidden"}>{children}</div>
      {!open && (
        <div className="absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t from-surface via-surface/90 to-transparent pb-1">
          <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted shadow-sm hover:text-ink">
            Show all
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ event }: { event: RunEventDto }) {
  if (event.type !== "implementation.finished") return null;
  return (
    <section className="my-3 overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex items-center gap-3 border-b border-line bg-sunken/50 px-4 py-2.5">
        <Check className="h-4 w-4 text-ok" aria-hidden />
        <span className="text-sm font-semibold">Implemented</span>
        <code className="font-mono text-[11px] text-ink-faint">{event.data.headSha.slice(0, 7)}</code>
        <span className="ml-auto text-[11px] text-ink-faint tabular-nums">{usd(event.data.costUsd)}</span>
      </header>
      <div className="px-5 py-4">
        <Expandable>
          <Prose>{event.data.summary.replace(/^Title:[^\n]*\n+/, "")}</Prose>
        </Expandable>
      </div>
    </section>
  );
}

function ChecksCard({ event }: { event: RunEventDto }) {
  if (event.type !== "checks.completed") return null;
  const { passed, findings, files, additions, deletions } = event.data;
  return (
    <section className={`my-3 rounded-xl border px-4 py-3 ${passed ? "border-line bg-surface" : "border-bad/30 bg-bad-soft"}`}>
      <div className="flex items-center gap-3">
        {passed ? <ShieldCheck className="h-4 w-4 text-ok" aria-hidden /> : <ShieldAlert className="h-4 w-4 text-bad" aria-hidden />}
        <span className="text-sm font-semibold">{passed ? "Checks passed" : "Checks failed"}</span>
        <span className="ml-auto text-xs text-ink-muted tabular-nums">
          {files} {files === 1 ? "file" : "files"} <span className="text-ok">+{additions}</span> <span className="text-bad">−{deletions}</span>
        </span>
      </div>
      {passed ? (
        <p className="mt-1 pl-7 text-xs text-ink-muted">No protected paths, secrets or hidden characters, and within the size limits.</p>
      ) : (
        <ul className="mt-2 space-y-1 pl-7 text-[13px] text-bad">
          {findings.map((f, i) => (
            <li key={i}>
              <span className="font-mono text-[11px]">{f.rule}</span> {f.message}
              {f.path && <span className="font-mono text-[11px]"> ({f.path})</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PullRequestCard({ event }: { event: RunEventDto }) {
  if (event.type !== "pr.opened") return null;
  return (
    <a
      href={event.data.url}
      target="_blank"
      rel="noreferrer"
      className="group my-3 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-line-strong"
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-ok-soft">
        <GitPullRequest className="h-4 w-4 text-ok" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">Pull request #{event.data.number} opened</span>
        <span className="block truncate font-mono text-[11px] text-ink-faint">{event.data.branch}</span>
      </span>
      <span className="ml-auto text-xs font-medium text-ink-muted group-hover:text-ink">Review on GitHub →</span>
    </a>
  );
}

function FailureCard({ event }: { event: RunEventDto }) {
  if (event.type !== "run.failed") return null;
  return (
    <section className="my-3 flex gap-3 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-bad">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="text-sm font-semibold">The run failed{event.data.stage ? ` while it was ${event.data.stage === "plan" ? "planning" : "implementing"}` : ""}</p>
        <p className="mt-0.5 text-[13px] break-words">{event.data.reason}</p>
      </div>
    </section>
  );
}

/**
 * A connection the egress proxy refused, from a summary like "refused
 * host:443: reason". A refusal because too many connections were open is a
 * pause, not a block, so it stays quiet; a host the policy refuses is a warning.
 */
function RefusedNote({ event }: { event: RunEventDto }) {
  if (event.type !== "agent.tool") return null;
  const match = /^refused ([^\s:]+)(?::\d+)?: (.*)$/.exec(event.data.summary);
  if (!match) {
    return (
      <Note icon={<ShieldAlert className="h-4 w-4" />} tone="text-gold-ink" at={event.at}>
        <span className="font-mono text-xs">{event.data.summary}</span>
      </Note>
    );
  }
  const [, host, reason] = match;
  if (/connections open/.test(reason!)) {
    return (
      <Note icon={<Globe className="h-4 w-4" />} tone="text-ink-faint" at={event.at}>
        Too many connections at once; a request to <span className="font-mono text-xs">{host}</span> had to retry ({reason})
      </Note>
    );
  }
  return (
    <Note icon={<ShieldAlert className="h-4 w-4" />} tone="text-gold-ink" at={event.at}>
      Blocked <span className="font-mono text-xs font-medium">{host}</span>: {reason}
    </Note>
  );
}

function EventView({ event, plans, awaitingApproval }: { event: RunEventDto; plans: RunEventDto[]; awaitingApproval: boolean }) {
  switch (event.type) {
    case "agent.message":
      return (
        <div className="py-2">
          <Prose>{event.data.text}</Prose>
        </div>
      );
    case "plan.proposed": {
      const version = plans.indexOf(event) + 1;
      return <PlanCard event={event} version={version} total={plans.length} defaultOpen={version === plans.length && awaitingApproval} />;
    }
    case "plan.approved":
      return (
        <Note icon={<Check className="h-4 w-4 text-ok" />} at={event.at}>
          <span className="font-medium text-ink">{event.data.by}</span> approved the plan
        </Note>
      );
    case "plan.changes_requested":
      return (
        <HumanMessage who={event.data.by} label="asked for changes" at={event.at}>
          {event.data.feedback}
        </HumanMessage>
      );
    case "implementation.finished":
      return <SummaryCard event={event} />;
    case "checks.completed":
      return <ChecksCard event={event} />;
    case "pr.opened":
      return <PullRequestCard event={event} />;
    case "run.failed":
      return <FailureCard event={event} />;
    case "run.cancelled":
      return (
        <Note icon={<Ban className="h-4 w-4" />} at={event.at}>
          <span className="font-medium text-ink">{event.data.by}</span> cancelled the run
        </Note>
      );
    default:
      return null;
  }
}

function LiveLine({ stage }: { stage: Stage }) {
  const now = useNow(1000);
  return (
    <div className="flex items-center gap-2 py-2 text-[13px] text-run" role="status">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inset-0 animate-ping rounded-full bg-run opacity-60 motion-reduce:hidden" />
        <span className="relative h-2 w-2 rounded-full bg-run" />
      </span>
      <span className="font-medium">Working for {clock(now - Date.parse(stage.startedAt))}</span>
    </div>
  );
}

function StageBlock({
  stage,
  opened,
  toggle,
  plans,
  awaitingApproval,
}: {
  stage: Stage;
  opened: ReadonlySet<string>;
  toggle: (id: string) => void;
  plans: RunEventDto[];
  awaitingApproval: boolean;
}) {
  const open = isOpen(stage, opened);
  const calls = stageCalls(stage);
  const items = visibleItems(stage, open);

  return (
    <section className="relative">
      <div className="flex items-center gap-3 pt-4 pb-1">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-faint uppercase">{stage.name}</span>
        <span className="h-px flex-1 bg-line" aria-hidden />
        {stage.status === "failed" && <span className="text-[11px] font-medium text-bad">failed</span>}
        <span className="text-[11px] text-ink-faint tabular-nums">{formatDuration(stageDuration(stage))}</span>
      </div>

      {!open && calls.length > 0 && (
        <button
          type="button"
          onClick={() => toggle(stage.id)}
          aria-expanded={false}
          className="flex items-center gap-2 py-1 text-[13px] text-ink-faint hover:text-ink"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          Worked for {formatDuration(stageDuration(stage))}: {summarise(calls).replace(/^./, (c) => c.toLowerCase())}
        </button>
      )}
      {open && stage.status === "finished" && calls.length > 0 && (
        <button
          type="button"
          onClick={() => toggle(stage.id)}
          aria-expanded
          className="flex items-center gap-2 py-1 text-[13px] text-ink-faint hover:text-ink"
        >
          <ChevronRight className="h-3.5 w-3.5 rotate-90" aria-hidden />
          Hide the work
        </button>
      )}

      {items.map((item) => {
        if (item.kind === "tools") return <WorkGroup key={item.id} item={item} open={opened.has(item.id)} onToggle={() => toggle(item.id)} />;
        if (item.kind === "refused" && item.event.type === "agent.tool")
          return <RefusedNote key={item.event.seq} event={item.event} />;
        if (item.kind === "event")
          return <EventView key={item.event.seq} event={item.event} plans={plans} awaitingApproval={awaitingApproval} />;
        return null;
      })}

      {stage.status === "running" && <LiveLine stage={stage} />}
    </section>
  );
}

/** The opening of the conversation: the issue Opificia works on. */
function IssueMessage({ run, at }: { run: RunDetail; at?: string }) {
  const now = useNow(60_000);
  return (
    <div className="flex justify-end pb-4">
      <a
        href={run.issueUrl}
        target="_blank"
        rel="noreferrer"
        className="max-w-[85%] rounded-2xl rounded-tr-md border border-line bg-surface px-4 py-3 hover:border-line-strong"
      >
        <span className="block text-[11px] text-ink-faint">
          {run.repo}#{run.issueNumber} · labelled for Opificia{at ? ` · ${when(at, now)}` : ""}
        </span>
        <span className="mt-0.5 block text-sm font-medium">{run.issueTitle}</span>
      </a>
    </div>
  );
}

export function Conversation({
  run,
  events,
  stages,
}: {
  run: RunDetail;
  events: RunEventDto[];
  stages: Stage[];
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const plans = events.filter((e) => e.type === "plan.proposed");
  const queued = events.find((e) => e.type === "run.queued");

  return (
    <div>
      <IssueMessage run={run} at={queued?.at} />
      {events.length <= 1 && <Note icon={<span className="h-2 w-2 animate-pulse rounded-full bg-run" />}>Waiting for a sandbox…</Note>}
      <div className="space-y-2">
        {stages.map((stage) => (
          <StageBlock
            key={stage.id}
            stage={stage}
            opened={opened}
            toggle={toggle}
            plans={plans}
            awaitingApproval={run.state === "awaiting_approval"}
          />
        ))}
      </div>
    </div>
  );
}
