// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { PrState, RunDetail, RunEventDto } from "@opificia/contracts";
import {
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  FilePen,
  FileSearch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Globe,
  MessageSquareText,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { Suspense, lazy, useRef, useState, type ReactNode } from "react";
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
  splitStage,
} from "../timeline.ts";
import { Collapse } from "../ui.tsx";

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

/** A chevron in a fixed 20px box, so rows and the guide lines below them line up. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden>
      <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-300 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
    </span>
  );
}

function WorkGroup({ item, open, onToggle }: { item: Extract<Item, { kind: "tools" }>; open: boolean; onToggle: () => void }) {
  const kinds = [...new Set(item.calls.map((c) => (c.type === "agent.tool" ? kindOf(c.data.tool) : "other")))].slice(0, 3);
  const id = `work-${item.id}`;
  return (
    <div className="group/tools py-0.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-[13px] text-ink-muted hover:bg-sunken/70 hover:text-ink"
      >
        <Chevron open={open} />
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
        <span className="min-w-0 truncate">{item.summary}</span>
      </button>
      <Collapse open={open} id={id}>
        <ul className="mt-0.5 mb-1 ml-[9px] border-l border-line-strong py-0.5 pl-[19px] transition-colors group-hover/tools:border-ink-faint">
          {item.calls.map((call) => (
            <ToolLine key={call.seq} call={call} />
          ))}
        </ul>
      </Collapse>
      {!open && item.last && (
        <ul className="ml-[9px] border-l border-line-strong pl-[19px]">
          <ToolLine call={item.last} live />
        </ul>
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

function PullRequestCard({ event, prState }: { event: RunEventDto; prState: PrState | null }) {
  if (event.type !== "pr.opened") return null;
  const merged = prState === "merged";
  const closed = prState === "closed";
  const Icon = merged ? GitMerge : GitPullRequest;
  return (
    <a
      href={event.data.url}
      target="_blank"
      rel="noreferrer"
      className="group my-3 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-line-strong"
    >
      <span className={`grid h-8 w-8 place-items-center rounded-full ${closed ? "bg-sunken" : "bg-ok-soft"}`}>
        <Icon className={`h-4 w-4 ${closed ? "text-ink-faint" : "text-ok"}`} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">
          Pull request #{event.data.number} {merged ? "merged" : closed ? "closed" : "opened"}
        </span>
        <span className="block truncate font-mono text-[11px] text-ink-faint">{event.data.branch}</span>
      </span>
      <span className="ml-auto text-xs font-medium text-ink-muted group-hover:text-ink">{merged || closed ? "View" : "Review"} on GitHub →</span>
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

function EventView({
  event,
  plans,
  awaitingApproval,
  prState = null,
}: {
  event: RunEventDto;
  plans: RunEventDto[];
  awaitingApproval: boolean;
  prState?: PrState | null;
}) {
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
      return <PullRequestCard event={event} prState={prState} />;
    case "pr.merged":
      return (
        <Note icon={<GitMerge className="h-4 w-4 text-ok" />} at={event.at}>
          {event.data.by ? (
            <>
              <span className="font-medium text-ink">{event.data.by}</span> merged the pull request
            </>
          ) : (
            "The pull request was merged"
          )}
        </Note>
      );
    case "pr.closed":
      return (
        <Note icon={<GitPullRequestClosed className="h-4 w-4" />} at={event.at}>
          The pull request was closed without merging
        </Note>
      );
    case "pr.reopened":
      return (
        <Note icon={<GitPullRequest className="h-4 w-4" />} at={event.at}>
          The pull request was reopened
        </Note>
      );
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

/** "2m 21s", or a live clock while the stage runs. */
function StageClock({ stage }: { stage: Stage }) {
  const now = useNow(stage.status === "running" ? 1000 : 3_600_000);
  return <>{stage.status === "running" ? clock(now - Date.parse(stage.startedAt)) : formatDuration(stageDuration(stage))}</>;
}

/** Hosts the policy refused, not connections the limit refused for a moment. */
function blockedHosts(work: Item[]): number {
  return work.filter((i) => i.kind === "refused" && i.event.type === "agent.tool" && !/connections open/.test(i.event.data.summary)).length;
}

