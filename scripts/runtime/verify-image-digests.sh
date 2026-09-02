#!/usr/bin/env bash
set -euo pipefail

# Aggregate the separately captured runtime 12/12 and recovery-added 1/1
# observations into the required release-candidate 13/13 service union.
# This wrapper intentionally performs no Docker action itself; collection is
# handled by start-integration/recovery scripts and the verifier below makes
# the final identity, lifecycle and digest assertions deterministic.
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$repository_root/scripts/ci/release-tools.mjs" aggregate-service-digests "$@"
