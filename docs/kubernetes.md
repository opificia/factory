# Run Opificia on Kubernetes

This guide explains how to run Opificia AI on a Kubernetes cluster, with sandboxes that scale with the work ([ADR-0010](adr/0010-run-on-kubernetes.md)). The chart in [`deploy/helm/opificia`](../deploy/helm/opificia) uses core Kubernetes resources only, so it works on any conformant cluster. This guide has the settings for Scaleway Kapsule, Google Kubernetes Engine and `kind`.

To run Opificia on one machine instead, see [`docs/prototype.md`](prototype.md).

## What runs where

| Part | Kubernetes object | Scaling |
| --- | --- | --- |
| API and web app | `Deployment`, `Service`, optional `Ingress` | A `HorizontalPodAutoscaler` on CPU, 2 to 6 pods by default. |
| Worker | `Deployment` with one pod, `PersistentVolumeClaim` | Exactly one. It holds the live sandbox sessions. |
| Sandboxes | One pod per stage of a run, created by the worker | Up to `sandbox.maxSandboxes` at once. The cluster's node autoscaler adds and removes sandbox nodes. |
| Valkey | `Deployment`, `Service` | One small pod, without persistence. |
| PostgreSQL | Outside the chart | Bring your own, usually a managed database. |
| Migrations | `Job`, before every install and upgrade | |

Sandboxes run on their own nodes. You give those nodes a label and a taint, and only sandbox pods tolerate the taint, so the API, the worker and their secrets never run there. When no run is in progress, the sandbox pool can shrink to no nodes at all. The first run after a quiet period then waits a few minutes for a node.

## What you need

