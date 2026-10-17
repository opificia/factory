# RFC-NNNN: Secret providers, with test and debug secrets for agents

- **Status:** draft
- **Author(s):** Bram De Backer
- **Created:** 2026-10-17
- **Comment period ends:** to be set when the comment period starts (at least 14 days)
- **Discussion:** the pull request that adds this RFC

## Summary

Opificia AI gets secret providers: plugins that fetch a repository's secrets from a store the operator chooses. The first is a plugin for Scaleway Secret Manager. A `file` provider works without any vendor. Secrets come in two scopes, and neither reaches the agent that writes code. **Test** secrets reach only a new `verify` stage, which runs the repository's tests on the agent's change without an agent, with the network narrowed to the hosts the secrets belong to. **Debug** secrets reach the agent only in a new `debug` stage, which a person starts and approves, which uses read-only credentials where it can, and which produces a report, not a branch.

In phase 1, test secrets stay in the repository's own CI, and Opificia reads the CI results back into the run. The `verify` stage follows when CI is not enough.

## Motivation

Many repositories have tests that need credentials: an API key for a payment provider's test mode, a test database, a storage bucket. Today an agent in the sandbox cannot run those tests, so it hands over changes it could not verify, and a person finds out in CI.

Some issues can only be understood with access to the running system: logs, an error tracker, a staging database. An agent that could look would save people a lot of time.

Both needs run into one rule. The sandbox holds no secrets ([ADR-0004](../adr/0004-target-architecture.md)). [ADR-0007](../adr/0007-sandbox-network-policy.md) opened the sandbox network because of that rule. The issue text reaches the model, so whoever writes an issue can try to steer the agent. An agent that holds a secret and can reach the internet is one prompt injection away from sending it out. The proxy sees host names, not request bodies, so it cannot catch a short secret.

If we do nothing, operators will put secrets in the sandbox anyway, through environment variables or files in the repository, with none of the safeguards below.

## Design

### Order of work

1. **CI results in the run.** The factory pushes its branches to the repository itself, so the repository's CI already runs on the pull request, with the repository's CI secrets. The control plane reads the results of the checks on the pull request's head commit through the forge adapter. When a check fails, the decider starts one more `implement` turn with the names of the failed checks and the end of their logs, and the control plane pushes the new commit to the same branch (`OPIFICIA_CI_RETRIES`, default 1). On GitHub, the App needs read access to Checks and Actions.
2. **Secret providers, the Scaleway Secret Manager plugin and the `debug` stage.**
3. **The `verify` stage,** when CI is not enough: for forges or repositories without CI, or for feedback before a pull request opens.

Step 1 needs no secret in Opificia at all. It has a cost: the agent's change runs in CI with the repository's CI secrets and the runner's open network, before a person has reviewed it. The checker keeps the agent away from the workflow files, but not from the test code those workflows run. Repositories should keep CI secrets that are worth more than test credentials in a GitHub environment that requires a reviewer.

### Secret providers

A secret provider runs in the control plane, in the credential broker that [ADR-0004](../adr/0004-target-architecture.md) describes. It never runs in a sandbox, and the sandbox never holds a credential for the store.

The interface is published in `sdk/contracts` (Apache-2.0):

```ts
export type SecretScope = "test" | "debug";

/** What a repository may use. Opificia stores bindings, never values. */
export type SecretBinding = {
  /** The environment variable the sandbox sees, for example STRIPE_TEST_KEY. */
  name: string;
  scope: SecretScope;
  /** Where the provider finds the value, in the provider's own terms. */
  ref: string;
  /** The hosts a sandbox may reach while it holds this secret. */
  hosts: string[];
};

export type ResolvedSecret = {
  name: string;
  value: string;
  /** Set when the provider issued a short-lived credential that can be revoked. */
  lease?: { id: string; expiresAt: string };
};

export interface SecretProvider {
  readonly id: string;
  resolve(repository: string, scope: SecretScope, bindings: SecretBinding[]): Promise<ResolvedSecret[]>;
  revoke?(leaseId: string): Promise<void>;
}
```

The operator picks one provider with `OPIFICIA_SECRET_PROVIDER`:

| Provider | Where | Notes |
| --- | --- | --- |
| `none` (default) | | No secrets. Runs work as today. |
| `file` | `apps/server` | Reads a JSON file that maps refs to values, usually mounted from a Kubernetes `Secret`. Works air-gapped. No leases. |
| `scaleway` | `plugins/secrets-scaleway` (Apache-2.0) | Scaleway Secret Manager. No leases. |

Bindings live in Opificia's settings for each repository, next to the network level of [ADR-0007](../adr/0007-sandbox-network-policy.md). Both need the repository table that ADR-0007 asks for. Organisation admins edit bindings in the web app. A repository's own files never define bindings, because the agent can change those files.

### The Scaleway Secret Manager plugin

