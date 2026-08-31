#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project_name="${IOT_COMPOSE_PROJECT:-iot-manager-p0}"
environment_file="${IOT_ENVIRONMENT_FILE:-$repository_root/deploy/.env.integration}"
state_file="${IOT_RUNTIME_STATE_FILE:-$repository_root/deploy/.runtime/iot-manager-p0/runtime.env}"
base_url="${IOT_BASE_URL:-https://iot-manager.localhost}"
observability_enabled="${IOT_ENABLE_OBSERVABILITY:-false}"
verify=false
[[ "${1:-}" == "--verify" ]] && verify=true

case "$observability_enabled" in
  true|false) ;;
  *) printf 'IOT_ENABLE_OBSERVABILITY must be true or false.\n' >&2; exit 64 ;;
esac

environment_value() {
  local name="$1" entry
  entry="$(grep -E "^${name}=" "$environment_file" | tail -n 1 | tr -d '\r' || true)"
  [[ -n "$entry" ]] || return 1
  printf '%s' "${entry#*=}"
}

assert_integration_role_matrix_configuration() {
  local enabled name value
  enabled="$(environment_value IOT_CREATE_INTEGRATION_IDENTITIES || true)"
  [[ "$enabled" == true ]] || {
    printf 'Integration environment must set IOT_CREATE_INTEGRATION_IDENTITIES=true. Update %s from deploy/.env.integration.example before running the Gate 2 stack.\n' "$environment_file" >&2
    exit 64
  }
  for name in \
    IOT_ADMIN_USERNAME IOT_ADMIN_DISPLAY_NAME IOT_ADMIN_EMAIL \
    IOT_OPERATOR_USERNAME IOT_OPERATOR_DISPLAY_NAME IOT_OPERATOR_EMAIL \
    IOT_VIEWER_USERNAME IOT_VIEWER_DISPLAY_NAME IOT_VIEWER_EMAIL; do
    value="$(environment_value "$name" || true)"
    [[ -n "$value" ]] || {
      printf 'Integration environment is missing %s. Update %s from deploy/.env.integration.example before running the Gate 2 stack.\n' "$name" "$environment_file" >&2
      exit 64
    }
  done
}

wait_service_healthy() {
  local service="$1"
  local timeout_seconds="${2:-180}"
  local deadline=$((SECONDS + timeout_seconds))
  while true; do
    local service_id health
    service_id="$(docker "${compose[@]}" ps -q "$service" | head -n 1)"
    health="none"
    [[ -n "$service_id" ]] && health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$service_id")"
    [[ "$health" == healthy ]] && return 0
    (( SECONDS < deadline )) || { printf '%s did not become healthy within %s seconds.\n' "$service" "$timeout_seconds" >&2; return 1; }
    sleep 3
  done
}

docker info >/dev/null
curl_tls_args=()
case "$(uname -s)" in
  # Caddy's integration CA is local and intentionally has no reachable CRL.
  # Keep chain and hostname validation, disabling only Schannel's lookup.
  MINGW*|MSYS*|CYGWIN*) curl_tls_args+=(--ssl-no-revoke) ;;
esac
if [[ ! -f "$environment_file" ]]; then
  cp "$repository_root/deploy/.env.integration.example" "$environment_file"
  printf 'Created non-secret integration environment file: %s\n' "$environment_file"
fi
assert_integration_role_matrix_configuration

bash "$repository_root/scripts/runtime/new-secrets.sh"

compose=(compose --project-name "$project_name" --env-file "$environment_file" -f "$repository_root/deploy/docker-compose.yml" -f "$repository_root/deploy/docker-compose.integration.yml")
docker "${compose[@]}" up -d --build volume-init postgres keycloak caddy

wait_service_healthy keycloak
wait_service_healthy caddy

identity_ca="$(mktemp)"
identity_response="${identity_ca}.response"
trap 'rm -f "$identity_ca" "$identity_response"' EXIT HUP INT TERM
docker "${compose[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$identity_ca"
# Caddy may be container-healthy a short time before its upstream's first
# request is routable. Keep this bounded and fail closed with the last HTTP
# status instead of letting a transient curl failure terminate silently.
identity_deadline=$((SECONDS + 60))
identity_status='curl-failed'
while true; do
  if identity_status="$(curl "${curl_tls_args[@]}" --silent --show-error --output "$identity_response" --write-out '%{http_code}' --cacert "$identity_ca" "$base_url/auth/realms/iot-manager/.well-known/openid-configuration")" && \
    [[ "$identity_status" == 200 ]]; then
    break
  fi
  (( SECONDS < identity_deadline )) || {
    printf 'Identity-plane discovery through Caddy did not return HTTP 200 within 60 seconds; last result: %s.\n' "$identity_status" >&2
    exit 1
  }
  sleep 2
done
rm -f "$identity_ca" "$identity_response"
trap - EXIT HUP INT TERM

IOT_COMPOSE_PROJECT="$project_name" IOT_ENVIRONMENT_FILE="$environment_file" IOT_RUNTIME_STATE_FILE="$state_file" \
  bash "$repository_root/scripts/runtime/reconcile-keycloak-realm.sh" --verify-idempotent
IOT_COMPOSE_PROJECT="$project_name" IOT_ENVIRONMENT_FILE="$environment_file" IOT_RUNTIME_STATE_FILE="$state_file" \
  bash "$repository_root/scripts/runtime/bootstrap-keycloak-owner.sh" --verify-idempotent

application_compose=(compose --project-name "$project_name" --profile application --env-file "$environment_file")
[[ -f "$state_file" ]] && application_compose+=(--env-file "$state_file")
application_compose+=(-f "$repository_root/deploy/docker-compose.yml" -f "$repository_root/deploy/docker-compose.integration.yml")
application_services=(backend backup wal-g-archive wal-g-backup)
if [[ "$observability_enabled" == true ]]; then
  application_compose=(compose --project-name "$project_name" --profile application --profile observability --env-file "$environment_file")
  [[ -f "$state_file" ]] && application_compose+=(--env-file "$state_file")
  application_compose+=(-f "$repository_root/deploy/docker-compose.yml" -f "$repository_root/deploy/docker-compose.integration.yml")
  application_services+=(alertmanager prometheus)
fi
docker "${application_compose[@]}" up -d --build "${application_services[@]}"

if [[ "$verify" == true ]]; then
  IOT_COMPOSE_PROJECT="$project_name" IOT_ENVIRONMENT_FILE="$environment_file" IOT_RUNTIME_STATE_FILE="$state_file" \
    "$repository_root/scripts/runtime/verify-stack.sh"
fi

printf 'Integration stack started. Project: %s\n' "$project_name"
