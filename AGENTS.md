# Instructions for AI coding agents

This file is for AI coding agents working in the Opificia AI repository. Humans may find it useful as a short index too. If anything here conflicts with a policy file, the policy file wins.

## What this repository is

Opificia is an open-source software factory: agents turn tickets into reviewed, tested pull requests, on infrastructure and models the operator controls. The repository is in phase 0 (foundations). It contains policies and documentation, not product code. No language, framework or model has been chosen yet; do not assume one.

## Where things are

| Topic | File |
| --- | --- |
| Project overview | [`README.md`](README.md) |
| How to contribute, DCO, commit style, AI policy | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Design commitments the code must meet | [`SOVEREIGNTY.md`](SOVEREIGNTY.md) |
| Decisions and roles | [`GOVERNANCE.md`](GOVERNANCE.md) |
| Licence per folder | [`REUSE.toml`](REUSE.toml), [`docs/adr/0002-licensing-model.md`](docs/adr/0002-licensing-model.md) |
| Architecture decisions | [`docs/adr/`](docs/adr/README.md) |
| Proposals | [`docs/rfcs/`](docs/rfcs/README.md) |
| Vulnerabilities | [`SECURITY.md`](SECURITY.md) |
| Name and logo | [`TRADEMARKS.md`](TRADEMARKS.md), [`brand/`](brand/README.md) |

## Rules

1. **Sign-off is human-only.** Never add a `Signed-off-by` line yourself, and never run `git commit -s` on behalf of a person. The human who submits the change signs off.
2. **Disclose yourself.** Add an `Assisted-by: <tool>/<model>` trailer to every commit you write or substantially change. That trailer is the only way AI tools are disclosed: never add a `Co-authored-by` trailer for an AI tool or model, and never add "generated with" lines to commits or pull requests. `Co-authored-by` is for people.
3. **Never commit secrets.** No tokens, keys, passwords or private URLs, not even in examples or tests. Use obvious placeholders.
4. **Respect folder licences.** The core is AGPL-3.0-only; `sdk/`, `plugins/` and `examples/` are Apache-2.0; `docs/` is CC-BY-4.0. Do not move code between them, and do not add code copied from elsewhere unless its licence is compatible and recorded.
5. **No new dependencies without an ADR.** This includes packages, GitHub Actions, container images and external services.
6. **Use Conventional Commits.** For example `docs: fix the RFC link`. See `CONTRIBUTING.md`.
7. **Do not change policy files** (`LICENSE*`, `REUSE.toml`, `GOVERNANCE.md`, `SOVEREIGNTY.md`, `TRADEMARKS.md`) unless the task explicitly asks for it.
8. **Do not touch `brand/`.** Logo files are copied unchanged from the brand book.
9. **Pin GitHub Actions to a full commit SHA**, with the version as a comment, and keep `permissions: read-all` at the top of every workflow.

## Writing style

Plain European English, short sentences, sentence-case headings. "We" is the project, "you" is the reader. No emoji, no exclamation marks, no hype words. Do not make claims about legal conformity, audits or readiness for production that the project cannot back up. Write "Opificia AI" on first mention in a document, "Opificia" after that.

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