- **Connection.** `OPIFICIA_SCALEWAY_REGION`, for example `fr-par`.
- **One Scaleway project per scope.** Test secrets live in one project and debug secrets in another, set in the plugin's configuration.
- **Two IAM applications**, one per scope, each with an API key: `OPIFICIA_SCALEWAY_TEST_ACCESS_KEY` and its secret key, and the same for `DEBUG`. Each application has `SecretManagerReadOnly` and `SecretManagerSecretAccess` on its own project only. Scaleway IAM enforces this, so a bug in Opificia cannot hand debug secrets to a `verify` stage. A resource-level condition can narrow an application further, to some folders.
- **Refs** are a path and a secret name within the scope's project, with one folder per repository, for example `/opificia/playground/STRIPE_TEST_KEY`. The plugin reads the latest enabled version.
- **No leases.** Secret Manager stores secrets; it does not issue short-lived credentials. An operator can give a debug secret an ephemeral policy, so that its version expires after a time or after one access, and the plugin reads it like any other.
- **No new package.** The plugin calls Secret Manager's REST API with `fetch` and the application's API key. It does not use the Scaleway SDK.

For the project's own factory, the API keys reach the server through the deployment's `Secret`, as described in [ADR-0013](../adr/0013-deployment-secrets-in-scaleway-secret-manager.md).

### The `verify` stage, for test secrets

The agent in the `implement` stage gets no secrets. Tests that need them fail or are skipped, as they do today. After the checker has accepted the change, and before the control plane pushes it, a `verify` stage runs:

1. **A fresh sandbox, without a harness and without model access.** The runner runs commands. No agent takes part.
2. **Install phase.** The repository's install command runs on the agent's branch, with the repository's network level and no secrets.
3. **Test phase.** The gateway narrows the sandbox's network to the hosts of the test bindings, and nothing else. Only then does it send the secrets to the runner. The runner keeps them in memory and passes them as environment variables to the test command. It never writes them to disk. The narrowed network applies to the whole sandbox, so a process left over from the install phase gains nothing.
4. **The result** is a check finding: passed or failed, with the end of the output, capped in size. Before the output leaves the gateway, it is redacted: every value of the stage's secrets, in plain text and in base64, hex and URL encoding, is replaced with its name.
5. **When it fails,** the decider starts one more `implement` turn with the redacted output (`OPIFICIA_VERIFY_RETRIES`, default 1). After that, the pull request opens with the failure reported, and a person decides.

The install and test commands come from the repository's settings in Opificia, not from the repository, for the same reason as the bindings.

The tests themselves were written or changed by the agent, so the `verify` stage runs code that someone may have steered. The design limits what that code can do with the secrets. It can reach only the hosts the secrets belong to, so it can only use a test credential against its own test service. Its output passes through the redaction before the agent sees it.

### The `debug` stage

A `debug` stage replaces the `plan` stage for an issue that needs investigation. Its job is to find out what is wrong, not to change code.

- **A person starts it.** No label, webhook or agent can start it. The repository must have the debug scope turned on.
- **A person approves the secrets.** When the stage starts, the person sees the list of debug bindings and picks the ones this run may use. The agent can ask for more during the stage through a runtime request, which waits for a person, like other requests that need someone ([ADR-0004](../adr/0004-target-architecture.md)).
- **Read-only and short-lived, where possible.** The settings page marks bindings that can write, and asks the person to confirm them separately. With a provider that issues leases, they end with the stage at the latest. Static secrets, which is all that the `file` and `scaleway` providers offer, stay valid after the stage, so the run page lists them and suggests rotating them.
- **The network** allows the built-in registry list and the hosts of the granted secrets. Unknown hosts are refused. The decision model of ADR-0007 is not used, and a person can still allow a host.
- **The agent gets the secrets** as environment variables of the harness process. The runner passes them on, and never writes them to disk.
- **The output is a report**, a Markdown document on the run page. The stage's branch is discarded. A following `plan` or `implement` stage gets the report, and no secrets. Posting the report to the issue needs a person's click, because the report may contain data from the systems the agent looked at.

### Safeguards in every stage that holds secrets

- **Redaction before storage.** The event store replaces known secret values in events and transcripts before it stores them, so the run page and the audit log never show them.
- **The checker** scans the change and the commit messages for every value the run's secrets had, in the same encodings as the redaction. A match blocks the push.
- **Audit.** The run events `secrets.granted` and `secrets.revoked` record the names, scopes, providers, lease IDs, and the person who approved. They never record values.
- **Leases are revoked,** for providers that issue them, when the stage ends, whatever the outcome. A lease the control plane could not revoke shows on the run page.

### Runner protocol

The runner protocol is version 0 and unstable. This RFC adds:

- a stage type `verify` with install and test commands, and `debug` alongside `plan` and `implement`;
- a `secrets` command from the gateway to the runner, sent only after the gateway has narrowed the network;
- a `command.finished` event with an exit code and the redacted output.

Server, runner and harness change together, as `AGENTS.md` requires.

### Security considerations

