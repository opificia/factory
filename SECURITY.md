# Security policy

This policy explains how to report a vulnerability in Opificia AI and what you can expect from us.

## Supported versions

There are no releases yet. Report anything you find on the `main` branch.

Once we publish releases, this section will list which versions receive security fixes. See [`docs/community/release-policy.md`](docs/community/release-policy.md).

## How to report a vulnerability

**Please do not open public issues, pull requests or Discussions for vulnerabilities.**

Use one of these private channels:

1. **GitHub private vulnerability reporting (preferred).** Go to the [Security tab](https://github.com/opificia/factory/security) of this repository and choose "Report a vulnerability". Only the maintainers can see your report.
2. **Email** <security@opificia.ai>.

A PGP key for encrypted email will be published here. Until then, use GitHub private vulnerability reporting if you need the report to stay encrypted in transit and at rest on our side.

## What to include

A good report helps us act quickly. Please include:

- The affected component, file or commit.
- What an attacker can do, and under which conditions.
- Steps to reproduce, or a proof of concept. Keep it minimal.
- How you found it, if relevant (for example, a tool or a review).
- Whether you want to be credited in the advisory, and under which name.

If you are not sure whether something is a vulnerability, report it privately anyway.

## What to expect

These are targets, not guarantees. The project is small, and we will tell you if we fall behind.

| Step | Target |
| --- | --- |
| Acknowledgement of your report | within 5 working days |
| Initial assessment (valid or not, and severity) | within 10 working days |
| Coordinated disclosure | 90 days after the report, by default |

We keep you informed while we work on a fix. We may agree with you on a shorter or longer disclosure period, for example if a fix is ready early, or if the issue is actively exploited. If we cannot reach agreement, the 90-day default applies.

## How we publish advisories

We publish advisories through [GitHub Security Advisories](https://github.com/opificia/factory/security/advisories) for this repository. Where it applies, we request a CVE ID (a public identifier for the vulnerability) through GitHub, which is a CVE Numbering Authority. Advisories credit the reporter unless you ask us not to.

## Scope

Opificia is a platform where AI agents read tickets, run code and open pull requests. That gives it a broader attack surface than most developer tools. All of these are in scope:

- **Sandbox escapes**: an agent or the code it runs getting access beyond what its sandbox should allow, such as the host, the network or other tenants.
- **Prompt injection** that leads to code execution, data leaks, privilege changes or actions the operator did not approve. Content in a ticket, repository, dependency or web page that makes an agent misbehave counts.
- **Credential exposure**: tokens, keys or secrets leaking into logs, prompts, model providers, pull requests or anywhere else they should not go.
- **Supply-chain issues**: compromised or confused dependencies, build or release tampering, and weaknesses in this repository's workflows.
- **Bypassing human approval**: any way to merge or deploy without the approvals the operator configured.

Out of scope:

- Vulnerabilities in third-party services or models that Opificia does not control. Please report those to their owners. If Opificia makes such a vulnerability worse, that part is in scope.
- Reports from automated scanners with no demonstrated impact.
- Social engineering of maintainers, and physical attacks.

## Safe harbour

We will not take legal action against you, or ask anyone else to, for security research that:

- is done in good faith to find and report vulnerabilities in Opificia;
- avoids privacy violations, data destruction and interruption or degradation of services;
- uses only your own accounts and test data, or accounts whose owner has given explicit permission;
- stops once you have demonstrated the issue, and does not access more data than needed to do so; and
- gives us reasonable time to fix the issue before you disclose it, as described above.

If you are unsure whether your research is covered, ask us first through one of the private channels above. This safe harbour covers the Opificia project only. It cannot authorise testing of systems that other people operate, including other people's Opificia installations.

## Regulation

Experience Lab BV intends to meet the vulnerability-handling expectations of the EU Cyber Resilience Act for its commercial offerings.
