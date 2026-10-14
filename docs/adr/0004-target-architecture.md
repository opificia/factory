# ADR-0004: Target architecture, with Claude Code as the first harness

- **Status:** accepted
- **Date:** 2026-10-14
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md), [`ROADMAP.md`](../../ROADMAP.md), [ADR-0002](0002-licensing-model.md)

## Context

Opificia AI is in phase 0. Before the first line of product code, we need a target architecture: the shape the code grows into, the boundaries that must not move, and the order in which we build the parts. Without it, the first working loop will set the architecture by accident.

Several forces shape the decision.

- **Frontier models are far ahead.** In October 2026, the strongest closed models from American labs are clearly better than open-weight models at long, agentic coding work. Open-weight models come close on saturated benchmarks such as SWE-bench Verified, but fall behind on long terminal tasks. We want to build Opificia with Opificia as early as possible, and we can only do that well with frontier models today.
- **We still want to switch to sovereign models.** The sovereignty commitments require Opificia to be model-agnostic, air-gap capable and free of any required vendor. Our own use of US models must not leak into the design of the software.
- **Harness quality matters as much as model quality.** The agent loop (the harness) is where labs and open projects compete: edit reliability, context compaction, tool-call recovery. Building our own would be expensive and lag behind. Wrapping existing harnesses lets us own what they do not offer: sandboxing, policy, audit, multi-tenancy and a pipeline that is independent of any one model.
- **Claude Code is the strongest harness for the models we will use first**, and it has a programmable SDK. Its terms of use restrict how a product may run it.
- **One artifact, two ways to run it.** Opificia must run self-hosted, on a single machine and on Kubernetes, and as the steward's multi-tenant cloud. There are no cloud-only code paths in the core.
- **Existing work to learn from.** [t3code](https://github.com/pingdotgg/t3code) (MIT) is a fast-moving open-source GUI for coding agents. It wraps the Claude Agent SDK, the Codex app-server and the Agent Client Protocol (ACP) behind one adapter interface, and keeps its state in an event-sourced store. It is a local, single-user tool with no sandbox and no tenants, but its adapter and orchestration patterns fit a server-side factory well.

## Considered options

1. **Build our own harness**, model-agnostic from the start.
2. **Wrap existing harnesses behind one adapter contract, with an open harness first** (OpenCode, Mistral Vibe or Codex CLI) and Claude Code later, if at all.
3. **Wrap existing harnesses behind one adapter contract, with Claude Code first**, followed by an open harness before the first release.
4. **Fork t3code** and turn it into a multi-tenant factory.
5. **Use a hosted agent service** such as Anthropic's Managed Agents, and build only the pipeline around it.

For the Claude Code integration itself, we compared three routes: the Claude Agent SDK for TypeScript, the headless CLI (`claude -p --output-format stream-json`), and the community ACP adapter (`@agentclientprotocol/claude-agent-acp`, Apache-2.0).

## Decision

We choose option 3. Opificia wraps existing harnesses behind one adapter contract. Claude Code, through the Claude Agent SDK, is the first supported harness. An open harness that runs open-weight models follows before the first release, and the first release is blocked until it passes the reference test suite.

### Reasons

- Option 1 spends our effort where the labs outspend us, and still leaves us with a weaker loop.
- Option 2 keeps the sovereignty story simple, but it means dogfooding on weaker models, which slows down the work that would make Opificia worth using.
- Option 3 lets us build Opificia with the best tools available now. The adapter contract and the release gate keep Claude Code out of the core: it is one plugin among several, and no feature may depend on it.
- Option 4 would import a single-user trust model (agents run as the user, with full access by default), local SQLite and terminals, a large GUI surface we do not need, and a codebase that changes every day. We borrow its patterns instead (see below).
- Option 5 conflicts with commitment 1: no feature may require a service hosted by a vendor.

For Claude Code we use the **Agent SDK**, not the bare CLI. The SDK gives typed messages, streaming input (so we can steer and interrupt a turn), permission callbacks and hooks as code, session resume and fork, and a session store that keeps transcripts in our own storage. It runs the same unmodified Claude Code binary as the CLI. The ACP adapter adds a third-party layer with no extra capability for our use.

### The shape of the system

```text
 Clients: web app, later desktop and mobile; CLI; MCP server
          |  commands (REST) and events (SSE, resumable by sequence number)
+----------------------------------------------------------------------+
| CONTROL PLANE (trusted, "brains")                                    |
|  Contracts, API, tenants and roles (OIDC), tickets, runs, approvals  |
|  Orchestrator: pure decider -> event store + outbox -> effect worker |
|  Postgres: run events, audit events, usage events, projections       |
|  Forge and ticket adapters; staged-write checker; credential broker  |
+-----------+-------------------+-------------------+------------------+
            |                   |                   |
      Model gateway        MCP gateway       Egress proxy and mirrors
   (holds provider keys,  (tenant allow-     (allow-list, logs every
    budgets, usage,        list, pinned       request; npm, PyPI and
    region policy)         tool definitions)  OCI mirrors)
            |                   |                   |
 ================= TRUST BOUNDARY: the sandbox is untrusted ================
+----------------------------------------------------------------------+
| EXECUTION PLANE ("hands"): one ephemeral sandbox per run             |
|  Fresh clone on a work branch; no long-lived secrets                 |
|  Harness runner: adapter plugin + harness (Claude Code first)        |
|  Speaks the runner protocol to the control plane; nothing else       |
+----------------------------------------------------------------------+
```

The parts, and what each one owns:

1. **Control plane.** One modular application with an API process and worker processes that share one PostgreSQL database. It owns tenants, tickets, runs, approvals, audit, usage and every credential. It never executes agent code and never feeds raw ticket or repository content to a privileged model call.
2. **Execution plane.** One ephemeral sandbox per run. Kubernetes with a gVisor runtime class is the reference for clusters; a container runtime on one machine is the reference for single-node installs. The sandbox has no network by default. It may reach only the control plane's runner endpoint, the gateways and the egress proxy.
3. **Harness runner.** A small program inside the sandbox that hosts a harness adapter. It receives commands from the control plane, drives the harness, and sends back normalised events. It is the only part of Opificia that talks to a harness.
4. **Gateways.** The model gateway holds provider keys, enforces budgets and region policy, and records usage. The MCP gateway holds tool credentials and enforces the tenant's allow-list. Each gateway is chosen in its own ADR.

### The harness adapter contract

The contract is the boundary that keeps Opificia independent of any one harness. It is a wire protocol between the control plane and the harness runner, not an in-process interface, for two reasons: the harness must run inside the sandbox, and a process boundary keeps proprietary harness libraries out of the AGPL core.

- **Specification.** The contract is published as JSON Schema in `sdk/` (Apache-2.0), with a reference runner library. Adapters live in `plugins/` (Apache-2.0).
- **Transport.** JSON-RPC 2.0 over one connection that the runner opens from the sandbox to the control plane. Events carry a per-run sequence number, so either side can reconnect and resume.
- **Commands** (control plane to runner): open a session, start a turn, steer a turn, interrupt a turn, answer a runtime request, roll back to a checkpoint, fork, and shut down. This set follows t3code's `ProviderAdapterV2` interface.
- **Events** (runner to control plane): session and turn state, messages, tool calls and results, runtime requests (approvals and questions), plan updates, checkpoints, usage estimates, and a terminal event with an exit class (completed, interrupted, budget exceeded, timed out, permission denied, model error, harness error). Each event can carry the harness's raw message, size-capped, for audit and for replay tests.
- **Capabilities.** Each adapter declares what it supports: steering, forking, rollback, subagents, plan mode, permission modes, MCP. The orchestrator and the clients branch on capabilities, never on the harness name.
- **Inputs per run.** Repository path and branch, the task files (`spec.md`, `plan.md`, `tasks.md`), `AGENTS.md`, a model endpoint (wire protocol, base URL, model ID and a short-lived per-run token, never the provider key), a generated MCP configuration, skills, and a permission profile with turn, cost and time limits.
- **Isolation lives in the sandbox.** Harness permission modes, hooks and allow-lists are policy and audit tools. They are not a security boundary, and the contract never relies on them as one.
- **Testing.** Every adapter ships recorded replay fixtures and passes a shared conformance suite.

Later adapters can implement the contract directly, or through two generic routes: the Codex app-server protocol, and ACP for any agent in the ACP registry.

### Claude Code as the first harness

The `claude` adapter is a TypeScript plugin that uses `@anthropic-ai/claude-agent-sdk`. This ADR accepts that package as a dependency of the plugin only, under AGENTS.md rule 5. The core never imports it.

How the adapter runs Claude Code:

- **Unmodified binary**, pinned through the SDK version. We do not patch or repackage it.
- **Model access through the gateway only.** `ANTHROPIC_BASE_URL` points to the model gateway, and `ANTHROPIC_AUTH_TOKEN` holds a per-run token with a budget. The gateway swaps it for the tenant's credential. For Amazon Bedrock, Google Vertex AI or Microsoft Foundry, the matching `CLAUDE_CODE_USE_*` flag and base URL apply. The gateway must pass `anthropic-beta` and `anthropic-version` headers through unchanged and must not buffer streams.
- **No vendor traffic.** `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` turns off telemetry, error reporting, feature flags and auto-update. The WebFetch domain check is turned off with `skipWebFetchPreflight`. Network policy blocks the remaining direct calls to Anthropic, such as the fast-mode availability check.
- **Isolated configuration.** `settingSources` loads project settings only. Each run gets its own `CLAUDE_CONFIG_DIR`, and auto memory is off (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`). The repository's `CLAUDE.md` is a one-line pointer to `AGENTS.md`, as in this repository.
- **Permissions as policy.** Each stage has explicit allow rules. A `PreToolUse` hook enforces protected paths (CI workflows, `CODEOWNERS`, agent instruction files, MCP configuration). Unattended stages use `permissionMode: "dontAsk"`, so anything outside the rules is denied. Where a stage may ask a person, the `canUseTool` callback turns the request into a runtime request that waits for an answer.
- **Limits.** `maxTurns` and `maxBudgetUsd` inside the run. The control plane enforces a wall-clock deadline, because the SDK has none, and the gateway enforces the hard cost cap. Usage reported by the SDK is an estimate; the gateway's numbers are authoritative.
- **Transcripts** go to the control plane through the SDK's session store, so resume works after the sandbox is gone.

Terms we must respect (from Anthropic's legal and compliance page for Claude Code, read on 14 October 2026):

- Running Claude Code in hosted sandboxes requires agreeing to Anthropic's Commercial Terms. The steward must do so before the cloud offers this harness.
- **Bring your own key only.** Each tenant authenticates with their own Anthropic API key, or their own Bedrock, Vertex or Foundry credentials. Opificia never pays for, resells or meters Claude usage, and the managed-token wallet never covers this harness.
- **No subscription login.** Opificia never offers Claude.ai sign-in and never accepts subscription tokens (`CLAUDE_CODE_OAUTH_TOKEN`).
- **Naming.** We may say in plain text that Opificia runs Claude Code. The name is never part of an Opificia product, plan or feature name.

### What we take from t3code

We copy ideas, not code. t3code is built on the Effect framework throughout, and adopting Effect would be a separate ADR.

- **Orchestration.** A pure decider turns commands into events. Events, projections, a command receipt and an outbox are written in one transaction. An effect worker carries out side effects and feeds results back as commands. Command receipts make retries idempotent. We implement this on PostgreSQL, behind the `RunOrchestrator` interface.
- **Streaming.** Clients read a snapshot at sequence *n*, then subscribe to events after *n*.
- **Identity of things.** Opificia's run and thread IDs are primary. Harness session IDs are references that can be replaced, so a run can survive a lost harness session through a handoff from its task files.
- **Checkpoints from git, not from the harness.** The runner writes a hidden git ref after every turn. Diffs and rollbacks come from those refs. A rollback that the harness cannot follow is refused before any file changes.
- **Persisted runtime requests.** Approvals and questions are stored as events, so they survive restarts and can be answered from any client.
- **One contracts package** shared by the server and every client.
- **Opificia is drivable by agents.** An authenticated MCP endpoint and a CLI expose the same commands as the web app.

What we do not take: the single-user trust model, full access as the default mode, worktrees as isolation, local SQLite and terminals, and the desktop-first scope.

### How a run ends

The sandbox never holds a forge token. When a turn ends, the runner hands the work branch and its checkpoint refs to the control plane as a git bundle. A deterministic checker inspects it: operation types, size limits, secret scan, hidden Unicode, protected paths and test integrity. Only then does the control plane push the branch and open the pull request with a short-lived token scoped to one repository. A person merges.

### Order of work

| Step | Scope | Harness and models | Done when |
| --- | --- | --- | --- |
| 1. First loop | Single-node install (containers, PostgreSQL), GitHub App, GitHub Issues, minimal web app, `claude` adapter, a pass-through credential proxy in place of the full model gateway | Claude Code with the steward's own Anthropic credentials | One ticket in the Opificia repository becomes a reviewed pull request, end to end |
| 2. Dogfooding | Opificia works on its own tickets; Kubernetes sandbox; model and MCP gateway ADRs; second harness | Claude Code, plus one open harness (OpenCode, Mistral Vibe or Codex CLI, chosen by ADR) with open-weight models hosted in Europe | Most Opificia tickets run through Opificia; the open harness passes the conformance suite |
| 3. First release | Cross-vendor review, published comparison, signed release | Any supported harness | The reference test suite passes with an open-weight model running locally, with Claude Code switched off |

Until step 2, the review stage cannot use a second vendor. Reviews in step 1 use a separate Claude session with fresh context, plus deterministic tools, and the pull request says so.

## Consequences

- We can start building with the strongest models available, and use Opificia on Opificia early.
- The harness contract, the runner protocol and the event log are the hardest parts to change later, so we design them first and publish them in `sdk/`.
- The core has no dependency on Anthropic. The only proprietary component is the `claude` plugin and the binary it runs, both outside the AGPL core and both optional.
- The cloud cannot sell Claude usage. Tenants who want Claude Code bring their own credentials and pay Anthropic directly. Opificia's fee per agent-minute covers the sandbox and platform, not model tokens. Counsel must confirm that this pricing does not count as intermediating Claude usage.
- There is a real risk that open harnesses get less attention while Claude Code works well. The release gate in step 3 is the counterweight. Dropping or weakening it needs a new ADR.
- Claude Code is tuned for Claude models. Pointing it at other models through the gateway is unsupported by Anthropic and is not a way to meet commitment 3.
- [`ROADMAP.md`](../../ROADMAP.md) says that phase 1 runs with at least one open-weight model and that dogfooding in phase 2 runs on open-weight models hosted in Europe. If this ADR is accepted, the roadmap must change to match the order of work above.

Follow-up work:

1. Legal review of the Commercial Terms, the "intermediate" clause and our pricing, and of whether published sandbox images may contain the Claude Code binary. Until then, operators install the binary into their own images.
2. Specify the harness contract and runner protocol, as an RFC.
3. ADRs for the control-plane language and runtime (TypeScript on Node is the working assumption; whether to use Effect is part of that ADR), durable execution, sandbox runtime, model gateway, MCP gateway, identity and clients.
4. An egress test in CI that runs the `claude` adapter with default settings and fails on any connection outside the configured endpoints.
5. Update `ROADMAP.md`.

### Sovereignty impact

1. **Runs anywhere you choose.** The core stays fully self-hostable. The `claude` adapter needs Anthropic's API or a cloud provider's endpoint, so it cannot run air-gapped. Air-gapped installs use an open harness, available from step 2.
2. **No phone-home.** Claude Code's optional traffic is switched off, the residual direct calls are blocked by network policy, and a CI egress test checks this.
3. **Model-agnostic.** The adapter contract and the gateway keep the core model-agnostic. Claude Code itself works only with Claude models. The release gate requires an open harness with an open-weight model to pass the reference suite.
4. **Open standards.** The contract is published as JSON Schema and builds on JSON-RPC, MCP, `AGENTS.md`, Agent Skills and ACP. Claude Code is a plugin, never a requirement.
5. **Your data stays yours.** With the `claude` adapter, code and prompts go to the model provider the operator configures. That provider is listed per tenant as a sub-processor. Transcripts and events are stored only in the operator's database.
6. **Humans decide.** No impact: merges still need a recorded human approval.
7. **Transparent supply chain.** The Agent SDK and the Claude Code binary are proprietary. They are pinned, listed in the SBOM of the `claude` plugin, and kept out of the core's release artefacts.
8. **Reference deployment on European infrastructure.** No impact on where the reference deployment runs. While we dogfood, the steward uses Claude models from a US-headquartered provider, as [How we build Opificia](../../SOVEREIGNTY.md#how-we-build-opificia) already discloses. In the cloud, tenants who choose Claude bring their own credentials.

## More information

- Claude Agent SDK: <https://code.claude.com/docs/en/agent-sdk/overview>
- Hosting the Agent SDK: <https://code.claude.com/docs/en/agent-sdk/hosting>
- Claude Code legal and compliance: <https://code.claude.com/docs/en/legal-and-compliance>
- Claude Code LLM gateway protocol: <https://code.claude.com/docs/en/llm-gateway-protocol>
- Claude Code environment variables: <https://code.claude.com/docs/en/env-vars>
- t3code: <https://github.com/pingdotgg/t3code>
- Agent Client Protocol: <https://agentclientprotocol.com/>
- Agents Rule of Two (Meta): <https://ai.meta.com/blog/practical-ai-agent-security/>

How to check that the decision is followed:

- No package in the core depends on `@anthropic-ai/claude-agent-sdk` or any other harness library. A CI check on the lockfile enforces this.
- The conformance suite runs against every adapter.
- From step 3, the release pipeline runs the reference suite with an open-weight model and Claude Code switched off.
