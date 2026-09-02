#!/usr/bin/env bash
set -euo pipefail

# Final aggregation is deliberately fail-closed: it consumes exact stage
# files and their service-union verification rather than a latest-success run.
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$repository_root/scripts/ci/release-tools.mjs" aggregate-release-evidence "$@"
