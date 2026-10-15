#!/usr/bin/env bash
# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: CC0-1.0
#
# Records a maintainer's sign-off on a pull request branch (ADR-0006).
#
#   signoff.sh token   Gets a token for the Opificia bot, limited to this
#                      repository and to writing contents.
#   signoff.sh find    Finds the pull request and a maintainer whose latest
#                      review approves the current head commit with "/signoff".
#   signoff.sh apply   Adds the maintainer's sign-off to the commits, checks
#                      that the tree is unchanged, and pushes.
#
# The Sign-off workflow runs this script from the default branch, never from
# the pull request. Every fact comes from the GitHub API or from git, not from
# the event that started the workflow.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "::error::$*" >&2; exit 1; }
note() { echo "::notice::$*"; }
output() { echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/null}"; }

# --- token ------------------------------------------------------------------
# Needs APP_ID and PRIVATE_KEY. Signs a JWT with openssl, so no extra Action.
token() {
  [ -n "${APP_ID:-}" ] && [ -n "${PRIVATE_KEY:-}" ] || die "Set the OPIFICIA_BOT_APP_ID variable and the OPIFICIA_BOT_PRIVATE_KEY secret."
  b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  local now header payload signature jwt key installation token
  now="$(date +%s)"
  header="$(printf '{"alg":"RS256","typ":"JWT"}' | b64)"
  payload="$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$APP_ID" | b64)"
  key="$(mktemp)"
  trap 'rm -f "$key"' RETURN
  printf '%s\n' "$PRIVATE_KEY" > "$key"
  signature="$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -sign "$key" | b64)"
  jwt="$header.$payload.$signature"
  installation="$(curl -fsS -H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/installation" | jq -r .id)"
  token="$(curl -fsS -X POST -H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/app/installations/$installation/access_tokens" \
    -d "{\"repositories\":[\"${GITHUB_REPOSITORY#*/}\"],\"permissions\":{\"contents\":\"write\"}}" | jq -r .token)"
  [ -n "$token" ] && [ "$token" != null ] || die "Could not get a token for the Opificia bot."
  echo "::add-mask::$token"
  output token "$token"
}

