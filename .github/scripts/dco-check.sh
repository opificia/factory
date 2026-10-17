#!/usr/bin/env bash
# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: CC0-1.0
#
# The DCO check of a pull request. Every commit needs a Signed-off-by line
# that matches its author, with one exception (ADR-0011): a commit without a
# sign-off passes when a maintainer approved the head of the pull request with
# "/signoff", and the commit is by that maintainer or by the bot that opened
# the pull request, and carries no Signed-off-by line of its own. The Sign-off
# workflow then merges the pull request with a merge commit that carries the
# maintainer's Signed-off-by line, which certifies such commits (ADR-0012).
# A commit that carries someone else's Signed-off-by line would land on main
# with a certification nobody gave, so the exception does not cover it. Anyone can type an
# author email, so an email alone proves nothing: the bot is the one GitHub
# names as the author of the pull request, the approval comes from the GitHub
# API, and the exception holds only for branches in this repository, which
# only people with write access can push. A fork could carry commits with a
# maintainer's email that the maintainer never wrote.
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

# The user ID of the bot that opened the pull request, or nothing when a
# person opened it. Its commits carry the noreply address "<id>+<login>@...".
# Only the ID counts, because the login changes when someone renames the App.
pull="$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER")"
bot_id="$(jq -r 'select(.user.type == "Bot") | .user.id' <<< "$pull")"
[[ "$bot_id" =~ ^[0-9]*$ ]] || bot_id=""
same_repo=0
[ "$(jq -r .head.repo.full_name <<< "$pull")" = "$GITHUB_REPOSITORY" ] && same_repo=1
is_bot_commit() {
  [ -n "$bot_id" ] && tr '[:upper:]' '[:lower:]' <<< "$1" | grep -qE "^${bot_id}\+[a-z0-9-]+\[bot\]@users\.noreply\.github\.com$"
}

# Emails of the maintainers whose latest review approves the head commit
# itself with "/signoff", one "<email>" per line, in lower case. Computed only
# when a commit needs it.
approvers() {
  "$here/signoff-reviews.sh" "$GITHUB_REPOSITORY" "$PR_NUMBER" |
    while read -r login commit_id; do
      [ "$commit_id" = "$HEAD_SHA" ] || continue
      awk -F '\t' -v h="$login" '$1 == h { print "<" tolower($3) ">" }' "$work/maintainers"
    done
}

missing=0
approvers_loaded=0
for sha in $(git rev-list "${BASE_SHA}..${HEAD_SHA}"); do
  author_email="$(git show -s --format='%ae' "$sha")"
  summary="$(git show -s --format='%h %s' "$sha")"
  # Every line that reads as a sign-off counts, in the trailers or anywhere
  # else in the message: commits reach main as they are (ADR-0012), and a
  # line in someone else's name there reads as their certification. A line
  # counts when it reads as one to a person, whatever stands between the
  # words, such as other hyphens; it is the author's only when it is exactly
  # "Signed-off-by: <author's name> <<author's email>>".
  author_name="$(git show -s --format='%an' "$sha")"
  own=0
  foreign=0
  while IFS= read -r line; do
    shopt -s nocasematch
    if [[ "$line" =~ ^Signed-off-by:\ ([^\<\>]+)\ \<([^\<\>]+)\>$ ]] &&
      [[ "${BASH_REMATCH[1]}" == "$author_name" ]] && [[ "${BASH_REMATCH[2]}" == "$author_email" ]]; then
      own=1
    else
      foreign=1
    fi
    shopt -u nocasematch
  done < <(git show -s --format='%B' "$sha" | tr -d '\r' | LC_ALL=C grep -iE '^[^[:alnum:]]*signed[^[:alnum:]]*off[^[:alnum:]]*by' || true)
  if [ "$foreign" -eq 1 ]; then
    echo "missing $summary (it carries a sign-off that is not exactly its author's: \"Signed-off-by: $author_name <$author_email>\". Each person signs off their own commits)"
    missing=1
    continue
  fi
  # A merge needs no sign-off only if it adds nothing: its tree must be what
  # git merges on its own. Otherwise it is checked like any other commit,
  # because a merge can carry changes that no other commit shows. Its message
  # is checked above like any other: it reaches main too.
  read -r -a parents <<< "$(git show -s --format='%P' "$sha")"
  if [ "${#parents[@]}" -eq 2 ] &&
    clean="$(git merge-tree --write-tree --no-messages "${parents[0]}" "${parents[1]}" 2>/dev/null)" &&
    [ "$clean" = "$(git rev-parse "$sha^{tree}")" ]; then
    echo "ok      $summary (merge without changes of its own)"
    continue
  fi
  if [ "$own" -eq 1 ]; then
    echo "ok      $summary"
    continue
  fi
  if [ "$same_repo" -eq 1 ] && [ "$approvers_loaded" -eq 0 ]; then
    approvers > "$work/approvers"
    approvers_loaded=1
  fi
  # Only commits without any sign-off line reach this point.
  if [ "$same_repo" -eq 1 ] && [ -s "$work/approvers" ]; then
    if is_bot_commit "$author_email"; then
      echo "ok      $summary (by the bot that opened the pull request; a maintainer approved it with /signoff and signs off in the merge commit)"
      continue
    fi
    if grep -qxF "<$(tr '[:upper:]' '[:lower:]' <<< "$author_email")>" "$work/approvers"; then
      echo "ok      $summary (by a maintainer who approved it with /signoff and signs off in the merge commit)"
      continue
    fi
  fi
  echo "missing $summary"
  missing=1
done

if [ "$missing" -ne 0 ]; then
  echo
  echo "Some commits lack a Signed-off-by line matching the commit author's email."
  echo "See CONTRIBUTING.md, section 'How to fix a missing sign-off'. For commits by the bot"
  echo "that opened the pull request, or by a maintainer, that maintainer can instead approve"
  echo "the head of the pull request with /signoff in the review, which signs off in the merge"
  echo "commit. Such commits must not carry a Signed-off-by line of their own."
  exit 1
fi
