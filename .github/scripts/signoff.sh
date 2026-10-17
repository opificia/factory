#!/usr/bin/env bash
# SPDX-FileCopyrightText: The Opificia Authors
# SPDX-License-Identifier: CC0-1.0
#
# Signs off a pull request at the merge (ADR-0011). An approving review with
# "/signoff" by a maintainer on the head of the pull request is the sign-off;
# this script merges the pull request with the maintainer's Signed-off-by line
# in the squash commit. It never rewrites the branch.
#
#   signoff.sh find      Finds the pull request and the maintainers whose latest
#                        review approves the current head with "/signoff".
#   signoff.sh token     Gets a token for the Opificia bot, limited to this
#                        repository and to writing contents.
#   signoff.sh recheck   Runs the DCO check again, now that the approval
#                        exists, and waits for it to pass.
#   signoff.sh merge     Squash-merges the approved head, with the sign-off,
#                        once the required checks pass.
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
# The squash commit's message: the subjects of the commits, then their
# Assisted-by and Co-authored-by lines, the sign-offs their authors gave
# themselves, and the sign-offs of the maintainers who approved, given as
# arguments ("Name <email>"). A Signed-off-by
# line for anyone but the commit's author is dropped: anyone can type one, and
# on main it would read as that person's certification. Reads one line per
# commit on standard input: the author's email and the message, both
# base64-encoded, separated by a space.
squash_message() {
  local encoded_email encoded message author subjects="" trailers="" line signer
  while read -r encoded_email encoded; do
    [ -n "$encoded" ] || continue
    author="$(base64 -d <<< "$encoded_email" | tr '[:upper:]' '[:lower:]')"
    message="$(base64 -d <<< "$encoded")"
    subjects+="* $(head -n 1 <<< "$message")"$'\n'
    while IFS= read -r line; do
      case "$(tr '[:upper:]' '[:lower:]' <<< "$line")" in
        assisted-by:* | co-authored-by:*) trailers+="$line"$'\n' ;;
        signed-off-by:*"<$author>") trailers+="$line"$'\n' ;;
      esac
    done < <(git interpret-trailers --parse <<< "$message")
  done
  for signer in "$@"; do trailers+="Signed-off-by: $signer"$'\n'; done
  printf '%s\n%s\n' "$subjects" "$(grep -v '^$' <<< "$trailers" | awk '!seen[tolower($0)]++')"
}

# Needs GH_TOKEN (the bot's token), NUMBER, HEAD_SHA, DEADLINE and
# MAINTAINERS_FILE. Every maintainer whose sign-off stands at the moment of
# the merge signs off, because the DCO check accepts commits by any of them.
# The signers are read again before each attempt: one who withdrew since the
# run started must not sign, and one who joined must. A short window remains
# between reading the reviews and the merge, because GitHub cannot make a merge
# depend on the reviews. The branch rule that requires an approving review
# closes it: GitHub itself refuses the merge once the approval is withdrawn. GitHub merges only if the head is still the approved
# commit ("sha") and the branch rules are met, such as the required checks.
merge() {
  : "${NUMBER:?}" "${HEAD_SHA:?}" "${DEADLINE:?}" "${MAINTAINERS_FILE:?}"
  local login logins name email message deadline="$DEADLINE" result title commits signers names
  title="$(gh api "repos/$GITHUB_REPOSITORY/pulls/$NUMBER" --jq .title)"
  commits="$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$NUMBER/commits" \
    --jq '.[] | "\(.commit.author.email | @base64) \(.commit.message | @base64)"')"

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
    message="$(squash_message "${signers[@]}" <<< "$commits")"
    if result="$(gh api -X PUT "repos/$GITHUB_REPOSITORY/pulls/$NUMBER/merge" \
      -f merge_method=squash -f sha="$HEAD_SHA" -f commit_title="$title (#$NUMBER)" -f commit_message="$message" \
      --jq .sha 2>&1)"; then
      note "Merged #$NUMBER as $result, signed off by ${names[*]}."
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

case "${1:-}" in
  find) find_review ;;
  token) token ;;
  recheck) recheck ;;
  merge) merge ;;
  squash-message) shift; squash_message "$@" ;;
  *) die "usage: signoff.sh find|token|recheck|merge" ;;
esac
