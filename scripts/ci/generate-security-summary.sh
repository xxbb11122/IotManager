#!/usr/bin/env bash
set -euo pipefail

# A compatibility-oriented public entry point. The implementation validates
# every individual immutable scan result before producing the summary.
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$repository_root/scripts/ci/release-tools.mjs" assemble-image-scans "$@"
