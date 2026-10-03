#!/bin/bash
set -euo pipefail
verify_idempotent=false
case "${1:-}" in
  '') ;;
  --verify-idempotent) verify_idempotent=true ;;
  *) printf 'Unsupported Glass reconciliation argument\n' >&2; exit 64 ;;
esac
[[ -n "${KEYCLOAK_REALM:-}" && -n "${KC_BOOTSTRAP_ADMIN_USERNAME:-}" ]] || exit 64
[[ "${IOT_WEB_ORIGIN:-}" =~ ^https://[^/@[:space:]\"\\]+$ ]] || { printf 'A valid HTTPS web origin is required\n' >&2; exit 64; }
config_file="$(mktemp)"
payload_file="$(mktemp)"
snapshot_one="$(mktemp)"
snapshot_two="$(mktemp)"
trap 'rm -f "$config_file" "$payload_file" "$snapshot_one" "$snapshot_two"' EXIT HUP INT TERM
kcadm() { /opt/keycloak/bin/kcadm.sh "$@" --config "$config_file"; }
admin_password="$(</run/secrets/keycloak_bootstrap_admin_password)"
kcadm config credentials --server http://127.0.0.1:8080/auth --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$admin_password" >/dev/null 2>&1
unset admin_password
id="$(kcadm get clients -r "$KEYCLOAK_REALM" -q clientId=iot-glass-next --fields id --format csv --noquotes | tr -d '\r' | head -n 1)"
if [[ -z "$id" ]]; then
  kcadm create clients -r "$KEYCLOAK_REALM" -s clientId=iot-glass-next -s protocol=openid-connect -s enabled=true >/dev/null
  id="$(kcadm get clients -r "$KEYCLOAK_REALM" -q clientId=iot-glass-next --fields id --format csv --noquotes | tr -d '\r' | head -n 1)"
fi
[[ -n "$id" ]] || exit 70
cat > "$payload_file" <<JSON
{
  "enabled": true, "publicClient": true, "standardFlowEnabled": true,
  "implicitFlowEnabled": false, "directAccessGrantsEnabled": false, "serviceAccountsEnabled": false,
  "redirectUris": ["com.iot.manager.glassnext://oauth/callback", "http://127.0.0.1:5190/", "$IOT_WEB_ORIGIN/glass/"],
  "webOrigins": ["capacitor://localhost", "http://localhost", "https://localhost", "http://127.0.0.1:5190", "$IOT_WEB_ORIGIN"],
  "attributes": {"pkce.code.challenge.method": "S256", "post.logout.redirect.uris": "com.iot.manager.glassnext://oauth/callback##http://127.0.0.1:5190/##$IOT_WEB_ORIGIN/glass/"},
  "defaultClientScopes": ["basic", "web-origins", "acr", "roles", "profile", "email"],
  "optionalClientScopes": ["address", "phone", "offline_access", "microprofile-jwt"]
}
JSON
reconcile_once() {
  kcadm update "clients/$id" -r "$KEYCLOAK_REALM" -f "$payload_file" >/dev/null
  # Existing clients require the dedicated scope-assignment API. Updating
  # defaultClientScopes on ClientRepresentation alone does not attach scopes.
  local found_basic=false scope_uuid scope_name
  while IFS=',' read -r scope_uuid scope_name; do
    scope_uuid="${scope_uuid//$'\r'/}"
    scope_name="${scope_name//$'\r'/}"
    case "$scope_name" in
      basic|web-origins|acr|roles|profile|email)
        kcadm update "clients/$id/default-client-scopes/$scope_uuid" -r "$KEYCLOAK_REALM" -n >/dev/null
        [[ "$scope_name" != basic ]] || found_basic=true
        ;;
    esac
  done < <(kcadm get client-scopes -r "$KEYCLOAK_REALM" --fields id,name --format csv --noquotes)
  [[ "$found_basic" == true ]] || { printf 'Required basic identity scope is unavailable\n' >&2; exit 70; }
}
snapshot_client() {
  kcadm get "clients/$id" -r "$KEYCLOAK_REALM"
  kcadm get "clients/$id/default-client-scopes" -r "$KEYCLOAK_REALM" --fields name --format csv --noquotes
}
reconcile_once
if [[ "$verify_idempotent" == true ]]; then
  snapshot_client > "$snapshot_one"
  reconcile_once
  snapshot_client > "$snapshot_two"
  [[ "$(<"$snapshot_one")" == "$(<"$snapshot_two")" ]] || { printf 'Glass reconciliation is not idempotent\n' >&2; exit 70; }
  printf 'GLASS_PHONE_RECONCILE_IDEMPOTENT=true\n'
fi
printf 'GLASS_PHONE_PKCE_AND_IDENTITY_SCOPES_READY=true\n'
