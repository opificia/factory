// SPDX-FileCopyrightText: The Opificia Authors
// SPDX-License-Identifier: AGPL-3.0-only

// Recorded runs for the fixture mode (fixtures/plugin.ts): the events of three
// real runs of Opificia on its own repository and the playground, with the
// names of people replaced. Regenerate them from a local install when the
// event contracts change.

export type SourceRun = {
  run: { repo: string; issue_number: number; issue_title: string; issue_url: string; branch: string; budget_usd: number; pr_url: string | null };
  events: { seq: number; at: string; type: string; data: Record<string, unknown> }[];
};

export const SOURCES: Record<"timeline" | "egress" | "cancelled", SourceRun> = {
 "timeline": {
  "run": {
   "repo": "opificia/factory",
   "issue_number": 31,
   "issue_title": "Group the run timeline by stage and fold tool calls",
   "issue_url": "https://github.com/opificia/factory/issues/31",
   "branch": "opificia/issue-31-ae32cdc6",
   "budget_usd": 15,
   "pr_url": "https://github.com/opificia/factory/pull/34"
  },
  "events": [
   {
    "seq": 1,
    "at": "2026-10-15T20:07:50.936Z",
    "type": "run.queued",
    "data": {
     "repo": "opificia/factory",
     "issue": {
      "url": "https://github.com/opificia/factory/issues/31",
      "title": "Group the run timeline by stage and fold tool calls",
      "number": 31
     },
     "budgetUsd": 15,
     "deadlineAt": "2026-10-15T21:07:50.918Z",
     "installationId": 171530814
    }
   },
   {
    "seq": 2,
    "at": "2026-10-15T20:07:52.961Z",
    "type": "stage.started",
    "data": {
     "stage": "plan",
     "baseSha": "fc62d68ae18945f4ed930adaae7821c162bc9569",
     "sessionId": "ca8b3b09-f127-475d-a5ac-39489726689a"
    }
   },
   {
    "seq": 3,
    "at": "2026-10-15T20:07:55.733Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/apps/web/src/pages/run.tsx"
    }
   },
   {
    "seq": 4,
    "at": "2026-10-15T20:07:56.369Z",
    "type": "agent.tool",
    "data": {
     "tool": "Glob",
     "stage": "plan",
     "summary": "apps/web/**/*.{ts,tsx,json}"
    }
   },
   {
    "seq": 5,
    "at": "2026-10-15T20:07:57.046Z",
    "type": "agent.tool",
    "data": {
     "tool": "Grep",
     "stage": "plan",
     "summary": "RunEventDto|EventType|'stage\\.started'|agent\\.tool"
    }
   },
   {
    "seq": 6,
    "at": "2026-10-15T20:08:00.380Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/sdk/contracts/src/run.ts"
    }
   },
   {
    "seq": 7,
    "at": "2026-10-15T20:08:00.847Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/apps/web/package.json"
    }
   },
   {
    "seq": 8,
    "at": "2026-10-15T20:08:01.414Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/apps/web/src/markdown.test.tsx"
    }
   },
   {
    "seq": 9,
    "at": "2026-10-15T20:08:01.618Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/apps/web/src/lib.ts"
    }
   },
   {
    "seq": 10,
    "at": "2026-10-15T20:08:02.144Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/sdk/contracts/src/api.ts"
    }
   },
   {
    "seq": 11,
    "at": "2026-10-15T20:08:04.924Z",
    "type": "agent.tool",
    "data": {
     "tool": "Grep",
     "stage": "plan",
     "summary": "tool: \"network\"|\"refused|refused"
    }
   },
   {
    "seq": 12,
    "at": "2026-10-15T20:08:05.855Z",
    "type": "agent.tool",
    "data": {
     "tool": "Grep",
     "stage": "plan",
     "summary": "stage\\.started|changes_requested|checks\\.completed"
    }
   },
   {
    "seq": 13,
    "at": "2026-10-15T20:08:12.656Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/apps/web/vite.config.ts"
    }
   },
   {
    "seq": 14,
    "at": "2026-10-15T20:08:37.162Z",
    "type": "agent.message",
    "data": {
     "text": "## Summary\n\nI'll add a pure module, `apps/web/src/timeline.ts`. It turns `RunEventDto[]` into rows: stage headers, folded tool groups and single events. `run.tsx` will render those rows and keep track of which groups are unfolded. This keeps the plan, the approval, the checks and the failure reason visible among the hundreds of `agent.tool` events. There are no server, contract or package changes.\n\n## Changes\n\n- **`apps/web/src/timeline.ts`** (new, AGPL-3.0-only SPDX header). Its only import is the `@opificia/contracts` types. It must not import `lib.ts`, because `lib.ts` reads `window` when it loads, and that would break the tests that run without a DOM.\n  - Types:\n    - `Stage`: `{ kind: \"stage\", id, name: \"Plan\" | \"Implement\" | \"Result\", startedAt, endedAt?, status: \"running\" | \"finished\" | \"failed\", outcome?: RunEventDto, items: Item[] }`.\n    - `Item`: one of these:\n      - `{ kind: \"event\", event }`\n      - `{ kind: \"tools\", id, summary, calls: RunEventDto[], last?: RunEventDto }`\n      - `{ kind: \"refused\", event }`\n  - `buildTimeline(events, { active: boolean }): { before: RunEventDto[], stages: Stage[] }`\n    - `run.queued` and anything else before the first `stage.started` goes in `before`.\n    - Each `stage.started` opens a new stage. After a change request the plan stage starts again, so a second \"Plan\" section appears. Stage ids come from the `seq` of the event that started the stage, so the fold state stays stable as events stream in.\n    - A stage ends at `plan.proposed`, `implementation.finished` or `run.failed`. That event becomes the stage's `outcome` and its `at` becomes `endedAt`. `run.failed` sets the status to `failed`.\n    - `plan.approved` and `plan.changes_requested` stay in the plan stage that just ended.\n    - Events after `implementation.finished` (`checks.completed`, `pr.opened`, and `run.failed` from checks) go in a \"Result\" stage. Its start is the `implementation.finished` time and its end is the last event in it.\n    - `run.cancelled` closes the current stage.\n    - A stage without an end is `running` only while `active` is true. Otherwise it counts as finished.\n  - Tool folding:\n    - Consecutive `agent.tool` events become one `tools` item.\n    - A `network` call whose summary starts with \"refused\" ends the current group and becomes its own `refused` item. Calls after it start a new group.\n    - `agent.message` and the other events also end a group.\n  - `summarise(calls)`:\n    - Counts calls by kind: `Read`/`Glob`/`Grep` read files, `Bash` runs commands, `Edit`/`Write`/`NotebookEdit` edit files, `network` is a network decision, anything else is an action.\n    - Builds the sentence with singular and plural forms, ordered by count, then by a fixed order of kinds when counts are equal. It names at most two kinds and adds \"and N other actions\" for the rest. Example: \"Read 4 files, ran 2 commands and edited 1 file\".\n  - `last` is set on the last tool group of a running stage, if that group is the stage's final item.\n  - `formatDuration(ms)` produces strings like \"6m 12s\", \"45s\" or \"1h 3m\".\n  - `pinned(event)` is true for the events that are never folded: `plan.approved`, `plan.changes_requested`, `checks.completed`, `pr.opened`, `run.failed` and `run.cancelled`.\n  - `visibleItems(stage, open)` returns what a stage shows when folded or unfolded:\n    - Unfolded (running, failed or opened by a click): all items.\n    - Folded: the outcome, pinned events and `refused` items.\n\n- **`apps/web/src/pages/run.tsx`**\n  - Call `buildTimeline(events, { active })`.\n  - Keep `useState<Set<string>>` for the stages and tool groups the user opened. Stages and groups are folded by default. Running and failed stages always count as open.\n  - Render stage headers as buttons, for example \"Implement · 6m 12s\", plus a running or failed marker.\n  - Render tool groups as a button row with the summary. Unfolded, the group lists its calls one per line in `font-mono text-xs text-slate-500`. When `last` is set, the last call stays visible under the folded row.\n  - Render `refused` rows in amber (`text-amber-700`).\n  - Render `agent.message` with the lazy `Markdown` component inside `Suspense`, with plain text as the fallback, as the plan card does. The time goes in a `title` attribute instead of the time column.\n  - Keep `EventLine` for single events. Its `agent.message` and `agent.tool` cases move to the new rows.\n\n## Tests\n\n- **`apps/web/src/timeline.test.ts`** (new, built from plain `RunEventDto` fixtures, no DOM):\n  - Grouping:\n    - events split into Plan, Implement and Result\n    - durations come from the event times\n    - a change request starts a second Plan stage\n  - Summary sentence:\n    - kinds counted by tool name\n    - singular and plural forms\n    - \"and N other actions\" when there are more than two kinds\n    - unknown tools count as actions\n  - Tool groups end at messages and other events.\n  - A stage that ends in `run.failed` is `failed`, unfolded, and shows the reason. A stage without an end is `running` only while the run is active.\n  - A refused `network` call becomes its own row and stays visible when the stage is folded. An allowed `network` call is folded into the group.\n  - The never-folded events stay visible in a folded stage.\n  - `last` is set only while the stage runs.\n- Commands: `pnpm --filter @opificia/web test`, `pnpm --filter @opificia/web build` and `pnpm typecheck`.\n\n## Risks\n\n- **Where some events go.** The issue doesn't say where these belong, so these are my choices:\n  - `plan.approved` and `plan.changes_requested` go under the plan stage they follow.\n  - A replanned run shows two \"Plan\" sections.\n  - `run.queued` goes above the first stage.\n  - A `run.failed` that comes from the checks belongs to \"Result\".\n- **Duration of a running stage.** For now it shows the time until the latest event and does not tick. A live clock would need a timer in the page.\n- **Markdown in every message.** Rendering each `agent.message` with Streamdown could slow down long runs. It loads once, lazily, but the reviewer should check how the page behaves with many messages.\n- **Refused calls are matched on text.** They are detected by the summary prefix \"refused\", which `apps/server/src/sandbox/sessions.service.ts:261` writes. If that text changes, the detection breaks silently. A comment in `timeline.ts` will point to the line.",
     "stage": "plan"
    }
   },
   {
    "seq": 15,
    "at": "2026-10-15T20:08:37.201Z",
    "type": "plan.proposed",
    "data": {
     "plan": "## Summary\n\nI'll add a pure module, `apps/web/src/timeline.ts`. It turns `RunEventDto[]` into rows: stage headers, folded tool groups and single events. `run.tsx` will render those rows and keep track of which groups are unfolded. This keeps the plan, the approval, the checks and the failure reason visible among the hundreds of `agent.tool` events. There are no server, contract or package changes.\n\n## Changes\n\n- **`apps/web/src/timeline.ts`** (new, AGPL-3.0-only SPDX header). Its only import is the `@opificia/contracts` types. It must not import `lib.ts`, because `lib.ts` reads `window` when it loads, and that would break the tests that run without a DOM.\n  - Types:\n    - `Stage`: `{ kind: \"stage\", id, name: \"Plan\" | \"Implement\" | \"Result\", startedAt, endedAt?, status: \"running\" | \"finished\" | \"failed\", outcome?: RunEventDto, items: Item[] }`.\n    - `Item`: one of these:\n      - `{ kind: \"event\", event }`\n      - `{ kind: \"tools\", id, summary, calls: RunEventDto[], last?: RunEventDto }`\n      - `{ kind: \"refused\", event }`\n  - `buildTimeline(events, { active: boolean }): { before: RunEventDto[], stages: Stage[] }`\n    - `run.queued` and anything else before the first `stage.started` goes in `before`.\n    - Each `stage.started` opens a new stage. After a change request the plan stage starts again, so a second \"Plan\" section appears. Stage ids come from the `seq` of the event that started the stage, so the fold state stays stable as events stream in.\n    - A stage ends at `plan.proposed`, `implementation.finished` or `run.failed`. That event becomes the stage's `outcome` and its `at` becomes `endedAt`. `run.failed` sets the status to `failed`.\n    - `plan.approved` and `plan.changes_requested` stay in the plan stage that just ended.\n    - Events after `implementation.finished` (`checks.completed`, `pr.opened`, and `run.failed` from checks) go in a \"Result\" stage. Its start is the `implementation.finished` time and its end is the last event in it.\n    - `run.cancelled` closes the current stage.\n    - A stage without an end is `running` only while `active` is true. Otherwise it counts as finished.\n  - Tool folding:\n    - Consecutive `agent.tool` events become one `tools` item.\n    - A `network` call whose summary starts with \"refused\" ends the current group and becomes its own `refused` item. Calls after it start a new group.\n    - `agent.message` and the other events also end a group.\n  - `summarise(calls)`:\n    - Counts calls by kind: `Read`/`Glob`/`Grep` read files, `Bash` runs commands, `Edit`/`Write`/`NotebookEdit` edit files, `network` is a network decision, anything else is an action.\n    - Builds the sentence with singular and plural forms, ordered by count, then by a fixed order of kinds when counts are equal. It names at most two kinds and adds \"and N other actions\" for the rest. Example: \"Read 4 files, ran 2 commands and edited 1 file\".\n  - `last` is set on the last tool group of a running stage, if that group is the stage's final item.\n  - `formatDuration(ms)` produces strings like \"6m 12s\", \"45s\" or \"1h 3m\".\n  - `pinned(event)` is true for the events that are never folded: `plan.approved`, `plan.changes_requested`, `checks.completed`, `pr.opened`, `run.failed` and `run.cancelled`.\n  - `visibleItems(stage, open)` returns what a stage shows when folded or unfolded:\n    - Unfolded (running, failed or opened by a click): all items.\n    - Folded: the outcome, pinned events and `refused` items.\n\n- **`apps/web/src/pages/run.tsx`**\n  - Call `buildTimeline(events, { active })`.\n  - Keep `useState<Set<string>>` for the stages and tool groups the user opened. Stages and groups are folded by default. Running and failed stages always count as open.\n  - Render stage headers as buttons, for example \"Implement · 6m 12s\", plus a running or failed marker.\n  - Render tool groups as a button row with the summary. Unfolded, the group lists its calls one per line in `font-mono text-xs text-slate-500`. When `last` is set, the last call stays visible under the folded row.\n  - Render `refused` rows in amber (`text-amber-700`).\n  - Render `agent.message` with the lazy `Markdown` component inside `Suspense`, with plain text as the fallback, as the plan card does. The time goes in a `title` attribute instead of the time column.\n  - Keep `EventLine` for single events. Its `agent.message` and `agent.tool` cases move to the new rows.\n\n## Tests\n\n- **`apps/web/src/timeline.test.ts`** (new, built from plain `RunEventDto` fixtures, no DOM):\n  - Grouping:\n    - events split into Plan, Implement and Result\n    - durations come from the event times\n    - a change request starts a second Plan stage\n  - Summary sentence:\n    - kinds counted by tool name\n    - singular and plural forms\n    - \"and N other actions\" when there are more than two kinds\n    - unknown tools count as actions\n  - Tool groups end at messages and other events.\n  - A stage that ends in `run.failed` is `failed`, unfolded, and shows the reason. A stage without an end is `running` only while the run is active.\n  - A refused `network` call becomes its own row and stays visible when the stage is folded. An allowed `network` call is folded into the group.\n  - The never-folded events stay visible in a folded stage.\n  - `last` is set only while the stage runs.\n- Commands: `pnpm --filter @opificia/web test`, `pnpm --filter @opificia/web build` and `pnpm typecheck`.\n\n## Risks\n\n- **Where some events go.** The issue doesn't say where these belong, so these are my choices:\n  - `plan.approved` and `plan.changes_requested` go under the plan stage they follow.\n  - A replanned run shows two \"Plan\" sections.\n  - `run.queued` goes above the first stage.\n  - A `run.failed` that comes from the checks belongs to \"Result\".\n- **Duration of a running stage.** For now it shows the time until the latest event and does not tick. A live clock would need a timer in the page.\n- **Markdown in every message.** Rendering each `agent.message` with Streamdown could slow down long runs. It loads once, lazily, but the reviewer should check how the page behaves with many messages.\n- **Refused calls are matched on text.** They are detected by the summary prefix \"refused\", which `apps/server/src/sandbox/sessions.service.ts:261` writes. If that text changes, the detection breaks silently. A comment in `timeline.ts` will point to the line.",
     "costUsd": 0.18629700000000002
    }
   },
   {
    "seq": 16,
    "at": "2026-10-15T20:10:29.490Z",
    "type": "plan.approved",
    "data": {
     "by": "Ada Lovelace",
     "deadlineAt": "2026-10-15T21:10:29.480Z"
    }
   },
   {
    "seq": 17,
    "at": "2026-10-15T20:10:31.157Z",
    "type": "stage.started",
    "data": {
     "stage": "implement",
     "baseSha": "fc62d68ae18945f4ed930adaae7821c162bc9569",
     "sessionId": "e36d3af4-3557-426c-a935-4d23556f19cc"
    }
   },
   {
    "seq": 18,
    "at": "2026-10-15T20:10:33.292Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "implement",
     "summary": "/work/repo/apps/web/src/pages/run.tsx"
    }
   },
   {
    "seq": 19,
    "at": "2026-10-15T20:10:33.881Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo/apps/web; ls . src; cat package.json | head -30; grep -n \"RunEventDto\" -A15 ../../sdk/contracts/src/*.ts | head -50; sed -n 250,270p ../server/src/sandbox/sessions.service.ts; head -5 src/markdown.tsx"
    }
   },
   {
    "seq": 20,
    "at": "2026-10-15T20:10:35.420Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo/sdk/contracts/src; sed -n 1,32p api.ts; grep -n \"stage\" *.ts | head -20; cat /work/repo/apps/web/src/markdown.test.tsx | head -15"
    }
   },
   {
    "seq": 21,
    "at": "2026-10-15T20:10:37.214Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo/sdk/contracts/src; grep -n \"Stage =\" -B1 -A2 run.ts; sed -n 40,60p run.ts"
    }
   },
   {
    "seq": 22,
    "at": "2026-10-15T20:11:08.452Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo/apps/web/src; cat > timeline.ts <<'EOF'\n// SPDX-FileCopyrightText: The Opificia Authors\n// SPDX-License-Identifier: AGPL-3.0-only\n\n// Pure logic for the run timeline. Keep this free of DOM and of `lib.ts`,\n// which reads `window` when it loads.\n\nimport type { RunEventDto } from \"@opificia/contracts\";\n\nexport type StageName = \"Plan\" | \"Implement\" | \"Result\";\n\nexport type Item =\n  | { kind: \"event\"; event: RunEventDto }\n  | { kind: \"tools\"; id: string; summary: string; calls: RunEven"
    }
   },
   {
    "seq": 23,
    "at": "2026-10-15T20:11:28.881Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo/apps/web/src; cat > timeline.test.ts <<'EOF'\n// SPDX-FileCopyrightText: The Opificia Authors\n// SPDX-License-Identifier: AGPL-3.0-only\n\nimport type { RunEventDto } from \"@opificia/contracts\";\nimport { describe, expect, it } from \"vitest\";\nimport { buildTimeline, formatDuration, isOpen, pinned, stageDuration, summarise, visibleItems } from \"./timeline.ts\";\n\nlet seq = 0;\nconst at = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s)).toISOString();\nconst make = (s: number, type: s"
    }
   },
   {
    "seq": 24,
    "at": "2026-10-15T20:11:29.144Z",
    "type": "agent.tool",
    "data": {
     "tool": "network",
     "stage": "implement",
     "summary": "allowed registry.npmjs.org:443: a built-in registry or source host"
    }
   },
   {
    "seq": 25,
    "at": "2026-10-15T20:11:39.878Z",
    "type": "agent.message",
    "data": {
     "text": "Dependencies aren't installed. I'll install them from the lock file.",
     "stage": "implement"
    }
   },
   {
    "seq": 26,
    "at": "2026-10-15T20:11:40.404Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo && pnpm install --frozen-lockfile 2>&1 | tail -5; pnpm --filter @opificia/web test 2>&1 | tail -40"
    }
   },
   {
    "seq": 27,
    "at": "2026-10-15T20:11:41.528Z",
    "type": "agent.tool",
    "data": {
     "tool": "network",
     "stage": "implement",
     "summary": "refused registry.npmjs.org:443: the session has 64 connections open"
    }
   },
   {
    "seq": 28,
    "at": "2026-10-15T20:11:45.115Z",
    "type": "agent.tool",
    "data": {
     "tool": "network",
     "stage": "implement",
     "summary": "allowed binaries.prisma.sh:443: allowed by the operator"
    }
   },
   {
    "seq": 29,
    "at": "2026-10-15T20:11:56.966Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo/apps/web/src/pages && python3 - <<'EOF'\np='run.tsx'\ns=open(p).read()\ns=s.replace('''import { api, formatTime, formatUsd } from \"../lib.ts\";\n''','''import { api, formatTime, formatUsd } from \"../lib.ts\";\nimport { type Item, type Stage, buildTimeline, formatDuration, isOpen, stageDuration, visibleItems } from \"../timeline.ts\";\n''')\ns=s.replace('''    case \"agent.message\":\n      body = <span className=\"whitespace-pre-wrap text-slate-700\">{event.data.text}</span>;\n      break;\n    case"
    }
   },
   {
    "seq": 30,
    "at": "2026-10-15T20:12:12.622Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo/apps/web/src/pages && cat > /tmp/new.tsx <<'EOF'\nfunction AgentMessage({ event }: { event: RunEventDto }) {\n  if (event.type !== \"agent.message\") return null;\n  return (\n    <li className=\"border-b border-slate-100 py-1.5 text-sm text-slate-700 last:border-0\" title={formatTime(event.at)}>\n      <Suspense fallback={<p className=\"whitespace-pre-wrap\">{event.data.text}</p>}>\n        <Markdown>{event.data.text}</Markdown>\n      </Suspense>\n    </li>\n  );\n}\n\nconst toolLine = (call: RunE"
    }
   },
   {
    "seq": 31,
    "at": "2026-10-15T20:12:15.534Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/apps/web/src/pages/run.tsx"
    }
   },
   {
    "seq": 32,
    "at": "2026-10-15T20:12:16.332Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/apps/web/src/pages/run.tsx"
    }
   },
   {
    "seq": 33,
    "at": "2026-10-15T20:12:17.387Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/apps/web/src/pages/run.tsx"
    }
   },
   {
    "seq": 34,
    "at": "2026-10-15T20:12:18.152Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/apps/web/src/pages/run.tsx"
    }
   },
   {
    "seq": 35,
    "at": "2026-10-15T20:12:19.224Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/apps/web/src/pages/run.tsx"
    }
   },
   {
    "seq": 36,
    "at": "2026-10-15T20:12:21.100Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo && pnpm build 2>&1 | tail -15; pnpm typecheck 2>&1 | tail -10; pnpm --filter @opificia/web test 2>&1 | tail -6; git status --short"
    }
   },
   {
    "seq": 37,
    "at": "2026-10-15T20:12:41.855Z",
    "type": "agent.message",
    "data": {
     "text": "Title: feat(web): group the run timeline by stage and fold tool calls\n\n## What changed\n\n- `apps/web/src/timeline.ts` (new): a pure module with no DOM and no `lib.ts` import.\n  - `buildTimeline` turns `RunEventDto[]` into stage sections (Plan, Implement, Result). Each has a duration, a status (running, finished or failed) and an outcome event.\n  - Consecutive `agent.tool` events become one folded row with a generated summary. A refused `network` call becomes its own row.\n  - `visibleItems` keeps the outcome, the never-folded events and refused calls in view when a stage is folded.\n  - The last tool call stays visible while a stage runs.\n  - `formatDuration` formats the stage times, for example \"6m 12s\".\n- `apps/web/src/pages/run.tsx`: renders the rows and keeps the unfolded stages and tool groups in component state.\n  - Stage headers are buttons (\"Implement · 6m 12s\"). A finished stage is folded by default. Running and failed stages are always unfolded.\n  - Tool groups are button rows. Unfolded, they list the calls one per line in muted monospace.\n  - Refused hosts are shown in amber.\n  - `agent.message` text uses the lazy `Markdown` component. The time is in a `title` attribute.\n- `apps/web/src/timeline.test.ts` (new): tests for grouping, durations, the summary sentence, a failed stage, a refused network call and the never-folded events.\n\nPlacement choices the issue leaves open:\n- `plan.approved` and `plan.changes_requested` stay in the plan stage they follow.\n- A change request produces a second \"Plan\" section.\n- `run.queued` appears above the first stage.\n- A `run.failed` after `implementation.finished` goes under \"Result\".\n\nThe issue is inconsistent about the summary sentence. The rule says to name at most two kinds, but the example names three (\"Read 4 files, ran 2 commands and edited 1 file\"). I followed the rule. That example now reads \"Read 4 files, ran 2 commands and 1 other action\". Say if you would rather name three kinds.\n\nOther things to know:\n- The duration of a running stage runs up to the latest event and does not tick.\n- A refused call is detected by the \"refused\" prefix in the summary. The code comment points to where the server writes it, in `apps/server/src/sandbox/sessions.service.ts`.\n- Every `agent.message` goes through Streamdown. Check how the page behaves on a run with many messages.\n- I did not open the page in a browser, so the rendering is only checked by the typecheck and the build.\n\n## Tests\n\n- `pnpm --filter @opificia/web test`: passed, 19 tests in 2 files.\n- `pnpm build`, which includes `@opificia/web`: passed. Vite warns that the lazily loaded markdown chunk is over 500 kB.\n- `pnpm typecheck`: passed.",
     "stage": "implement"
    }
   },
   {
    "seq": 38,
    "at": "2026-10-15T20:12:41.890Z",
    "type": "agent.message",
    "data": {
     "text": "Reviewing the change before handing it over.",
     "stage": "implement"
    }
   },
   {
    "seq": 39,
    "at": "2026-10-15T20:12:43.319Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "git status --short && git diff"
    }
   },
   {
    "seq": 40,
    "at": "2026-10-15T20:12:51.702Z",
    "type": "agent.message",
    "data": {
     "text": "Title: feat(web): group the run timeline by stage and fold tool calls\n\n## What changed\n\n- `apps/web/src/timeline.ts` (new): a pure module with no DOM and no `lib.ts` import.\n  - `buildTimeline` turns `RunEventDto[]` into stage sections (Plan, Implement, Result). Each has a duration, a status (running, finished or failed) and an outcome event.\n  - Consecutive `agent.tool` events become one folded row with a generated summary. A refused `network` call becomes its own row.\n  - `visibleItems` keeps the outcome, the never-folded events and refused calls in view when a stage is folded.\n  - The last tool call stays visible while a stage runs.\n  - `formatDuration` formats the stage times, for example \"6m 12s\".\n- `apps/web/src/pages/run.tsx`: renders the rows and keeps the unfolded stages and tool groups in component state.\n  - Stage headers are buttons (\"Implement · 6m 12s\"). A finished stage is folded by default. Running and failed stages are always unfolded.\n  - Tool groups are button rows. Unfolded, they list the calls one per line in muted monospace.\n  - Refused hosts are shown in amber.\n  - `agent.message` text uses the lazy `Markdown` component. The time is in a `title` attribute.\n- `apps/web/src/timeline.test.ts` (new): tests for grouping, durations, the summary sentence, a failed stage, a refused network call and the never-folded events.\n\nPlacement choices the issue leaves open:\n- `plan.approved` and `plan.changes_requested` stay in the plan stage they follow.\n- A change request produces a second \"Plan\" section.\n- `run.queued` appears above the first stage.\n- A `run.failed` after `implementation.finished` goes under \"Result\".\n\nThe issue is inconsistent about the summary sentence. The rule says to name at most two kinds, but the example names three (\"Read 4 files, ran 2 commands and edited 1 file\"). I followed the rule. That example now reads \"Read 4 files, ran 2 commands and 1 other action\". Say if you would rather name three kinds.\n\nOther things to know:\n- The duration of a running stage runs up to the latest event and does not tick.\n- A refused call is detected by the \"refused\" prefix in the summary. The code comment points to where the server writes it, in `apps/server/src/sandbox/sessions.service.ts`.\n- Every `agent.message` goes through Streamdown. Check how the page behaves on a run with many messages.\n- I did not open the page in a browser, so the rendering is only checked by the typecheck and the build.\n\n## Tests\n\n- `pnpm --filter @opificia/web test`: passed, 19 tests in 2 files.\n- `pnpm build`, which includes `@opificia/web`: passed. Vite warns that the lazily loaded markdown chunk is over 500 kB.\n- `pnpm typecheck`: passed.",
     "stage": "implement"
    }
   },
   {
    "seq": 41,
    "at": "2026-10-15T20:12:51.763Z",
    "type": "implementation.finished",
    "data": {
     "costUsd": 0.5640415000000001,
     "headSha": "77ca41975cdc6494ed7ad4350550fff3cab68051",
     "summary": "## What changed\n\n- `apps/web/src/timeline.ts` (new): a pure module with no DOM and no `lib.ts` import.\n  - `buildTimeline` turns `RunEventDto[]` into stage sections (Plan, Implement, Result). Each has a duration, a status (running, finished or failed) and an outcome event.\n  - Consecutive `agent.tool` events become one folded row with a generated summary. A refused `network` call becomes its own row.\n  - `visibleItems` keeps the outcome, the never-folded events and refused calls in view when a stage is folded.\n  - The last tool call stays visible while a stage runs.\n  - `formatDuration` formats the stage times, for example \"6m 12s\".\n- `apps/web/src/pages/run.tsx`: renders the rows and keeps the unfolded stages and tool groups in component state.\n  - Stage headers are buttons (\"Implement · 6m 12s\"). A finished stage is folded by default. Running and failed stages are always unfolded.\n  - Tool groups are button rows. Unfolded, they list the calls one per line in muted monospace.\n  - Refused hosts are shown in amber.\n  - `agent.message` text uses the lazy `Markdown` component. The time is in a `title` attribute.\n- `apps/web/src/timeline.test.ts` (new): tests for grouping, durations, the summary sentence, a failed stage, a refused network call and the never-folded events.\n\nPlacement choices the issue leaves open:\n- `plan.approved` and `plan.changes_requested` stay in the plan stage they follow.\n- A change request produces a second \"Plan\" section.\n- `run.queued` appears above the first stage.\n- A `run.failed` after `implementation.finished` goes under \"Result\".\n\nThe issue is inconsistent about the summary sentence. The rule says to name at most two kinds, but the example names three (\"Read 4 files, ran 2 commands and edited 1 file\"). I followed the rule. That example now reads \"Read 4 files, ran 2 commands and 1 other action\". Say if you would rather name three kinds.\n\nOther things to know:\n- The duration of a running stage runs up to the latest event and does not tick.\n- A refused call is detected by the \"refused\" prefix in the summary. The code comment points to where the server writes it, in `apps/server/src/sandbox/sessions.service.ts`.\n- Every `agent.message` goes through Streamdown. Check how the page behaves on a run with many messages.\n- I did not open the page in a browser, so the rendering is only checked by the typecheck and the build.\n\n## Tests\n\n- `pnpm --filter @opificia/web test`: passed, 19 tests in 2 files.\n- `pnpm build`, which includes `@opificia/web`: passed. Vite warns that the lazily loaded markdown chunk is over 500 kB.\n- `pnpm typecheck`: passed."
    }
   },
   {
    "seq": 42,
    "at": "2026-10-15T20:12:52.457Z",
    "type": "checks.completed",
    "data": {
     "files": 3,
     "passed": true,
     "findings": [],
     "additions": 505,
     "deletions": 12
    }
   },
   {
    "seq": 43,
    "at": "2026-10-15T20:12:55.742Z",
    "type": "pr.opened",
    "data": {
     "url": "https://github.com/opificia/factory/pull/34",
     "branch": "opificia/issue-31-ae32cdc6",
     "number": 34
    }
   },
   {
    "seq": 44,
    "at": "2026-10-15T20:52:16.031Z",
    "type": "pr.closed",
    "data": {}
   }
  ]
 },
 "egress": {
  "run": {
   "repo": "opificia/factory",
   "issue_number": 25,
   "issue_title": "Reject invalid entries in OPIFICIA_EGRESS_ALLOW at startup",
   "issue_url": "https://github.com/opificia/factory/issues/25",
   "branch": "opificia/issue-25-1eee519b",
   "budget_usd": 15,
   "pr_url": "https://github.com/opificia/factory/pull/27"
  },
  "events": [
   {
    "seq": 1,
    "at": "2026-10-15T18:20:42.019Z",
    "type": "run.queued",
    "data": {
     "repo": "opificia/factory",
     "issue": {
      "url": "https://github.com/opificia/factory/issues/25",
      "title": "Reject invalid entries in OPIFICIA_EGRESS_ALLOW at startup",
      "number": 25
     },
     "budgetUsd": 15,
     "deadlineAt": "2026-10-15T19:20:42.013Z",
     "installationId": 171530814
    }
   },
   {
    "seq": 2,
    "at": "2026-10-15T18:20:44.111Z",
    "type": "stage.started",
    "data": {
     "stage": "plan",
     "baseSha": "13a6de6d02f8bfb07c366247af23d4a86abc5aff",
     "sessionId": "ad2f7bdb-f9a5-4a57-97a9-581cf646ca77"
    }
   },
   {
    "seq": 3,
    "at": "2026-10-15T18:20:46.973Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/apps/server/src/config.ts"
    }
   },
   {
    "seq": 4,
    "at": "2026-10-15T18:20:47.304Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/apps/server/src/sandbox/egress-policy.ts"
    }
   },
   {
    "seq": 5,
    "at": "2026-10-15T18:20:51.012Z",
    "type": "agent.tool",
    "data": {
     "tool": "Grep",
     "stage": "plan",
     "summary": "EGRESS_ALLOW"
    }
   },
   {
    "seq": 6,
    "at": "2026-10-15T18:20:51.388Z",
    "type": "agent.tool",
    "data": {
     "tool": "Glob",
     "stage": "plan",
     "summary": "apps/server/src/**/*.test.ts"
    }
   },
   {
    "seq": 7,
    "at": "2026-10-15T18:20:53.840Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/.env.example"
    }
   },
   {
    "seq": 8,
    "at": "2026-10-15T18:20:54.275Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/docs/prototype.md"
    }
   },
   {
    "seq": 9,
    "at": "2026-10-15T18:20:54.815Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/apps/server/src/sandbox/egress-policy.test.ts"
    }
   },
   {
    "seq": 10,
    "at": "2026-10-15T18:21:13.032Z",
    "type": "agent.message",
    "data": {
     "text": "## Summary\nAt startup, the server will check every entry in `OPIFICIA_EGRESS_ALLOW` and refuse to start if one is not a host name. Today an entry such as `https://example.org`, `example.org:443` or `*.example.org` never matches in the egress proxy, so the host stays blocked and nothing tells the operator why. The check reuses `normalizeHost`, so startup accepts exactly what the proxy can match.\n\n## Changes\n- **`apps/server/src/config.ts`**\n  - Import `normalizeHost` from `./sandbox/egress-policy.js`. That module only imports `node:net` and a type from `@opificia/contracts`, so the import creates no cycle and has no side effects.\n  - Move the `OPIFICIA_EGRESS_ALLOW` schema into an exported constant, `EgressAllow`, and use it in `Env`. It keeps today's handling: `z.string().default(\"\")`, split on commas, trim, drop empty entries. It then checks each entry in its `.transform((v, ctx) => …)`:\n    - Remove a leading `.` if there is one, and run `normalizeHost` on the rest.\n    - If that returns `undefined`, add one issue per invalid entry with `ctx.addIssue`, then return `z.NEVER`. Example message: `\"https://example.org\" is not a host name. Use a host name without a scheme, port or wildcard, such as \"example.org\", or \".example.org\" to include subdomains.`\n    - Otherwise, store the normalised form (the dot if there was one, plus the host). This is lower case without a trailing dot, which matches how `decideHost` normalises the host it compares against.\n  - `loadConfig` already prints each issue as `OPIFICIA_EGRESS_ALLOW: <message>` under \"Invalid configuration…\", so it does not change.\n- **`apps/server/src/config.test.ts`** (new, with the SPDX AGPL-3.0-only header like the other tests). It tests `EgressAllow` directly. It never calls `loadConfig`, so it reads no private key and no `.env`.\n- **`.env.example`** (the comment above `OPIFICIA_EGRESS_ALLOW`): say that entries are host names without a scheme, port or wildcard, for example `example.org` or `.example.org`, and that the server refuses to start otherwise.\n- **`docs/prototype.md`** (\"Network access\" section): add one sentence with the same rule, saying that a leading dot includes subdomains and that the server refuses to start on an invalid entry.\n\n## Tests\nNew cases in `apps/server/src/config.test.ts`, all calling `EgressAllow.safeParse`:\n- Valid entries: `\"example.org, binaries.prisma.sh\"` gives `[\"example.org\", \"binaries.prisma.sh\"]`, and `\" Example.ORG. \"` gives `[\"example.org\"]`.\n- A dot entry: `\".example.org\"` gives `[\".example.org\"]`.\n- Empty: `\"\"`, `\" , \"` and `undefined` all give `[]`.\n- Invalid: `https://example.org`, `example.org:443` and `*.example.org` each fail. The issue message contains the invalid entry and the `example.org` example.\n- A mixed list such as `\"example.org,https://bad.example\"` fails and names only the bad entry.\n\nCommands: `pnpm --filter @opificia/server test` and `pnpm typecheck`. To check the \"done when\" condition by hand, start the server with `OPIFICIA_EGRESS_ALLOW=https://example.org` and confirm that it exits with the message.\n\n## Risks\n- **Stricter rule:** `normalizeHost` needs at least one dot and a top-level label that starts with a letter. That rejects `localhost`, single-label internal names and IP addresses. The proxy refuses all of these already, so nothing that works today stops working. But an operator whose `.env` holds such an entry will now see a startup failure where before it was silently ignored. The reviewer should confirm that this is intended.\n- **Stored value changes:** entries are now stored normalised, without a trailing dot. `matchesList` compares against a normalised host, so matching gets more reliable, but the stored value is no longer the raw text.",
     "stage": "plan"
    }
   },
   {
    "seq": 11,
    "at": "2026-10-15T18:21:13.077Z",
    "type": "plan.proposed",
    "data": {
     "plan": "## Summary\nAt startup, the server will check every entry in `OPIFICIA_EGRESS_ALLOW` and refuse to start if one is not a host name. Today an entry such as `https://example.org`, `example.org:443` or `*.example.org` never matches in the egress proxy, so the host stays blocked and nothing tells the operator why. The check reuses `normalizeHost`, so startup accepts exactly what the proxy can match.\n\n## Changes\n- **`apps/server/src/config.ts`**\n  - Import `normalizeHost` from `./sandbox/egress-policy.js`. That module only imports `node:net` and a type from `@opificia/contracts`, so the import creates no cycle and has no side effects.\n  - Move the `OPIFICIA_EGRESS_ALLOW` schema into an exported constant, `EgressAllow`, and use it in `Env`. It keeps today's handling: `z.string().default(\"\")`, split on commas, trim, drop empty entries. It then checks each entry in its `.transform((v, ctx) => …)`:\n    - Remove a leading `.` if there is one, and run `normalizeHost` on the rest.\n    - If that returns `undefined`, add one issue per invalid entry with `ctx.addIssue`, then return `z.NEVER`. Example message: `\"https://example.org\" is not a host name. Use a host name without a scheme, port or wildcard, such as \"example.org\", or \".example.org\" to include subdomains.`\n    - Otherwise, store the normalised form (the dot if there was one, plus the host). This is lower case without a trailing dot, which matches how `decideHost` normalises the host it compares against.\n  - `loadConfig` already prints each issue as `OPIFICIA_EGRESS_ALLOW: <message>` under \"Invalid configuration…\", so it does not change.\n- **`apps/server/src/config.test.ts`** (new, with the SPDX AGPL-3.0-only header like the other tests). It tests `EgressAllow` directly. It never calls `loadConfig`, so it reads no private key and no `.env`.\n- **`.env.example`** (the comment above `OPIFICIA_EGRESS_ALLOW`): say that entries are host names without a scheme, port or wildcard, for example `example.org` or `.example.org`, and that the server refuses to start otherwise.\n- **`docs/prototype.md`** (\"Network access\" section): add one sentence with the same rule, saying that a leading dot includes subdomains and that the server refuses to start on an invalid entry.\n\n## Tests\nNew cases in `apps/server/src/config.test.ts`, all calling `EgressAllow.safeParse`:\n- Valid entries: `\"example.org, binaries.prisma.sh\"` gives `[\"example.org\", \"binaries.prisma.sh\"]`, and `\" Example.ORG. \"` gives `[\"example.org\"]`.\n- A dot entry: `\".example.org\"` gives `[\".example.org\"]`.\n- Empty: `\"\"`, `\" , \"` and `undefined` all give `[]`.\n- Invalid: `https://example.org`, `example.org:443` and `*.example.org` each fail. The issue message contains the invalid entry and the `example.org` example.\n- A mixed list such as `\"example.org,https://bad.example\"` fails and names only the bad entry.\n\nCommands: `pnpm --filter @opificia/server test` and `pnpm typecheck`. To check the \"done when\" condition by hand, start the server with `OPIFICIA_EGRESS_ALLOW=https://example.org` and confirm that it exits with the message.\n\n## Risks\n- **Stricter rule:** `normalizeHost` needs at least one dot and a top-level label that starts with a letter. That rejects `localhost`, single-label internal names and IP addresses. The proxy refuses all of these already, so nothing that works today stops working. But an operator whose `.env` holds such an entry will now see a startup failure where before it was silently ignored. The reviewer should confirm that this is intended.\n- **Stored value changes:** entries are now stored normalised, without a trailing dot. `matchesList` compares against a normalised host, so matching gets more reliable, but the stored value is no longer the raw text.",
     "costUsd": 0.1490438
    }
   },
   {
    "seq": 12,
    "at": "2026-10-15T18:29:26.840Z",
    "type": "plan.approved",
    "data": {
     "by": "Ada Lovelace",
     "deadlineAt": "2026-10-15T19:29:26.836Z"
    }
   },
   {
    "seq": 13,
    "at": "2026-10-15T18:29:28.409Z",
    "type": "stage.started",
    "data": {
     "stage": "implement",
     "baseSha": "13a6de6d02f8bfb07c366247af23d4a86abc5aff",
     "sessionId": "3d785858-b4bc-47f9-ab51-cd975467f1d2"
    }
   },
   {
    "seq": 14,
    "at": "2026-10-15T18:29:30.974Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "implement",
     "summary": "/work/repo/apps/server/src/config.ts"
    }
   },
   {
    "seq": 15,
    "at": "2026-10-15T18:29:31.491Z",
    "type": "agent.tool",
    "data": {
     "tool": "Grep",
     "stage": "implement",
     "summary": "normalizeHost"
    }
   },
   {
    "seq": 16,
    "at": "2026-10-15T18:29:32.118Z",
    "type": "agent.tool",
    "data": {
     "tool": "Grep",
     "stage": "implement",
     "summary": "EGRESS_ALLOW"
    }
   },
   {
    "seq": 17,
    "at": "2026-10-15T18:29:39.618Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/apps/server/src/config.ts"
    }
   },
   {
    "seq": 18,
    "at": "2026-10-15T18:29:41.474Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/apps/server/src/config.ts"
    }
   },
   {
    "seq": 19,
    "at": "2026-10-15T18:29:42.103Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/apps/server/src/config.ts"
    }
   },
   {
    "seq": 20,
    "at": "2026-10-15T18:29:42.796Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/.env.example"
    }
   },
   {
    "seq": 21,
    "at": "2026-10-15T18:29:43.827Z",
    "type": "agent.tool",
    "data": {
     "tool": "Edit",
     "stage": "implement",
     "summary": "/work/repo/docs/prototype.md"
    }
   },
   {
    "seq": 22,
    "at": "2026-10-15T18:29:44.092Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo/apps/server/src && head -12 sandbox/egress-policy.test.ts"
    }
   },
   {
    "seq": 23,
    "at": "2026-10-15T18:29:48.644Z",
    "type": "agent.tool",
    "data": {
     "tool": "Write",
     "stage": "implement",
     "summary": "/work/repo/apps/server/src/config.test.ts"
    }
   },
   {
    "seq": 24,
    "at": "2026-10-15T18:29:48.987Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "cd /work/repo && pnpm --filter @opificia/server test 2>&1 | tail -15; pnpm typecheck 2>&1 | tail -8"
    }
   },
   {
    "seq": 25,
    "at": "2026-10-15T18:29:49.047Z",
    "type": "agent.tool",
    "data": {
     "tool": "network",
     "stage": "implement",
     "summary": "allowed registry.npmjs.org:443: a built-in registry or source host"
    }
   },
   {
    "seq": 26,
    "at": "2026-10-15T18:29:49.080Z",
    "type": "agent.tool",
    "data": {
     "tool": "network",
     "stage": "implement",
     "summary": "refused registry.npmjs.org:443: the session has 32 connections open"
    }
   },
   {
    "seq": 27,
    "at": "2026-10-15T18:30:12.283Z",
    "type": "agent.tool",
    "data": {
     "tool": "network",
     "stage": "implement",
     "summary": "allowed binaries.prisma.sh:443: allowed by the operator"
    }
   },
   {
    "seq": 28,
    "at": "2026-10-15T18:30:16.582Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "pnpm --filter @opificia/server test 2>&1 | grep -iE \"error|fail\" | head -15"
    }
   },
   {
    "seq": 29,
    "at": "2026-10-15T18:30:18.450Z",
    "type": "agent.message",
    "data": {
     "text": "The contracts package isn't built. Build it first.",
     "stage": "implement"
    }
   },
   {
    "seq": 30,
    "at": "2026-10-15T18:30:19.080Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "pnpm install 2>&1 | tail -3; pnpm build 2>&1 | tail -5; pnpm --filter @opificia/server test 2>&1 | tail -8; pnpm typecheck 2>&1 | tail -8"
    }
   },
   {
    "seq": 31,
    "at": "2026-10-15T18:30:44.293Z",
    "type": "agent.message",
    "data": {
     "text": "Title: feat(server): reject invalid OPIFICIA_EGRESS_ALLOW entries at startup\n\n## What changed\n- `apps/server/src/config.ts`: added an exported `EgressAllow` schema, used for `OPIFICIA_EGRESS_ALLOW`.\n  - It checks each entry with `normalizeHost` from the egress policy, after removing an optional leading dot.\n  - An invalid entry adds an issue that names the entry and gives `example.org` and `.example.org` as examples. `loadConfig` then refuses to start.\n  - Valid entries are stored normalised: lower case, no trailing dot, and the leading dot kept.\n- `apps/server/src/config.test.ts` (new): tests `EgressAllow` directly, so it reads no private key and no `.env`. It covers valid entries, a dot entry, empty values, `https://example.org`, `example.org:443`, `*.example.org`, and a mixed list.\n- `.env.example` and `docs/prototype.md`: say that entries are host names, without a scheme, port or wildcard, and that the server refuses to start otherwise.\n\n## Tests\n- `pnpm --filter @opificia/server test`: 4 files and 42 tests passed.\n- `pnpm typecheck`: passed in all packages.\n- I ran `pnpm install` and `pnpm build` first, because the tests could not resolve `@opificia/contracts` until it was built.\n- I did not start the server by hand with `OPIFICIA_EGRESS_ALLOW=https://example.org`. The unit tests cover the schema, and `loadConfig` prints its issues unchanged.\n\n## Review note\n`normalizeHost` needs a dot and a top-level label that starts with a letter. An entry such as `localhost`, a single-label name or an IP address now stops the server at startup. Before, the proxy ignored it without saying so. Please confirm that this is intended.",
     "stage": "implement"
    }
   },
   {
    "seq": 32,
    "at": "2026-10-15T18:30:44.348Z",
    "type": "agent.message",
    "data": {
     "text": "Reviewing the change before handing it over.",
     "stage": "implement"
    }
   },
   {
    "seq": 33,
    "at": "2026-10-15T18:30:46.754Z",
    "type": "agent.tool",
    "data": {
     "tool": "Bash",
     "stage": "implement",
     "summary": "git status --short && git diff"
    }
   },
   {
    "seq": 34,
    "at": "2026-10-15T18:30:51.919Z",
    "type": "agent.message",
    "data": {
     "text": "Title: feat(server): reject invalid OPIFICIA_EGRESS_ALLOW entries at startup\n\n## What changed\n- `apps/server/src/config.ts`: added an exported `EgressAllow` schema, used for `OPIFICIA_EGRESS_ALLOW`.\n  - It checks each entry with `normalizeHost` from the egress policy, after removing an optional leading dot.\n  - An invalid entry adds one issue that names the entry and gives `example.org` and `.example.org` as examples. `loadConfig` then refuses to start.\n  - Valid entries are stored normalised: lower case, no trailing dot, and the leading dot kept.\n- `apps/server/src/config.test.ts` (new): tests `EgressAllow` directly, so it reads no private key and no `.env`. It covers valid entries, a dot entry, empty values, `https://example.org`, `example.org:443`, `*.example.org`, and a mixed list.\n- `.env.example` and `docs/prototype.md`: say that entries are host names, without a scheme, port or wildcard, and that the server refuses to start otherwise.\n\n## Tests\n- `pnpm --filter @opificia/server test`: 4 files and 42 tests passed.\n- `pnpm typecheck`: passed in all packages.\n- I ran `pnpm install` and `pnpm build` first, because the tests could not resolve `@opificia/contracts` until it was built.\n- I did not start the server by hand with `OPIFICIA_EGRESS_ALLOW=https://example.org`. The unit tests cover the schema, and `loadConfig` prints its issues unchanged.\n\n## Review note\n`normalizeHost` needs a dot and a top-level label that starts with a letter. An entry such as `localhost`, a single-label name or an IP address now stops the server at startup. Before, the proxy ignored it without saying so. Please confirm that this is intended.",
     "stage": "implement"
    }
   },
   {
    "seq": 35,
    "at": "2026-10-15T18:30:52.013Z",
    "type": "implementation.finished",
    "data": {
     "costUsd": 0.20419889999999996,
     "headSha": "8fc06b189ff3c104eeb28f68f9b78551db8ebf52",
     "summary": "## What changed\n- `apps/server/src/config.ts`: added an exported `EgressAllow` schema, used for `OPIFICIA_EGRESS_ALLOW`.\n  - It checks each entry with `normalizeHost` from the egress policy, after removing an optional leading dot.\n  - An invalid entry adds one issue that names the entry and gives `example.org` and `.example.org` as examples. `loadConfig` then refuses to start.\n  - Valid entries are stored normalised: lower case, no trailing dot, and the leading dot kept.\n- `apps/server/src/config.test.ts` (new): tests `EgressAllow` directly, so it reads no private key and no `.env`. It covers valid entries, a dot entry, empty values, `https://example.org`, `example.org:443`, `*.example.org`, and a mixed list.\n- `.env.example` and `docs/prototype.md`: say that entries are host names, without a scheme, port or wildcard, and that the server refuses to start otherwise.\n\n## Tests\n- `pnpm --filter @opificia/server test`: 4 files and 42 tests passed.\n- `pnpm typecheck`: passed in all packages.\n- I ran `pnpm install` and `pnpm build` first, because the tests could not resolve `@opificia/contracts` until it was built.\n- I did not start the server by hand with `OPIFICIA_EGRESS_ALLOW=https://example.org`. The unit tests cover the schema, and `loadConfig` prints its issues unchanged.\n\n## Review note\n`normalizeHost` needs a dot and a top-level label that starts with a letter. An entry such as `localhost`, a single-label name or an IP address now stops the server at startup. Before, the proxy ignored it without saying so. Please confirm that this is intended."
    }
   },
   {
    "seq": 36,
    "at": "2026-10-15T18:30:52.664Z",
    "type": "checks.completed",
    "data": {
     "files": 4,
     "passed": true,
     "findings": [],
     "additions": 69,
     "deletions": 5
    }
   },
   {
    "seq": 37,
    "at": "2026-10-15T18:30:57.997Z",
    "type": "pr.opened",
    "data": {
     "url": "https://github.com/opificia/factory/pull/27",
     "branch": "opificia/issue-25-1eee519b",
     "number": 27
    }
   },
   {
    "seq": 38,
    "at": "2026-10-15T20:47:17.507Z",
    "type": "pr.merged",
    "data": {
     "by": "ada"
    }
   }
  ]
 },
 "cancelled": {
  "run": {
   "repo": "opificia/playground",
   "issue_number": 4,
   "issue_title": "Add a reverseWords helper",
   "issue_url": "https://github.com/opificia/playground/issues/4",
   "branch": "opificia/issue-4-9d6e01d6",
   "budget_usd": 15,
   "pr_url": null
  },
  "events": [
   {
    "seq": 1,
    "at": "2026-10-14T23:27:01.705Z",
    "type": "run.queued",
    "data": {
     "repo": "opificia/playground",
     "issue": {
      "url": "https://github.com/opificia/playground/issues/4",
      "title": "Add a reverseWords helper",
      "number": 4
     },
     "budgetUsd": 15,
     "deadlineAt": "2026-10-15T00:27:01.693Z",
     "installationId": 171530814
    }
   },
   {
    "seq": 2,
    "at": "2026-10-14T23:27:03.402Z",
    "type": "stage.started",
    "data": {
     "stage": "plan",
     "baseSha": "5e33b0c5a20b3f92329a4ee95179b76767a3b431",
     "sessionId": "a9be87ff-c69d-41de-ad43-e349362d8ecf"
    }
   },
   {
    "seq": 3,
    "at": "2026-10-14T23:27:06.026Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/AGENTS.md"
    }
   },
   {
    "seq": 4,
    "at": "2026-10-14T23:27:06.201Z",
    "type": "agent.tool",
    "data": {
     "tool": "Glob",
     "stage": "plan",
     "summary": "**/*"
    }
   },
   {
    "seq": 5,
    "at": "2026-10-14T23:27:08.113Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/src/text.ts"
    }
   },
   {
    "seq": 6,
    "at": "2026-10-14T23:27:08.309Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/src/text.test.ts"
    }
   },
   {
    "seq": 7,
    "at": "2026-10-14T23:27:08.630Z",
    "type": "agent.tool",
    "data": {
     "tool": "Read",
     "stage": "plan",
     "summary": "/work/repo/package.json"
    }
   },
   {
    "seq": 8,
    "at": "2026-10-14T23:27:09.835Z",
    "type": "run.cancelled",
    "data": {
     "by": "Ada Lovelace"
    }
   }
  ]
 }
};
