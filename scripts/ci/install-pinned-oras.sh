#!/usr/bin/env bash
set -euo pipefail

# Use a fixed, checksum-verified OCI client on both hosted and protected runners.
version=1.3.4
archive_sha256=f27adb935022d94df8dc77719c322dda592c78a0d57a6f7dcdd8d900b248c454
test -n "${RUNNER_TEMP:-}" && test -n "${GITHUB_PATH:-}" || {
  echo '::error::RUNNER_TEMP and GITHUB_PATH are required for the pinned ORAS installer.' >&2
  exit 64
}
install_dir="$(mktemp -d "$RUNNER_TEMP/iot-manager-oras.XXXXXX")"
archive="$install_dir/oras_${version}_linux_amd64.tar.gz"
curl --fail --location --retry 3 --silent --show-error \
  "https://github.com/oras-project/oras/releases/download/v${version}/oras_${version}_linux_amd64.tar.gz" \
  --output "$archive"
printf '%s  %s\n' "$archive_sha256" "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$install_dir" oras
chmod 0755 "$install_dir/oras"
printf '%s\n' "$install_dir" >> "$GITHUB_PATH"
