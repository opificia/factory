// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Connect, Plugin } from "vite";
import { SOURCES, type SourceRun } from "./runs.ts";

/**
 * The fixture mode of the web app (ADR-0009): the Vite dev server answers
 * /api itself, with recorded runs in every state and a signed-in person, so
 * the app can be seen and screenshotted without a server, a database or
 * GitHub. Writes succeed and change nothing. Times are shifted on every
 * request, so live clocks and short ages look right.
 *
 * Start it with `pnpm --filter @opificia/web dev:fixtures`.
 */

type Event = SourceRun["events"][number];

type Scenario = {
  id: string;
  source: keyof typeof SOURCES;
  /** The last event to include. Undefined includes all of them. */
  upTo?: number;
  state: string;
  title?: string;
  issueNumber?: number;
  /** How long ago the last event happened, in minutes. Live runs use seconds. */
  agoMinutes: number;
  extra?: (last: Event) => Event[];
};

const MINUTE = 60_000;

/** One run per state. Run ids are fixed, so screenshots can link to them. */
export const SCENARIOS: Scenario[] = [
  { id: "f0000000-0000-4000-8000-000000000001", source: "timeline", upTo: 8, state: "planning", title: "Show the plan as a numbered checklist", issueNumber: 101, agoMinutes: 0 },
  { id: "f0000000-0000-4000-8000-000000000002", source: "timeline", upTo: 15, state: "awaiting_approval", agoMinutes: 3 },
  { id: "f0000000-0000-4000-8000-000000000003", source: "timeline", upTo: 34, state: "implementing", title: "Add keyboard shortcuts to the run page", issueNumber: 103, agoMinutes: 0 },
  { id: "f0000000-0000-4000-8000-000000000004", source: "timeline", upTo: 43, state: "pr_opened", title: "Show runs in a sidebar, grouped by what needs attention", issueNumber: 30, agoMinutes: 20 },
  { id: "f0000000-0000-4000-8000-000000000005", source: "egress", state: "pr_opened", agoMinutes: 120 },
  { id: "f0000000-0000-4000-8000-000000000006", source: "timeline", state: "pr_opened", title: "Fold the plan card and fix the run actions", issueNumber: 32, agoMinutes: 26 * 60 },
  {
    id: "f0000000-0000-4000-8000-000000000007",
    source: "timeline",
    upTo: 41,
    state: "failed",
    title: "Protect .githooks from agent changes",
    issueNumber: 21,
    agoMinutes: 180,
    extra: (last) => [
      {
        seq: last.seq + 1,
        at: last.at,
        type: "checks.completed",
        data: {
          passed: false,
          findings: [
            { rule: "protected_path", path: ".github/workflows/checks.yml", message: "the change touches a protected path" },
            { rule: "secret", path: "apps/web/src/lib.ts", message: "a string that looks like an API key" },
          ],
          files: 4,
          additions: 120,
          deletions: 3,
        },
      },
      { seq: last.seq + 2, at: last.at, type: "run.failed", data: { reason: "the checks found 2 problems" } },
    ],
  },
  { id: "f0000000-0000-4000-8000-000000000008", source: "cancelled", state: "cancelled", agoMinutes: 2 * 24 * 60 },
];

function eventsOf(scenario: Scenario, now: number): Event[] {
  let events = SOURCES[scenario.source].events.filter((e) => scenario.upTo === undefined || e.seq <= scenario.upTo);
  if (scenario.extra) events = [...events, ...scenario.extra(events.at(-1)!)];
  const ago = scenario.agoMinutes === 0 ? 4_000 : scenario.agoMinutes * MINUTE;
  const shift = now - ago - Date.parse(events.at(-1)!.at);
  return events.map((e) => ({ ...e, at: new Date(Date.parse(e.at) + shift).toISOString() }));
}

function prStateOf(events: Event[]): string | null {
  let state: string | null = null;
  for (const e of events) {
    if (e.type === "pr.opened" || e.type === "pr.reopened") state = "open";
    if (e.type === "pr.merged") state = "merged";
    if (e.type === "pr.closed") state = "closed";
  }
  return state;
}