function StageBlock({
  stage,
  choices,
  choose,
  opened,
  toggle,
  plans,
  awaitingApproval,
  prState,
}: {
  stage: Stage;
  prState: PrState | null;
  choices: ReadonlyMap<string, boolean>;
  choose: (id: string, open: boolean) => void;
  opened: ReadonlySet<string>;
  toggle: (id: string) => void;
  plans: RunEventDto[];
  awaitingApproval: boolean;
}) {
  const open = isOpen(stage, choices);
  const { work, after } = splitStage(stage);
  const calls = stageCalls(stage);
  const blocked = blockedHosts(work);
  const running = stage.status === "running";
  const row = useRef<HTMLButtonElement>(null);
  const id = `stage-${stage.id}`;

  const collapse = () => {
    choose(stage.id, false);
    row.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <section>
      <div className="flex items-center gap-3 pt-5 pb-1">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-faint uppercase">{stage.name}</span>
        <span className="h-px flex-1 bg-line" aria-hidden />
        {stage.status === "failed" && <span className="text-[11px] font-medium text-bad">failed</span>}
      </div>

      {work.length > 0 && (
        <div className="group/stage">
          <button
            ref={row}
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => choose(stage.id, !open)}
            className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-sunken ${
              open ? "sticky top-0 z-[2] bg-canvas/95 shadow-[0_1px_0_var(--line)] backdrop-blur md:top-[var(--run-header,0px)]" : ""
            } ${running ? "text-run" : "text-ink-muted hover:text-ink"}`}
          >
            <Chevron open={open} />
            {running && (
              <span className="relative -ml-1 flex h-2 w-2" aria-hidden>
                <span className="absolute inset-0 animate-ping rounded-full bg-run opacity-60 motion-reduce:hidden" />
                <span className="relative h-2 w-2 rounded-full bg-run" />
              </span>
            )}
            <span className="font-medium">
              {running ? "Working for " : "Worked for "}
              <span className="tabular-nums">
                <StageClock stage={stage} />
              </span>
            </span>
            {calls.length > 0 && <span className="min-w-0 truncate text-ink-faint">· {summarise(calls).replace(/^./, (c) => c.toLowerCase())}</span>}
            {blocked > 0 && (
              <span className="ml-auto shrink-0 rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-gold-ink">
                {blocked} blocked {blocked === 1 ? "host" : "hosts"}
              </span>
            )}
          </button>

          <Collapse open={open} id={id}>
            <div className="mt-1 ml-[9px] border-l-2 border-line-strong pl-[17px] transition-colors group-hover/stage:border-ink-faint">
              {work.map((item) => {
                if (item.kind === "tools") return <WorkGroup key={item.id} item={item} open={opened.has(item.id)} onToggle={() => toggle(item.id)} />;
                if (item.kind === "refused") return <RefusedNote key={item.event.seq} event={item.event} />;
                return <EventView key={item.event.seq} event={item.event} plans={plans} awaitingApproval={awaitingApproval} />;
              })}
              {running ? (
                <p className="py-2 text-[13px]">
                  <span className="shimmer">Working…</span>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={collapse}
                  className="my-1 -ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-ink-faint hover:bg-sunken hover:text-ink"
                >
                  <ChevronRight className="h-3.5 w-3.5 -rotate-90" aria-hidden />
                  Collapse
                </button>
              )}
            </div>
          </Collapse>
        </div>
      )}

      {after.map((event) => (
        <EventView key={event.seq} event={event} plans={plans} awaitingApproval={awaitingApproval} prState={prState} />
      ))}
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
  // Stages: what the person chose; tool groups: which ones are open.
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(new Map());
  const choose = (id: string, open: boolean) => setChoices((current) => new Map(current).set(id, open));
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
      <div>
        {stages.map((stage) => (
          <StageBlock
            key={stage.id}
            stage={stage}
            choices={choices}
            choose={choose}
            opened={opened}
            toggle={toggle}
            plans={plans}
            awaitingApproval={run.state === "awaiting_approval"}
            prState={run.prState}
          />
        ))}
      </div>
    </div>
  );
}
