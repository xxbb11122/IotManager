#!/usr/bin/env bash
# Run on a dedicated Linux VM as its unprivileged runner account.
set -euo pipefail
umask 077
mode="${1:-check}"
case "$mode" in check|register) ;; *) echo 'Usage: recovery-runner.sh check|register' >&2; exit 64;; esac
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Linux x86_64 is required by the pinned ORAS toolchain.' >&2; exit 78; }
[[ "$(id -u)" != 0 ]] || { echo 'Use an unprivileged dedicated runner account.' >&2; exit 78; }
for tool in docker node gh git tar sha256sum realpath; do command -v "$tool" >/dev/null; done
docker info >/dev/null
docker compose version >/dev/null
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
gh attestation verify --help >/dev/null
[[ "$(df -Pk . | awk 'END {print $4}')" -ge 20971520 ]] || { echo 'At least 20 GiB free disk is required.' >&2; exit 78; }
if [[ "$mode" == check ]]; then
  printf '{"status":"PASS","scope":"linux-host-prerequisites-only","productionApproved":false,"registered":false}\n'
  exit 0
fi
: "${IOT_RUNNER_REPOSITORY:?owner/repository is required}"
: "${IOT_RUNNER_HOME:?New absolute directory outside the repository is required}"
: "${IOT_RUNNER_ARCHIVE:?Official Linux x64 runner archive is required}"
: "${IOT_RUNNER_ARCHIVE_SHA256:?Checksum copied from GitHub runner setup is required}"
: "${IOT_RUNNER_NAME:?Unique runner name is required}"
[[ "$IOT_RUNNER_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ "$IOT_RUNNER_NAME" =~ ^[A-Za-z0-9_-]{1,64}$ ]]
[[ "$IOT_RUNNER_ARCHIVE_SHA256" =~ ^[a-f0-9]{64}$ ]]
[[ "$IOT_RUNNER_HOME" == /* && ! -e "$IOT_RUNNER_HOME" && ! -L "$IOT_RUNNER_HOME" ]]
runner_home="$(realpath -m "$IOT_RUNNER_HOME")"
checkout="$(git rev-parse --show-toplevel)"
[[ "$runner_home" != / && "$runner_home" != "$checkout" && "$runner_home" != "$checkout/"* ]]
printf '%s  %s\n' "$IOT_RUNNER_ARCHIVE_SHA256" "$IOT_RUNNER_ARCHIVE" | sha256sum --check --status
# The archive must first match GitHub's out-of-band checksum. Refuse absolute
# and traversal members as a second guard; never run a downloaded shell pipe.
tar -tzf "$IOT_RUNNER_ARCHIVE" | node --input-type=module -e '
 let s="";for await(const c of process.stdin)s+=c;
 if(s.split("\n").some(p=>p.startsWith("/")||p.split("/").includes("..")))process.exit(1);'
mkdir -m 0700 "$runner_home"
tar -xzf "$IOT_RUNNER_ARCHIVE" --no-same-owner -C "$runner_home"
cd "$runner_home"
test -x ./config.sh
token="$(gh api --method POST "repos/$IOT_RUNNER_REPOSITORY/actions/runners/registration-token" --jq .token)"
test -n "$token"
trap 'unset token' EXIT
if ! ./config.sh --unattended --ephemeral --url "https://github.com/$IOT_RUNNER_REPOSITORY" \
  --token "$token" --name "$IOT_RUNNER_NAME" --labels iot-manager-recovery --work _work > registration.private.log 2>&1; then
  echo 'Runner registration failed; inspect the mode-0600 registration.private.log locally.' >&2
  exit 1
fi
unset token GH_TOKEN GITHUB_TOKEN
printf 'Registered one-job runner. Start %s/run.sh using the dedicated account. Re-register after each job.\n' "$runner_home"
