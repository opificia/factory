# Sovereignty commitments

Opificia AI is meant to be software that European organisations can run without depending on anyone else's infrastructure, models or permission. This document turns that aim into design commitments: rules that the code will be held to, and that you can test.

Each commitment is **proposed until an ADR accepts it**. ADRs (architecture decision records) live in [`docs/adr/`](docs/adr/README.md). Every RFC must state how it affects each commitment (see the [RFC template](docs/rfcs/0000-template.md)).

## What we mean by sovereignty

Sovereignty is about control, not about labels. For any installation of Opificia, you should be able to answer three questions:

1. **Where does it run?** On which machines, in which country, operated by whom.
2. **Who holds the keys?** Who can read the code, prompts, logs and credentials it handles.
3. **Under which law?** Which jurisdiction the operator, the hosting provider and the model provider answer to.

The commitments below make sure that you, the operator, decide the answers.

## The commitments

### 1. Runs anywhere you choose

*Status: proposed until ADR accepted.*

Opificia is fully self-hostable, including in air-gapped environments (networks with no connection to the internet). No feature may require a service hosted by the project, the steward or any other vendor.

How we test it: the full feature set works in an installation with no outbound internet access, given local models and local repositories.

### 2. No phone-home

*Status: proposed until ADR accepted.*

Opificia does not contact the project or any vendor on its own. Telemetry is off by default and opt-in only. When an operator turns it on, it is sent only to an endpoint the operator configures. Update checks, if they exist, follow the same rule.

How we test it: a default installation makes no network connections other than to endpoints the operator has configured.

### 3. Model-agnostic

*Status: proposed until ADR accepted.*

Opificia talks to models through an open, documented interface. Any model that implements it can be used. Open-weight models are first-class: they are tested, documented and supported to the same level as hosted models. There is no hard dependency on a single model provider.

How we test it: the reference test suite passes with at least one open-weight model running locally.

### 4. Open standards

*Status: proposed until ADR accepted.*

Where a choice exists, Opificia uses open protocols and formats rather than proprietary ones: for repositories, tickets, identity, configuration, logs and model access. Proprietary integrations may exist as plugins, never as requirements.

How we test it: every external interface in the core is documented and based on an openly published specification.

### 5. Your data stays yours

*Status: proposed until ADR accepted.*

Code, prompts, model outputs, logs and traces are stored only where the operator configures. Opificia does not send them anywhere else. The project does not train models on data from Opificia installations, and does not collect such data.

How we test it: storage and outbound destinations are listed in configuration, and nothing is written or sent outside them.

### 6. Humans decide

*Status: proposed until ADR accepted.*

By default, nothing is merged or deployed without approval from a person. Operators can change this, but only explicitly, in configuration, and the change is recorded in the audit log.

How we test it: in a default installation, no agent can merge a pull request or trigger a deployment without a recorded human approval.

### 7. Transparent supply chain

*Status: proposed until ADR accepted.*

For the first release, we aim to publish an SBOM (software bill of materials, a list of every component in a build) with every release, to sign releases, and to make builds reproducible, so that anyone can check that a release matches its source.

How we test it: release artefacts come with an SBOM and a signature, and an independent rebuild produces the same artefacts.

### 8. Reference deployment on European infrastructure

*Status: proposed until ADR accepted.*

The project's official reference deployment, and any managed offering run by the steward, runs on infrastructure from providers headquartered in Europe. This applies to what the project and steward run themselves. It places no restriction on where you run Opificia.

How we test it: the providers used for the reference deployment are listed publicly, with their country of headquarters.

## What sovereignty does not mean here

- **The licence does not restrict who may use the software.** Open-source licences cannot discriminate between users or fields of use, and we do not want them to. Anyone, anywhere, may use Opificia under its licence.
- **Sovereignty comes from operation, not from the code alone.** It depends on who operates an installation, where, and under which law. Opificia aims to make a sovereign setup possible and practical. It cannot make a given installation sovereign by itself.
- **It is not a certification.** These commitments describe how we build the software. They are not a legal or regulatory assessment of any installation.
- **It does not restrict which tools we use to build Opificia.** See [How we build Opificia](#how-we-build-opificia) below.

## How we build Opificia

*Status: proposed until ADR accepted.*

We write Opificia with help from AI coding tools. Some of these are frontier models from American providers: among the strongest closed models available today. We say this openly because some readers will want to know.

Our commitments apply to the software you run, not to the tools we use to write it. Three rules keep that true:

- **No tool is required.** No part of Opificia may require a specific AI tool or provider to build, run or operate it.
- **AI help is recorded.** Every commit with meaningful AI help names the tool in an `Assisted-by` trailer, so the record is public in the git history. See [`CONTRIBUTING.md`](CONTRIBUTING.md#ai-assisted-contributions).
- **Confidential material stays out.** We do not send embargoed vulnerability reports, secrets and credentials, or anything people share with the project in confidence to third-party AI services.

We intend to move our own work onto Opificia as it matures. See [`ROADMAP.md`](ROADMAP.md#phase-2-hardening).

## Changing these commitments

Adding, removing or weakening a commitment needs an RFC and the approval of the steering team, as described in [`GOVERNANCE.md`](GOVERNANCE.md).
