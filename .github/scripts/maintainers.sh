#!/usr/bin/env bash
# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: CC0-1.0
#
# Prints the active maintainers from MAINTAINERS.md, one per line, as
# "handle<TAB>name<TAB>email", with the handle in lower case and without "@".
# Reads the file given as the first argument, or standard input. Rows without
# an email address are skipped. Used by the DCO check and the Sign-off
# workflow (ADR-0006).

set -euo pipefail

awk -F '|' '
  function trim(s) { gsub(/^[ \t`]+|[ \t`]+$/, "", s); return s }
  /^## / { in_section = ($0 == "## Active maintainers"); next }
  !in_section || !/^\|/ { next }
  /^\| *---/ { next }
  !header_seen {
    for (i = 2; i < NF; i++) col[trim($i)] = i
    header_seen = 1
    next
  }
  !("Handle" in col && "Name" in col && "Email" in col) { next }
  {
    handle = tolower(trim($col["Handle"])); sub(/^@/, "", handle)
    name = trim($col["Name"])
    email = trim($col["Email"])
    if (handle ~ /^[a-z0-9-]+$/ && email ~ /^[^ <>@]+@[^ <>@]+$/ && name != "" && name !~ /^\*/)
      printf "%s\t%s\t%s\n", handle, name, email
  }
' "${1:-/dev/stdin}"
