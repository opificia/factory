# Run the prototype

This guide explains how to run the first working loop of Opificia AI on your own machine. A person labels a GitHub issue; Opificia writes a plan, waits for a person to approve it, implements the change in a sandbox, checks the result and opens a pull request. A person reviews and merges it.

The prototype follows [ADR-0004](adr/0004-target-architecture.md), [ADR-0005](adr/0005-prototype-stack.md) and [ADR-0007](adr/0007-sandbox-network-policy.md). It is meant for one person working on their own repositories. Do not use it on repositories where other people can write issues you do not trust, and do not expose it to the internet. See [Limits](#limits).

## What you need

- Node.js 24 and pnpm 12.
- Git.
- A Docker-compatible container engine, such as Docker Engine, Colima, Podman or Docker Desktop.
- A GitHub account that can create a GitHub App.
- Your own Anthropic API key. Opificia uses Claude Code as its first harness, through the Claude Agent SDK, and you pay Anthropic directly for the model. Opificia never resells or meters model use.

## 1. Create a GitHub App

Opificia talks to GitHub as a GitHub App, so its access is limited to the repositories you choose. Create the App under your account or organisation, in **Settings**, **Developer settings**, **GitHub Apps**.

- **Callback URL:** `http://localhost:5173/api/auth/callback/github`. This is for signing in with GitHub.
- **Webhook:** switch it off. The prototype polls GitHub every 30 seconds instead, so it needs no public URL.
- **Repository permissions:** Contents: read and write. Issues: read and write. Pull requests: read and write. Metadata: read-only. Leave Workflows at no access.
- **Account permissions:** Email addresses: read-only. GitHub sign-in needs this.

After you create it, note the App ID and the client ID, generate a client secret and a private key, and store the key outside the repository, for example in `~/.config/opificia/github-app.pem` with mode `600`. Then install the App on the repositories Opificia may work on. Choose **Only select repositories**.

## 2. Configure

```sh
cp .env.example .env
```

Fill in `.env`:

- `BETTER_AUTH_SECRET`: generate it with `openssl rand -base64 32`;
- the four `GITHUB_APP_*` values from step 1;
- `ANTHROPIC_API_KEY`: your own key;
- `OPIFICIA_OPERATOR_EMAILS`: the email address you will sign up with. Only these people can link the GitHub App's installations to an organisation.

Keep `CHECKPOINT_DISABLE=1` and `BETTER_AUTH_TELEMETRY=0`. They stop Prisma and Better Auth from contacting their vendors. `.env` is ignored by git; never commit it.

## 3. Start the services

```sh
# PostgreSQL and Valkey
docker compose -f deploy/compose/docker-compose.yml up -d

# Dependencies, build and database tables
pnpm install
pnpm build
pnpm db:deploy

# The sandbox image with the claude harness
pnpm sandbox:build

# The server and the web app
pnpm dev
```

The sandbox image contains Claude Code, installed as a dependency of the Claude Agent SDK. Build it yourself, as above. Opificia does not publish it.

Open <http://localhost:5173>.

## 4. Use it

1. Create an account, then create an organisation.
2. Open **Settings** and link your GitHub App installation. The repositories it can reach are listed below it.
3. In one of those repositories, add the label `opificia` to an open issue.
4. Within 30 seconds a run starts. Open it from **Runs** to follow it live.
5. Claude Code reads the repository in a sandbox and proposes a plan. The plan also appears as a comment on the issue.
6. Approve the plan, or ask for changes. If you ask for changes, Opificia plans again with your feedback.
7. Claude Code implements the plan, runs the tests and reviews its own diff.
8. Opificia checks the result and opens a pull request that closes the issue. Review it and merge it yourself. Until you merge or close it, the run is listed under **Needs you**; Opificia checks the pull request every 30 seconds and records when it is merged or closed.

Each run has a budget of 15 USD and 60 minutes of agent time; the time spent waiting for your approval does not count. You can change both in `.env`. You can cancel a run at any time.

## How it works

| Part | Folder | What it does |
| --- | --- | --- |
| Server | `apps/server` | API, sign-in, the run event store and the worker. It polls GitHub, starts sandboxes and opens pull requests. |
| Web app | `apps/web` | Runs, plans, approvals and settings. |
| Contracts | `sdk/contracts` | Zod schemas for the API and the runner protocol. |
| Runner library | `sdk/runner` | What a harness adapter needs inside a sandbox: the protocol client and git helpers. |
| `claude` harness | `plugins/harness-claude` | Drives Claude Code through the Claude Agent SDK. |
| Compose file | `deploy/compose` | PostgreSQL and Valkey. |

**Runs are event-sourced.** Every change to a run is an event in PostgreSQL. A pure function decides which events a command causes; a projection table holds the current state; an outbox holds the side effects, such as starting a sandbox or opening a pull request, and a worker performs them. Valkey only tells listeners that a run has new events. The web app reads the events from PostgreSQL over server-sent events.

**Each stage runs in its own container.** The planning stage can only read files. The implementation stage can edit files and run commands. The container:

- sits on an internal Docker network with no route to the internet;
- reaches only a small gateway, which forwards to the server's sandbox port (3001) and nowhere else;
- reaches other hosts only through the egress proxy in that port, and only in the implementation stage (see [Network access](#network-access));
- runs as an unprivileged user, with no Linux capabilities and a read-only root file system;
- has limits on memory, CPU and processes;
- shares no folder with the host: it downloads the repository as a git bundle from the gateway, and uploads its result as a git bundle the same way.

**Keys stay outside the sandbox.** Claude Code in the sandbox sends model requests to the server, which checks a token for that stage and adds your Anthropic API key. The GitHub token never enters the sandbox: the server pushes the branch itself, with an installation token limited to one repository.

**The server checks the result before it pushes.** These checks do not depend on the model:

- no changes to CI workflows and scripts, git hooks in `.githooks/`, `CODEOWNERS`, `MAINTAINERS.md`, `AGENTS.md`, `CLAUDE.md`, `.mcp.json` or `.claude/`;
- no new submodules;
- at most 50 files and 2,000 changed lines;
- no strings that look like API keys, tokens or private keys;
- no invisible or bidirectional Unicode characters;
- the branch must build on the commit the plan was made for;
- no merge commits, and every commit has `OPIFICIA_GIT_AUTHOR_EMAIL` as its author and committer, and no `Signed-off-by` line. The agent writes its own commits, so it could otherwise claim to be someone else, or sign off for a person.

If any check fails, the run fails and nothing is pushed.

## See the web app without a server

`pnpm --filter @opificia/web dev:fixtures` starts the web app on <http://localhost:5174> with recorded runs in every state, and no server, database or GitHub App. `pnpm --filter @opificia/web screenshot` takes screenshots of every state, in light and dark ([ADR-0009](adr/0009-let-agents-see-the-web-app.md)). The sandbox image contains Chromium, so agents can do the same when they change the web app.

## Where data lives

- PostgreSQL holds accounts, organisations, runs and their events.
- `.data/` in the repository holds a cache of each repository and the files of each run. The log of each sandbox is in `.data/runs/<run>/<session>/container.log`.

## Network access

The implementation stage can install dependencies through an egress proxy in the sandbox gateway ([ADR-0007](adr/0007-sandbox-network-policy.md)). `OPIFICIA_SANDBOX_NETWORK` sets the level:

| Level | The sandbox can reach |
| --- | --- |
| `none` | Nothing but the gateway. |
| `registries` (default) | Package registries and download hosts on a built-in list, plus the hosts in `OPIFICIA_EGRESS_ALLOW`. |
| `open` | Every host that is not on the deny list. |

The proxy:

- only handles HTTPS on port 443, through `CONNECT`, and does not decrypt it. It sees the host name and the number of bytes, not the content;
- refuses IP addresses, and host names that resolve to private, loopback or link-local addresses, such as the Docker host or a cloud metadata service;
- refuses a deny list at every level: telemetry and direct model access, paste sites, file drops, request catchers and tunnels;
- gives each sandbox its own proxy token, apart from the runner token;
- limits each sandbox to 64 open connections and 4,000 in total, and to 1 MB sent per connection and 32 MB in total. A connection over the first limit waits up to 30 seconds for another to close, rather than being refused. Installing dependencies downloads a lot and sends little; the limits keep an upload small and keep one sandbox from wearing down the server.

The built-in list holds package registries and download-only hosts, such as GitHub's source archives and release assets. It does not hold `github.com`, `gitlab.com` or `codeberg.org`, because they also accept pushes. Add them to `OPIFICIA_EGRESS_ALLOW` if your repositories need them, for example for dependencies fetched with git.

The run timeline shows the first decision for each host. Every connection is logged in `.data/runs/<run>/<session>/egress.log`. The planning stage never has network access.

Entries in `OPIFICIA_EGRESS_ALLOW` are host names, without a scheme, port or wildcard, such as `example.org`. A leading dot, as in `.example.org`, includes subdomains. The server refuses to start when an entry is not a host name.

To let Opificia work on its own repository, add `binaries.prisma.sh` to `OPIFICIA_EGRESS_ALLOW`. Prisma downloads its engines from there while it installs, and the build fails without them.

The decision model for unknown hosts and the button to allow a host for a repository come later. Until then, a host that is not on the list is refused; add it to `OPIFICIA_EGRESS_ALLOW` if you trust it.

## Limits

This is a prototype. In particular:

- A plain container is not a strong security boundary. Stronger isolation, such as gVisor, comes later (ADR-0004, step 2).
- The issue text reaches the model. Someone who can write issues in your repository can try to steer the agent. The plan approval and the checks above limit the damage, but do not label issues from people you do not trust.
- With network access, an agent that someone steered could still send data out through an allowed host. For example, an issue could contain someone's npm token, and the agent could publish a package with it. The proxy does not see request bodies; the upload limits keep such a leak small, but cannot stop a short secret. For a repository whose code must not leave your machine, set `OPIFICIA_SANDBOX_NETWORK=none`.
- Only the people in `OPIFICIA_OPERATOR_EMAILS` can link installations of your GitHub App. A shared install also needs to check each person's own access on GitHub.
- Email addresses are not verified. Set `OPIFICIA_SIGNUP=closed` once you have created your account, so nobody else can sign up.
- The harness enforces the USD budget inside the sandbox. The model proxy only caps the number of model requests per stage (`OPIFICIA_MAX_MODEL_REQUESTS`). An agent that bypasses the harness can spend more than the budget, up to that cap. Metering spend in the proxy comes later.
- The server polls GitHub; webhooks come later.
- Only the `claude` harness exists. A second harness for open-weight models is planned for phase 2.
- The runner protocol is version 0 and will change. An RFC will specify it.

## Troubleshooting

- **"the sandbox image ... is missing":** run `pnpm sandbox:build`.
- **A run fails at once with "could not start the sandbox":** check that your container engine runs and that `docker image inspect opificia/harness-claude:dev` finds the image. On Linux, the gateway reaches the server through `host.docker.internal`, which needs Docker Engine 20.10 or later.
- **No run starts:** check that the installation is linked in **Settings**, that the issue is open and labelled `opificia`, and look at the server log.
