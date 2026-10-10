# Triage

Triage is the work of sorting new issues and pull requests so that they reach the right person. This page explains what the labels in Opificia AI mean and how fast we aim to respond.

Anyone can help with triage by reproducing bugs, asking for missing information or pointing to duplicates. Committers and maintainers apply the labels.

## Labels

Labels are defined in [`.github/labels.yml`](../../.github/labels.yml) and synced to the repository automatically. Change them there, not in the GitHub interface.

### Type

Every issue and pull request gets exactly one type label.

| Label | Meaning |
| --- | --- |
| `type/bug` | Something does not work as documented. |
| `type/feature` | A new capability or an improvement. |
| `type/docs` | Documentation only. |
| `type/chore` | Maintenance: tooling, CI, repository settings. |

### Area

Area labels say which part of the project is affected. There can be more than one. The list will grow with the architecture; until then, `area/core` and `area/sdk` are placeholders.

| Label | Meaning |
| --- | --- |
| `area/governance` | Governance, policies and community processes. |
| `area/ci` | Workflows and repository hygiene checks. |
| `area/brand` | Name, logo and trademark use. |
| `area/core` | The core platform. |
| `area/sdk` | The SDK and plugin interfaces. |

### Status

| Label | Meaning |
| --- | --- |
| `status/triage` | New; a maintainer has not looked at it yet. Issue forms add this label. |
| `status/accepted` | In scope and ready for work. |
| `status/blocked` | Waiting on something else. The blocking reason must be in a comment. |
| `status/needs-rfc` | Too significant for an issue. It needs an [RFC](../rfcs/README.md) first. |

### Other labels

| Label | Meaning |
| --- | --- |
| `good first issue` | Small, well described and suitable for a first contribution. A maintainer must add enough context for a newcomer to start. |
| `help wanted` | Maintainers would welcome a contribution. |
| `security` | Security hardening that can be discussed in public. Vulnerabilities are never handled in public issues; see [`SECURITY.md`](../../SECURITY.md). |
| `sovereignty` | Affects a commitment in [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md). Needs extra care in review. |
| `ai-assisted` | The pull request contains meaningful AI-assisted work, disclosed with an `Assisted-by` trailer. For transparency, not a judgement. |

## The triage routine

For each new item with `status/triage`:

1. **Check it belongs here.** Questions go to Discussions; vulnerabilities go to private reporting. Move or close with a polite pointer.
2. **Check it is complete.** Ask for missing information. If there is no reply after 30 days, close it; it can be reopened.
3. **Check for duplicates.** Close duplicates with a link to the original.
4. **Label it.** Add a type label, area labels, and `sovereignty` if relevant.
5. **Decide.** Replace `status/triage` with `status/accepted`, `status/needs-rfc` or `status/blocked`, or close the item with a reason.

## Response-time goals

These are goals, not promises. Most maintainers volunteer their time.

| Item | First response | Decision or review |
| --- | --- | --- |
| New issue | within 5 working days | triage complete within 10 working days |
| New pull request | within 5 working days | first review within 10 working days |
| RFC | within 5 working days | decision after the 14-day comment period |
| Discussion question | best effort | best effort |
| Vulnerability report | see [`SECURITY.md`](../../SECURITY.md) | see `SECURITY.md` |

If an item has waited longer than these goals, add a comment to bring it back to our attention.
