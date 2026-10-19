#!/bin/sh
# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: AGPL-3.0-only
#
# Entry point of the server image (apps/server/Dockerfile).
#   serve     runs the server, in the role OPIFICIA_ROLE sets (the default)
#   migrate   applies the database migrations to DATABASE_URL, then exits
set -eu

case "${1:-serve}" in
  serve) exec node /app/apps/server/dist/main.js ;;
  migrate) cd /app/apps/server && exec node_modules/.bin/prisma migrate deploy ;;
  *)
    echo "usage: opificia [serve|migrate]" >&2
    exit 64
    ;;
esac
