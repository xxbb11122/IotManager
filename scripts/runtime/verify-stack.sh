#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project_name="${IOT_COMPOSE_PROJECT:-iot-manager-p0}"
environment_file="${IOT_ENVIRONMENT_FILE:-$repository_root/deploy/.env.integration}"
state_file="${IOT_RUNTIME_STATE_FILE:-$repository_root/deploy/.runtime/iot-manager-p0/runtime.env}"
base_url="${IOT_BASE_URL:-https://iot-manager.localhost}"
timeout_seconds="${IOT_RUNTIME_TIMEOUT_SECONDS:-240}"
observability_enabled="${IOT_ENABLE_OBSERVABILITY:-false}"

[[ -f "$environment_file" ]] || { printf 'Environment file was not found: %s\n' "$environment_file" >&2; exit 66; }
case "$observability_enabled" in
  true|false) ;;
  *) printf 'IOT_ENABLE_OBSERVABILITY must be true or false.\n' >&2; exit 64 ;;
esac
docker info >/dev/null

# Windows curl uses Schannel, which attempts an online revocation lookup even
# when --cacert pins Caddy's local integration CA. The CA chain and hostname
# checks remain enabled; only that impossible offline lookup is disabled.
curl_tls_args=()
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) curl_tls_args+=(--ssl-no-revoke) ;;
esac

# Git Bash rewrites Unix-looking container paths before Docker receives them.
# Compose files are host paths, so normalize them first; only exec calls that
# include /bin/sh suppress MSYS conversion.
docker_host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath --mixed "$1"
  else
    printf '%s' "$1"
  fi
}

docker_container_paths() {
  if command -v cygpath >/dev/null 2>&1; then
    MSYS_NO_PATHCONV=1 docker "$@"
  else
    docker "$@"
  fi
}

compose=(compose --project-name "$project_name" --profile application --env-file "$(docker_host_path "$environment_file")")
[[ "$observability_enabled" == true ]] && compose+=(--profile observability)
[[ -f "$state_file" ]] && compose+=(--env-file "$(docker_host_path "$state_file")")
compose+=(-f "$(docker_host_path "$repository_root/deploy/docker-compose.yml")" -f "$(docker_host_path "$repository_root/deploy/docker-compose.integration.yml")")

artifact_dir="$repository_root/artifacts/p0-runtime/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$artifact_dir"

container_id() {
  docker "${compose[@]}" ps -q "$1" | head -n 1
}

health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1"
}

