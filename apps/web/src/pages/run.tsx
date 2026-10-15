// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import { RunDetail, RunEventDto, TERMINAL_STATES } from "@opificia/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";
import { z } from "zod";
import { api, formatTime, formatUsd } from "../lib.ts";
import { Button, Card, ErrorText, StateBadge } from "../ui.tsx";

// The Markdown renderer is large, so it loads only when a plan is shown.
const Markdown = lazy(() => import("../markdown.tsx").then((m) => ({ default: m.Markdown })));

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

function EventLine({ event }: { event: RunEventDto }) {
  const time = <span className="w-28 shrink-0 text-xs text-slate-400 tabular-nums">{formatTime(event.at)}</span>;
  let body: React.ReactNode;
  switch (event.type) {
    case "run.queued":
      body = <>Run queued for {event.data.repo}#{event.data.issue.number}</>;
      break;
    case "stage.started":
      body = <>Sandbox started for the {event.data.stage} stage at {event.data.baseSha.slice(0, 7)}</>;
      break;
    case "agent.message":
      body = <span className="whitespace-pre-wrap text-slate-700">{event.data.text}</span>;
      break;
    case "agent.tool":
      body = (
        <span className="font-mono text-xs text-slate-600">
          {event.data.tool} {event.data.summary}
        </span>
      );
      break;
    case "plan.proposed":
      body = <>Plan proposed ({formatUsd(event.data.costUsd)})</>;
      break;
    case "plan.approved":
      body = <>Plan approved by {event.data.by}</>;
      break;
    case "plan.changes_requested":
      body = (
        <>
          {event.data.by} asked for changes: <span className="whitespace-pre-wrap italic">{event.data.feedback}</span>
        </>
      );
      break;
    case "implementation.finished":
      body = <>Implementation finished at {event.data.headSha.slice(0, 7)} ({formatUsd(event.data.costUsd)})</>;
      break;
    case "checks.completed":
      body = (
        <div>
          Checks {event.data.passed ? "passed" : "failed"}: {event.data.files} files, +{event.data.additions} −{event.data.deletions}
          {event.data.findings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-700">
              {event.data.findings.map((f, i) => (
                <li key={i}>
                  {f.path ? <code>{f.path}</code> : null} {f.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
      break;
    case "pr.opened":
      body = (
        <>
          Pull request{" "}
          <a className="text-brand underline" href={event.data.url} target="_blank" rel="noreferrer">
            #{event.data.number}
          </a>{" "}
          opened from {event.data.branch}
        </>
      );
      break;
    case "run.failed":
      body = <span className="text-red-700">Run failed: {event.data.reason}</span>;
      break;
    case "run.cancelled":
      body = <>Run cancelled by {event.data.by}</>;
      break;
  }
  return (
    <li className="flex gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
      {time}
      <div className="min-w-0 flex-1 break-words">{body}</div>
    </li>
  );
}

export function RunPage() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const queryClient = useQueryClient();
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api(`/runs/${runId}`, RunDetail) });
  const events = useRunEvents(runId, () => void queryClient.invalidateQueries({ queryKey: ["run", runId] }));
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const command = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api(`/runs/${runId}/${path}`, z.undefined(), { method: "POST", body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => {
      setFeedback("");
      setShowFeedback(false);
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
  });

  if (run.error) return <ErrorText error={run.error} />;
  if (!run.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const r = run.data;
  const active = !TERMINAL_STATES.includes(r.state);

  return (
    <div className="space-y-5">
      <Card
        title={r.issueTitle}
        actions={
          active ? (
            <Button variant="danger" disabled={command.isPending} onClick={() => command.mutate({ path: "cancel" })}>
              Cancel run
            </Button>
          ) : undefined
        }
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">State</dt>
            <dd>
              <StateBadge state={r.state} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Issue</dt>
            <dd>
              <a className="text-brand underline" href={r.issueUrl} target="_blank" rel="noreferrer">
                {r.repo}#{r.issueNumber}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Cost</dt>
            <dd className="tabular-nums">
              {formatUsd(r.costUsd)} of {formatUsd(r.budgetUsd)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Pull request</dt>
            <dd>
              {r.prUrl ? (
                <a className="text-brand underline" href={r.prUrl} target="_blank" rel="noreferrer">
                  Open on GitHub
                </a>
              ) : (
                <span className="text-slate-400">Not yet</span>
              )}
            </dd>
          </div>
        </dl>
        <ErrorText error={command.error} />
      </Card>

      {r.plan && (
        <Card title="Plan">
          <div className="max-h-[32rem] overflow-auto rounded-md bg-slate-50 p-4">
            <Suspense fallback={<p className="whitespace-pre-wrap text-sm leading-relaxed">{r.plan}</p>}>
              <Markdown>{r.plan}</Markdown>
            </Suspense>
          </div>
          {r.state === "awaiting_approval" && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-slate-600">Nothing is implemented until you approve the plan.</p>
              <div className="flex gap-2">
                <Button disabled={command.isPending} onClick={() => command.mutate({ path: "approve" })}>
                  Approve plan
                </Button>
                <Button variant="secondary" onClick={() => setShowFeedback(!showFeedback)}>
                  Ask for changes
                </Button>
              </div>
              {showFeedback && (
                <div className="space-y-2">
                  <textarea
                    className="h-28 w-full rounded-md border border-slate-300 p-3 text-sm focus:border-brand focus:outline-none"
                    placeholder="What should change in the plan?"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <Button
                    disabled={!feedback.trim() || command.isPending}
                    onClick={() => command.mutate({ path: "request-changes", body: { feedback } })}
                  >
                    Send feedback and plan again
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title="Timeline">
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">Waiting for events…</p>
        ) : (
          <ol>
            {events.map((event) => (
              <EventLine key={event.seq} event={event} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
