# ADR-0007: Sandbox network policy, with a decision model for unknown hosts

- **Status:** accepted
- **Date:** 2026-10-15
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [ADR-0004](0004-target-architecture.md), [ADR-0005](0005-prototype-stack.md), [`AGENTS.md`](../../AGENTS.md) rule 5, [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md)

## Context

[ADR-0004](0004-target-architecture.md) says that the sandbox has no network by default, and may reach only the control plane, the gateways and an egress proxy with an allow-list. The prototype goes further: a sandbox reaches only the sandbox gateway, and nothing else resolves.

That keeps the prototype safe, but it stops real work. An agent in the sandbox cannot install dependencies, so it cannot run the tests of most repositories. It cannot read documentation or download a release. A fixed allow-list cannot predict what each repository needs, and asking a person about every new host makes that person the bottleneck of the factory.

The risk of opening the network is smaller than it was when ADR-0004 was written. The sandbox holds no secrets: the model key stays in the gateway, and the forge token stays in the control plane. Four risks remain:

1. **Exfiltration.** An agent steered by a prompt injection sends private code to a host the attacker controls.
2. **Harmful input.** A malicious package or web page ends up in the change. The deterministic checker and the human review of the pull request limit this.
3. **Abuse.** The sandbox is used to attack other hosts, or the operator's own network.
4. **Phone-home.** A tool in the sandbox contacts its vendor (commitment 2).

