#!/usr/bin/env bash
# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: CC0-1.0
#
# The DCO check of a pull request. Every commit needs a Signed-off-by line
# that matches its author. When a GitHub App bot opened the pull request, a
# commit by that bot may carry a maintainer's sign-off instead (ADR-0006), but
# only if that maintainer approved the pull request with "/signoff" on a
# commit with the same tree. Anyone can type a Signed-off-by line or an author
# email, so neither proves anything alone: the bot is the one GitHub names as
# the author of the pull request.
#
# Needs BASE_SHA, HEAD_SHA, PR_NUMBER, GITHUB_REPOSITORY and GH_TOKEN, and a
# clone with both commits. The maintainers come from the base branch, and the
# workflow runs this script from the base branch too, so a pull request cannot
# change the check that judges it.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git show "${BASE_SHA}:MAINTAINERS.md" | "$here/maintainers.sh" > "$work/maintainers"

# The noreply email of the bot that opened the pull request, or nothing when
# a person opened it.
bot_email="$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" --jq \
  'select(.user.type == "Bot") | "\(.user.id)+\(.user.login)@users.noreply.github.com" | ascii_downcase')"

# Emails of maintainers who approved with /signoff on a commit whose tree is
# the tree of the head. Computed only when a bot commit needs it.
approved_signers() {
  local head_tree login commit_id
  head_tree="$(git rev-parse "${HEAD_SHA}^{tree}")"
  "$here/signoff-reviews.sh" "$GITHUB_REPOSITORY" "$PR_NUMBER" |
    while read -r login commit_id; do
      awk -F '\t' -v h="$login" '$1 == h { found = 1 } END { exit !found }' "$work/maintainers" || continue
      [ "$(gh api "repos/$GITHUB_REPOSITORY/commits/$commit_id" --jq .commit.tree.sha)" = "$head_tree" ] || continue
      awk -F '\t' -v h="$login" '$1 == h { print "<" $3 ">" }' "$work/maintainers"
    done
}

missing=0
signers_loaded=0
for sha in $(git rev-list "${BASE_SHA}..${HEAD_SHA}"); do
  # A merge needs no sign-off only if it adds nothing: its tree must be what
  # git merges on its own. Otherwise it is checked like any other commit,
  # because a merge can carry changes that no other commit shows.
  read -r -a parents <<< "$(git show -s --format='%P' "$sha")"
  if [ "${#parents[@]}" -eq 2 ] &&
    clean="$(git merge-tree --write-tree --no-messages "${parents[0]}" "${parents[1]}" 2>/dev/null)" &&
    [ "$clean" = "$(git rev-parse "$sha^{tree}")" ]; then
    echo "ok      $(git show -s --format='%h %s' "$sha") (merge without changes of its own)"
    continue
  fi
  author_email="$(git show -s --format='%ae' "$sha")"
  signoffs="$(git show -s --format='%(trailers:key=Signed-off-by,valueonly)' "$sha")"
  summary="$(git show -s --format='%h %s' "$sha")"
  if grep -qiF "<${author_email}>" <<< "$signoffs"; then
    echo "ok      $summary"
    continue
  fi
  if [ -n "$bot_email" ] && [ "$(tr '[:upper:]' '[:lower:]' <<< "$author_email")" = "$bot_email" ]; then
    if [ "$signers_loaded" -eq 0 ]; then
      approved_signers > "$work/signers"
      signers_loaded=1
    fi
    if [ -s "$work/signers" ] && grep -qiFf "$work/signers" <<< "$signoffs"; then
      echo "ok      $summary (by the bot that opened the pull request, signed off by a maintainer who approved with /signoff)"
      continue
    fi
  fi
  echo "missing $summary"
  missing=1
done

if [ "$missing" -ne 0 ]; then
  echo
  echo "Some commits lack a Signed-off-by line matching the commit author's email."
  echo "See CONTRIBUTING.md, section 'How to fix a missing sign-off'. A maintainer can also"
  echo "sign off by approving the pull request with /signoff in the review."
  exit 1
fi
