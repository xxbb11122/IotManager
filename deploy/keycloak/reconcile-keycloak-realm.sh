#!/bin/bash
set -euo pipefail

verify_idempotent=false
case "${1:-}" in
  "") ;;
  --verify-idempotent) verify_idempotent=true ;;
  *) printf 'Unsupported reconciliation argument: %s\n' "$1" >&2; exit 64 ;;
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

for variable in KEYCLOAK_REALM KC_BOOTSTRAP_ADMIN_USERNAME IOT_WEB_ORIGIN IOT_DASHBOARD_REDIRECT_URI IOT_CONSOLE_REDIRECT_URI IOT_MOBILE_REDIRECT_URI; do
  required "$variable"
done

config_file="$(mktemp)"
payload_file="$(mktemp)"
snapshot_one=""
snapshot_two=""
trap 'rm -f "$config_file" "$payload_file" "$snapshot_one" "$snapshot_two"' EXIT HUP INT TERM
# Keycloak 26 parses global options after the command and its arguments.
# Keep the session isolated from the container user's default config file so
# concurrent reconciliation/bootstrap runs cannot share credentials.
kcadm() {
  /opt/keycloak/bin/kcadm.sh "$@" --config "$config_file"
}

admin_password="$(read_secret keycloak_bootstrap_admin_password)"
kcadm config credentials --server http://127.0.0.1:8080/auth --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$admin_password" >/dev/null
unset admin_password

realm="$KEYCLOAK_REALM"
ensure_role() {
  local role="$1"
  if ! kcadm get "roles/$role" -r "$realm" >/dev/null 2>&1; then
    kcadm create roles -r "$realm" -s "name=$role" >/dev/null
  fi
}

client_id() {
  kcadm get clients -r "$realm" -q "clientId=$1" --fields id --format csv --noquotes \
    | tr -d '\r' | head -n 1
}

ensure_client() {
  local client="$1"
  local payload="$2"
  local id
  id="$(client_id "$client")"
  if [[ -z "$id" ]]; then
    kcadm create clients -r "$realm" -s "clientId=$client" -s protocol=openid-connect -s enabled=true >/dev/null
    id="$(client_id "$client")"
  fi
  [[ -n "$id" ]] || { printf 'Unable to locate Keycloak client: %s\n' "$client" >&2; exit 70; }
  printf '%s' "$payload" > "$payload_file"
  kcadm update "clients/$id" -r "$realm" -f "$payload_file" >/dev/null
}

reconcile_once() {
  if ! kcadm get "realms/$realm" >/dev/null 2>&1; then
    kcadm create realms -s "realm=$realm" -s enabled=true -s 'displayName=IoT Manager' >/dev/null
  fi

  cat > "$payload_file" <<EOF
{
  "displayName": "IoT Manager",
  "enabled": true,
  "registrationAllowed": false,
  "rememberMe": false,
  "verifyEmail": true,
  "bruteForceProtected": true,
  "failureFactor": 5,
  "waitIncrementSeconds": 60,
  "maxFailureWaitSeconds": 900,
  "accessTokenLifespan": 300,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 28800,
  "offlineSessionIdleTimeout": 2592000,
  "revokeRefreshToken": true,
  "refreshTokenMaxReuse": 0
}
EOF
  kcadm update "realms/$realm" -f "$payload_file" >/dev/null

  for role in OWNER ADMIN OPERATOR VIEWER; do
    ensure_role "$role"
  done

  local web_payload mobile_payload
  web_payload=$(cat <<EOF
{
  "enabled": true,
  "protocol": "openid-connect",
  "publicClient": true,
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "redirectUris": ["$IOT_DASHBOARD_REDIRECT_URI", "$IOT_CONSOLE_REDIRECT_URI"],
  "webOrigins": ["$IOT_WEB_ORIGIN"],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "$IOT_DASHBOARD_REDIRECT_URI##$IOT_CONSOLE_REDIRECT_URI"
  }
}
EOF
)
  mobile_payload=$(cat <<EOF
{
  "enabled": true,
  "protocol": "openid-connect",
  "publicClient": true,
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "redirectUris": ["$IOT_MOBILE_REDIRECT_URI"],
  "webOrigins": ["capacitor://localhost", "http://localhost"],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "$IOT_MOBILE_REDIRECT_URI"
  }
}
EOF
)
  ensure_client iot-web "$web_payload"
  ensure_client iot-mobile "$mobile_payload"
}

snapshot_client() {
  local client="$1"
  local id
  id="$(client_id "$client")"
  [[ -n "$id" ]] || { printf 'Unable to capture Keycloak client: %s\n' "$client" >&2; exit 70; }
  printf '[client:%s]\n' "$client"
  kcadm get "clients/$id" -r "$realm"
}

capture_snapshot() {
  printf '[realm]\n'
  kcadm get "realms/$realm"
  for role in OWNER ADMIN OPERATOR VIEWER; do
    printf '[role:%s]\n' "$role"
    kcadm get "roles/$role" -r "$realm"
  done
  snapshot_client iot-web
  snapshot_client iot-mobile
}

reconcile_once
if [[ "$verify_idempotent" == true ]]; then
  snapshot_one="$(mktemp)"
  capture_snapshot > "$snapshot_one"
  reconcile_once
  snapshot_two="$(mktemp)"
  capture_snapshot > "$snapshot_two"
  # The supported Keycloak image is deliberately minimal and does not ship
  # GNU cmp/diff.  These snapshots contain only text generated by kcadm, so
  # Bash's string comparison is sufficient and keeps the idempotence check
  # independent of an undeclared OS package.
  [[ "$(<"$snapshot_one")" == "$(<"$snapshot_two")" ]] || {
    printf 'Keycloak realm reconciliation is not idempotent.\n' >&2
    exit 70
  }
  printf 'REALM_RECONCILED=%s\n' "$realm"
  printf 'KEYCLOAK_REALM_RECONCILE_IDEMPOTENT=true\n'
else
  printf 'REALM_RECONCILED=%s\n' "$realm"
fi
