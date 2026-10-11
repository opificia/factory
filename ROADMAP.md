# Roadmap

This roadmap describes the phases Opificia AI will go through on the way to a first release. It lists phases, not dates. We will add dates only when we can keep them.

A project board with the detailed work for each phase will be linked here once it exists.

## Phase 0: foundations

*Status: in progress.*

Set up the repository so that contributors, companies and public-sector buyers can trust it before any product code exists.

- Licences, REUSE mapping and contributor sign-off (DCO).
- Code of conduct, security policy, governance and trademark policy.
- Sovereignty commitments, proposed as testable rules.
- Templates for issues, pull requests, ADRs and RFCs.
- Repository hygiene checks in CI.

Done when: the policies are merged and the first maintainers are named.

## Phase 1: a first working loop

Build the smallest version of the factory that works end to end: one agent takes one ticket, writes a change in a sandbox, runs the tests and opens a pull request that a human reviews.

- RFCs and ADRs for the core architecture, the model interface and the sandbox.
- A first choice of language and runtime, recorded in an ADR.
- The loop running fully self-hosted, with at least one open-weight model.

Done when: someone outside the core team can run the loop on their own machine from the documentation.

## Phase 2: hardening

Make the loop dependable and safe to run on real code.

- Sandbox isolation, credential handling and audit logging.
- Defences against prompt injection, tested against known attacks.
- Tests that check each sovereignty commitment.
- Plugin and SDK interfaces, under Apache-2.0.
- A security review of the design.
- **Opificia builds Opificia.** Once the loop works, we use it on our own tickets, running on open-weight models hosted in Europe. We publish how this compares with the AI tools we use today. We aim to do most of our own work on Opificia by the first release. See [How we build Opificia](SOVEREIGNTY.md#how-we-build-opificia).

Done when: the sovereignty commitments are accepted as ADRs and each one has an automated test.

## Phase 3: first release

Publish a first release that people can install and evaluate.

- Signed releases with an SBOM (software bill of materials).
- Work towards reproducible builds.
- Installation and operations documentation.
- A release and support policy (see [`docs/community/release-policy.md`](docs/community/release-policy.md)).
- A reference deployment on infrastructure from providers headquartered in Europe.
- Most project work runs on Opificia itself, and the comparison from phase 2 is public.

Done when: version 0.1.0 is tagged, signed and documented.

## After the first release

Directions we expect to explore, in no fixed order: more agent roles, more forges and ticket systems, multi-tenant operation, and moving the project to a neutral foundation. Proposals are welcome as RFCs.
