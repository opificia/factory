// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { RunDetail, RunEventDto, TERMINAL_STATES } from "@opificia/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ArrowDown, Check, ExternalLink, GitPullRequest, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { usd } from "../format.ts";
import { api } from "../lib.ts";
import { Conversation } from "../run/conversation.tsx";
import { STEPS, type StepStatus, stepStatuses, stoppedAt } from "../status.ts";
import { buildTimeline } from "../timeline.ts";
import { Button, ErrorText, Kbd, StatusPill, Textarea } from "../ui.tsx";

/** Follows the run's event stream. The server resumes from Last-Event-ID. */
function useRunEvents(runId: string, onEvent: () => void): RunEventDto[] {
  const [events, setEvents] = useState<RunEventDto[]>([]);
  useEffect(() => {
    setEvents([]);
    const source = new EventSource(`/api/runs/${runId}/stream`);
    source.addEventListener("run", (message) => {
      const parsed = RunEventDto.safeParse(JSON.parse((message as MessageEvent<string>).data));
      if (!parsed.success) return;
      setEvents((current) => (current.some((e) => e.seq === parsed.data.seq) ? current : [...current, parsed.data]));
      onEvent();
    });
    return () => source.close();
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  return events;
}

/**
 * Keeps the page at the newest event while you are near the bottom, and says
 * so when you scrolled up and something new arrived.
 */
function useFollow(count: number, enabled: boolean) {
  const [away, setAway] = useState(false);
  const near = useRef(true);
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const onScroll = () => {
      near.current = main.scrollHeight - main.scrollTop - main.clientHeight < 120;
      if (near.current) setAway(false);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    const main = document.getElementById("main");
    if (!main || !enabled) return;
    if (near.current) main.scrollTo({ top: main.scrollHeight });
    else setAway(true);
  }, [count, enabled]);
  const toBottom = () => {
    const main = document.getElementById("main");
    main?.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
    setAway(false);
  };
  return { away, toBottom };
}

const STEP_STYLE: Record<StepStatus, { dot: string; text: string }> = {
  done: { dot: "bg-ink text-canvas", text: "text-ink-muted" },
  current: { dot: "bg-run text-white ring-4 ring-run-soft", text: "text-run font-medium" },
  waiting: { dot: "bg-gold-soft text-gold-ink ring-1 ring-gold", text: "text-gold-ink font-medium" },
  failed: { dot: "bg-bad text-white", text: "text-bad font-medium" },
  skipped: { dot: "bg-line-strong text-ink-muted", text: "text-ink-faint" },
  pending: { dot: "border border-line-strong bg-surface text-ink-faint", text: "text-ink-faint" },
};

function Steps({ run, events }: { run: RunDetail; events: RunEventDto[] }) {
  const statuses = stepStatuses(run.state, stoppedAt(events));
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Progress">
      {STEPS.map((step, i) => {
        const status = statuses[step];
        const style = STEP_STYLE[status];
        return (
          <li key={step} className="flex items-center gap-2" aria-current={status === "current" || status === "waiting" ? "step" : undefined}>
            {i > 0 && <span className={`h-px w-5 ${status === "pending" ? "bg-line" : "bg-line-strong"}`} aria-hidden />}
            <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] font-semibold ${style.dot}`} aria-hidden>
              {status === "done" ? (
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              ) : status === "failed" ? (
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              ) : (
                i + 1
              )}
            </span>
            <span className={style.text}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Budget({ run }: { run: RunDetail }) {
  const share = Math.min(1, run.costUsd / run.budgetUsd);
  return (
    <div className="hidden w-36 shrink-0 sm:block" title={`${usd(run.costUsd)} of a ${usd(run.budgetUsd)} budget`}>
      <div className="flex justify-between text-[11px] text-ink-faint tabular-nums">
        <span>Cost</span>
        <span>
          <span className="text-ink-muted">{run.costUsd.toFixed(2)}</span> / {run.budgetUsd.toFixed(0)} USD
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
        <div className={`h-full rounded-full ${share > 0.8 ? "bg-bad" : "bg-ink-faint"}`} style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
    </div>
  );
}

/** Tells the page how tall the sticky header is, so rows pinned below it line up. */
function useHeaderHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = ref.current;
    const main = document.getElementById("main");
    if (!header || !main) return;
    const observer = new ResizeObserver(() => main.style.setProperty("--run-header", `${header.offsetHeight}px`));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function Header({ run, events, onCancel, cancelling }: { run: RunDetail; events: RunEventDto[]; onCancel: () => void; cancelling: boolean }) {
  const active = !TERMINAL_STATES.includes(run.state);
  const ref = useHeaderHeight();
  return (
    <header ref={ref} className="z-10 border-b border-line bg-canvas/85 backdrop-blur md:sticky md:top-0">
      <div className="mx-auto max-w-3xl px-6 pt-5 pb-4">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <a href={`https://github.com/${run.repo}`} target="_blank" rel="noreferrer" className="hover:text-ink">
            {run.repo}
          </a>
          <span aria-hidden>/</span>
          <a href={run.issueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
            issue #{run.issueNumber}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          <span className="ml-auto flex items-center gap-2">
            {run.prUrl && (
              <a
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 font-medium text-ink hover:bg-sunken"
              >
                <GitPullRequest className="h-3.5 w-3.5 text-ok" aria-hidden />
                Pull request
              </a>
            )}
            {active && (
              <Button variant="danger" size="sm" disabled={cancelling} onClick={onCancel}>
                <X className="h-3.5 w-3.5" aria-hidden />
                Cancel run
              </Button>
            )}
          </span>
        </div>
        <div className="mt-2 flex items-start gap-4">
          <h1 className="min-w-0 flex-1 text-xl leading-snug font-semibold tracking-tight text-balance">{run.issueTitle}</h1>
          <Budget run={run} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusPill state={run.state} />
          <Steps run={run} events={events} />
        </div>
      </div>
    </header>
  );
}

/** The decision a person makes on a plan, kept at the bottom of the page. */
function ReviewBar({ busy, onApprove, onRequestChanges }: { busy: boolean; onApprove: () => void; onRequestChanges: (feedback: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const send = () => feedback.trim() && onRequestChanges(feedback.trim());
  return (
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-canvas via-canvas to-canvas/0 pt-6 pb-5">
      <div className="mx-auto max-w-3xl px-6">
        <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-lg shadow-brand/5">
          <span className="absolute inset-y-0 left-0 w-1 bg-gold" aria-hidden />
          <div className="flex flex-wrap items-center gap-3 py-3 pr-3 pl-5">
            <div className="min-w-[14rem] flex-1">
              <p className="text-sm font-semibold">The plan is ready for your review</p>
              <p className="text-xs text-ink-muted">Nothing is built until you approve it.</p>
            </div>
            {!asking && (
              <Button variant="secondary" onClick={() => setAsking(true)}>
                Ask for changes
              </Button>
            )}
            <Button disabled={busy} onClick={onApprove}>
              <Check className="h-4 w-4" aria-hidden />
              Approve plan
            </Button>
          </div>
          {asking && (
            <div className="border-t border-line px-5 py-3">
              <Textarea
                autoFocus
                rows={3}
                aria-label="What should change in the plan?"
                placeholder="What should change in the plan?"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                  if (e.key === "Escape") setAsking(false);
                }}
              />
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-ink-faint">
                  <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> to send
                </span>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setAsking(false)}>
                  Close
                </Button>
                <Button size="sm" disabled={!feedback.trim() || busy} onClick={send}>
                  Send and plan again
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RunPage() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const queryClient = useQueryClient();
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api(`/runs/${runId}`, RunDetail) });
  const events = useRunEvents(runId, () => {
    void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    void queryClient.invalidateQueries({ queryKey: ["runs"] });
  });

  const command = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api(`/runs/${runId}/${path}`, z.undefined(), { method: "POST", body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  const active = run.data ? !TERMINAL_STATES.includes(run.data.state) : false;
  const follow = useFollow(events.length, active);

  if (run.error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ErrorText error={run.error} />
      </div>
    );
  }
  if (!run.data) return <div className="mx-auto max-w-3xl px-6 py-10 text-sm text-ink-faint">Loading…</div>;
  const r = run.data;
  const { stages } = buildTimeline(events, { active });

  return (
    <div className="flex min-h-full flex-col">
      <Header run={r} events={events} onCancel={() => command.mutate({ path: "cancel" })} cancelling={command.isPending} />
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-6">
        <ErrorText error={command.error} />
        <Conversation run={r} events={events} stages={stages} />
      </div>
      {follow.away && (
        <div className="pointer-events-none sticky bottom-24 z-10 flex justify-center">
          <button
            type="button"
            onClick={follow.toBottom}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted shadow-md hover:text-ink"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            New activity
          </button>
        </div>
      )}
      {r.state === "awaiting_approval" ? (
        <ReviewBar
          busy={command.isPending}
          onApprove={() => command.mutate({ path: "approve" })}
          onRequestChanges={(feedback) => command.mutate({ path: "request-changes", body: { feedback } })}
        />
      ) : (
        <div className="h-10" aria-hidden />
      )}
    </div>
  );
}
