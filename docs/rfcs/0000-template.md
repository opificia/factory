# RFC-NNNN: Short title

- **Status:** draft
- **Author(s):** name or handle
- **Created:** YYYY-MM-DD
- **Comment period ends:** YYYY-MM-DD (at least 14 days after it starts)
- **Discussion:** link to the Discussion or pull request

## Summary

One paragraph explaining the proposal.

## Motivation

Why are we doing this? What problem does it solve, for whom? What happens if we do nothing?

## Design

Explain the proposal in enough detail that someone familiar with Opificia AI could implement it. Cover:

- how it works, with examples;
- interfaces and configuration it adds or changes;
- how it interacts with existing parts of the system;
- security considerations, including new attack surface such as prompt injection paths, credentials and sandbox boundaries;
- new dependencies, with their licences; and
- how it will be tested.

## Alternatives

What other designs did you consider, and why did you not choose them? What is the cost of not doing this at all?

## Sovereignty impact

Check the proposal against each commitment in [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md). For each one, write "no impact", or explain the impact and how the design keeps the commitment.

| Commitment | Impact |
| --- | --- |
| 1. Runs anywhere you choose (self-hostable, air-gap capable) | |
| 2. No phone-home (telemetry off by default, operator-configured endpoint) | |
| 3. Model-agnostic (open interface, open-weight models first-class) | |
| 4. Open standards | |
| 5. Your data stays yours | |
| 6. Humans decide (human approval before merge or deploy) | |
| 7. Transparent supply chain (SBOMs, signed releases, reproducible builds) | |
| 8. Reference deployment on European infrastructure | |

If the proposal weakens a commitment, say so clearly. That requires the approval of the steering team.

## Unresolved questions

What needs to be settled during the comment period? What is deliberately left for later?