A decision model can take most of the routine questions away from people. [Clef](https://blog.cloudflare.com/clef-decision-models/) is an open-weight decision model by Cloudflare, released under Apache-2.0 in October 2026. It does not generate text. It takes a state and a set of typed questions, and returns a probability for every allowed answer. Cloudflare uses it to classify website domains, including phishing. [Sference](https://sference.com), a managed inference provider that runs on European GPUs, serves Clef through a decisions API.

## Considered options

1. **A strict allow-list**, as ADR-0004 describes. Unknown hosts are refused.
2. **An open network**, with every request logged.
3. **Network levels per repository**, where unknown hosts are refused and a person can allow them.
4. **Option 3, plus a decision model** that allows or refuses unknown hosts when it is confident, and asks a person when it is not.

## Decision

We choose option 4. Every repository has a network level, and an egress proxy enforces it. For unknown hosts, the proxy asks a decision model first and a person second. The first decision model is Clef, served by Sference.

### Network levels

| Level | The sandbox can reach | Unknown hosts |
| --- | --- | --- |
| `none` | The sandbox gateway only | Refused |
| `registries` (default) | Package registries and source hosts on a built-in list, plus hosts allowed for the repository | Decision model, then a person |
| `open` | Every host not on the deny list, with every request logged | Allowed |

The built-in list covers the common registries (npm, PyPI, crates.io, the Go module proxy, Maven Central, RubyGems, Debian and Ubuntu archives) and the release downloads of the major forges. The operator can change it.

### The egress proxy

The proxy is part of the sandbox gateway in the server, so it adds no new package or image. Sandboxes reach it through `HTTP_PROXY` and `HTTPS_PROXY`. It handles plain HTTP and HTTPS through `CONNECT`, and does not decrypt HTTPS. It therefore sees the host name, the port and the number of bytes in each direction, but not the paths or bodies. Tools that ignore the proxy settings cannot reach anything, because the sandbox network has no other route.

Every request passes three layers, cheapest first:

1. **Fixed rules, which no model can override.**
   - Always refused: private, loopback and link-local addresses after DNS resolution, the cloud metadata address, the Docker host, the control plane apart from the gateway, the telemetry hosts of tools in the sandbox, and a list of known paste sites, request catchers and tunnel services.
   - Always allowed: the built-in list at levels `registries` and `open`, and hosts a person allowed for the repository.
2. **The decision model, for hosts no rule covers.**
3. **A person, when the model is not confident or not configured.**

### The decision model

The proxy sends the model a short, structured state. It holds the host name, the port, the bytes sent so far, whether the repository is public or private, the stage of the run, and earlier decisions for that host. It never sends the issue, the plan, the agent's messages, the repository name or any code. Those can be written by an attacker. Note that a host name can be too, which is one reason why the model only ever answers fixed questions.

The model answers three questions:

| ID | Type | Question |
| --- | --- | --- |
| `category` | choice | What kind of destination is this: package registry, source hosting, documentation, API service, file sharing or paste site, request catcher or tunnel, or unknown? |
| `exfiltration_risk` | score | How likely is a request to this host to send data out: low, medium or high? |
| `safe` | noul | Is it safe to let a coding agent in an isolated sandbox fetch from this host? |

The proxy turns the answers into a decision:

- **Allow** when `safe` is at least the upper threshold, the category is registry, source hosting or documentation, and the risk is low.
- **Refuse** when `safe` is at most the lower threshold, or the category is file sharing, paste site, request catcher or tunnel.
- **Ask a person** in every other case.

The thresholds are settings. We choose their defaults from the evaluation below, not up front.

Further rules:

- **Decisions are cached** per organisation, repository and host. A model decision expires after seven days. A person's decision lasts until someone revokes it.
- **Uploads are capped.** For hosts that the model allowed, the proxy closes a connection that sends more than a set number of bytes, and asks a person. Exfiltration needs outgoing data, so this limits the damage of a wrong answer.
- **The run never waits.** A request that needs a person is refused at once, with a message that names the host. The run page shows the request, and a person can allow the host for the repository with one click. Later requests then pass.
- **The proxy fails closed.** If the model is slow or unavailable (Sference returns 429, 503 or 504, or takes more than two seconds), the host is treated as uncertain. Nothing is allowed because the model could not answer.
- **Every decision is recorded** as a run event, with the probabilities and the layer that decided.

### Shadow mode first

`OPIFICIA_EGRESS_DECIDER=off|shadow|enforce` controls the model, and the default is `shadow`. In shadow mode, the model decides and its decision is recorded, but the fixed rules and people still enforce. We switch to `enforce` only after an evaluation on two sets of requests: normal requests from real runs, and known exfiltration patterns (paste sites, request catchers, look-alike registry domains, long random subdomains, DNS tunnels). People's decisions in shadow mode become part of that data.

### Sference

- **API:** `POST https://api.sference.com/v1/decisions`, with the model `Cloudflare/clef` and a bearer key.
- **Key:** `SFERENCE_API_KEY`. Like the model key, it stays in the control plane and never enters a sandbox. Without a key, the model layer is off and unknown hosts go to a person.
- **Cost:** USD 0.24 per million input tokens, and nothing for output. A decision uses a few hundred tokens, so a decision costs a small fraction of a cent, and the cache keeps the number of decisions low.
- **Company:** Sference is run by Neural Compute Ltd, registered in England and Wales. It states that all inference runs on GPUs in Europe, that it keeps no inputs by default and that it does not train on customer data.
- **Interface:** the proxy calls Sference through a small `DecisionModel` interface in the server. Clef's weights are open, so a self-hosted Clef, or another decision model, can replace Sference without changing the proxy.

### Reasons

- People decide only the uncertain cases, and their decisions are reused. This removes the bottleneck without removing people.
- A model that only scores fixed answers is harder to steer than a chat model, and its answers are easy to check in code.
- The fixed rules, the upload cap and failing closed keep the worst cases out of the model's hands.
- Option 1 blocks the factory. Option 2 leaves private code one prompt injection away from leaking. Option 3 works, but every new host costs a person's time.

## Consequences

- Agents can install dependencies and run tests in the sandbox, for most repositories without anyone's help.
- Sference becomes an optional external service. It receives host names and request metadata, but no code. Operators who use it list it as a sub-processor.
- The proxy cannot see paths or bodies. Decrypting HTTPS with a certificate authority in the sandbox would let it judge more, and would allow caching mirrors of the registries. That needs its own ADR.
- Requests that leave through an allowed registry, for example a package publish, are not checked by the model. The sandbox holds no publishing credentials, which limits this.
- Clef is new. Its probabilities only help if they are reliable for our requests, which is why it starts in shadow mode.
- This ADR replaces the network default in ADR-0004: the default is now `registries`, not "no network".

Follow-up work, once this ADR is accepted:

1. Build the proxy in the sandbox gateway, the network levels, and the setting per repository. The setting needs a repository table.
2. Add the run events, and the allow button on the run page.
3. Build the evaluation sets, run shadow mode, and choose the default thresholds.
4. Before `enforce`, review Sference's data processing agreement, and confirm the retention of the decisions endpoint, which its documentation does not state.
5. A setup step that installs dependencies before the agent starts.
6. An ADR on HTTPS inspection and registry mirrors.

### Sovereignty impact

1. **Runs anywhere you choose.** No impact on self-hosting. The model layer is optional. Air-gapped installs use the level `none`, or `registries` with local mirrors, and no decision model.
2. **No phone-home.** Kept. Sference is contacted only when the operator sets a key. The deny list keeps the telemetry hosts of sandbox tools blocked at every level, including `open`.
3. **Model-agnostic.** Kept. The decision model sits behind an interface, and Clef is an open-weight model that can run locally.
4. **Open standards.** Kept. The sandbox uses standard HTTP proxy settings. The decisions API of Sference is a vendor API, used only behind our own interface.
5. **Your data stays yours.** Sference receives host names, byte counts and the visibility of the repository, never code or prompts. It is an outbound destination the operator configures, and it is listed in the configuration.
6. **Humans decide.** No impact on merges. Network decisions may now be made by a model, but people can override every decision, and every decision is recorded.
7. **Transparent supply chain.** No new package or image. One optional external service, recorded here.
8. **Reference deployment on European infrastructure.** If the steward's reference deployment uses Sference, it is listed as a provider headquartered in the United Kingdom, with inference in Europe.

## More information

- Clef: <https://blog.cloudflare.com/clef-decision-models/>
- Sference decisions API: <https://sference.com/docs/guides/decisions>
- How to check that the decision is followed: a sandbox reaches nothing without passing the proxy; every allowed request to a host outside the built-in list has a recorded decision; and the deny list is enforced at the level `open`.
