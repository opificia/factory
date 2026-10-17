# Maintainer guide

This guide is for maintainers and committers of Opificia AI. It explains how we review, merge and label. [`GOVERNANCE.md`](../../GOVERNANCE.md) describes the roles themselves.

## What we expect from maintainers

- Review pull requests and answer issues in your areas, within the goals in [`triage.md`](triage.md).
- Follow and enforce the [Code of Conduct](../../CODE_OF_CONDUCT.md), including in your own behaviour.
- Keep your affiliation in [`MAINTAINERS.md`](../../MAINTAINERS.md) up to date, and declare conflicts of interest.
- Use two-factor authentication on your forge accounts, and sign your commits.
- Tell the other maintainers when you will be away for more than a few weeks.

## Reviewing

Review the change, not the person. Be specific about what must change and what is a suggestion; prefix optional comments with "Nit:" or "Optional:".

For every pull request, check:

- **Purpose.** Is the change wanted? Does it need an RFC or an ADR first? If so, label it `status/needs-rfc` and say why.
- **Correctness and tests.** Does it do what it says? Are tests or docs updated?
- **Sovereignty.** Does it affect any commitment in [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md)? Look for new network calls, new external services, telemetry, data stored in new places, and anything that removes a human approval step. If yes, add the `sovereignty` label and make sure the impact is discussed.
- **Security.** New inputs, new permissions, secrets handling, prompt injection paths, workflow changes.
- **Dependencies.** No new dependency without an ADR. Check its licence.
- **Licensing.** The change respects the licence of the folder it touches. Copied code is attributed and compatible.
- **AI assistance.** If the pull request contains meaningful AI-assisted work, it has an `Assisted-by` trailer and the `ai-assisted` label. The human author can explain the change.
- **Style.** Plain language and the conventions in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

Pull requests from automated agents need a human maintainer's approval like any other pull request. Never approve such a pull request without reading the full diff.

## Merging

- All required checks must be green: REUSE, DCO, Markdown, links and the pull request title.
- At least one approval from a code owner. Policy files need an approval from the steering team.
- No unresolved objections. For changes that need an RFC, the RFC process must be complete.
- **Merge commits** only ([ADR-0012](../adr/0012-merge-with-merge-commits.md)). Approve with `/signoff` to let the `Sign-off` workflow merge with your sign-off in the merge commit. Your sign-off covers only commits by you or by the bot that opened the pull request, without any `Signed-off-by` line of their own; every other commit needs its author's own sign-off, or the DCO check stays red. If you merge by hand, for example a pull request that changes workflows, title the merge commit with the pull request's title and number, and add a `Signed-off-by` line for each maintainer who approved with `/signoff` when the branch has commits covered that way.
- Do not merge your own pull request without another maintainer's approval.
- **While the project has one maintainer**, that maintainer may merge their own pull requests without the approvals above, once the required checks pass. GitHub does not let them approve their own pull request, so they merge by hand, as described above. For policy files this holds only while they also represent the steward on the steering team. Any contributor can still object after the merge ([`GOVERNANCE.md`](../../GOVERNANCE.md)), and a valid objection leads to a revert or a follow-up. The exception ends when a second maintainer joins. Pull requests that someone else opened, including those of the factory's App, still need the maintainer's approval.
- Do not bypass branch protection, except to fix a broken repository, and say so in the pull request.

## Labelling

Labels and their meanings are in [`triage.md`](triage.md). Every issue and pull request should have one `type/*` label and one `status/*` label while open. Add `good first issue` only when the issue explains enough for a newcomer to start.

## Handling security reports

Vulnerability reports arrive through private vulnerability reporting or by email, as described in [`SECURITY.md`](../../SECURITY.md). Do not discuss them in public channels. Work on fixes in a private security advisory fork, and publish the advisory when the fix is released.

## Stepping back

If you can no longer give the project the time it needs, say so. Moving to emeritus status is normal and respected; see [`GOVERNANCE.md`](../../GOVERNANCE.md).
