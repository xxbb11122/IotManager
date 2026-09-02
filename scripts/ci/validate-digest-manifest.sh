#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$repository_root/scripts/ci/release-tools.mjs" validate-digest-manifest "$@"
