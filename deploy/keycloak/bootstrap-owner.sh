#!/bin/bash
set -euo pipefail

verify_idempotent=false
case "${1:-}" in
  "") ;;
  --verify-idempotent) verify_idempotent=true ;;
  *) printf 'Unsupported bootstrap argument: %s\n' "$1" >&2; exit 64 ;;
esac

read_secret() {
  local name="$1"
  local secret_file="/run/secrets/${name}"
  [[ -r "$secret_file" ]] || { printf 'Required Keycloak secret is unavailable: %s\n' "$name" >&2; exit 78; }
  local value
  value="$(<"$secret_file")"
  [[ -n "$value" ]] || { printf 'Required Keycloak secret is empty: %s\n' "$name" >&2; exit 78; }
  printf '%s' "$value"
}

required() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "$value" ]] || { printf 'Required environment variable is empty: %s\n' "$name" >&2; exit 64; }
}

boolean() {
  local name="$1"
  local value="${!name:-false}"
  case "$value" in
    true|false) printf '%s' "$value" ;;
    *) printf 'Environment variable %s must be true or false.\n' "$name" >&2; exit 64 ;;
  esac
}

for variable in KEYCLOAK_REALM KC_BOOTSTRAP_ADMIN_USERNAME IOT_BOOTSTRAP_OWNER_USERNAME IOT_BOOTSTRAP_OWNER_DISPLAY_NAME IOT_BOOTSTRAP_OWNER_EMAIL; do
  required "$variable"
done

integration_identities_enabled="$(boolean IOT_CREATE_INTEGRATION_IDENTITIES)"
legacy_viewer_enabled="$(boolean IOT_CREATE_INTEGRATION_VIEWER)"

if [[ "$integration_identities_enabled" == true ]]; then
  for variable in \
    IOT_ADMIN_USERNAME IOT_ADMIN_DISPLAY_NAME IOT_ADMIN_EMAIL \
    IOT_OPERATOR_USERNAME IOT_OPERATOR_DISPLAY_NAME IOT_OPERATOR_EMAIL \
    IOT_VIEWER_USERNAME IOT_VIEWER_DISPLAY_NAME IOT_VIEWER_EMAIL; do
    required "$variable"
  done
elif [[ "$legacy_viewer_enabled" == true ]]; then
  for variable in IOT_VIEWER_USERNAME IOT_VIEWER_DISPLAY_NAME IOT_VIEWER_EMAIL; do
    required "$variable"
  done
fi

config_file="$(mktemp)"
snapshot_one=""
snapshot_two=""
trap 'rm -f "$config_file" "$snapshot_one" "$snapshot_two"' EXIT HUP INT TERM
kcadm() {
  /opt/keycloak/bin/kcadm.sh "$@" --config "$config_file"
}
admin_password="$(read_secret keycloak_bootstrap_admin_password)"
kcadm config credentials --server http://127.0.0.1:8080/auth --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$admin_password" >/dev/null
unset admin_password

realm="$KEYCLOAK_REALM"
user_id() {
  kcadm get users -r "$realm" -q "username=$1" --fields id --format csv --noquotes \
    | tr -d '\r' | head -n 1
}

ensure_user() {
  local username="$1"
  local display_name="$2"
  local email="$3"
  local password_secret="$4"
  local role="$5"
  local id
  id="$(user_id "$username")"
  if [[ -z "$id" ]]; then
    kcadm create users -r "$realm" -s "username=$username" -s enabled=true \
      -s "email=$email" -s emailVerified=true -s "firstName=$display_name" \
      -s "lastName=$display_name" >/dev/null
    id="$(user_id "$username")"
  fi
  [[ -n "$id" ]] || { printf 'Unable to locate Keycloak user: %s\n' "$username" >&2; exit 70; }
  # Keycloak's default profile requires first and last name. Keep existing
  # integration users profile-complete so an older stack cannot divert PKCE
  # automation to a required-action form.
  kcadm update "users/$id" -r "$realm" -s enabled=true -s "email=$email" \
    -s emailVerified=true -s "firstName=$display_name" -s "lastName=$display_name" \
    -s 'requiredActions=[]' >/dev/null
  local password
  password="$(read_secret "$password_secret")"
  # Keycloak 26 interprets --temporary as a boolean flag; omission makes this
  # integration password non-temporary without exposing it in output.
  kcadm set-password -r "$realm" --username "$username" --new-password "$password" >/dev/null
  unset password
  if ! kcadm get "users/$id/role-mappings/realm" -r "$realm" | grep -q '"name" : "'"$role"'"'; then
    kcadm add-roles -r "$realm" --uusername "$username" --rolename "$role" >/dev/null
  fi
  printf '%s' "$id"
}

