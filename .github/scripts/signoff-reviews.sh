#!/usr/bin/env bash
# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: CC0-1.0
#
# Prints "login commit" for every reviewer of a pull request whose latest
# review is an approval with a line that reads "/signoff" (ADR-0006). A later
# request for changes, a dismissal or an approval without "/signoff" replaces
# an earlier sign-off. Comments do not change it.
#
# Usage: signoff-reviews.sh <owner/repo> <pull request number>
# Needs GH_TOKEN with read access to pull requests.

set -euo pipefail

gh api --paginate "repos/$1/pulls/$2/reviews" --jq \
  '.[] | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED" or .state == "DISMISSED")
       | [(.user.login | ascii_downcase), .state, .commit_id,
          (if (.body // "") | split("\n") | map(gsub("^\\s+|\\s+$"; "")) | index("/signoff") != null then "1" else "0" end)]
       | @tsv' |
  awk -F '\t' '
    # Reviews come oldest first, so the last line per reviewer wins.
    { state[$1] = $2; commit[$1] = $3; signoff[$1] = $4; if (!($1 in seen)) { seen[$1] = 1; order[++n] = $1 } }
    END {
      for (i = 1; i <= n; i++) {
        login = order[i]
        if (state[login] == "APPROVED" && signoff[login] == "1") print login " " commit[login]
      }
    }'
