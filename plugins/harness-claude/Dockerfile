# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: Apache-2.0
#
# Sandbox image for the claude harness. Build it from the repository root:
#   docker build -t opificia/harness-claude:dev -f plugins/harness-claude/Dockerfile .
#
# The image contains Claude Code as a dependency of the Claude Agent SDK. Build
# it yourself; Opificia does not publish it (ADR-0004).

# node 24.22.0, Debian bookworm slim
FROM node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
WORKDIR /app
RUN npm install --global --no-fund --no-audit pnpm@12.11.2
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY sdk/contracts/package.json sdk/contracts/
COPY sdk/runner/package.json sdk/runner/
COPY plugins/harness-claude/package.json plugins/harness-claude/
RUN pnpm install --frozen-lockfile --filter "@opificia/harness-claude..."
COPY sdk/contracts sdk/contracts
COPY sdk/runner sdk/runner
COPY plugins/harness-claude plugins/harness-claude
RUN pnpm --filter "@opificia/harness-claude..." build

# node 24.22.0, Debian bookworm slim
FROM node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
ENV HOME=/home/node \
    CLAUDE_CONFIG_DIR=/home/node/.claude \
    OPIFICIA_IN_DIR=/in \
    OPIFICIA_OUT_DIR=/out \
    OPIFICIA_WORK_DIR=/work
USER node
WORKDIR /work
ENTRYPOINT ["node", "/app/plugins/harness-claude/dist/main.js"]
