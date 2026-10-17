# ADR-0013: Keep the reference deployment's secrets in Scaleway Secret Manager

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [ADR-0003](0003-host-the-website-on-scaleway.md), [ADR-0007](0007-sandbox-network-policy.md), [ADR-0010](0010-run-on-kubernetes.md), [RFC-0052](../rfcs/0052-secret-providers.md), [`AGENTS.md`](../../AGENTS.md) rule 5, [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md)

## Context

[ADR-0010](0010-run-on-kubernetes.md) keeps secrets out of the Helm chart. The chart refers to a Kubernetes `Secret` that the operator creates. It holds the database URL, the auth secret, the GitHub App credentials and the model API key. With [ADR-0007](0007-sandbox-network-policy.md), the Sference key joins them.

That leaves open how the project fills this `Secret` for its own reference deployment on Scaleway Kapsule, which runs our own factory and the managed cloud. Creating it by hand with `kubectl` works, but the values then live on the laptops of the people who created it, nobody can see who read or changed them, and rotating a key means repeating the steps by hand.

We also want agents to use repository secrets, such as test credentials, through a secret provider (see [RFC-0052](../rfcs/0052-secret-providers.md)). The people who run the factory would then manage two kinds of secrets: the factory's own, and those of the repositories it works on. One tool for both is simpler to learn, to audit and to secure.

This ADR is about the project's own deployment. It does not change what Opificia AI requires of other operators.

## Considered options

1. **Kubernetes `Secret`s created by hand.** No new tool, but no audit, no versions and no rotation.
2. **Scaleway Secret Manager**, synced into the cluster by External Secrets Operator.
3. **A self-hosted secret store** in the cluster, such as OpenBao. Open source and under our control, but we would run and back up another stateful service, and it would hold the keys of the cluster it runs in.

## Decision

We choose option 2.

### How it works

- **One Scaleway project** for the factory's secrets, `opificia-factory`, in `fr-par`, the region of the cluster. Each secret has a path per deployment. The reference deployment uses `/production/`.
- **External Secrets Operator** (ESO) runs in the reference cluster, in its own namespace, on the control-plane pool. It reads the secrets under `/production/` and writes the `Secret` that the chart refers to. It refreshes every hour.
- **A dedicated IAM application**, `opificia-factory-secrets`, as for the website in [ADR-0003](0003-host-the-website-on-scaleway.md). Its policy grants `SecretManagerReadOnly` and `SecretManagerSecretAccess` on the project `opificia-factory` only, with a resource-level condition that limits it to `/production/`. It cannot create, change or delete secrets. Its API key is the one secret we still create by hand, in ESO's namespace.
- **The chart does not change.** It still refers to a plain `Secret` and knows nothing of ESO or Scaleway. ESO and its `SecretStore` are part of the reference deployment, not of Opificia.
- **Rotation.** We add a new version in Secret Manager. The server reads its configuration when it starts, so after ESO has updated the `Secret`, within the hour, we restart the deployments. Restarting them automatically would need another component, and can wait.

ESO and its pods never run on the sandbox pool. Its application can read every secret of the control plane, so it belongs with the control plane, behind the taint that keeps sandbox pods away ([ADR-0010](0010-run-on-kubernetes.md)).

### Reasons

- We already run the website and the reference deployment on Scaleway, and know its IAM. Secret Manager adds no new provider, contract or account for the people who run the factory.
- Scaleway is headquartered in France, and the secrets stay in `fr-par`. This keeps commitment 8.
- Secret Manager has versions, paths, IAM policies that can limit access to one path, and Scaleway's audit trail. That is enough for the factory's own secrets and for repository secrets.
- ESO keeps the cluster side independent of the store. Moving to another store later means changing one `SecretStore` and copying the values. The chart and the server stay as they are.
- Option 1 does not scale beyond one person, and leaves no record.
- Option 3 makes us operate the service that holds the keys to everything else, before we have the people to do that well.

### Dependencies

This ADR adds, for the reference deployment only:

- **Scaleway Secret Manager**, in `fr-par`.
- **External Secrets Operator** (Apache-2.0), installed from its Helm chart, with its image pinned by digest. It adds custom resources to the reference cluster, not to the Opificia chart.

## Consequences

- The factory's secrets have one home, versions, and a record of changes. People no longer keep them on their laptops.
- Scaleway can technically read the values, as it can read the database and the disks of the reference deployment. We already trust it with those.
- If Secret Manager is unavailable, running pods keep working with the `Secret` they have. Changing a value has to wait, and a new install cannot start.
- One credential is still created by hand: the API key of `opificia-factory-secrets`.

Follow-up work:

1. Create the project, the IAM application and its policy, and install ESO in the reference cluster. Document all three in the Kapsule guide of [ADR-0010](0010-run-on-kubernetes.md).
2. Check that the resource-level condition limits the application to `/production/`, by trying to read a secret outside it.
3. List Secret Manager among the providers of the reference deployment.

### Sovereignty impact

1. **Runs anywhere you choose.** No impact. The chart still expects a plain `Secret`, and operators fill it however they like.
2. **No phone-home.** No impact. Opificia contacts no vendor. ESO contacts only the Scaleway endpoint that we configure.
3. **Model-agnostic.** No impact.
4. **Open standards.** No impact. The interface between the cluster and the store is a Kubernetes `Secret`.
5. **Your data stays yours.** No code, prompts or logs go to Secret Manager. It holds the credentials of the reference deployment, with the provider that already hosts it.
6. **Humans decide.** No impact.
7. **Transparent supply chain.** No impact on Opificia's release artefacts. ESO is open source and pinned in the reference deployment.
8. **Reference deployment on European infrastructure.** Kept. The secrets stay with a provider headquartered in France, in the Paris region.

## More information

- Scaleway Secret Manager concepts: <https://www.scaleway.com/en/docs/secret-manager/concepts/>
- Scaleway IAM permission sets: <https://www.scaleway.com/en/docs/iam/reference-content/permission-sets/>
- Products that support resource-level conditions: <https://www.scaleway.com/en/docs/iam/policies-permissions/supported-products-resource-level/>
- External Secrets Operator, Scaleway provider: <https://external-secrets.io/latest/provider/scaleway/>
- How to check that the decision is followed: the Opificia chart contains no reference to ESO or Scaleway; ESO runs only on the control-plane pool; its IAM application can read only `/production/` in `opificia-factory`.