owner_id=""
admin_id=""
operator_id=""
viewer_id=""

bootstrap_users() {
  owner_id="$(ensure_user "$IOT_BOOTSTRAP_OWNER_USERNAME" "$IOT_BOOTSTRAP_OWNER_DISPLAY_NAME" "$IOT_BOOTSTRAP_OWNER_EMAIL" keycloak_owner_password OWNER)"
  admin_id=""
  operator_id=""
  viewer_id=""

  if [[ "$integration_identities_enabled" == true ]]; then
    admin_id="$(ensure_user "$IOT_ADMIN_USERNAME" "$IOT_ADMIN_DISPLAY_NAME" "$IOT_ADMIN_EMAIL" keycloak_admin_password ADMIN)"
    operator_id="$(ensure_user "$IOT_OPERATOR_USERNAME" "$IOT_OPERATOR_DISPLAY_NAME" "$IOT_OPERATOR_EMAIL" keycloak_operator_password OPERATOR)"
    viewer_id="$(ensure_user "$IOT_VIEWER_USERNAME" "$IOT_VIEWER_DISPLAY_NAME" "$IOT_VIEWER_EMAIL" keycloak_viewer_password VIEWER)"
  elif [[ "$legacy_viewer_enabled" == true ]]; then
    viewer_id="$(ensure_user "$IOT_VIEWER_USERNAME" "$IOT_VIEWER_DISPLAY_NAME" "$IOT_VIEWER_EMAIL" keycloak_viewer_password VIEWER)"
  fi
}

snapshot_user() {
  local role="$1"
  local id="$2"
  [[ -n "$id" ]] || return 0
  printf '[%s]\n' "$role"
  kcadm get "users/$id" -r "$realm" --fields id,username,enabled,email,emailVerified,firstName,lastName,requiredActions
  kcadm get "users/$id/role-mappings/realm" -r "$realm" --fields id,name --format csv --noquotes | sort
}

capture_snapshot() {
  snapshot_user OWNER "$owner_id"
  snapshot_user ADMIN "$admin_id"
  snapshot_user OPERATOR "$operator_id"
  snapshot_user VIEWER "$viewer_id"
}

emit_subjects() {
  printf 'IOT_BOOTSTRAP_OWNER_SUBJECT=%s\n' "$owner_id"
  [[ -z "$admin_id" ]] || printf 'IOT_BOOTSTRAP_ADMIN_SUBJECT=%s\n' "$admin_id"
  [[ -z "$operator_id" ]] || printf 'IOT_BOOTSTRAP_OPERATOR_SUBJECT=%s\n' "$operator_id"
  [[ -z "$viewer_id" ]] || printf 'IOT_BOOTSTRAP_VIEWER_SUBJECT=%s\n' "$viewer_id"
}

bootstrap_users
if [[ "$verify_idempotent" == true ]]; then
  snapshot_one="$(mktemp)"
  capture_snapshot > "$snapshot_one"
  bootstrap_users
  snapshot_two="$(mktemp)"
  capture_snapshot > "$snapshot_two"
  # Keep the verification runnable in Keycloak's minimal base image, which
  # does not provide GNU cmp/diff.  Snapshot output is textual kcadm data.
  [[ "$(<"$snapshot_one")" == "$(<"$snapshot_two")" ]] || {
    printf 'Keycloak bootstrap is not idempotent.\n' >&2
    exit 70
  }
  emit_subjects
  printf 'KEYCLOAK_BOOTSTRAP_IDEMPOTENT=true\n'
else
  emit_subjects
fi