# --- find -------------------------------------------------------------------
# Needs GH_TOKEN (read access), HEAD_SHA and MAINTAINERS_FILE.
find_review() {
  local pr reviews login
  pr="$(gh api "repos/$GITHUB_REPOSITORY/commits/$HEAD_SHA/pulls" --jq \
    "[.[] | select(.state == \"open\" and .head.sha == \"$HEAD_SHA\" and .head.repo.full_name == \"$GITHUB_REPOSITORY\")][0] // empty")"
  if [ -z "$pr" ]; then
    note "No open pull request from this repository has $HEAD_SHA as its head. Nothing to do."
    return 0
  fi
  # Approvals on exactly this commit, with a line that reads "/signoff".
  # Each reviewer's latest review counts, and it must be on this exact commit.
  reviews="$("$here/signoff-reviews.sh" "$GITHUB_REPOSITORY" "$(jq -r .number <<< "$pr")")"
  login=""
  while read -r candidate commit_id; do
    [ -n "$candidate" ] && [ "$commit_id" = "$HEAD_SHA" ] || continue
    if cut -f1 "$MAINTAINERS_FILE" | grep -qxF "$candidate"; then login="$candidate"; fi
  done <<< "$reviews"
  if [ -z "$login" ]; then
    note "No approving review with /signoff by a maintainer on $HEAD_SHA. Nothing to do."
    return 0
  fi
  # The bot force-pushes the head branch, so it must be an ordinary work
  # branch: never the default branch, and not covered by any branch rule.
  # Only pull requests into the default branch qualify.
  local branch base default rules
  branch="$(jq -r .head.ref <<< "$pr")"
  base="$(jq -r .base.ref <<< "$pr")"
  default="$(gh api "repos/$GITHUB_REPOSITORY" --jq .default_branch)"
  [ "$base" = "$default" ] || die "Sign-off by approval works only for pull requests into $default."
  [ "$branch" != "$default" ] || die "The head branch is $default. It cannot be rewritten."
  rules="$(gh api "repos/$GITHUB_REPOSITORY/rules/branches/$branch" --jq 'length')"
  [ "$rules" = 0 ] || die "Branch rules apply to $branch, so the bot will not rewrite it. Sign off in a terminal."
  output login "$login"
  output branch "$branch"
  output base "$base"
  output number "$(jq -r .number <<< "$pr")"
  # The bot that opened the pull request, if a bot did. Only its commits may
  # receive a maintainer's sign-off, apart from the maintainer's own.
  output bot_email "$(jq -r 'select(.user.type == "Bot") | "\(.user.id)+\(.user.login)@users.noreply.github.com" | ascii_downcase' <<< "$pr")"
}

# --- apply ------------------------------------------------------------------
# Needs LOGIN, BRANCH, BASE, HEAD_SHA, MAINTAINERS_FILE and PUSH_URL, and
# BOT_EMAIL when a bot opened the pull request. Runs in a clone where the
# branch and the base can be fetched from "origin".
apply() {
  local name email base_sha new_head
  : "${LOGIN:?}" "${BRANCH:?}" "${BASE:?}" "${HEAD_SHA:?}" "${MAINTAINERS_FILE:?}" "${PUSH_URL:?}"
  name="$(awk -F '\t' -v h="$LOGIN" '$1 == h { print $2 }' "$MAINTAINERS_FILE")"
  email="$(awk -F '\t' -v h="$LOGIN" '$1 == h { print $3 }' "$MAINTAINERS_FILE")"
  [ -n "$name" ] && [ -n "$email" ] || die "$LOGIN is not a maintainer with an email address in MAINTAINERS.md."

  git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" "+refs/heads/$BASE:refs/remotes/origin/$BASE"
  [ "$(git rev-parse "origin/$BRANCH")" = "$HEAD_SHA" ] || die "The branch moved after the approval. Approve the new head again."
  git checkout --quiet --detach "$HEAD_SHA"
  base_sha="$(git merge-base HEAD "origin/$BASE")"

  [ -z "$(git rev-list --merges "$base_sha..HEAD")" ] || die "The branch contains merge commits. Rebase it on $BASE first."
  if git diff --name-only "$base_sha" HEAD | grep -q '^\.github/workflows/'; then
    die "The branch changes workflows, which the bot may not push. Sign off in a terminal: git signoff && git push --force-with-lease"
  fi

  # Only commits by the bot that opened the pull request or by the approving
  # maintainer may receive this maintainer's sign-off. Anyone else certifies
  # their own commits. An author email alone proves nothing, so a bot email
  # counts only when that bot is the author of the pull request.
  local sha author signoffs pending=0 lower bot_id=""
  # Only the bot's user ID counts, because the login in its noreply address
  # changes when someone renames the App.
  [[ "${BOT_EMAIL:-}" =~ ^([0-9]+)\+ ]] && bot_id="${BASH_REMATCH[1]}"
  for sha in $(git rev-list "$base_sha..HEAD"); do
    author="$(git show -s --format='%ae' "$sha")"
    signoffs="$(git show -s --format='%(trailers:key=Signed-off-by,valueonly)' "$sha")"
    grep -qiF "<$author>" <<< "$signoffs" && continue
    grep -qiF "<$email>" <<< "$signoffs" && continue
    lower="$(tr '[:upper:]' '[:lower:]' <<< "$author")"
    if { [ -n "$bot_id" ] && grep -qE "^${bot_id}\+[a-z0-9-]+\[bot\]@users\.noreply\.github\.com$" <<< "$lower"; } ||
      [ "$lower" = "$(tr '[:upper:]' '[:lower:]' <<< "$email")" ]; then
      pending=1
    else
      die "Commit $(git show -s --format='%h' "$sha") is by $author, who must sign it off themselves."
    fi
  done
  if [ "$pending" -eq 0 ]; then
    note "Every commit is already signed off. Nothing to do."
    return 0
  fi

  GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" \
    git -c user.name="$name" -c user.email="$email" rebase --quiet --signoff --force-rebase "$base_sha"
  new_head="$(git rev-parse HEAD)"
  [ "$(git rev-parse "$new_head^{tree}")" = "$(git rev-parse "$HEAD_SHA^{tree}")" ] || die "The tree changed while signing off. Nothing was pushed."

  git push --quiet --force-with-lease="refs/heads/$BRANCH:$HEAD_SHA" "$PUSH_URL" "$new_head:refs/heads/$BRANCH"
  output new_head "$new_head"
  note "Signed off $BRANCH for $name. New head: $new_head."
}

case "${1:-}" in
  token) token ;;
  find) find_review ;;
  apply) apply ;;
  *) die "usage: signoff.sh token|find|apply" ;;
esac
