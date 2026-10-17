# ADR-0010: Run Opificia on any Kubernetes cluster, with sandboxes that scale with the work

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** the maintainers, with the project steward as architecture owner
- **Related:** [ADR-0003](0003-host-the-website-on-scaleway.md), [ADR-0004](0004-target-architecture.md), [ADR-0005](0005-prototype-stack.md), [ADR-0007](0007-sandbox-network-policy.md), [`AGENTS.md`](../../AGENTS.md) rule 5, [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md)

## Context

Opificia AI runs on one machine. The server starts one Docker container per stage of a run through the local Docker engine, and passes it the repository and receives its work through two folders on the host. That is enough for one person on a laptop. It is not enough for the factory to work on its own tickets all day, and step 2 of [ADR-0004](0004-target-architecture.md) asks for a Kubernetes sandbox.

Three things tie the current code to one machine:

1. **The Docker socket.** Kubernetes nodes have no Docker engine we can use, and running one inside the cluster needs privileged containers.
2. **Host folders.** A run reads `/in/repo.bundle` and writes `/out/result.bundle` through bind mounts. A pod on another node cannot share a folder with the server.
3. **State in the worker's memory.** The worker holds the live sandbox sessions, their tokens and their egress budgets in memory. A second worker would not know the sessions of the first.

The load is uneven. A run needs about 2 CPUs and 4 GB of memory for up to an hour, and there can be none or twenty at once. The control plane itself is small. Paying for twenty idle sandboxes is wasteful, and making runs wait for capacity is slow.

[ADR-0004](0004-target-architecture.md) also says that Opificia runs anywhere the operator chooses (commitment 1), with no cloud-only code paths. Our own reference deployment will run on Scaleway Kapsule, in line with commitment 8, but nothing may depend on it. The same install must work on Google Kubernetes Engine, Amazon EKS, Azure AKS, OVHcloud, a self-managed cluster or `kind` on a laptop.

## Considered options

1. **Docker in the cluster.** Run the current server with a Docker engine in a privileged sidecar. Little code, but every sandbox shares one privileged engine, and it scales to one node.
2. **Kubernetes Jobs through a separate operator** with its own custom resources. Clean on paper, but it adds a component, custom resource definitions and a second release to every install.
3. **A Kubernetes sandbox backend in the worker**, which creates one pod per stage through the Kubernetes API, and a Helm chart that uses only core Kubernetes resources. Capacity comes from the cluster's own node autoscaler.
4. **A provider's serverless containers**, such as Scaleway Serverless Containers or Google Cloud Run. No nodes to manage, but each provider has its own API and limits, which breaks commitment 1.

## Decision

We choose option 3.

### Sandbox backends

The worker starts sandboxes through a small interface with two implementations, chosen with `OPIFICIA_SANDBOX_BACKEND`:

- `docker` (the default), as today, for single-node installs;
- `kubernetes`, which creates one pod per stage in the worker's namespace.

Everything above the interface (sessions, the runner protocol, the model proxy, the egress proxy and the checker) is shared. There is no code path that only one backend uses beyond the interface itself.

### Files over the gateway, not host folders

The repository bundle and the result bundle travel over the sandbox gateway, for both backends. The runner downloads `repo.bundle` after its hello and uploads `result.bundle` before it completes, with its session token, through two HTTP endpoints on the gateway. The harness still sees an input folder and an output folder, so harness adapters do not change. The runner protocol in `sdk/contracts` is version 0 and unstable, so we change the server, the runner and the harness together.

The Docker backend then needs no bind mounts either, which makes the two backends behave the same.

### The sandbox pod

Each pod gets what the Docker container gets today, in Kubernetes terms:

- a non-root user, no capabilities, no privilege escalation, a read-only root file system, the `RuntimeDefault` seccomp profile, and no service account token;
- `/work`, `/tmp` and the home folder as `emptyDir` volumes with size limits;
- requests and limits of 2 CPUs and 4 GiB of memory, which the operator can change;
- `activeDeadlineSeconds` set to the run's time limit, so a pod never outlives its run;
- a configurable `runtimeClassName`, `nodeSelector` and tolerations, so sandboxes run on their own nodes, with gVisor where the cluster offers it;
- the annotation `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`, so a node autoscaler never removes a node while a run works on it.

