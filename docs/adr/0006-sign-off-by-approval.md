# ADR-0006: Sign off by approval

- **Status:** superseded by [ADR-0011](0011-sign-off-at-the-merge.md)
- **Date:** 2026-10-15
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [`CONTRIBUTING.md`](../../CONTRIBUTING.md#developer-certificate-of-origin-dco), [`AGENTS.md`](../../AGENTS.md) rule 1, [ADR-0004](0004-target-architecture.md), [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md) commitment 6

## Context

Opificia AI asks every contributor to certify the Developer Certificate of Origin (DCO) with a `Signed-off-by` line on every commit. The DCO check in CI fails a pull request if any commit lacks a sign-off that matches its author. AI agents never sign off: a person must certify the change.

Today that person has to do it in a terminal. An agent commits locally, the person runs `git signoff` on the branch, and only then pushes. The agent cannot push or open the pull request itself, because the DCO check would fail.

This does not scale to a factory. When Opificia works on its own tickets (ADR-0004, step 2), it writes the commits and opens the pull requests. Nobody has a local clone of those branches. A maintainer reviews the pull request on GitHub, often from another device. Asking them to clone, rebase and force-push for every pull request blocks the loop on a terminal session.

The DCO itself does not require a terminal. It requires that a named person certifies, once, that the project may accept the change, and that the record is kept. The review of a pull request is the moment a person actually looks at the change, so it is the natural moment to certify it.

## Considered options

1. **Keep sign-off in the terminal.** The person runs `git signoff` and pushes.
2. **Exempt the factory's commits from the DCO.** The bot's commits need no sign-off. The merge by a maintainer is the only record.
3. **Sign off in the squash commit.** The maintainer adds a `Signed-off-by` line to the commit message when they merge. The DCO check accepts unsigned bot commits.
4. **Sign off by approval.** The maintainer approves the pull request with `/signoff` in the review. A workflow then adds their sign-off to every commit on the branch.

## Decision

We choose option 4.

1. A maintainer reviews the pull request and submits an approving review whose body contains `/signoff`.
2. A workflow checks the review through the GitHub API. The review must be an approval, from a person listed in [`MAINTAINERS.md`](../../MAINTAINERS.md), on the commit that is currently the head of the branch.
3. The workflow rebases the branch with `--signoff`, using the name and email address listed for that maintainer, and pushes it with the bot's token so that the checks run again.
4. Before it pushes, the workflow checks that the new head has exactly the same tree as the approved commit. The sign-off cannot carry any other change.

The DCO check changes in one way. A commit by the Opificia bot account passes if it carries a sign-off from a listed maintainer. Commits by people still need their own sign-off, as today.

### Reasons

- The person who certifies is the person who reviewed the exact commit. Tying the sign-off to the review's commit means a later push cannot slip in under an earlier approval.
- The record stays in git, in the same form as today, so the history and the DCO check keep working.
- It costs the reviewer nothing beyond the review they already do, and it works from any device.
- Option 1 blocks the factory. Option 2 loses the per-change certification, which is the point of the DCO. Option 3 needs the maintainer to type the line correctly at merge time, and the check cannot verify it before the merge.

### Security of the workflow

- The workflow that reacts to the review runs without secrets and only records the review ID. A second workflow, started by `workflow_run` from the default branch, does the work with the bot's token. A pull request therefore cannot change the code that signs it off.
- The second workflow trusts nothing but the review ID. It reads the review, the reviewer and the commit from the GitHub API.
- It works only on branches in this repository. Contributors from forks sign off themselves, as today.
- The workflow reads `MAINTAINERS.md` from the default branch, never from the pull request. `MAINTAINERS.md` joins `.github/workflows/` on the protected paths that agents may not edit, so an agent cannot add a maintainer.

## Consequences

- Agents may push unsigned commits to a branch and open the pull request. The DCO check fails until a maintainer signs off. This replaces the current rule that sign-off comes before the push.
- Each maintainer needs a name and an email address in `MAINTAINERS.md` that the workflow can use. Pseudonymous sign-offs remain unacceptable.
- The rebase changes the commit hashes. We need to check whether branch protection with "dismiss stale approvals" dismisses the approval after the push. If it does, the workflow must approve again or we turn that setting off and rely on the tree check.
- The bot account needs its own GitHub App token, stored as a repository secret.

Follow-up work, once this ADR is accepted:

1. Update the DCO section and the AI section of `CONTRIBUTING.md`. A bot still never signs off on its own; it only records a maintainer's sign-off.
2. Update `AGENTS.md` rule 1 to describe the new flow, without changing its meaning: agents never add a sign-off.
3. Add the two workflows and change the DCO check.
4. Fill in `MAINTAINERS.md`.

### Sovereignty impact

1. **Runs anywhere you choose.** No impact. This concerns how we accept contributions, not the software.
2. **No phone-home.** No impact.
3. **Model-agnostic.** No impact.
4. **Open standards.** No impact. The DCO and the `Signed-off-by` trailer stay as they are.
5. **Your data stays yours.** No impact.
6. **Humans decide.** Strengthened for our own repository. Every change the factory makes needs an explicit, recorded certification by a named maintainer on the exact commit.
7. **Transparent supply chain.** No impact. The record of who certified each change stays in the git history.
8. **Reference deployment on European infrastructure.** No impact.

## More information

- Developer Certificate of Origin, version 1.1: <https://developercertificate.org/>
- How to check that the decision is followed: every commit on `main` made by the bot carries a `Signed-off-by` line of a listed maintainer, and the pull request has an approving review from that maintainer on a commit with the same tree.
