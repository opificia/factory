# Architecture decision records

An architecture decision record (ADR) is a short document that records one significant decision about Opificia AI: what was decided, why, and what follows from it. Together, the ADRs explain why Opificia is built the way it is.

We use the MADR format (Markdown Architectural Decision Records), in a slightly shortened form.

## When to write an ADR

Write an ADR when a decision:

- is hard or expensive to reverse, such as a language, a storage engine or a public interface;
- adds a dependency (a package, a GitHub Action, a container image or an external service);
- affects a commitment in [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md); or
- settles a question that people keep asking.

Large or contested decisions start as an [RFC](../rfcs/README.md). Once the RFC is accepted, record the outcome as an ADR. Small, clear decisions can go straight to an ADR in a pull request.

## How to write one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md`, using the next free number.
2. Fill in the sections. Keep it short: one to two pages is usually enough.
3. Set the status to `proposed` and open a pull request.
4. When the pull request is merged with the maintainers' approval, set the status to `accepted`.

ADRs are not edited after acceptance, apart from typos and links. To change a decision, write a new ADR that supersedes the old one, and set the old one's status to `superseded by ADR-NNNN`.

## Statuses

| Status | Meaning |
| --- | --- |
| `proposed` | Under discussion. |
| `accepted` | Decided. The code and documentation follow it. |
| `rejected` | Considered and not adopted. Kept for the record. |
| `deprecated` | No longer relevant, without a replacement. |
| `superseded by ADR-NNNN` | Replaced by a later decision. |

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| [0002](0002-licensing-model.md) | Licensing model | accepted |
| [0003](0003-host-the-website-on-scaleway.md) | Host the website on Scaleway | accepted |
| [0004](0004-target-architecture.md) | Target architecture, with Claude Code as the first harness | accepted |
| [0005](0005-prototype-stack.md) | Prototype stack | accepted |
| [0006](0006-sign-off-by-approval.md) | Sign off by approval | superseded by [ADR-0011](0011-sign-off-at-the-merge.md) |
| [0007](0007-sandbox-network-policy.md) | Sandbox network policy, with a decision model for unknown hosts | accepted |
| [0008](0008-render-markdown-with-streamdown.md) | Render Markdown in the web app with Streamdown | accepted |
| [0009](0009-let-agents-see-the-web-app.md) | Let agents see the web app, with a fixture mode and a browser in the sandbox | accepted |
| [0010](0010-run-on-kubernetes.md) | Run Opificia on any Kubernetes cluster, with sandboxes that scale with the work | proposed |
| [0011](0011-sign-off-at-the-merge.md) | Sign off at the merge | superseded by [ADR-0012](0012-merge-with-merge-commits.md) |
| [0012](0012-merge-with-merge-commits.md) | Merge with merge commits, signed off in the merge commit | accepted |