function detail(scenario: Scenario, now: number) {
  const { run } = SOURCES[scenario.source];
  const events = eventsOf(scenario, now);
  const plans = events.filter((e) => e.type === "plan.proposed");
  const opened = events.find((e) => e.type === "pr.opened");
  const cost = events.reduce((sum, e) => sum + (typeof e.data.costUsd === "number" ? e.data.costUsd : 0), 0);
  const issueNumber = scenario.issueNumber ?? run.issue_number;
  return {
    events,
    run: {
      id: scenario.id,
      repo: run.repo,
      issueNumber,
      issueTitle: scenario.title ?? run.issue_title,
      issueUrl: `https://github.com/${run.repo}/issues/${issueNumber}`,
      state: scenario.state,
      costUsd: cost,
      prUrl: opened ? String(opened.data.url) : null,
      prState: prStateOf(events),
      createdAt: events[0]!.at,
      updatedAt: events.at(-1)!.at,
      plan: plans.length ? String(plans.at(-1)!.data.plan) : null,
      branch: run.branch,
      budgetUsd: run.budget_usd,
      deadlineAt: new Date(now + 60 * MINUTE).toISOString(),
      lastSeq: events.at(-1)!.seq,
    },
  };
}

const PERSON = { id: "fixture-user", name: "Ada Lovelace", email: "ada@example.org", emailVerified: true, image: null };
const ORGANIZATION = { id: "fixture-org", name: "Example", slug: "example", members: [], invitations: [] };

function json(res: Parameters<Connect.NextHandleFunction>[1], body: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const handle: Connect.NextHandleFunction = (req, res, next) => {
  const url = new URL(req.url ?? "/", "http://fixture");
  const path = url.pathname;
  if (!path.startsWith("/api/")) return next();
  const now = Date.now();

  if (path === "/api/auth/get-session") {
    return json(res, {
      user: { ...PERSON, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() },
      session: { id: "fixture-session", userId: PERSON.id, activeOrganizationId: ORGANIZATION.id, expiresAt: new Date(now + 86_400_000).toISOString() },
    });
  }
  if (path === "/api/auth/organization/get-full-organization") return json(res, ORGANIZATION);
  if (path.startsWith("/api/auth/")) return json(res, {});

  if (path === "/api/runs") {
    return json(
      res,
      SCENARIOS.map((s) => detail(s, now).run)
        .map(({ plan: _plan, branch: _branch, budgetUsd: _budget, deadlineAt: _deadline, lastSeq: _seq, ...summary }) => summary)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  const match = /^\/api\/runs\/([^/]+)(\/stream|\/events|\/(approve|request-changes|cancel))?$/.exec(path);
  const scenario = match && SCENARIOS.find((s) => s.id === match[1]);
  if (match && !scenario) return json(res, { message: "There is no such run." }, 404);
  if (scenario) {
    if (req.method === "POST") {
      res.statusCode = 204;
      return res.end();
    }
    const { run, events } = detail(scenario, now);
    if (match[2] === "/stream") {
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("cache-control", "no-cache");
      res.write(events.map((e) => `id: ${e.seq}\nevent: run\ndata: ${JSON.stringify(e)}\n\n`).join(""));
      // Keep the stream open, as the server does, so the browser does not reconnect.
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
      req.on("close", () => clearInterval(heartbeat));
      return;
    }
    if (match[2] === "/events") return json(res, events);
    return json(res, run);
  }

  if (path === "/api/github/installations") return json(res, [{ installationId: 1, accountLogin: "example", linked: true }]);
  if (path === "/api/github/repos") {
    return json(res, [
      { fullName: "opificia/factory", private: false, defaultBranch: "main", installationId: 1 },
      { fullName: "opificia/playground", private: true, defaultBranch: "main", installationId: 1 },
    ]);
  }
  return json(res, { message: "The fixture mode has no answer for this request." }, 404);
};

export function fixtures(): Plugin {
  return {
    name: "opificia-fixtures",
    configureServer(server) {
      server.middlewares.use(handle);
    },
  };
}
