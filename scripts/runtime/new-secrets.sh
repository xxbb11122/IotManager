#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
secret_directory="${1:-$repository_root/deploy/.runtime/iot-manager-p0/secrets}"
force="${IOT_FORCE_SECRETS:-false}"

mkdir -p "$secret_directory"
chmod 700 "$secret_directory"
umask 077

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 48
  else
    od -An -N48 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

for secret_name in \
  postgres_admin_password \
  iot_db_owner_password \
  iot_db_app_password \
  keycloak_db_password \
  keycloak_bootstrap_admin_password \
  keycloak_owner_password \
  keycloak_admin_password \
  keycloak_operator_password \
  keycloak_viewer_password \
  weather_fingerprint_secret \
  metrics_scrape_token \
  walg_s3_access_key \
  walg_s3_secret_key; do
  secret_path="$secret_directory/$secret_name"
  if [[ -f "$secret_path" && "$force" != "true" ]]; then
    printf 'Preserved existing secret: %s\n' "$secret_name"
    continue
  fi
  random_hex > "$secret_path"
  chmod 600 "$secret_path"
  printf 'Generated secret: %s\n' "$secret_name"
done

printf 'Secret directory ready: %s\n' "$secret_directory"
