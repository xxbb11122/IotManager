#!/usr/bin/env bash
# Executed on a GitHub-hosted policy job, before protected hosts or secrets.
set -euo pipefail
: "${DEFAULT_BRANCH:?}"
: "${GITHUB_REF:?}"
: "${GITHUB_WORKFLOW_SHA:?}"
source_sha="${SOURCE_SHA:-$GITHUB_SHA}"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ && "$GITHUB_WORKFLOW_SHA" =~ ^[a-f0-9]{40}$ ]]
case "$GITHUB_REF" in
  "refs/heads/$DEFAULT_BRANCH") ;;
  refs/tags/r1-rc.*) [[ "${ALLOW_RELEASE_TAG:-false}" == true ]] ;;
  *) echo 'Only the protected default branch or an approved release-tag invocation may use this workflow.' >&2; exit 64;;
esac
git merge-base --is-ancestor "$source_sha" "refs/remotes/origin/$DEFAULT_BRANCH"
git merge-base --is-ancestor "$GITHUB_WORKFLOW_SHA" "refs/remotes/origin/$DEFAULT_BRANCH"