The network is closed by a `NetworkPolicy` in the chart. Sandbox pods accept no connections, and may only connect to the worker's sandbox port. They get no DNS: the worker adds the address of its own sandbox service to each pod as the host name `gateway`, so sandboxes reach `gateway:3001` exactly as they do with Docker. Everything else goes through the egress proxy of [ADR-0007](0007-sandbox-network-policy.md), which already refuses private, loopback and link-local addresses. On Kubernetes those include the pod and service networks and the API server.

A `NetworkPolicy` only works when the cluster's network plugin enforces it. Some do not, and then a sandbox would have an open network. Before it starts its first sandbox, the worker therefore starts a probe pod with the sandbox policy, which tries to reach a public address directly. If the probe gets through, the worker refuses to start sandboxes and says why.

### Scaling

| Part | How it scales |
| --- | --- |
| API | A `Deployment` with a `HorizontalPodAutoscaler` on CPU. API processes keep no state of their own; Valkey tells them about new events. |
| Worker | One replica, replaced with the `Recreate` strategy. It holds the live sandbox sessions. Making the worker highly available is later work. |
| Sandboxes | One pod per stage, with resource requests. When pods wait for room, the cluster's node autoscaler adds sandbox nodes. When runs end, the nodes empty and the autoscaler removes them, down to zero. |
| PostgreSQL | Outside the chart. Operators bring a database, usually a managed one, through `DATABASE_URL`. |
| Valkey | In the chart, one small pod without persistence, as in the Docker Compose file. It holds nothing that is not also in PostgreSQL. |

The chart sets no provider-specific options. Node autoscaling is the cluster's job: an autoscaling pool on Kapsule, the cluster autoscaler or node auto-provisioning on GKE, Karpenter on EKS, or the cluster autoscaler anywhere else. The operator gives the sandbox nodes a label and a taint, and tells the chart about them. The documentation lists the settings for each provider we have tried.

`OPIFICIA_MAX_SANDBOXES` caps how many sandboxes run at once, so a burst of issues cannot grow the cluster without bound. Runs above the cap wait in the queue. Because a new node can take several minutes to start and to pull the sandbox image, the worker waits up to 15 minutes for a pod to be scheduled before it counts the time it takes the runner to say hello.

### The chart and the images

- **A Helm chart** in `deploy/helm/opificia`. It uses `Deployment`, `Service`, `Ingress`, `NetworkPolicy`, `HorizontalPodAutoscaler`, `PersistentVolumeClaim`, `ServiceAccount`, `Role`, `RoleBinding` and a `Job` for database migrations. No custom resources, and no annotations of any provider. Operators who do not use Helm can render it once with `helm template` and apply the result with `kubectl`.
- **Secrets stay out of the chart.** The chart refers to a `Secret` the operator creates, holding the database URL, the auth secret, the GitHub App credentials and the model API key.
- **The worker's permissions** are a `Role` in its own namespace: create, read, watch and delete pods, read pod logs, and read its own services. Nothing cluster-wide.
- **A server image**, built from `apps/server/Dockerfile` on the pinned `node:24` image, which also serves the built web app. Operators build the sandbox image themselves, as before, because it contains Claude Code ([ADR-0004](0004-target-architecture.md)), and push both to a registry of their choice.

### The reference deployment

The project's own factory runs on Scaleway in `fr-par`:

- **Kapsule** with the Cilium network plugin, which enforces network policies, and two pools: a small fixed pool for the control plane and Valkey, and an autoscaling sandbox pool from 0 to a fixed maximum, with a label and a `NoSchedule` taint;
- **Managed Database for PostgreSQL**;
- **Container Registry**, for the server and sandbox images.

The steward confirms the cost before the infrastructure is created.

### Isolation on clusters without gVisor

[ADR-0004](0004-target-architecture.md) names gVisor as the reference sandbox runtime on Kubernetes. GKE offers it as the runtime class `gvisor`. Kapsule only offers `containerd` with the default runtime. Until that changes, the reference deployment relies on:

