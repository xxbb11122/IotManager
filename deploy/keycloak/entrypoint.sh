#!/bin/bash
set -euo pipefail

read_secret() {
  local name="$1"
  local secret_file="/run/secrets/${name}"
  if [[ ! -r "$secret_file" ]]; then
    printf 'Required Keycloak secret is unavailable: %s\n' "$name" >&2
    exit 78
  fi
  local value
  value="$(<"$secret_file")"
  if [[ -z "$value" ]]; then
    printf 'Required Keycloak secret is empty: %s\n' "$name" >&2
    exit 78
  fi
  printf '%s' "$value"
}

export KC_BOOTSTRAP_ADMIN_PASSWORD="$(read_secret keycloak_bootstrap_admin_password)"
# KCRAW avoids Keycloak expression resolution of `$` in high-entropy passwords.
export KCRAW_DB_PASSWORD="$(read_secret keycloak_db_password)"
exec /opt/keycloak/bin/kc.sh "$@"
