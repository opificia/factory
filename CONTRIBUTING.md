# Contributing to Opificia AI

Thank you for your interest in Opificia AI. This guide explains how to contribute and what we expect from every contribution.

## What we need now

Opificia is moving from its foundation phase to a first working loop. A prototype exists (see [`docs/prototype.md`](docs/prototype.md)), but most of the design is still open, so the most useful contributions right now are:

- **Documentation**: clearer policies, fixes to wording, better explanations.
- **RFCs and design discussion**: how the factory should work, which interfaces it needs, how to keep it self-hostable.
- **Translations**: the README in Dutch, French and German to begin with.
- **Review**: reading proposals and pull requests, and saying what is unclear or wrong.

Code contributions will follow once the first architecture decisions are recorded.

## Before you start

- **Small fixes** (typos, broken links): open a pull request directly.
- **Ideas and questions**: start a thread in [GitHub Discussions](https://github.com/opificia/factory/discussions). Discussing first saves you from writing something we cannot accept.
- **Significant changes** (new components, new dependencies, changes to policies or to a sovereignty commitment): write an RFC. See [`docs/rfcs/README.md`](docs/rfcs/README.md).
- **Security issues**: do not open an issue or pull request. Follow [`SECURITY.md`](SECURITY.md).

Everyone taking part must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Developer Certificate of Origin (DCO)

We do not ask you to sign a contributor licence agreement. Instead, every commit must carry a sign-off line:

```text
Signed-off-by: Ada Lovelace <ada@example.org>
```

By adding this line, you certify the Developer Certificate of Origin below. In plain words, you state that you wrote the change, or otherwise have the right to submit it, under the licence of the folder you are changing. You keep your copyright.

The sign-off must use your real name (or the name you are publicly known by) and an email address that reaches you. Pseudonymous sign-offs cannot be accepted.

### The full text

This is the Developer Certificate of Origin, version 1.1, copied verbatim from [developercertificate.org](https://developercertificate.org/):

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

### How to sign off

Add `-s` when you commit. Git adds the line for you, using `user.name` and `user.email` from your git configuration:

```sh
git commit -s -m "docs: clarify the RFC process"
```

### Catch a missing sign-off before you push

We recommend that you set up two things once, in your clone of the repository:

```sh
cp .githooks/pre-push .git/hooks/pre-push
git config alias.signoff '!f() { git fetch --quiet origin && git rebase --quiet --signoff --force-rebase "$(git merge-base HEAD "${1:-origin/main}")"; }; f'
```

- The `pre-push` hook runs the same check as CI. If a commit lacks your sign-off, git refuses the push and lists the commit, so the problem never reaches a pull request. If a maintainer signs off your pull request with `/signoff` instead (see [Sign off at the merge](#sign-off-at-the-merge)), run `git config opificia.signoff approval`: the hook then lists unsigned commits but lets the push through.
- `git signoff` fetches `origin`, then signs off every commit on your branch since it left `main`. Use `git signoff <branch>` if you started from another branch. The fetch matters: with an old `origin/main`, the rebase would also copy commits that are already on `main`.

We copy the hook into `.git/hooks` instead of pointing git at `.githooks`. That way, a branch you check out cannot change which hook runs on your machine. Copy the hook again when it changes.

If an AI agent writes commits for you, it never signs them off (see [AI-assisted contributions](#ai-assisted-contributions)). Review the commits, then run `git signoff` and push. If you are a maintainer, you can instead let the agent push and open the pull request, and sign off at the merge.

### Sign off at the merge

Maintainers sign off a pull request by approving it ([ADR-0011](docs/adr/0011-sign-off-at-the-merge.md), [ADR-0012](docs/adr/0012-merge-with-merge-commits.md)). This is how changes written by the Opificia bot or by an agent get their sign-off:

1. Review the pull request on GitHub.
2. Approve it, with a line that reads `/signoff` in the review. A plain comment does not count: it must be an approving review.
3. The DCO check runs again and passes. The `Sign-off` workflow then merges the pull request with a merge commit that carries your `Signed-off-by` line, using the name and email address in [`MAINTAINERS.md`](MAINTAINERS.md). You do not merge it yourself, and the branch is not rewritten.

By writing `/signoff`, you certify the Developer Certificate of Origin for the commits by the bot and by you, exactly as with `git commit -s`. Those commits reach `main` as they are, and the merge commit records your certification. Nothing is merged when:

- your approval is not on the current head of the branch, because someone pushed after your review. Approve the new head;
- a commit is by someone other than you or the bot that opened the pull request, because that person must sign off themselves. A commit by you or the bot that carries a `Signed-off-by` line for anyone else is refused too: it would reach `main` with a certification nobody gave. An author email alone proves nothing, so a commit counts as the bot's only when GitHub names that bot as the author of the pull request;
- the pull request does not go into the default branch. A stacked pull request moves onto the default branch when its base is merged; approve it again then;
- the branch changes `.github/workflows/`, which the bot may not merge. Sign off in a terminal and merge it yourself; or
- the required checks do not pass within 30 minutes. Approve again once they do, or merge it yourself.

GitHub does not let you approve your own pull request, so this works for pull requests that a bot or another person opened. An agent that works for you should open its pull requests as a GitHub App, such as the factory's App. It works only for branches in this repository, not for forks. The workflow needs a GitHub App that is installed only on this repository, with "Contents: read and write" and nothing else, and that branch rules allow to merge. Its ID goes in the repository variable `OPIFICIA_BOT_APP_ID`, and its private key in the secret `OPIFICIA_BOT_PRIVATE_KEY`.

### How to fix a missing sign-off

For the last commit:

```sh
git commit --amend --no-edit -s
git push --force-with-lease
```

For several commits on your branch (replace `main` with the branch you started from):

```sh
git rebase --signoff main
git push --force-with-lease
```

The DCO check on your pull request turns green once every commit is signed off.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The first line has the form `type(optional scope): summary`, in the imperative mood and in lower case, without a full stop.

Types we use: `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`, `build`, `perf`, `revert`.

```text
docs: explain how to fix a missing sign-off
ci: pin the markdownlint action to a commit SHA
feat(sdk): add a plugin manifest schema
fix(governance)!: correct the RFC comment period
```

A `!` after the type marks a breaking change. Explain it in the commit body, in a `BREAKING CHANGE:` footer.

Pull requests are merged with a merge commit ([ADR-0012](docs/adr/0012-merge-with-merge-commits.md)). Every commit of the branch reaches `main`, so every commit message must follow this format. The merge commit takes the pull request's title, so `git log --first-parent main` reads as a list of changes. That is why the title must follow this format too. Two checks enforce it: `Commit messages` for every commit, apart from merges made by git or GitHub, and `Pull request title` for the title.

## Pull request process

1. **One topic per pull request.** Small pull requests are reviewed faster.
2. **Link the issue or Discussion** the change belongs to, if there is one.
3. **Keep the checks green.** They check licence headers (REUSE), sign-offs, Markdown style, links, commit messages and the pull request title. [`AGENTS.md`](AGENTS.md) shows how to run them locally.
4. **Review.** A code owner (see [`.github/CODEOWNERS`](.github/CODEOWNERS)) must approve. Policy files need approval from the steering team.
5. **Merge.** A maintainer merges the pull request with a merge commit, usually by approving it with `/signoff` (see [Sign off at the merge](#sign-off-at-the-merge)).

If nobody responds within ten working days, add a comment to the pull request. [`docs/community/triage.md`](docs/community/triage.md) describes our response-time goals.

## AI-assisted contributions

Opificia builds AI agents, so we expect contributors to use AI tools too. These rules apply:

- **AI tools are allowed**, for code, documentation and review.
- **A human submits and signs off.** You are responsible for every line you submit, whoever or whatever wrote it. You must understand the change well enough to explain and maintain it.
- **Disclose meaningful assistance** with an `Assisted-by` trailer in the commit message, naming the tool and, if known, the model:

  ```text
  docs: draft the plugin RFC template

  Assisted-by: <tool name>/<model name>
  Signed-off-by: Ada Lovelace <ada@example.org>
  ```

  "Meaningful" means the tool wrote or substantially rewrote part of the change. Autocompletion of a single line does not need a trailer.
- **No incompatible code.** Do not paste output that reproduces code under a licence incompatible with the folder you change. If a tool produces a large block that looks copied from elsewhere, do not submit it.
- **Keep confidential material out of AI tools.** Do not paste or send embargoed security reports, secrets and credentials, or anything shared with the project in confidence into third-party AI tools. If in doubt, ask a maintainer first. [How we build Opificia](SOVEREIGNTY.md#how-we-build-opificia) explains why.
- **Automated agents** may open pull requests only from a clearly labelled bot account (for example, a name ending in `-bot` and a profile that says who runs it). A human maintainer must approve every such pull request before it is merged. A bot account never signs off by itself. It only records the sign-off a maintainer gives with `/signoff` (see [Sign off at the merge](#sign-off-at-the-merge)).

Pull requests with meaningful AI assistance get the `ai-assisted` label. This is for transparency, not a judgement.

## Licence of your contribution

Inbound equals outbound: you license your contribution under the licence of the folder you change, as mapped in [`REUSE.toml`](REUSE.toml).

| Folder | Licence |
| --- | --- |
| Everything not listed below (the core) | AGPL-3.0-only |
| `sdk/`, `plugins/`, `examples/` | Apache-2.0 |
| `docs/` | CC-BY-4.0 |
| `website/` (except fonts and logo files) | CC-BY-4.0 |
| Configuration and templates (`.github/`, dotfiles, `*.yml`) | CC0-1.0 |
| `brand/` | Not open source; see [`TRADEMARKS.md`](TRADEMARKS.md) |

New files are covered by these mappings automatically. If a file needs a different licence, for example because it is copied from another project, add an SPDX header to it and explain why in the pull request.

## Recognition

Every contributor is one of The Opificia Authors. [`AUTHORS.md`](AUTHORS.md) explains how you are credited. Sustained contributors can become committers and maintainers, as described in [`GOVERNANCE.md`](GOVERNANCE.md).

## Getting help

Ask in [GitHub Discussions](https://github.com/opificia/factory/discussions), in the Q&A category. [`SUPPORT.md`](SUPPORT.md) lists the other places to get help.
