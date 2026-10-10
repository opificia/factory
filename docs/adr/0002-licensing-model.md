# ADR-0002: Licensing model

- **Status:** proposed
- **Date:** 2026-10-11
- **Deciders:** the steering team
- **Related:** [`REUSE.toml`](../../REUSE.toml), [`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`TRADEMARKS.md`](../../TRADEMARKS.md)

## Context

Opificia AI needs a licensing model before the first line of code is written, because changing licences later requires the agreement of every copyright holder.

The model has to serve several goals at once:

- **Auditability and exit.** Organisations, especially in the public sector, must be able to read, audit, fork and run the software without asking anyone.
- **Reciprocity.** Opificia is the kind of software that is often offered as a hosted service. If someone improves the core and runs it as a service, those improvements should flow back to everyone.
- **Easy extension.** Plugins, integrations and SDK users should not face strong copyleft obligations, or the ecosystem will not grow.
- **Low friction for contributors.** Contributing should not require signing a legal agreement or giving up copyright.
- **Clarity.** Every file must have a clear, machine-readable licence.

## Considered options

1. **AGPL-3.0-only core, Apache-2.0 extensions, CC-BY-4.0 docs, DCO.**
2. **Apache-2.0 everywhere, DCO.** Permissive throughout.
3. **Source-available licences (BSL, FSL).** Code is visible, but commercial use is restricted for a period.
4. **Any of the above with a CLA** (contributor licence agreement) instead of the DCO.

## Decision

We choose option 1:

| Part | Licence |
| --- | --- |
| The core (everything not listed below) | AGPL-3.0-only |
| `sdk/`, `plugins/`, `examples/` | Apache-2.0 |
| Documentation in `docs/` | CC-BY-4.0 |
| Configuration and templates | CC0-1.0 |
| Logos in `brand/` | Not open source; covered by [`TRADEMARKS.md`](../../TRADEMARKS.md) |

Contributions are accepted under the Developer Certificate of Origin (DCO): contributors sign off each commit, keep their copyright, and license their work under the licence of the folder they change (inbound equals outbound). [`REUSE.toml`](../../REUSE.toml) records the licence of every file, following the REUSE specification, and a CI check enforces it.

### Reasons

- **You can audit and fork.** AGPL-3.0 is an OSI-approved open-source licence. Anyone can read, run, modify and redistribute the core.
- **Modified hosted versions must share their changes.** The AGPL's network clause (section 13) means that anyone who runs a modified core as a service for others must offer those users the modified source. Without it, a provider could take the core, improve it privately and offer it as a closed service.
- **Extensions stay easy to adopt.** Apache-2.0 for the SDK, plugins and examples lets companies build proprietary or differently licensed extensions without AGPL obligations, and includes an explicit patent grant.
- **"Only", not "or later".** AGPL-3.0-only means a future licence version cannot apply without a deliberate decision by the project.
- **The DCO is lighter than a CLA.** It needs no paperwork, keeps copyright with contributors, and does not concentrate rights in one company, which matters for a project that intends to move to a neutral foundation.

## Rejected options

- **Apache-2.0 everywhere** would maximise adoption, but it lets hosted providers keep improvements to the core private. It remains the main alternative if adoption speed turns out to matter more than reciprocity.
- **BSL, FSL and similar** are not open-source licences under the Open Source Definition. They would conflict with the project's purpose, and many public-sector buyers cannot treat such software as open source.
- **A CLA** would let the steward relicense contributions, for example to sell a commercial licence. It also adds friction and asks contributors to trust one company. We reject it for now; see the open question below.

## Consequences

- Companies that run a modified core as a service must publish their changes. Some companies avoid AGPL software as a policy; this may slow adoption in those places.
- Because there is no CLA, the core cannot be relicensed or dual-licensed later without the agreement of every contributor whose code is affected.
- Contributors must sign off every commit. A CI check enforces this.
- The boundary between core and extensions must stay clear in the code. Extension interfaces will need careful design, so that plugins are not derivative works of the core in a way that defeats the purpose of Apache-2.0 for extensions. This needs a separate ADR once the architecture exists.
- The code of conduct is adapted from the Contributor Covenant 3.0 and therefore stays under CC-BY-SA-4.0.

### Sovereignty impact

Supports commitment 1 (runs anywhere you choose): the licence gives everyone the right to self-host and fork. Supports commitment 4 (open standards): all licences are standard SPDX-listed licences. No negative impact on the other commitments. As [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md) notes, the licence does not restrict who may use the software.

## Open question: dual licensing

Should the steward be able to offer the core under a commercial licence as well as the AGPL, for organisations that cannot accept AGPL terms? That would require a CLA from the start, or the agreement of every contributor later. This ADR does not decide the question. If the project wants to keep that option, it must decide before outside contributions to the core begin, and record the outcome in a new ADR.

## More information

- AGPL-3.0: [`LICENSES/AGPL-3.0-only.txt`](../../LICENSES/AGPL-3.0-only.txt), from <https://www.gnu.org/licenses/agpl-3.0.txt>
- Apache-2.0: [`LICENSES/Apache-2.0.txt`](../../LICENSES/Apache-2.0.txt)
- REUSE specification: <https://reuse.software/spec-3.3/>
- Developer Certificate of Origin: <https://developercertificate.org/>