- A Kubernetes cluster, version 1.29 or later, whose network plugin enforces `NetworkPolicy`. The worker checks this before it starts its first sandbox, and refuses to run sandboxes otherwise.
- Two node pools: one for the control plane, and one for sandboxes with a label, a taint and autoscaling from 0. A sandbox requests 2 CPUs and 4 GiB of memory by default, so the sandbox nodes need more than that, with room for the cluster's own agents.
- PostgreSQL 15 or later.
- A container registry the cluster can pull from.
- Helm 3, or `kubectl` if you render the chart once with `helm template`.
- A GitHub App, as in [step 1 of the prototype guide](prototype.md#1-create-a-github-app). Its callback URL is your public URL followed by `/api/auth/callback/github`.

## 1. Build the images

Opificia does not publish images yet. Build both and push them to your registry. Most cloud nodes are `amd64`, so on another machine, such as a Mac with Apple silicon, build for that platform:

```sh
REGISTRY=registry.example.org/opificia
TAG=$(git rev-parse --short HEAD)

docker buildx build --platform linux/amd64 -f apps/server/Dockerfile \
  -t "$REGISTRY/server:$TAG" --push .
docker buildx build --platform linux/amd64 -f plugins/harness-claude/Dockerfile \
  -t "$REGISTRY/harness-claude:$TAG" --push .
```

The server image holds the API, the worker, the migrations and the built web app. The sandbox image contains Claude Code, which is why you build it yourself ([ADR-0004](adr/0004-target-architecture.md)).

## 2. Create the namespace and the secret

The chart never creates secrets. Create one with these keys, in the namespace you install into:

```sh
kubectl create namespace opificia
kubectl --namespace opificia create secret generic opificia \
  --from-literal=DATABASE_URL='postgresql://opificia:<password>@<host>:5432/opificia' \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=GITHUB_APP_ID='<app id>' \
  --from-literal=GITHUB_APP_CLIENT_ID='<client id>' \
  --from-literal=GITHUB_APP_CLIENT_SECRET='<client secret>' \
  --from-file=GITHUB_APP_PRIVATE_KEY=./github-app.private-key.pem \
  --from-literal=ANTHROPIC_API_KEY='<your key>'
```

Install one release per namespace. The worker refuses to start when another network policy in its namespace applies to sandboxes, and a second release would add one.

## 3. Write your values

Start from this, and add the settings for your provider below:

```yaml
image:
  repository: registry.example.org/opificia/server
  tag: "<tag>"
publicUrl: https://opificia.example.org
existingSecret: opificia

env:
  OPIFICIA_OPERATOR_EMAILS: you@example.org
  OPIFICIA_GIT_AUTHOR_EMAIL: 12345+opificia[bot]@users.noreply.github.com

sandbox:
  image: registry.example.org/opificia/harness-claude:<tag>
  maxSandboxes: 4
  nodeSelector:
    opificia-pool: sandbox
  tolerations:
    - key: opificia-pool
      operator: Equal
      value: sandbox
      effect: NoSchedule

ingress:
  enabled: true
  className: nginx
  host: opificia.example.org
  tlsSecretName: opificia-tls
```

[`values.yaml`](../deploy/helm/opificia/values.yaml) explains every setting. Other server settings go under `env`, with the names in [`.env.example`](../.env.example). The chart sets the ones that depend on Kubernetes itself, and refuses them under `env`.

Live updates on the run page use server-sent events. If your ingress controller buffers responses or closes idle connections early, turn that off for this host. The server already sends `X-Accel-Buffering: no`, which nginx respects.

## 4. Install

```sh
helm upgrade --install opificia deploy/helm/opificia \
  --namespace opificia --values my-values.yaml
```

Helm runs the migrations first, then starts the rest. Without Helm, render the chart once, apply the migration `Job`, wait for it to complete, and apply the rest:

```sh
helm template opificia deploy/helm/opificia --namespace opificia --values my-values.yaml > opificia.yaml
```

Then watch the worker:

```sh
kubectl --namespace opificia logs deployment/opificia-worker --follow
```

Sign in at your public URL, and turn sign-ups off once you have an account (`env.OPIFICIA_SIGNUP: closed`).

## The network check

A `NetworkPolicy` in the chart closes the sandbox network: sandboxes accept no connections, and may only connect to the worker's sandbox port. Everything else goes through the worker's egress proxy ([ADR-0007](adr/0007-sandbox-network-policy.md)). Before it starts its first sandbox, the worker:

1. reads the network policies of its namespace, and Cilium's if the cluster has them, and refuses to start if any of them lets sandboxes reach anything else;
2. starts two probe pods on a sandbox node: one under the sandbox policy and one outside it. The first must reach the worker and nothing else, and the second must reach at least one public address, so that the result means something.

If the probe fails, the worker logs what each pod reached, and exits. The usual cause is a network plugin that does not enforce network policies. The probe is the only check of cluster-wide policies, which the worker may not read. If you have checked the network another way, you can turn the probe off with `sandbox.networkProbe: false`.

The first probe on an empty sandbox pool waits for a node, as a run does, which can take several minutes.

## Isolation

On a cluster without gVisor or a similar runtime, sandboxes share the kernel of their node. The pod's security context, the dedicated sandbox nodes and the network policy limit what a sandbox can do. A process that escapes its container is still root on its node, and the cluster's own agents on that node, such as the network plugin, hold credentials that reach further. Such a cluster suits repositories whose issues you trust, such as your own, not issues from anyone on the internet. To see which agents run on a sandbox node:

```sh
kubectl get pods --all-namespaces --field-selector spec.nodeName=<node> -o wide
```

Use `sandbox.runtimeClassName` where the cluster offers a stronger runtime, such as `gvisor` on GKE Sandbox.

## Provider settings

### Scaleway Kapsule

Kapsule's default network plugin, Cilium, enforces network policies. Create the cluster with two pools. The sandbox pool scales from 0, with the label and the taint of the values above. A PRO2-S node (8 vCPUs, 32 GB) holds three sandboxes:

```sh
scw k8s cluster create name=opificia region=fr-par cni=cilium \
  pools.0.name=control pools.0.node-type=DEV1-L pools.0.size=1 \
  pools.1.name=sandbox pools.1.node-type=PRO2-S pools.1.size=1 \
  pools.1.autoscaling=true pools.1.min-size=0 pools.1.max-size=2 \
  pools.1.labels.opificia-pool=sandbox \
  pools.1.taints.0.key=opificia-pool pools.1.taints.0.value=sandbox pools.1.taints.0.effect=NoSchedule
```

The autoscaler removes the first sandbox node once it has been idle for a while. Set `pools.1.max-size` so that `max-size` times the sandboxes per node is at least `sandbox.maxSandboxes`. Fetch the kubeconfig into its own file, so that it does not change your other contexts:

```sh
scw k8s kubeconfig get <cluster id> > opificia.kubeconfig
export KUBECONFIG=$PWD/opificia.kubeconfig
```

For the images, use Scaleway Container Registry, and give the cluster a pull secret with the key of an IAM application that may only read the registry. Add its name to `imagePullSecrets` and `sandbox.imagePullSecrets`. For the database, use Managed Database for PostgreSQL, reachable from the cluster over a private network. Kapsule has no ingress controller of its own: install one, or set `api.service.type: LoadBalancer` for a Scaleway load balancer.

The project's own deployment keeps its secrets in Scaleway Secret Manager and syncs them into the `Secret` with External Secrets Operator ([ADR-0013](adr/0013-deployment-secrets-in-scaleway-secret-manager.md)). The chart is the same either way.

Kapsule does not offer gVisor. See [Isolation](#isolation).

### Google Kubernetes Engine

Create the cluster with Dataplane V2, which enforces network policies. For the sandbox pool, use GKE Sandbox, which runs pods under gVisor, with autoscaling from 0:

```sh
gcloud container clusters create opificia --region europe-west1 \
  --enable-dataplane-v2 --num-nodes 1 --machine-type e2-standard-2
gcloud container node-pools create sandbox --cluster opificia --region europe-west1 \
  --sandbox type=gvisor --machine-type e2-standard-8 \
  --enable-autoscaling --min-nodes 0 --max-nodes 2 --num-nodes 0 \
  --node-labels opificia-pool=sandbox --node-taints opificia-pool=sandbox:NoSchedule
```

Add `sandbox.runtimeClassName: gvisor` to your values. GKE adds its own taint to GKE Sandbox nodes, and the `gvisor` runtime class lets sandbox pods tolerate it.

### kind

`kind` runs a cluster in Docker on your machine, which is enough to try the chart and to work on the Kubernetes backend. It has no node autoscaler, so the sandbox pool is fixed. Give one node the sandbox label and taint, build the images locally and load them into the cluster:

```sh
kind create cluster --name opificia
kubectl label node opificia-control-plane opificia-pool=sandbox
pnpm server:build && pnpm sandbox:build
kind load docker-image opificia/server:dev opificia/harness-claude:dev --name opificia
```

With one node, leave out the taint and the tolerations. Use `image.repository: opificia/server`, `image.tag: dev`, `image.pullPolicy: Never` and `sandbox.image: opificia/harness-claude:dev`, set `api.autoscaling.enabled: false` unless you have installed the metrics server, and reach the web app with `kubectl port-forward service/opificia-api 8080:80` and `publicUrl: http://localhost:8080`. The database can run on your machine, at `host.docker.internal`. If the worker reports that the cluster does not enforce the network policy, your kind version's network plugin does not; install one that does, such as Calico.

## Upgrading

Build and push new images, change `image.tag` and `sandbox.image`, and run `helm upgrade` again. The migrations run first. The worker is replaced, not rolled, and runs that were in flight fail with the reason; start them again from the run page.

## Removing

`helm uninstall opificia --namespace opificia` removes everything but the worker's volume, which holds the repository caches. Delete it with `kubectl --namespace opificia delete pvc opificia-worker`. Sandbox pods that are still running end at their deadline; delete them with `kubectl --namespace opificia delete pods -l opificia.role=sandbox`.