- the pod's security context, which is the same as the Docker container's today;
- **dedicated sandbox nodes.** Only sandbox pods tolerate their taint, and they carry no secrets. A process that escapes its container lands on a node where the only other workloads are other sandboxes. Kubernetes' node authorizer lets that node's kubelet read only the secrets of pods on the same node, and there are none.

This is weaker than gVisor, and we say so in the documentation.

### Reasons

- One pod per stage is the natural Kubernetes form of what the Docker backend does today, so the sessions, the protocol and the checks stay as they are.
- The cluster's own node autoscaler is the one part every managed Kubernetes offers. Building on it, rather than on a provider's API, keeps Opificia portable.
- Moving the files onto the gateway removes the last reason a sandbox needs to share a disk with the server. It also prepares sandboxes on other machines, such as remote runners.
- Core resources only means that the chart works on any conformant cluster, and that operators can read every object it creates.

### Dependencies

This ADR adds:

- `@kubernetes/client-node` (Apache-2.0), the official Kubernetes client for JavaScript, in `apps/server`;
- Helm (Apache-2.0), as the format of the chart and a tool for operators. Opificia does not need it at run time;
- for the reference deployment only: Scaleway Kapsule, Managed Database for PostgreSQL and Container Registry, all in `fr-par`.

No new container image: the server image builds on the `node:24` image that ADR-0005 already pins, and the chart runs the pinned `valkey/valkey` image.

## Consequences

- Opificia can run on any conformant Kubernetes cluster, and sandbox capacity follows the work, down to no sandbox nodes when nothing runs.
- The runner protocol changes. Harness adapters built on `sdk/runner` do not need to change; adapters that read the host folders directly do.
- Two backends need testing. The shared part is most of the code, but the Kubernetes backend needs a cluster to test against. `kind` on a laptop is enough for a person; a CI job with `kind` needs its own decision, because it adds a GitHub Action.
- The worker remains a single replica. If it restarts, the runs in flight fail, as they do today. Handing sessions over between workers is later work.
- On Kapsule, sandboxes do not have gVisor. The dedicated sandbox nodes limit the damage of an escape, but do not prevent it.
- The first run after a quiet period waits for a node to start, typically a few minutes.

Follow-up work:

1. Move the bundles onto the gateway (runner, harness and server together).
2. The sandbox backend interface and the Kubernetes backend, with the network probe.
3. The server image, the web app served by the server, and the Helm chart, with a guide in `docs/kubernetes.md` for Kapsule, GKE and `kind`.
4. Create the reference deployment on Scaleway, after the steward confirms the cost.
5. Find a stronger runtime for Kapsule: gVisor or Kata Containers installed on the sandbox pool, or support from Scaleway.
6. Publish a server image, once the release process exists.

### Sovereignty impact

1. **Runs anywhere you choose.** Strengthened. Opificia runs on any conformant Kubernetes cluster, as well as on one machine, and the chart has no provider-specific parts.
2. **No phone-home.** No impact. The chart sets the same telemetry switches as the Docker Compose file, and the Kubernetes client talks only to the cluster's API server.
3. **Model-agnostic.** No impact.
4. **Open standards.** Strengthened. The deployment uses only core Kubernetes resources and a standard Helm chart.
5. **Your data stays yours.** No impact. Repositories and results now travel between the sandbox and the worker over the cluster network instead of through a disk, and are stored only by the worker, as before.
6. **Humans decide.** No impact.
7. **Transparent supply chain.** One library and one operator tool, both Apache-2.0.
8. **Reference deployment on European infrastructure.** Strengthened. The project's own factory runs on Scaleway in Paris.

## More information

- Kubernetes network policies: <https://kubernetes.io/docs/concepts/services-networking/network-policies/>
- The cluster autoscaler and pods that must not be evicted: <https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md>
- GKE Sandbox: <https://cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods>
- Scaleway Kapsule pools and autoscaling: <https://www.scaleway.com/en/docs/kubernetes/>
