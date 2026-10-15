# Changelog

All notable changes to Opificia AI are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases will follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). There are no releases yet.

## [Unreleased]

### Added

- Repository foundations: licences and REUSE mapping, contribution guide with DCO sign-off, code of conduct, security policy, governance, trademark policy and sovereignty commitments.
- ADR and RFC templates, and the first two ADRs.
- Issue, pull request and discussion templates.
- Repository hygiene checks in one `Checks` workflow with parallel jobs (REUSE, DCO, Markdown style, links, pull request titles), plus OpenSSF Scorecard and label sync.
- A first static website in `website/`, with self-hosted fonts and no scripts or third-party requests, deployed to Scaleway by the `Website` workflow.
- ADR-0004 on the target architecture and ADR-0005 on the prototype stack.
- A first prototype of the loop, from a labelled GitHub issue to a pull request: a NestJS server with an event-sourced run lifecycle, a web app for plans and approvals, the runner protocol (version 0), the `claude` harness in a network-isolated sandbox, and deterministic checks before every push. See `docs/prototype.md`.

[Unreleased]: https://github.com/opificia/factory/commits/main
