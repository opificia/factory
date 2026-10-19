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
- Two node pools: one for the control plane, and one for sandboxes with a label, a taint and autoscaling from 0. A sandbox requests 2 CPUs and 4 GiB of memory by default, so the sandbox nodes need more than that, with room for the cluster's own agents. A sandbox's disk also comes from its node: 8 GiB for the working copy (`sandbox.workSize`) and 2 GiB for `/tmp` and its home folder. Give the sandbox nodes a system disk with room for that, times the sandboxes per node, and for the sandbox image. See [Sandbox nodes](#sandbox-nodes).
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

## Sandbox nodes

You can size the sandbox pool in two ways:

- **Several sandboxes per node**, with larger nodes and the default settings. A sandbox starts at once on a node that has room. You pay for the whole node while any sandbox runs on it.
- **One sandbox per node**, with nodes the size of one sandbox and `sandbox.onePerNode: true`. You pay for a node while a sandbox runs on it, for the minutes an idle node waits before the autoscaler removes it, and for any buffer below. A sandbox that escapes its container finds no other sandbox on its node. Each sandbox needs a node of its own, though, which takes a few minutes to start unless one is ready.

For one sandbox per node, let a sandbox reserve less CPU than the node has, since the node's own agents reserve some, and use all of it. For nodes with 2 vCPUs and 8 GB:

```yaml
sandbox:
  cpu: 1500m
  cpuLimit: "2"
  memory: 4Gi
  onePerNode: true
  buffer:
    sandboxes: 1
```

`sandbox.buffer.sandboxes` keeps room for that many sandboxes ready, so that a run does not wait for a node. Placeholder pods the size of a sandbox hold the room, on the sandbox image, so the node already has it. A sandbox pushes a placeholder out, and the node autoscaler adds a node for the placeholder in the background. With one sandbox per node, each placeholder holds a node of its own, which you pay for as for a running sandbox. Let the pool grow to `sandbox.maxSandboxes` plus the buffer.

The placeholders have a `PriorityClass` below 0, so that sandboxes can push them out. The chart creates one at -1. A `PriorityClass` applies to the whole cluster, so if the chart may not create one, create your own and give its name in `sandbox.buffer.priorityClassName`. The node autoscaler ignores pods below its cutoff, which is -10 by default, so keep the class above it.

## Isolation

On a cluster without gVisor or a similar runtime, sandboxes share the kernel of their node. The pod's security context, the dedicated sandbox nodes and the network policy limit what a sandbox can do. A process that escapes its container is still root on its node, and the cluster's own agents on that node, such as the network plugin, hold credentials that reach further. Such a cluster suits repositories whose issues you trust, such as your own, not issues from anyone on the internet. To see which agents run on a sandbox node:

```sh
kubectl get pods --all-namespaces --field-selector spec.nodeName=<node> -o wide
```

With `sandbox.onePerNode`, a process that escapes finds no other sandbox on its node, though the agents are still there. Use `sandbox.runtimeClassName` where the cluster offers a stronger runtime, such as `gvisor` on GKE Sandbox.

## Provider settings

### Scaleway Kapsule

Kapsule's default network plugin, Cilium, enforces network policies. Create the cluster with two pools. The sandbox pool scales from 0, with the label and the taint of the values above. Since Kapsule has no gVisor, give every sandbox a PRO2-XXS node (2 vCPUs, 8 GB) of its own, with the settings in [Sandbox nodes](#sandbox-nodes). A 40 GB system disk leaves room for the sandbox's disk and the sandbox image:

```sh
scw k8s cluster create name=opificia region=fr-par cni=cilium \
  pools.0.name=control pools.0.node-type=DEV1-L pools.0.size=1 \
  pools.1.name=sandbox pools.1.node-type=PRO2-XXS pools.1.size=1 pools.1.root-volume-size=40GB \
  pools.1.autoscaling=true pools.1.min-size=0 pools.1.max-size=5 \
  pools.1.labels.opificia-pool=sandbox \
  pools.1.taints.0.key=opificia-pool pools.1.taints.0.value=sandbox pools.1.taints.0.effect=NoSchedule
```

Set `pools.1.max-size` to at least `sandbox.maxSandboxes` plus `sandbox.buffer.sandboxes`. To run several sandboxes per node instead, use a larger type, such as PRO2-S (8 vCPUs, 32 GB) for three, with a system disk for all three, and set `max-size` so that `max-size` times the sandboxes per node is at least `sandbox.maxSandboxes`. Without a buffer, the autoscaler removes the last sandbox node once it has been idle for a while. Fetch the kubeconfig into its own file, so that it does not change your other contexts:

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
gcloud container clusters create opificia --zone europe-west1-b \
  --enable-dataplane-v2 --num-nodes 1 --machine-type e2-standard-2
gcloud container node-pools create sandbox --cluster opificia --zone europe-west1-b \
  --sandbox type=gvisor --machine-type e2-standard-8 \
  --enable-autoscaling --min-nodes 0 --max-nodes 2 --num-nodes 0 \
  --node-labels opificia-pool=sandbox --node-taints opificia-pool=sandbox:NoSchedule
```

This is a zonal cluster. In a regional cluster, `--num-nodes` and the autoscaling limits count per zone, so the same commands start three times as many nodes.

Add `sandbox.runtimeClassName: gvisor` to your values. GKE adds its own taint to GKE Sandbox nodes, and the `gvisor` runtime class lets sandbox pods tolerate it. Since gVisor keeps sandboxes apart, several can share a node; `sandbox.buffer` works here too.

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
