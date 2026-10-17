#!/usr/bin/env bash
# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: CC0-1.0
#
# Signs off a pull request at the merge (ADR-0011, ADR-0012). An approving
# review with "/signoff" by a maintainer on the head of the pull request is
# the sign-off; this script merges the pull request with a merge commit that
# carries the maintainer's Signed-off-by line. It never rewrites the branch.
#
#   signoff.sh find      Finds the pull request and the maintainers whose latest
#                        review approves the current head with "/signoff".
#   signoff.sh token     Gets a token for the Opificia bot, limited to this
#                        repository and to writing contents.
#   signoff.sh recheck   Runs the DCO check again, now that the approval
#                        exists, and waits for it to pass.
#   signoff.sh merge     Merges the approved head with a merge commit that
#                        carries the sign-off, once the required checks pass.
#
# The Sign-off workflow runs this script from the default branch, never from
# the pull request. Every fact comes from the GitHub API or from git, not from
# the event that started the workflow.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "::error::$*" >&2; exit 1; }
note() { echo "::notice::$*"; }
output() { echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/null}"; }

# How long the run may wait, in all, for the DCO check and the other required
# checks. `find` sets the deadline; the later steps share it.
WAIT_SECONDS="${WAIT_SECONDS:-1800}"
POLL_SECONDS="${POLL_SECONDS:-20}"

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

# The maintainers whose latest review approves HEAD_SHA with "/signoff", on
# pull request $1, separated by spaces. Reviews are read again on every call:
# a reviewer can withdraw a sign-off, or another can give one, at any time.
signers() {
  local reviews logins="" candidate commit_id
  reviews="$("$here/signoff-reviews.sh" "$GITHUB_REPOSITORY" "$1")" || die "Could not read the reviews of #$1."
  while read -r candidate commit_id; do
    [ -n "$candidate" ] && [ "$commit_id" = "$HEAD_SHA" ] || continue
    if cut -f1 "$MAINTAINERS_FILE" | grep -qxF "$candidate"; then logins+="${logins:+ }$candidate"; fi
  done <<< "$reviews"
  [[ -z "$logins" || "$logins" =~ ^[a-z0-9-]+( [a-z0-9-]+)*$ ]] || die "Unexpected reviewers on #$1."
  echo "$logins"
}

# --- find -------------------------------------------------------------------
# Needs GH_TOKEN (read access), HEAD_SHA and MAINTAINERS_FILE.
find_review() {
  local pr number logins
  pr="$(gh api "repos/$GITHUB_REPOSITORY/commits/$HEAD_SHA/pulls" --jq \
    "[.[] | select(.state == \"open\" and .head.sha == \"$HEAD_SHA\" and .head.repo.full_name == \"$GITHUB_REPOSITORY\")][0] // empty")"
  if [ -z "$pr" ]; then
    note "No open pull request from this repository has $HEAD_SHA as its head. Nothing to do."
    return 0
  fi
  number="$(jq -r .number <<< "$pr")"
  # Approvals on exactly this commit, with a line that reads "/signoff".
  # Each reviewer's latest review counts, and it must be on this exact commit.
  logins="$(signers "$number")"
  if [ -z "$logins" ]; then
    note "No approving review with /signoff by a maintainer on $HEAD_SHA. Nothing to do."
    return 0
  fi
  local base default
  base="$(jq -r .base.ref <<< "$pr")"
  default="$(gh api "repos/$GITHUB_REPOSITORY" --jq .default_branch)"
  if [ "$base" != "$default" ]; then
    note "Pull request #$number goes into $base, not $default. It is merged once it goes into $default; approve it again then."
    return 0
  fi
  # The bot's token cannot write workflows, so it cannot merge changes to them.
  # The list is read in full first: a failed request must stop the run, not
  # pass as "no workflow changes".
  local files
  files="$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$number/files" --jq '.[].filename')" || die "Could not read the files of #$number."
  if grep -q '^\.github/workflows/' <<< "$files"; then
    die "Pull request #$number changes .github/workflows/, which the bot may not merge. Sign off in a terminal (git signoff && git push --force-with-lease) and merge it yourself."
  fi
  # Only values of a known shape go to GITHUB_OUTPUT: a newline in free text,
  # such as a title, could add outputs of its own.
  [[ "$logins" =~ ^[a-z0-9-]+( [a-z0-9-]+)*$ ]] && [[ "$number" =~ ^[0-9]+$ ]] || die "Unexpected reviewers or pull request number."
  output logins "$logins"
  output number "$number"
  output deadline "$(( $(date +%s) + WAIT_SECONDS ))"
}

