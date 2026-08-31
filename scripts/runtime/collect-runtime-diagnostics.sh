#!/usr/bin/env bash
set -euo pipefail

# Capture only the state and bounded logs needed to diagnose a failed isolated
# integration run. Docker Secrets are not included in inspect output below; a
# final exact-value scrub protects against an accidental application log leak.
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project_name="${IOT_COMPOSE_PROJECT:-iot-manager-p0}"
environment_file="${IOT_ENVIRONMENT_FILE:-$repository_root/deploy/.env.integration}"
state_file="${IOT_RUNTIME_STATE_FILE:-$repository_root/deploy/.runtime/iot-manager-p0/runtime.env}"
artifact_dir="${IOT_DIAGNOSTIC_DIRECTORY:-$repository_root/artifacts/p0-runtime/failed-$(date -u +%Y%m%dT%H%M%SZ)}"

mkdir -p "$artifact_dir"
compose=(compose --project-name "$project_name" --profile application --env-file "$environment_file")
[[ -f "$state_file" ]] && compose+=(--env-file "$state_file")
compose+=(-f "$repository_root/deploy/docker-compose.yml" -f "$repository_root/deploy/docker-compose.integration.yml")

docker "${compose[@]}" ps --format json > "$artifact_dir/compose-ps.json" 2>&1 || true

for service in volume-init postgres keycloak caddy backend backup wal-g-archive wal-g-backup; do
  container_id="$(docker "${compose[@]}" ps -q "$service" 2>/dev/null | head -n 1 || true)"
  [[ -n "$container_id" ]] || continue
  docker inspect --format '{{json .State}}' "$container_id" > "$artifact_dir/${service}-state.json" 2>&1 || true
done

docker "${compose[@]}" logs --no-color --tail 250 > "$artifact_dir/compose-logs.txt" 2>&1 || true

if command -v perl >/dev/null 2>&1; then
  for secret_file in "$repository_root"/deploy/.runtime/iot-manager-p0/secrets/*; do
    [[ -f "$secret_file" ]] || continue
    secret_value="$(cat "$secret_file")"
    [[ -n "$secret_value" ]] || continue
    SECRET_VALUE="$secret_value" perl -0pi -e 'my $value = $ENV{SECRET_VALUE}; s/\Q$value\E/[REDACTED]/g if length $value;' "$artifact_dir"/* 2>/dev/null || true
  done
fi

printf 'Runtime diagnostics written to: %s\n' "$artifact_dir"
