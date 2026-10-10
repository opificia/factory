# Governance

This document describes how Opificia AI is run: who can do what, how decisions are made, and how that can change.

Opificia is in its founding phase. It is led by a steward, with an open path for contributors to become maintainers. We intend to move the project to a vendor-neutral foundation later (see the last section).

## Roles

| Role | Who | Can |
| --- | --- | --- |
| **User** | Anyone who uses Opificia. | Use it, ask questions, report bugs, propose ideas. |
| **Contributor** | Anyone who has contributed: code, docs, reviews, translations, triage. | Everything a user can, plus open pull requests and comment on RFCs. |
| **Committer** | A contributor with triage rights, granted by the maintainers. | Label and triage issues, review pull requests. Their approval counts as a review, but merging needs a maintainer. |
| **Maintainer** | A committer elected by the maintainers. Listed in [`MAINTAINERS.md`](MAINTAINERS.md). | Merge pull requests, cut releases, vote on decisions, accept RFCs. |
| **Steward** | {{STEWARD_ENTITY}}, the legal entity that stewards the project. | Hold the trademark and project accounts, appoint the first maintainers, break ties during the founding phase. |

The **steering team** is the subset of maintainers who own policy files (licences, governance, sovereignty commitments, trademarks). During the founding phase it consists of the steward's representatives and any maintainers they invite. Changes to those files need a steering team approval.

## How decisions are made

### Lazy consensus for normal changes

Most changes, such as fixes, documentation and small features, are decided by lazy consensus: a pull request that has the required approvals and no unresolved objections can be merged. Silence means consent. An objection must give a reason and, where possible, an alternative.

### RFCs for significant changes

Significant changes need an RFC (request for comments, a written proposal). That includes new components, new runtime dependencies, changes to public interfaces, and any change that affects a commitment in [`SOVEREIGNTY.md`](SOVEREIGNTY.md). [`docs/rfcs/README.md`](docs/rfcs/README.md) describes the process.

An RFC is open for comments for at least **14 days**. After that, the maintainers accept it if there is consensus. Accepted decisions about architecture are recorded as ADRs (architecture decision records) in [`docs/adr/`](docs/adr/README.md).

### Maintainer vote as a fallback

If consensus cannot be reached, any maintainer can call a vote. The vote stays open for at least 7 days. A **simple majority** of the votes cast decides. During the founding phase, the steward breaks a tie.

### Changes to policy files

Changes to `LICENSE`, `LICENSES/`, `REUSE.toml`, `GOVERNANCE.md`, `SOVEREIGNTY.md` and `TRADEMARKS.md` need an RFC and the approval of the steering team.

## Becoming a committer or maintainer

We want more maintainers, from more organisations. The path is:

1. **Sustained contributions.** Over several months, contribute in ways that show good judgement: code, reviews, documentation, triage or community work all count.
2. **Nomination.** Any maintainer can nominate a contributor, with a short written case. You may ask a maintainer to nominate you.
3. **Vote.** The maintainers vote within 14 days. A nominee becomes a maintainer with a simple majority and no veto from the steering team. A veto must be explained in writing to the nominee.

Committer rights follow the same path with a lighter bar: a nomination and approval by two maintainers.

New maintainers are added to [`MAINTAINERS.md`](MAINTAINERS.md) and the `maintainers` team. [`docs/community/maintainer-guide.md`](docs/community/maintainer-guide.md) describes what we expect from them.

## Inactivity and emeritus status

A maintainer who has not reviewed, merged or commented for **six months** is asked whether they want to continue. If they do not reply within a month, or say no, they become **emeritus**. Emeritus maintainers keep their place in `MAINTAINERS.md`, in a separate section, but lose merge rights and votes. They can return through a simple vote, without a new nomination.

Any maintainer can step down to emeritus at any time.

## Conflicts of interest

Maintainers disclose who employs or pays them for their work on Opificia, in [`MAINTAINERS.md`](MAINTAINERS.md). They update it when that changes.

A maintainer with a conflict of interest in a decision, for example because their employer benefits directly, says so before the decision and does not cast the deciding vote.

We aim for no single organisation to hold a majority of maintainer seats once the project has more than three maintainers. While that is not yet possible, decisions by that organisation's maintainers alone are still open to objection by any contributor.

## Changing this document

This document can change through an RFC with a 14-day comment period, followed by approval by a two-thirds majority of the maintainers and by the steering team. Editorial fixes that do not change meaning follow the normal pull request process.

## Foundation intention

The project intends to move to a vendor-neutral foundation, for example the Eclipse Foundation, which is headquartered in Brussels. We intend to do so once the project has independent maintainers and more than one contributing organisation. There is no date. When we move, the trademark, project accounts and governance will transfer to the foundation, and this document will be replaced by the foundation's governance model.