# --- recheck ----------------------------------------------------------------
# Needs GH_TOKEN with "actions: write", HEAD_SHA and DEADLINE. The DCO check ran before
# the approval existed; a new run sees it. The run uses the workflow and the
# script from the default branch, as every DCO run does.
recheck() {
  local run deadline="${DEADLINE:?}" status conclusion
  run="$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/dco.yml/runs?head_sha=$HEAD_SHA&event=pull_request_target&per_page=1" --jq '.workflow_runs[0].id // empty')"
  [ -n "$run" ] || die "No DCO run found for $HEAD_SHA."
  while :; do
    read -r status conclusion <<< "$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run" --jq '"\(.status) \(.conclusion)"')"
    [ "$status" = completed ] && break
    [ "$(date +%s)" -lt "$deadline" ] || die "The DCO run $run did not finish in time."
    sleep "$POLL_SECONDS"
  done
  if [ "$conclusion" != success ]; then
    gh api -X POST "repos/$GITHUB_REPOSITORY/actions/runs/$run/rerun" > /dev/null
    sleep "$POLL_SECONDS"
    while :; do
      read -r status conclusion <<< "$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run" --jq '"\(.status) \(.conclusion)"')"
      [ "$status" = completed ] && break
      [ "$(date +%s)" -lt "$deadline" ] || die "The DCO run $run did not finish in time."
      sleep "$POLL_SECONDS"
    done
  fi
  [ "$conclusion" = success ] || die "The DCO check still fails on $HEAD_SHA. See run $run: some commits need their author's own sign-off."
  note "The DCO check passes on $HEAD_SHA."
}

# --- merge ------------------------------------------------------------------
# The merge commit's message: a Signed-off-by line for each maintainer who
# approved, given as arguments ("Name <email>"). With it, they certify every
# commit the merge brings in that its author did not sign off (ADR-0012).
merge_message() {
  local signer
  for signer in "$@"; do printf 'Signed-off-by: %s\n' "$signer"; done
}

# Needs GH_TOKEN (the bot's token), NUMBER, HEAD_SHA, DEADLINE and
# MAINTAINERS_FILE. Every maintainer whose sign-off stands at the moment of
# the merge signs off, because the DCO check accepts commits by any of them.
# The signers are read again before each attempt: one who withdrew since the
# run started must not sign, and one who joined must.
#
# A short window remains between reading the reviews and the merge: GitHub
# cannot make a merge depend on a particular review. A branch rule that
# requires an approving review closes it only when the withdrawn sign-off was
# the last approval; with another approval in place, the merge goes ahead and
# the commit names a maintainer who withdrew a moment before. The sign-offs
# are therefore read once more after the merge, and the run fails, naming
# them, if any withdrew in that window, so that a maintainer can follow up. GitHub merges only if the head is still the approved
# commit ("sha") and the branch rules are met, such as the required checks.
merge() {
  : "${NUMBER:?}" "${HEAD_SHA:?}" "${DEADLINE:?}" "${MAINTAINERS_FILE:?}"
  local login logins name email message deadline="$DEADLINE" result title signers names
  title="$(gh api "repos/$GITHUB_REPOSITORY/pulls/$NUMBER" --jq .title)"

  while :; do
    logins="$(signers "$NUMBER")"
    [ -n "$logins" ] || die "No maintainer's sign-off on $HEAD_SHA stands any more. Nothing was merged."
    signers=()
    names=()
    for login in $logins; do
      name="$(awk -F '\t' -v h="$login" '$1 == h { print $2 }' "$MAINTAINERS_FILE")"
      email="$(awk -F '\t' -v h="$login" '$1 == h { print $3 }' "$MAINTAINERS_FILE")"
      [ -n "$name" ] && [ -n "$email" ] || die "$login is not a maintainer with an email address in MAINTAINERS.md."
      signers+=("$name <$email>")
      names+=("$name")
    done
    message="$(merge_message "${signers[@]}")"
    # The title is the pull request's, so `git log --first-parent` reads like
    # a list of the changes, one line each.
    if result="$(gh api -X PUT "repos/$GITHUB_REPOSITORY/pulls/$NUMBER/merge" \
      -f merge_method=merge -f sha="$HEAD_SHA" -f commit_title="$title (#$NUMBER)" -f commit_message="$message" \
      --jq .sha 2>&1)"; then
      note "Merged #$NUMBER as $result, signed off by ${names[*]}."
      check_after_merge "$logins" "$result"
      return 0
    fi
    # 409: the head moved after the approval. Anything but 405 will not change by waiting.
    grep -q 'HTTP 409' <<< "$result" && die "The head of #$NUMBER moved after the approval. Approve the new head again."
    grep -q 'HTTP 405' <<< "$result" || die "GitHub refused to merge #$NUMBER: $result"
    [ "$(date +%s)" -lt "$deadline" ] || die "#$NUMBER could not be merged in time: $result"
    echo "Waiting for the required checks: $result"
    sleep "$POLL_SECONDS"
  done
}

# Reads the sign-offs again after a merge, and fails the run, naming them, if
# any of the maintainers named in the commit withdrew in the meantime. The
# merge cannot be undone here; the failed run and its summary tell the
# maintainers to look.
check_after_merge() {
  local signed="$1" sha="$2" now login withdrawn=""
  now="$(signers "$NUMBER")"
  for login in $signed; do
    [[ " $now " == *" $login "* ]] || withdrawn+="${withdrawn:+ }$login"
  done
  [ -z "$withdrawn" ] && return 0
  local text="#$NUMBER was merged as $sha with a sign-off by $withdrawn, whose sign-off was withdrawn while it merged. Check whether they still certify the change; if not, revert $sha."
  echo "$text" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  die "$text"
}

case "${1:-}" in
  find) find_review ;;
  token) token ;;
  recheck) recheck ;;
  merge) merge ;;
  merge-message) shift; merge_message "$@" ;;
  *) die "usage: signoff.sh find|token|recheck|merge" ;;
esac
