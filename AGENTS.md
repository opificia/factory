# Instructions for AI coding agents

This file is for AI coding agents working in the Opificia AI repository. Humans may find it useful as a short index too. If anything here conflicts with a policy file, the policy file wins.

## What this repository is

Opificia is an open-source software factory: agents turn tickets into reviewed, tested pull requests, on infrastructure and models the operator controls. The repository is moving from phase 0 (foundations) to phase 1 (a first working loop). A prototype of the loop exists; [`docs/prototype.md`](docs/prototype.md) explains how to run it and how it fits together. The target architecture is in [ADR-0004](docs/adr/0004-target-architecture.md) and the prototype stack in [ADR-0005](docs/adr/0005-prototype-stack.md): TypeScript on Node.js 24, NestJS, PostgreSQL with Prisma, Valkey, Better Auth, Vite and React, with Claude Code as the first harness. Use only what those ADRs list; anything else needs a new ADR (rule 5).

## Where things are

| Topic | File |
| --- | --- |
| Project overview | [`README.md`](README.md) |
| How to contribute, DCO, commit style, AI policy | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Design commitments the code must meet | [`SOVEREIGNTY.md`](SOVEREIGNTY.md) |
| Decisions and roles | [`GOVERNANCE.md`](GOVERNANCE.md) |
| Licence per folder | [`REUSE.toml`](REUSE.toml), [`docs/adr/0002-licensing-model.md`](docs/adr/0002-licensing-model.md) |
| Architecture decisions | [`docs/adr/`](docs/adr/README.md) |
| Target architecture and prototype stack | [ADR-0004](docs/adr/0004-target-architecture.md), [ADR-0005](docs/adr/0005-prototype-stack.md) |
| Running the prototype | [`docs/prototype.md`](docs/prototype.md) |
| Proposals | [`docs/rfcs/`](docs/rfcs/README.md) |
| Vulnerabilities | [`SECURITY.md`](SECURITY.md) |
| Name and logo | [`TRADEMARKS.md`](TRADEMARKS.md), [`brand/`](brand/README.md) |

## Rules

1. **Sign-off is human-only.** Never add a `Signed-off-by` line yourself, and never run `git commit -s` on behalf of a person. The human who submits the change signs off: in a terminal before the push, or as a maintainer by approving the pull request with `/signoff`, which merges it with a merge commit that carries their sign-off ([ADR-0012](docs/adr/0012-merge-with-merge-commits.md)). The second way covers only commits by that maintainer or by the bot that opened the pull request, on a branch in this repository, without any `Signed-off-by` line, and not pull requests that change `.github/workflows/`; anyone else signs off their own commits. Every commit reaches `main`, so every commit message follows Conventional Commits. With the second way, you may push unsigned commits and open the pull request; the DCO check stays red until a maintainer approves with `/signoff`.
2. **Disclose yourself.** Add an `Assisted-by: <tool>/<model>` trailer to every commit you write or substantially change.
3. **Never commit secrets.** No tokens, keys, passwords or private URLs, not even in examples or tests. Use obvious placeholders.
4. **Respect folder licences.** The core is AGPL-3.0-only; `sdk/`, `plugins/` and `examples/` are Apache-2.0; `docs/` is CC-BY-4.0. Do not move code between them, and do not add code copied from elsewhere unless its licence is compatible and recorded.
5. **No new dependencies without an ADR.** This includes packages, GitHub Actions, container images and external services.
6. **Use Conventional Commits.** For example `docs: fix the RFC link`. See `CONTRIBUTING.md`.
7. **Do not change policy files** (`LICENSE*`, `REUSE.toml`, `GOVERNANCE.md`, `SOVEREIGNTY.md`, `TRADEMARKS.md`) unless the task explicitly asks for it.
8. **Do not touch `brand/`.** Logo files are copied unchanged from the brand book.
9. **Pin GitHub Actions to a full commit SHA**, with the version as a comment, and keep `permissions: read-all` at the top of every workflow.
10. **Keep agent instructions in this file.** `AGENTS.md` is the only source of agent instructions. Tool-specific files (for example `CLAUDE.md` or `.cursorrules`) may exist only as a one-line pointer to this file.

## Writing style

Plain European English, short sentences, sentence-case headings. "We" is the project, "you" is the reader. No emoji, no exclamation marks, no hype words. Do not make claims about legal conformity, audits or readiness for production that the project cannot back up. Write "Opificia AI" on first mention in a document, "Opificia" after that.

## Building and testing the code

The code is a pnpm workspace: `apps/server`, `apps/web`, `sdk/contracts`, `sdk/runner` and `plugins/harness-claude`. Use Node.js 24 and pnpm 12.

```sh
pnpm install
pnpm build       # also generates the Prisma client
pnpm typecheck
pnpm test        # Vitest
```

Keep the run lifecycle in `apps/server/src/runs/decider.ts` pure, and test it there. Change the database only through a Prisma migration (`pnpm db:migrate`). The runner protocol in `sdk/contracts` is version 0 and unstable; change the server and the harness together.

## Checking changes to the web app

Tests and the typecheck do not show how a page looks. When you change `apps/web`, look at the result before you hand it over ([ADR-0009](docs/adr/0009-let-agents-see-the-web-app.md)):

```sh
pnpm --filter @opificia/contracts build
pnpm --filter @opificia/web screenshot                   # every state, light and dark, and 400px wide
pnpm --filter @opificia/web screenshot /runs/<id> /      # only these pages
pnpm --filter @opificia/web screenshot /runs/<id> --bottom --width 400   # the end of a page, 400px wide
```

The command runs the web app in fixture mode (`apps/web/fixtures`), with recorded runs in every state and no server, and prints the paths of the screenshots. Open the ones your change affects and look at them: layout, spacing, light and dark, and 400 pixels wide. A run page scrolls inside the app, so use `--bottom` for what is at the end of it, such as the checks and the pull request. Fix what looks wrong and take them again. Say in your summary which screenshots you checked. If your change needs a state the fixtures do not have, add a scenario to `apps/web/fixtures/plugin.ts`.

Follow the look that is there: the colour tokens in `apps/web/src/styles.css` (navy and slate; gold only for what needs a person; colour only for attention, work in progress and failure), the components in `apps/web/src/ui.tsx`, and icons from `lucide-react`.

## Running the hygiene checks locally

The CI checks are repository hygiene only. You can run them with these tools:

```sh
# Licence and copyright information (REUSE)
uvx --from 'reuse[charset-normalizer]' reuse lint

# Markdown style, using .markdownlint.yaml
npx markdownlint-cli2 "**/*.md"

# Links, using .lychee.toml
lychee --config .lychee.toml .

# Citation metadata
uvx cffconvert --validate

# publiccode.yml
docker run --rm -v "$PWD:/data" italia/publiccode-parser-go /data/publiccode.yml
```

The DCO and pull request title checks run only on pull requests. Check them yourself: every commit has a human `Signed-off-by` line, and the title follows Conventional Commits.

## When unsure

When unsure, open a Discussion instead of guessing.
