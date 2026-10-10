# ADR-0001: Record architecture decisions

- **Status:** accepted
- **Date:** 2026-10-11
- **Deciders:** the project steward
- **Related:** [ADR README](README.md)

## Context

Opificia AI is meant to be a long-lived open-source project, with contributors from many organisations who will join at different times. Decisions about architecture, dependencies and policy will be made over years. Without a record, new contributors cannot tell why something is the way it is, and the same questions get debated again.

Public-sector and enterprise users also need to audit how the software was designed, for example to check it against the commitments in [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md).

## Considered options

1. Record decisions as ADRs in the repository, in Markdown.
2. Record decisions in a wiki.
3. Rely on issues, pull requests and Discussions.

## Decision

We record significant decisions as architecture decision records (ADRs) in `docs/adr/`, using a shortened MADR format (see [`0000-template.md`](0000-template.md)).

ADRs live next to the code, are reviewed in pull requests like any other change, are versioned with the code, and are available in every copy and mirror of the repository, including offline ones. A wiki is separate from the repository and is not mirrored with it. Issues and pull requests hold the discussion, but not a readable summary of the outcome.

## Consequences

- Significant decisions take a little more effort: someone must write the ADR.
- Newcomers have one place to read why the project is built the way it is.
- ADRs are immutable once accepted. Changing a decision means writing a new ADR, which keeps the history readable.
- Large or contested decisions first go through an [RFC](../rfcs/README.md); the ADR records the outcome.

### Sovereignty impact

Positive for commitment 4 (open standards): decisions are stored as plain Markdown in the repository, with no dependency on a hosted wiki. No impact on the other commitments.

## More information

- Michael Nygard, "Documenting architecture decisions" (2011): <https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>
- MADR: <https://adr.github.io/madr/>
