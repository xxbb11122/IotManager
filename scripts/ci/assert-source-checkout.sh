#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || "$1" != "--source-sha" ]]; then
  printf 'Usage: %s --source-sha <40-character-git-sha>\n' "$0" >&2
  exit 64
fi

requested_sha="$2"
[[ "$requested_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'sourceSha must be a lowercase 40-character Git SHA.\n' >&2
  exit 64
}

actual_sha="$(git rev-parse HEAD)"
printf 'requestedSourceSha=%s\ncheckedOutSourceSha=%s\n' "$requested_sha" "$actual_sha"
[[ "$actual_sha" == "$requested_sha" ]] || {
  printf 'Checkout SHA mismatch.\n' >&2
  exit 1
}
printf 'checkoutVerified=true\n'
