# ADR-0013: Keep the reference deployment's secrets in Infisical EU Cloud, for now

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [ADR-0003](0003-host-the-website-on-scaleway.md), [ADR-0007](0007-sandbox-network-policy.md), [ADR-0010](0010-run-on-kubernetes.md), [RFC-0051](../rfcs/0051-secret-providers.md), [`AGENTS.md`](../../AGENTS.md) rule 5, [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md)

## Context

[ADR-0010](0010-run-on-kubernetes.md) keeps secrets out of the Helm chart. The chart refers to a Kubernetes `Secret` that the operator creates. It holds the database URL, the auth secret, the GitHub App credentials and the model API key. With [ADR-0007](0007-sandbox-network-policy.md), the Sference key joins them.

That leaves open how the project fills this `Secret` for its own reference deployment on Scaleway Kapsule, which runs our own factory and the managed cloud. We want both running soon, so we prefer a service we can use today over one we must first learn to operate. Creating it by hand with `kubectl` works, but the values then live on the laptops of the people who created it, nobody can see who read or changed them, and rotating a key means repeating the steps by hand.

We also want agents to use repository secrets, such as test credentials, through a secret provider plugin (see the [RFC on secret providers](../rfcs/0051-secret-providers.md)). The people who run the factory would then manage two kinds of secrets: the factory's own, and those of the repositories it works on. One tool for both is simpler to learn, to audit and to secure.

This ADR is about the project's own deployment. It does not change what Opificia AI requires of other operators.

## Considered options

1. **Kubernetes `Secret`s created by hand.** No new tool, but no audit log, no versions and no rotation.
2. **Scaleway Secret Manager**, synced into the cluster by External Secrets Operator. A provider headquartered in Europe, which we already use.
3. **Infisical, self-hosted on Scaleway.** The core is MIT-licensed. We would run and back up another stateful service, with its own PostgreSQL and Redis, and it would hold the keys of the cluster it runs in.
4. **Infisical EU Cloud** (`eu.infisical.com`), synced into the cluster by External Secrets Operator.

## Decision

We choose option 4, for now.

### How it works

- **One Infisical project** for the factory, `opificia-factory`, with one environment per deployment. The reference deployment uses `production`.
- **External Secrets Operator** (ESO) runs in the reference cluster, in its own namespace, on the control-plane pool. It reads the `production` environment with an Infisical machine identity, and writes the `Secret` that the chart refers to. It refreshes every hour.
- **The machine identity** uses Universal Auth, has read access to `production` only, and has no access to repository secrets. Its client ID and client secret are the one secret we still create by hand, in ESO's namespace. If the Infisical plan allows it, the identity accepts logins only from the cluster's egress addresses.
- **The chart does not change.** It still refers to a plain `Secret` and knows nothing of ESO or Infisical. ESO and its `SecretStore` are part of the reference deployment, not of Opificia.
- **Rotation.** The server reads its configuration when it starts. After a value changes in Infisical, ESO updates the `Secret` within the hour, and we restart the deployments. Restarting them automatically would need another component, and can wait.

ESO and its pods never run on the sandbox pool. Its identity can read every secret of the control plane, so it belongs with the control plane, behind the taint that keeps sandbox pods away ([ADR-0010](0010-run-on-kubernetes.md)).

### Reasons

- One tool for the factory's secrets and for repository secrets, with environments, folders, machine identities with narrow access, versions and an audit log.
- Speed. We can use it today, and we run nothing new that holds state. Option 3 gives us the same tool, but makes us operate the service that holds the keys to everything else, before we have the people to do that well.
- ESO keeps the cluster side independent of the store. Moving to option 2 or 3 later means changing one `SecretStore` and copying the values. The chart and the server stay as they are.
- Option 1 does not scale beyond one person, and leaves no record.
- Option 2 keeps commitment 8. We do not choose it now because we want one tool for both kinds of secrets, and Infisical's model of environments, folders and identities fits repository secrets better. It remains the fallback.

### Dependencies

This ADR adds, for the reference deployment only:

- **Infisical EU Cloud**, an external service. Infisical's documentation says the EU region runs in its own AWS account, separate from the US region. It does not say in which AWS region, or where the company is headquartered. Secondary sources place Infisical, Inc. in San Francisco.
- **External Secrets Operator** (Apache-2.0), installed from its Helm chart, with its image pinned by digest. It adds custom resources to the reference cluster, not to the Opificia chart.

## Consequences

- The factory's secrets have one home, an audit log and versions. People no longer keep them on their laptops.
- A US-headquartered company holds the factory's credentials: the database URL, the GitHub App key and the model key. We assume Infisical can read them. That company may be subject to US law that reaches data stored in the EU.
- If Infisical EU Cloud is unavailable, running pods keep working with the `Secret` they have. Changing a value has to wait, and a new install cannot start.
- One credential is still created by hand: ESO's machine identity.
- People who operate the factory need an Infisical account.

Follow-up work:

1. The steward reviews Infisical's data processing agreement, and lists Infisical publicly as a provider of the reference deployment, with what is known about where it is headquartered and where its EU region runs.
2. Create the Infisical project and the machine identity, and install ESO in the reference cluster. Document both in the Kapsule guide of [ADR-0010](0010-run-on-kubernetes.md).
3. **Leave Infisical EU Cloud** for Infisical self-hosted on Scaleway, or for Scaleway Secret Manager, once we can operate it well, and at the latest before commitment 8 is accepted without an exception for this ADR. That move needs a new ADR, which supersedes this one.

### Sovereignty impact

1. **Runs anywhere you choose.** No impact. The chart still expects a plain `Secret`, and operators fill it however they like.
2. **No phone-home.** No impact. Opificia contacts no vendor. ESO contacts only the Infisical host that we configure.
3. **Model-agnostic.** No impact.
4. **Open standards.** No impact. The interface between the cluster and the store is a Kubernetes `Secret`.
5. **Your data stays yours.** No code, prompts or logs go to Infisical. It holds the credentials of the reference deployment, and its audit log records when they are read. Infisical becomes a sub-processor of the steward for those credentials.
6. **Humans decide.** No impact.
7. **Transparent supply chain.** No impact on Opificia's release artefacts. ESO is open source and pinned in the reference deployment.
8. **Reference deployment on European infrastructure.** **Weakened.** The reference deployment depends on a provider that we believe is headquartered in the United States, even though its EU region runs in Europe. We accept this for speed, as an exception with an exit (follow-up 3). Weakening a commitment needs the approval of the steering team, and this ADR is not accepted without it.

## More information

- Infisical cloud architecture: <https://infisical.com/docs/internals/architecture/cloud>
- Infisical Universal Auth: <https://infisical.com/docs/documentation/platform/identities/universal-auth>
- External Secrets Operator, Infisical provider: <https://external-secrets.io/latest/provider/infisical/>
- How to check that the decision is followed: the Opificia chart contains no reference to ESO or Infisical; ESO runs only on the control-plane pool; its machine identity can read only the `production` environment of `opificia-factory`.
