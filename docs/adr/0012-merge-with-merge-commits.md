# ADR-0012: Merge with merge commits, signed off in the merge commit

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Supersedes:** [ADR-0011](0011-sign-off-at-the-merge.md)
- **Related:** [ADR-0006](0006-sign-off-by-approval.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md#sign-off-at-the-merge), [`AGENTS.md`](../../AGENTS.md) rule 1, [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md) commitment 6

## Context

The repository merges pull requests by squash only, and [ADR-0011](0011-sign-off-at-the-merge.md) puts the maintainer's sign-off in the squash commit. Squash merges keep causing work now that Opificia writes most of its own pull requests, often as a stack:

- When the lower pull request of a stack is squash-merged, its commits reach `main` as one new commit. The pull request above still contains the original commits, so it has to be rebased, which rewrites its commits and loses their sign-offs. Stack #47 (#45 and #46) needed both on the day this ADR was written.
- A squash commit replaces the commits a person signed off in a terminal with a new commit, so the record of who certified what moves from the commits to the merge.
- The squash commit's message has to be assembled from the commits, and each rule about which lines it may copy has been a source of mistakes.

A merge commit keeps the commits of the branch as they are, and joins them to `main` with one more commit.

## Considered options

1. **Keep squash merges** (ADR-0011).
2. **Merge commits, with every commit signed off before the merge.** Commits without a sign-off get one by a rebase, as in ADR-0006. That rewrites branches again, which is what breaks stacks.
3. **Merge commits, signed off in the merge commit.** The approval with `/signoff` stays the sign-off. The merge commit carries the `Signed-off-by` line of every maintainer who approved, and certifies the commits it brings in that their authors did not sign off.

## Decision

We choose option 3. Everything in ADR-0011 stands, except that the merge is a merge commit:

1. A maintainer approves the head of the pull request with `/signoff`, as before.
2. Commits reach `main` as they are, so every line in a commit message that reads as a sign-off, in the trailers or anywhere else, must name the commit's author. This holds for merge commits on the branch too, which otherwise need no sign-off when they add nothing of their own. A sign-off in anyone else's name fails the DCO check: each person signs off their own commits.
3. The DCO check accepts a commit without a sign-off when a maintainer's latest review approves the head with `/signoff`, the commit is by that maintainer or by the bot that opened the pull request, the branch is in this repository, and the commit carries no `Signed-off-by` line at all. A commit with someone else's sign-off line would reach `main` as it is, with a certification nobody gave, so the exception does not cover it. Commits by anyone else still need their author's own sign-off.
4. The `Sign-off` workflow runs the DCO check again, reads the sign-offs again before each attempt, and merges the approved head with a merge commit:
   - titled with the pull request's title and number, such as `feat: add the chart (#50)`, so that `git log --first-parent main` reads as a list of changes, one line each, as it did with squash merges;
   - with a `Signed-off-by` line for every maintainer whose sign-off stands at that moment.
5. Maintainers who merge by hand use a merge commit too. Squash and rebase merges are turned off in the repository settings.

### Reasons

- **Stacks work.** Commits keep their hashes when they reach `main`, so the pull requests above need no rebase and keep their sign-offs.
- **The record stays where it was made.** A commit signed off in a terminal reaches `main` unchanged. The merge commit adds the maintainer's certification for the rest.
- **Simpler.** The workflow writes the sign-off lines and nothing else; it no longer rebuilds a message from the commits.
- **The certification stays.** As in ADR-0011, every change from a bot or an agent reaches `main` with a named maintainer's `Signed-off-by`, now in the merge commit that brings it in.

## Consequences

- `main` holds every commit of every pull request, including small fixes made during review. `git log --first-parent main` shows one line per pull request. Every commit must follow Conventional Commits, as `CONTRIBUTING.md` already asks, and a check (`Commit messages`) enforces it, apart from merges made by git or GitHub.
- A commit without its author's sign-off can now be on `main`. It is covered by the `Signed-off-by` line in the merge commit that brought it in, and the DCO check let it through only because a listed maintainer approved that exact head with `/signoff`. To check a commit's certification, look at its own trailers, then at the merge commit that brought it into `main`: the oldest merge on `main`'s own line that contains it, `git log --first-parent --ancestry-path --merges --reverse --format='%h %s' <commit>..main | head -n 1`.
- To undo a pull request, revert its merge commit, keeping `main`'s side: `git revert -m 1 <merge-commit>`.
- The default branch must allow merge commits, so it cannot require a linear history.
- A maintainer can withdraw their sign-off in the moment between the workflow reading the reviews and GitHub merging, because GitHub cannot make a merge depend on a particular review. A branch rule that requires an approving review stops the merge only when that was the last approval. The workflow therefore reads the sign-offs again after the merge and fails, naming the maintainer, if one was withdrawn in that moment, so that the maintainers can decide whether to revert.
- Pull requests that change `.github/workflows/` are still signed off in a terminal and merged by hand, now with a merge commit.

### Sovereignty impact

1. **Runs anywhere you choose.** No impact.
2. **No phone-home.** No impact.
3. **Model-agnostic.** No impact.
4. **Open standards.** No impact. The DCO and the `Signed-off-by` trailer stay as they are.
5. **Your data stays yours.** No impact.
6. **Humans decide.** Unchanged. Every change still needs an explicit, recorded certification by a named maintainer on the exact commit they approved.
7. **Transparent supply chain.** Strengthened slightly. The history on `main` keeps every commit as it was reviewed.
8. **Reference deployment on European infrastructure.** No impact.

## More information

- How to check that the decision is followed: every merge commit on `main` from a pull request opened by the bot carries a `Signed-off-by` line of a listed maintainer, and every commit it brings in either carries its author's sign-off or none at all.