| Path | What limits it |
| --- | --- |
| A steered agent sends a secret out | The `implement` agent has none. In `debug`, the network allows only registries and the secrets' own hosts, and a person granted each secret. |
| Steered test code sends a test secret out | The network allows only the secrets' own hosts. Test credentials should be worth little outside their test service. |
| A secret travels back through test output | Redaction in four encodings and a size cap. A deliberate encoding the redaction does not know still gets through, so test secrets must be ones whose leak is a nuisance, not an incident. |
| A secret ends up in the pull request | The checker scans for the run's secret values and blocks the push. |
| The agent changes the commands or the bindings | Both live in Opificia's settings, not in the repository. |
| `debug` data reaches the model provider | The agent reads logs and records, and the model provider sees them. The operator chooses the model for the debug stage per repository. |
| A process escapes the sandbox | It finds only the secrets of its own stage. The store's credentials stay in the control plane. |
| Steered test code runs in the repository's CI (step 1) | The checker blocks changes to workflow files. CI secrets worth more than test credentials belong in a GitHub environment that requires a reviewer. GitHub masks secret values in logs, in plain text only. |

### Dependencies

No new package or image. The Scaleway plugin uses `fetch`. Scaleway Secret Manager is an optional external service, used only when the operator configures it.

### Testing

- The decider: the new stages, the retry after failed CI or a failed `verify`, and the rule that no event starts `debug` except a person's.
- The forge adapter: reading check results and log tails from recorded GitHub responses.
- The gateway: no `secrets` command before the network is narrowed, and a narrowed network that refuses every other host.
- Redaction and the checker, with each encoding.
- The Scaleway plugin against a fake Secret Manager on `node:http`, including a refused request and a disabled version.
- The broker with a fake provider that issues leases, including a lease that cannot be revoked.
- The `file` provider in the existing integration tests, without any vendor.

## Alternatives

- **Secrets in the `implement` stage.** This is what most tools do, and it is the simplest. With the network of ADR-0007, one prompt injection in an issue can send them out. We reject it as a default, and leave it as an open question for test secrets that are worth nothing (see below).
- **Placeholders swapped by the proxy.** The agent sees a placeholder, and the egress proxy puts in the real value only in requests to the right host. The secret never enters the sandbox. This is the strongest design for HTTP APIs, but it needs the proxy to decrypt HTTPS, which ADR-0007 leaves to its own ADR, and it does not work for database protocols. It could replace the `verify` stage for HTTP APIs once that ADR exists.
- **A secret store's own CLI in the sandbox**, with a credential for the store. The sandbox would hold a credential for the store itself, which can read more than one run needs.
- **Only the forge's CI, for good.** This is step 1 of the order of work, and it may be enough for a long time. On its own it ties the loop to forges with CI, and the agent learns about failures only after the pull request opens. The `verify` stage stays in this RFC so that the path beyond CI is agreed.
- **No debug stage.** People debug, and give the agent what they found. That is safe, and slow.

## Sovereignty impact

| Commitment | Impact |
| --- | --- |
| 1. Runs anywhere you choose (self-hostable, air-gap capable) | Kept. The `file` provider needs no vendor and works air-gapped. Scaleway Secret Manager is an optional plugin. |
| 2. No phone-home (telemetry off by default, operator-configured endpoint) | Kept. A provider contacts only the store the operator configures. |
| 3. Model-agnostic (open interface, open-weight models first-class) | No impact. The stages work with any harness. |
| 4. Open standards | Kept. The provider interface is published in `sdk/contracts`. Secrets reach commands as environment variables. CI results come through the forge adapter, so other forges can provide them too. |
| 5. Your data stays yours | Affected. In a `debug` stage, data from the operator's own systems goes to the model provider that the operator configured for the stage. The store sees which secrets were read, and when. Both are destinations the operator configures. |
| 6. Humans decide (human approval before merge or deploy) | Strengthened. No agent gets a debug secret without a person's recorded approval. Merges are not affected. |
| 7. Transparent supply chain (SBOMs, signed releases, reproducible builds) | No new package or image. |
| 8. Reference deployment on European infrastructure | Kept. The project's own factory uses Scaleway Secret Manager, a provider headquartered in France ([ADR-0013](../adr/0013-deployment-secrets-in-scaleway-secret-manager.md)). This RFC does not depend on where the store runs. |

## Unresolved questions

- **Test secrets for the agent.** Should a repository be able to mark a test secret as safe to give to the `implement` agent, for faster feedback? If so, what must be true of it: a test-mode key, a spending limit, an account with no data?
- **When `verify` is needed.** Which signal tells us that CI is no longer enough: a forge without CI, a repository that wants feedback before the pull request, or CI secrets too valuable to run unreviewed code with?
- **Tenants in the managed cloud.** This RFC configures the IAM applications once per installation. The managed cloud needs a connection per organisation, and a place to keep its credentials.
- **Debug data and the model.** Should the `debug` stage require a model from a provider on an operator's list, for example one hosted in Europe?
- **Static debug secrets.** Should the `debug` stage refuse static secrets that can write, rather than ask for confirmation?
- **The debug report.** Should a report always go through the checker's secret scan before a person can post it, even when it contains no code?
