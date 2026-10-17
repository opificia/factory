# ADR-0011: Sign off at the merge

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Supersedes:** [ADR-0006](0006-sign-off-by-approval.md)
- **Related:** [`CONTRIBUTING.md`](../../CONTRIBUTING.md#sign-off-at-the-merge), [`AGENTS.md`](../../AGENTS.md) rule 1, [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md) commitment 6

## Context

[ADR-0006](0006-sign-off-by-approval.md) lets a maintainer sign off a pull request by approving it with `/signoff`. A workflow then rebases the branch with `--signoff` and force-pushes it. That removed the terminal from the loop, but two costs remain now that Opificia writes most of its own pull requests:

- **Rewritten branches break stacked pull requests.** The rebase gives every commit a new hash. A pull request built on top of the signed-off one then conflicts and has to be rebased again. This happened with #45 and #46 on the day this ADR was written.
- **Two steps per pull request.** The maintainer approves with `/signoff`, waits for the push and the checks, and then merges.

We considered dropping the sign-off now that pull requests also get an AI review. We do not, because the two do different things. An AI review checks the change. The sign-off is a person certifying the Developer Certificate of Origin: that the project may accept the change under its licence. Neither an AI reviewer nor the agent that wrote the change can give that certification. Dropping it would also weaken commitment 6, "Humans decide".

The repository merges by squash only. Every change on `main` is one squash commit, and that commit is the record that lasts.

## Considered options

1. **Keep ADR-0006.**
2. **Drop the sign-off** and rely on the review.
3. **Sign off at the merge.** The approval with `/signoff` is the sign-off. A workflow squash-merges the approved commit, with the maintainer's `Signed-off-by` line in the squash commit. The branch is never rewritten.

## Decision

We choose option 3.

1. A maintainer reviews the pull request and submits an approving review with a line that reads `/signoff`, as before.
2. The DCO check accepts a commit without a sign-off when a maintainer's latest review approves the head of the pull request with `/signoff`, the commit is by that maintainer or by the bot that opened the pull request, and the branch is in this repository. Every maintainer who approved this way signs off in the squash commit. Commits by anyone else still need their author's own sign-off. Anyone can set a commit's author email, so the exception does not hold for forks: a fork could carry commits in a maintainer's name that the maintainer never wrote. Only people with write access can push branches to this repository.
3. The `Sign-off` workflow runs the DCO check again, now that the approval exists. It then squash-merges the pull request through the GitHub API as the Opificia bot, with:
   - the head commit the maintainer approved as the expected head, so GitHub refuses the merge if anyone pushed after the approval;
   - the subjects of the commits, their `Assisted-by` and `Co-authored-by` lines, the sign-offs their authors gave themselves, and the `Signed-off-by` line of every maintainer who approved with `/signoff`, with the name and email address in [`MAINTAINERS.md`](../../MAINTAINERS.md), in the squash commit's message. A `Signed-off-by` line for anyone other than the commit's author is left out, because anyone can type one, and on `main` it would read as that person's certification.
4. The merge waits for the required checks, as any merge does, up to 30 minutes for the re-run DCO check and the merge together. Before each attempt to merge, the workflow reads the reviews again: a maintainer who withdrew their sign-off in the meantime does not sign, one who gave it does, and with no sign-off left nothing is merged.

Option 3 of ADR-0006 was close to this, and ADR-0006 rejected it because the maintainer had to type the sign-off line correctly at the merge, and nothing could check it before. Here the workflow writes the line, from the approval the check already verified.

### Reasons

- **The certification stays.** A named maintainer certifies the exact commit they reviewed, and every squash commit on `main` made from a bot's or an agent's work carries their `Signed-off-by` line.
- **One step.** The approval is the merge. The maintainer does nothing else.
- **No rewritten branches on this path.** Stacked pull requests keep their history, and the workflow force-pushes nothing. The other ways to sign off still rewrite the branch: `git signoff` in a terminal rebases it, for example for pull requests that change workflows.
- **Nothing new to trust.** The workflow still runs from the default branch, still reads the review from the GitHub API, and still uses the bot's token only for the last step.

## Consequences

- The `Signed-off-by` line lives in the squash commit on `main`, not in the commits of the branch. The DCO check on the pull request passes because of the approval, and the squash commit records it.
- A stacked pull request, whose base is another branch, is not merged by its approval. When its base is merged, GitHub moves it onto `main`; the maintainer approves it again then.
- The bot merges pull requests. If branch rules restrict who may merge, the bot must be allowed to.
- A maintainer can withdraw their sign-off in the moment between the workflow reading the reviews and GitHub merging, because GitHub cannot make a merge depend on the reviews. The default branch must therefore require an approving review: GitHub then refuses the merge itself once the approval is withdrawn, by a request for changes or a dismissal.
- Pull requests that change `.github/workflows/` still need a sign-off in a terminal, because the bot's token cannot write workflows. The maintainer merges them by hand.
- The workflow waits up to 30 minutes for the required checks. A pull request whose checks take longer must be approved again, or merged by hand.
- Contributors who sign off their own commits are not affected.

Follow-up work, done with this ADR:

1. Change the DCO check, the `Sign-off` workflow and its script.
2. Update `CONTRIBUTING.md`, `AGENTS.md` rule 1 (with the same meaning: agents never sign off), and the references to ADR-0006.
3. Set ADR-0006's status to superseded.

### Sovereignty impact

1. **Runs anywhere you choose.** No impact. This concerns how we accept contributions, not the software.
2. **No phone-home.** No impact.
3. **Model-agnostic.** No impact.
4. **Open standards.** No impact. The DCO and the `Signed-off-by` trailer stay as they are.
5. **Your data stays yours.** No impact.
6. **Humans decide.** Unchanged. Every change still needs an explicit, recorded certification by a named maintainer, on the exact commit they approved.
7. **Transparent supply chain.** No impact. The record of who certified each change stays in the git history of `main`.
8. **Reference deployment on European infrastructure.** No impact.

## More information

- Developer Certificate of Origin, version 1.1: <https://developercertificate.org/>
- How to check that the decision is followed: every squash commit on `main` from a pull request opened by the bot carries a `Signed-off-by` line of a listed maintainer, and that maintainer approved the pull request with `/signoff` on the commit that was merged.
