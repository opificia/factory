# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: AGPL-3.0-only
#
# Server image: the control plane (API and worker) and the built web app, which
# the API serves on the same origin (ADR-0010). Build it from the repository
# root:
#   docker build -t opificia/server:dev -f apps/server/Dockerfile .
#
# One image runs every role. OPIFICIA_ROLE chooses api, worker or all, and the
# database migrations run from it too:
#   docker run --rm --env-file .env opificia/server:dev migrate

# node 24.22.0, Debian bookworm slim
FROM node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
WORKDIR /app
# Prisma chooses its migration engine by the OpenSSL it finds, at install time
# here and at run time below, so both stages need the same one.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global --no-fund --no-audit pnpm@12.11.2
ENV CHECKPOINT_DISABLE=1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY sdk/contracts/package.json sdk/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@opificia/server..." --filter "@opificia/web..."
COPY sdk/contracts sdk/contracts
COPY apps/server apps/server
COPY apps/web apps/web
COPY brand/opificia-mark.svg brand/opificia-mark-reverse.svg brand/
COPY website/fonts website/fonts
RUN pnpm --filter "@opificia/server..." --filter "@opificia/web..." build
# Keep only what the server needs at run time. The Prisma CLI stays: it runs
# the migrations.
RUN rm -rf node_modules sdk/contracts/node_modules apps/server/node_modules apps/web/node_modules \
  && pnpm install --frozen-lockfile --prod --filter "@opificia/server..."

# node 24.22.0, Debian bookworm slim
FROM node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
# The worker clones repositories and checks branches with git.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir /data && chown node:node /data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/sdk/contracts/package.json sdk/contracts/
COPY --from=build /app/sdk/contracts/dist sdk/contracts/dist
COPY --from=build /app/sdk/contracts/node_modules sdk/contracts/node_modules
COPY --from=build /app/apps/server/package.json /app/apps/server/prisma.config.ts apps/server/
COPY --from=build /app/apps/server/prisma apps/server/prisma
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/apps/web/dist apps/web/dist
COPY apps/server/docker-entrypoint.sh /usr/local/bin/opificia
# Settings that stop components from contacting their vendors (ADR-0005), and
# the ones every container needs. The rest comes from the environment.
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    BETTER_AUTH_TELEMETRY=0 \
    OPIFICIA_API_BIND=0.0.0.0 \
    OPIFICIA_WEB_DIR=/app/apps/web/dist \
    OPIFICIA_DATA_DIR=/data
USER node
WORKDIR /app/apps/server
EXPOSE 3000 3001
ENTRYPOINT ["opificia"]
CMD ["serve"]
