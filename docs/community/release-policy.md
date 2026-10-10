# Release policy

This page describes how Opificia AI will version and publish releases. There are no releases yet; this policy applies from the first one. Parts marked "to be decided" will be settled in an ADR before the first release.

## Versioning

Opificia follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): `MAJOR.MINOR.PATCH`.

- **PATCH** releases contain bug fixes and security fixes only.
- **MINOR** releases add features in a backwards-compatible way.
- **MAJOR** releases may contain breaking changes. Breaking changes are listed in the changelog with migration notes.

Before 1.0.0, minor releases may contain breaking changes. We will still list them clearly.

What counts as the public interface (APIs, configuration formats, the plugin interface, command-line options) will be defined in an ADR before the first release.

## Release process

1. Update [`CHANGELOG.md`](../../CHANGELOG.md): move entries from `Unreleased` into a new version section, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
2. Create a **signed tag** `vMAJOR.MINOR.PATCH` on `main`, signed with a maintainer's GPG or SSH key, or with Sigstore keyless signing.
3. Publish the release notes, crediting the contributors to the release.
4. Publish release artefacts with checksums.

For the first release, we aim to add:

- an SBOM (software bill of materials) for each artefact;
- signatures on every artefact, verifiable without trusting the forge; and
- reproducible builds, so that anyone can rebuild an artefact and get the same result.

These goals come from commitment 7 in [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md).

## Support window

*To be decided.* We will state how long each release line receives bug fixes and security fixes before the first release. Until then, only the latest release, and `main`, are supported.

## Security releases

Security fixes are released as patch releases, together with a GitHub Security Advisory. See [`SECURITY.md`](../../SECURITY.md).

## Release cadence

*To be decided.* We do not promise a fixed schedule before the first release.
