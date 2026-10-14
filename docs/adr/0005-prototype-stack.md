# ADR-0005: Prototype stack

- **Status:** accepted
- **Date:** 2026-10-15
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [ADR-0004](0004-target-architecture.md), [`AGENTS.md`](../../AGENTS.md) rule 5, [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md)

## Context

[ADR-0004](0004-target-architecture.md) sets the target architecture of Opificia AI and starts with a first loop: a single-node install where one ticket becomes a reviewed pull request, using Claude Code as the harness. To build that loop, we need a concrete stack. Every package, container image and service we add needs an ADR (AGENTS.md rule 5), so this ADR records the whole prototype stack at once.

The first loop does this:

1. A person labels an issue `opificia` in a GitHub repository.
2. Opificia notices the issue and starts a run. Claude Code reads the issue and the repository in a sandbox and proposes a plan.
3. A person approves the plan in the web app.
4. Claude Code implements the change and runs the tests in the same kind of sandbox, then reviews its own diff.
5. Opificia checks the result, pushes the branch and opens a pull request. A person merges it.

The first target is a private repository, `opificia/playground`, made for this purpose.

Two choices below differ from earlier research. That research proposed PostgreSQL as the only data store in v0, and an external OIDC identity provider (Keycloak) instead of authentication inside the application. The steward chose otherwise, for speed and familiarity. This ADR records how each choice stays within the commitments.

## Considered options

1. **A mainstream TypeScript stack:** NestJS, Prisma, PostgreSQL, Valkey, Better Auth, Vite and React.
2. **The same, with PostgreSQL as the only data store**, using `LISTEN` and `NOTIFY` for fan-out.
3. **An Effect-based server**, as t3code uses, with the same database.
4. **Drizzle instead of Prisma** as the database layer.
5. **An external identity provider only** (Keycloak or Zitadel over OIDC), with no authentication code in the application.

## Decision

We choose option 1, with the components below. All are open source under licences that are compatible with the AGPL core.

| Area | Choice | Licence | Notes |
| --- | --- | --- | --- |
| Runtime | Node.js 24 | MIT | Runs TypeScript directly where that is enough |
| Language | TypeScript 6 | Apache-2.0 | Not 7 yet: the NestJS 12 build tool requires TypeScript 6 |
| Package manager | pnpm 12, with workspaces | MIT | One repository, several packages |
| Back end | NestJS 12 (`@nestjs/core`, `@nestjs/platform-express`) | MIT | API and worker processes |
| API description | `@nestjs/swagger` | MIT | OpenAPI built from the Zod contracts with Zod's own `z.toJSONSchema()` |
| Contracts | Zod 4 | MIT | Shared by server, web app and runner |
| Database | PostgreSQL | PostgreSQL License | Source of truth for all state |
| Database access | Prisma 7 (`prisma`, `@prisma/client`) | Apache-2.0 | Pinned to 7.x: the `latest` tag on npm points to an 8.0 release candidate |
| Fan-out and cache | Valkey, with `iovalkey` | BSD-3-Clause, MIT | Never a source of truth; see below |
| Authentication | Better Auth 1.7, with the Prisma adapter and the organization plugin | MIT | Email and GitHub sign-in in the prototype |
| Front end | Vite 8, React 19, TanStack Router and Query | MIT | Single-page app; no server-side rendering |
| Styling | Tailwind CSS 4, shadcn/ui | MIT | shadcn/ui components are copied into the repository |
| Tests | Vitest 5 | MIT | |
| GitHub | `octokit`, `@octokit/auth-app` | MIT | GitHub App with installation tokens |
| Sandboxes | `dockerode`, talking to a local Docker-compatible engine | Apache-2.0 | One container per run |
| Container images | `postgres`, `valkey/valkey`, `node:24` | PostgreSQL License, BSD-3-Clause, MIT | Official images, pinned by digest |
| Harness | Claude Agent SDK | Anthropic Commercial Terms | Already accepted by ADR-0004, for `plugins/harness-claude` only |

**Supporting packages.** This ADR also covers the companion packages that the components above need, and their required peer dependencies:

- NestJS: `@nestjs/common`, `@nestjs/cli`, `@nestjs/testing`, `reflect-metadata`, `rxjs`, and `ws` for the runner connection;
- Prisma: `@prisma/adapter-pg` and `pg`;
- Vite and Tailwind CSS: `@vitejs/plugin-react` and `@tailwindcss/vite`;
- shadcn/ui: the libraries its components import (Radix UI, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`);
- type definitions (`@types/*`).

All are under the MIT, ISC or Apache-2.0 licence. Any other package needs its own ADR.

We do not use `nestjs-zod`, because it does not support NestJS 12 yet. A small validation pipe checks requests against the Zod contracts instead.

### Reasons

- **Familiar, widely used tools** let us reach a working loop quickly, and contributors and coding agents know them well.
- **NestJS** gives modules, dependency injection and a clear split between API and worker processes. It settles the open question in ADR-0004: we do not use Effect. We implement t3code's patterns (decider, event store, outbox) in plain TypeScript.
- **Prisma** has a readable schema, managed migrations and a Better Auth adapter. The event store's append and its per-run sequence number use raw SQL inside Prisma transactions, where the query builder is not precise enough.
- **Valkey rather than Redis.** Valkey is the Linux Foundation fork of Redis, under BSD-3-Clause. Redis is available under AGPL-3.0 among other licences, which would work, but its licence has changed before. Valkey keeps self-hosting simple.
- **Better Auth** runs inside our application, so a single-node install needs no separate identity provider. Its organization plugin gives us tenants, members and roles. Its SSO plugin can add OIDC and SAML providers later, so operators can still bring Keycloak, Zitadel, Entra or Okta.

### Rejected options

- **PostgreSQL only** (option 2) would mean one fewer service. We keep it as a fallback: if Valkey is not configured, the server can fall back to `LISTEN` and `NOTIFY`.
- **Effect** (option 3) is a capable framework, but it is a large commitment that few contributors know, and NestJS covers what the prototype needs.
- **Drizzle** (option 4) is closer to SQL. The steward prefers Prisma's schema and migrations.
- **An external identity provider only** (option 5) adds a heavy service to every install, including a single laptop.

### How the parts fit together

| Folder | Contents | Licence |
| --- | --- | --- |
| `apps/server` | NestJS API and worker processes | AGPL-3.0-only |
| `apps/web` | Vite and React web app | AGPL-3.0-only |
| `sdk/contracts` | Zod schemas for the API and the runner protocol | Apache-2.0 |
| `sdk/runner` | Reference runner library for harness adapters | Apache-2.0 |
| `plugins/harness-claude` | The `claude` adapter (ADR-0004) | Apache-2.0 |
| `deploy/compose` | Docker Compose file for a single-node install | CC0-1.0 |

These licences follow from [`REUSE.toml`](../../REUSE.toml) as it stands. No change to it is needed.

Rules that keep the prototype within ADR-0004:

- **PostgreSQL is the source of truth.** Run events, audit events, usage events and projections live there. Valkey carries only notifications ("run R has new events up to sequence N") and rebuildable cache entries. Clients always read events from PostgreSQL, resuming from their last sequence number. Losing Valkey loses no data.
- **Tenants from the first table.** Every table carries an organisation ID, even while the prototype has one organisation.
- **Sandboxes reach only the control plane.** Each run gets a container on an internal Docker network with no route to the internet. The control plane is the only other member of that network. It serves the runner protocol and a pass-through proxy that adds the Anthropic API key to model requests. The key never enters the container.
- **The forge token stays in the control plane.** The sandbox hands back a git bundle. The control plane checks it and pushes it with a GitHub App installation token that is limited to one repository.
- **Polling, not webhooks.** The prototype polls GitHub every 30 seconds for issues labelled `opificia`, so it needs no public URL. Webhooks follow when Opificia runs on a server.

Prototype defaults, changeable in configuration:

| Setting | Default |
| --- | --- |
| Model spend per run | 15 USD |
| Wall-clock time per run | 60 minutes |
| Polling interval | 30 seconds |
| Web app URL in development | `http://localhost:5173`, which proxies `/api` to the server |
| Server URL in development | `http://localhost:3000` |

### Telemetry and phone-home

Commitment 2 says a default installation contacts no vendor on its own. We checked each component:

| Component | What we found | What we do |
| --- | --- | --- |
| Prisma CLI | The `prisma` 7.10.0 package contains a usage check that calls `checkpoint.prisma.io` by default | Set `CHECKPOINT_DISABLE=1` in `.env.example`, Docker Compose and CI |
| Better Auth | Telemetry is off by default, according to its documentation | Also set `telemetry: { enabled: false }` in code and `BETTER_AUTH_TELEMETRY=0` |
| Claude Code | See ADR-0004 | As ADR-0004 describes |
| shadcn CLI | Downloads components from its registry when a developer runs it | Developer tool only; never runs in an install |
| Vite, NestJS CLI, TanStack Router plugin, pnpm | No telemetry code found in the published packages | None needed; the egress test confirms it |
| Docker Desktop | Proprietary, with its own telemetry | Not required. Any Docker-compatible engine works, such as Docker Engine, Colima or Podman |

Searching a package for telemetry code is not proof. The CI egress test from ADR-0004 is the real check, and it covers the whole install.

## Consequences

- We can start building the first loop as soon as this ADR is accepted.
- A single-node install runs four services: PostgreSQL, Valkey, the server and the web app. That is one more than a PostgreSQL-only design.
- Authentication code lives in our application. We must keep Better Auth up to date and follow its security advisories.
- Prisma does not express PostgreSQL row-level security well. Each transaction has to set the organisation ID with `set_config`, and we test cross-tenant isolation explicitly.
- The prototype sandbox is a plain container on the developer's machine, not gVisor on Kubernetes. That is acceptable for one person working on their own repositories, and not for anything else. Stronger isolation comes in step 2 of ADR-0004.
- The prototype implements a first version of the runner protocol in `sdk/contracts`, marked unstable. The RFC from ADR-0004 then specifies it from what we learn.

Follow-up work:

1. Update [`AGENTS.md`](../../AGENTS.md), which says no language or framework has been chosen, once this ADR is accepted.
2. Add the CI egress test, starting with the Docker Compose install.
3. Add a licence check on the lockfile to CI, so new dependencies cannot slip in without an ADR.

### Sovereignty impact

1. **Runs anywhere you choose.** Supported: every component is open source and self-hostable, and a single-node install needs only a container engine. The `claude` harness still needs a model provider, as ADR-0004 describes.
2. **No phone-home.** Supported, with the settings in the telemetry table above, checked by the egress test.
3. **Model-agnostic.** No impact. The stack does not depend on a model provider.
4. **Open standards.** Supported: PostgreSQL, OpenAPI, JSON Schema through Zod, and OIDC and SAML through Better Auth's SSO plugin when we add it.
5. **Your data stays yours.** Supported: all state stays in the operator's PostgreSQL. Valkey holds no data that is not also in PostgreSQL.
6. **Humans decide.** Supported: the loop has a human approval for the plan and a human merge.
7. **Transparent supply chain.** Lockfile pinned, images pinned by digest. The SBOM follows with the first release.
8. **Reference deployment on European infrastructure.** No impact. The prototype runs on a developer's machine.

## More information

- NestJS: <https://nestjs.com/>
- Prisma: <https://www.prisma.io/docs>
- Better Auth telemetry: <https://www.better-auth.com/docs/reference/telemetry>
- Valkey: <https://valkey.io/>
- Vite: <https://vite.dev/>
- TanStack Router: <https://tanstack.com/router>
- shadcn/ui: <https://ui.shadcn.com/>

How to check that the decision is followed:

- Packages added beyond this list need their own ADR.
- `CHECKPOINT_DISABLE=1` and `BETTER_AUTH_TELEMETRY=0` appear in `.env.example`, the Docker Compose file and CI.
- No code reads run events from Valkey.