services=(postgres keycloak caddy backend backup wal-g-archive wal-g-backup)
[[ "$observability_enabled" == true ]] && services+=(alertmanager prometheus)
deadline=$((SECONDS + timeout_seconds))
while true; do
  unhealthy=()
  for service in "${services[@]}"; do
    id="$(container_id "$service")"
    if [[ -z "$id" || "$(health "$id")" != "healthy" ]]; then
      unhealthy+=("$service")
    fi
  done
  [[ ${#unhealthy[@]} -eq 0 ]] && break
  if (( SECONDS >= deadline )); then
    printf 'Timed out waiting for healthy services: %s\n' "${unhealthy[*]}" >&2
    exit 1
  fi
  sleep 3
done

for service in "${services[@]}"; do
  id="$(container_id "$service")"
  published="$(docker port "$id" 2>/dev/null || true)"
  if [[ "$service" != caddy && -n "$published" ]]; then
    printf 'Internal service unexpectedly publishes host ports: %s -> %s\n' "$service" "$published" >&2
    exit 1
  fi
done

ca_certificate="$artifact_dir/caddy-integration-root.crt"
docker "${compose[@]}" cp "caddy:/data/caddy/pki/authorities/local/root.crt" "$ca_certificate"

status() {
  local url="$1"
  local output="$2"
  curl "${curl_tls_args[@]}" --silent --show-error --output "$output" --write-out '%{http_code}' --cacert "$ca_certificate" "$url"
}

environment_value() {
  local key="$1"
  local value
  value="$(sed -n "s/^${key}=//p" "$environment_file" | tail -n 1)"
  [[ -n "$value" ]] || { printf 'Required value is empty or missing in the environment file: %s\n' "$key" >&2; exit 64; }
  printf '%s' "$value"
}

[[ "$(status "$base_url/auth/realms/iot-manager/.well-known/openid-configuration" "$artifact_dir/openid-configuration.json")" == 200 ]] || {
  printf 'Keycloak discovery endpoint did not return HTTP 200 through Caddy.\n' >&2; exit 1; }
[[ "$(status "$base_url/api/v1/devices" "$artifact_dir/unauthenticated-api.txt")" == 401 ]] || {
  printf 'Unauthenticated API request did not return HTTP 401.\n' >&2; exit 1; }
[[ "$(status "$base_url/h2-console" "$artifact_dir/h2-console.txt")" == 404 ]] || {
  printf 'Production H2 console route did not return HTTP 404.\n' >&2; exit 1; }
[[ "$(status "$base_url/actuator/prometheus" "$artifact_dir/public-prometheus.txt")" == 404 ]] || {
  printf 'Public Prometheus route did not return HTTP 404.\n' >&2; exit 1; }

http_url="http://${base_url#https://}/"
redirect_status="$(curl --silent --show-error --max-redirs 0 --dump-header "$artifact_dir/http-redirect-headers.txt" --output "$artifact_dir/http-redirect-body.txt" --write-out '%{http_code}' "$http_url")"
[[ "$redirect_status" == 308 ]] || {
  printf 'HTTP endpoint did not return the expected 308 redirect; received %s.\n' "$redirect_status" >&2; exit 1; }
grep -qi "^location: ${base_url}/" "$artifact_dir/http-redirect-headers.txt" || {
  printf 'HTTP endpoint did not redirect to the expected HTTPS origin: %s\n' "$base_url" >&2; exit 1; }

allowed_origin="$(environment_value IOT_WEB_ORIGIN)"
allowed_cors_status="$(curl "${curl_tls_args[@]}" --silent --show-error --request OPTIONS \
  --header "Origin: $allowed_origin" \
  --header 'Access-Control-Request-Method: GET' \
  --dump-header "$artifact_dir/cors-allowed-headers.txt" \
  --output "$artifact_dir/cors-allowed-body.txt" \
  --write-out '%{http_code}' --cacert "$ca_certificate" "$base_url/api/v1/devices")"
[[ ! "$allowed_cors_status" =~ ^5 ]] || {
  printf 'Allowed-origin CORS preflight returned server error: %s\n' "$allowed_cors_status" >&2; exit 1; }
tr -d '\r' < "$artifact_dir/cors-allowed-headers.txt" | grep -qi "^access-control-allow-origin: ${allowed_origin}$" || {
  printf 'Allowed-origin CORS preflight did not return the configured origin: %s\n' "$allowed_origin" >&2; exit 1; }

rejected_origin='https://untrusted-origin.invalid'
rejected_cors_status="$(curl "${curl_tls_args[@]}" --silent --show-error --request OPTIONS \
  --header "Origin: $rejected_origin" \
  --header 'Access-Control-Request-Method: GET' \
  --dump-header "$artifact_dir/cors-rejected-headers.txt" \
  --output "$artifact_dir/cors-rejected-body.txt" \
  --write-out '%{http_code}' --cacert "$ca_certificate" "$base_url/api/v1/devices")"
[[ ! "$rejected_cors_status" =~ ^5 ]] || {
  printf 'Rejected-origin CORS preflight returned server error: %s\n' "$rejected_cors_status" >&2; exit 1; }
if tr -d '\r' < "$artifact_dir/cors-rejected-headers.txt" | grep -qi "^access-control-allow-origin: ${rejected_origin}$"; then
  printf 'Rejected-origin CORS preflight unexpectedly allowed an untrusted origin.\n' >&2
  exit 1
fi

oversized_payload="$artifact_dir/oversized-request-body.tmp"
oversized_response="$artifact_dir/oversized-response.txt"
head -c 1048577 /dev/zero | tr '\0' a > "$oversized_payload"
oversized_status="$(curl "${curl_tls_args[@]}" --silent --show-error --request POST --header 'Content-Type: application/json' \
  --data-binary "@$oversized_payload" --output "$oversized_response" --write-out '%{http_code}' \
  --cacert "$ca_certificate" "$base_url/api/v1/devices")"
rm -f "$oversized_payload"
[[ "$oversized_status" == 413 ]] || {
  printf 'Caddy did not reject an API body over 1 MB; received %s.\n' "$oversized_status" >&2; exit 1; }

curl "${curl_tls_args[@]}" --silent --show-error --head --cacert "$ca_certificate" "$base_url/" > "$artifact_dir/response-headers.txt"
for header in strict-transport-security x-content-type-options x-frame-options content-security-policy permissions-policy; do
  grep -qi "^${header}:" "$artifact_dir/response-headers.txt" || {
    printf 'Required security header is missing: %s\n' "$header" >&2; exit 1; }
done

if [[ "$observability_enabled" == true ]]; then
  # The Backend health image already contains wget. Read the Docker secret
  # only inside that private container and persist metrics, never the token.
  docker_container_paths "${compose[@]}" exec -T backend /bin/sh -ec '
    token="$(cat /run/secrets/IOT_METRICS_SCRAPE_TOKEN)"
    wget -qO- --header="X-Iot-Metrics-Token: $token" http://127.0.0.1:8080/actuator/prometheus
  ' > "$artifact_dir/prometheus-backend-metrics.txt"
  grep -q '^# HELP iot_websocket_sessions_active ' "$artifact_dir/prometheus-backend-metrics.txt" || {
    printf 'Authenticated internal Prometheus scrape did not expose the IoT metric registry.\n' >&2; exit 1; }
  # A healthy Prometheus process can precede its first scheduled scrape. Poll
  # the private API for the configured Backend job rather than reporting this
  # expected startup window as a platform failure.
  targets_deadline=$((SECONDS + (timeout_seconds < 90 ? timeout_seconds : 90)))
  backend_target_up=false
  targets_json=''
  while true; do
    targets_json="$(docker_container_paths "${compose[@]}" exec -T backend /bin/sh -ec \
      'wget -qO- http://prometheus:9090/api/v1/targets')"
    if grep -Eq '"job"[[:space:]]*:[[:space:]]*"iot-manager-backend"' <<<"$targets_json" && \
      grep -Eq '"health"[[:space:]]*:[[:space:]]*"up"' <<<"$targets_json"; then
      backend_target_up=true
      break
    fi
    (( SECONDS < targets_deadline )) || break
    sleep 3
  done
  printf '%s\n' "$targets_json" > "$artifact_dir/prometheus-targets.json"
  [[ "$backend_target_up" == true ]] || {
    printf 'Prometheus did not report an up Backend target within the startup window.\n' >&2; exit 1; }
fi

docker "${compose[@]}" ps --format json > "$artifact_dir/compose-ps.json"
printf 'P0 runtime smoke checks passed. Evidence directory: %s\n' "$artifact_dir"
