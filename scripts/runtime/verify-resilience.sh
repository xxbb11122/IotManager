#!/usr/bin/env bash
set -euo pipefail

# This verifier deliberately restarts and briefly pauses only the explicitly
# named integration Compose project. It proves that the production readiness
# probe fails closed on PostgreSQL loss, a normal restart preserves the live
# PostgreSQL volume, and a Backend that starts before PostgreSQL keeps retrying
# until its dependency returns. It is not a replacement for the protected PITR
# drill.

[[ "${IOT_RESILIENCE_CONFIRM:-}" == "RESILIENCE" ]] || {
  printf 'Set IOT_RESILIENCE_CONFIRM=RESILIENCE to run controlled PostgreSQL restart/pause checks.\n' >&2
  exit 64
}

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project_name="${IOT_COMPOSE_PROJECT:-iot-manager-p0}"
environment_file="${IOT_ENVIRONMENT_FILE:-$repository_root/deploy/.env.integration}"
state_file="${IOT_RUNTIME_STATE_FILE:-$repository_root/deploy/.runtime/iot-manager-p0/runtime.env}"
timeout_seconds="${IOT_RUNTIME_TIMEOUT_SECONDS:-240}"

[[ -f "$environment_file" ]] || { printf 'Environment file was not found: %s\n' "$environment_file" >&2; exit 66; }
docker info >/dev/null

compose=(compose --project-name "$project_name" --profile application --env-file "$environment_file")
[[ -f "$state_file" ]] && compose+=(--env-file "$state_file")
compose+=(-f "$repository_root/deploy/docker-compose.yml" -f "$repository_root/deploy/docker-compose.integration.yml")

environment_value() {
  local key="$1"
  local value
  value="$(sed -n "s/^${key}=//p" "$environment_file" | tail -n 1 | tr -d '\r')"
  [[ -n "$value" ]] || { printf 'Required value was not found in the environment file: %s\n' "$key" >&2; exit 66; }
  printf '%s' "$value"
}

container_id() {
  docker "${compose[@]}" ps -q "$1" | head -n 1
}

container_id_including_stopped() {
  # `docker compose ps -q` only lists running containers. Use --all for the
  # deliberate stopped-dependency assertion below.
  docker "${compose[@]}" ps -a -q "$1" | head -n 1
}

wait_healthy() {
  local service="$1"
  local deadline=$((SECONDS + timeout_seconds))
  local id health
  while true; do
    id="$(container_id "$service")"
    health="none"
    [[ -n "$id" ]] && health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
    [[ "$health" == healthy ]] && return 0
    (( SECONDS < deadline )) || {
      printf 'Service did not become healthy after resilience check: %s (%s)\n' "$service" "$health" >&2
      return 1
    }
    sleep 3
  done
}

bootstrap_user="$(environment_value POSTGRES_BOOTSTRAP_USERNAME)"
database_name="$(environment_value IOT_DB_DATABASE)"

snapshot() {
  local postgres_id="$1"
  local migrations roles devices commands
  migrations="$(docker exec -u postgres "$postgres_id" psql -U "$bootstrap_user" -d "$database_name" -Atc 'SELECT count(*) FROM flyway_schema_history WHERE success' | tr -d '\r\n')"
  roles="$(docker exec -u postgres "$postgres_id" psql -U "$bootstrap_user" -d "$database_name" -Atc 'SELECT count(*) FROM roles' | tr -d '\r\n')"
  devices="$(docker exec -u postgres "$postgres_id" psql -U "$bootstrap_user" -d "$database_name" -Atc 'SELECT count(*) FROM devices' | tr -d '\r\n')"
  commands="$(docker exec -u postgres "$postgres_id" psql -U "$bootstrap_user" -d "$database_name" -Atc 'SELECT count(*) FROM device_commands' | tr -d '\r\n')"
  [[ "$migrations" == 18 ]] || { printf 'Expected 18 successful PostgreSQL migrations, found %s.\n' "$migrations" >&2; exit 1; }
  [[ "$roles" == 4 ]] || { printf 'Expected four platform role seeds, found %s.\n' "$roles" >&2; exit 1; }
  printf '%s|%s|%s|%s' "$migrations" "$roles" "$devices" "$commands"
}

postgres_id="$(container_id postgres)"
backend_id="$(container_id backend)"
[[ -n "$postgres_id" && -n "$backend_id" ]] || { printf 'PostgreSQL and Backend must be running before resilience verification.\n' >&2; exit 1; }
wait_healthy postgres
wait_healthy backend
resilience_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

before_snapshot="$(snapshot "$postgres_id")"
for service in backend backup wal-g-archive wal-g-backup; do
  service_id="$(container_id "$service")"
  [[ -n "$service_id" ]] || { printf 'Required service is missing for restart-policy verification: %s\n' "$service" >&2; exit 1; }
  restart_policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$service_id")"
  [[ "$restart_policy" == unless-stopped ]] || {
    printf 'Service %s must use restart policy unless-stopped, found %s\n' "$service" "$restart_policy" >&2
    exit 1
  }
done

docker "${compose[@]}" restart postgres >/dev/null
wait_healthy postgres
wait_healthy backend
postgres_id="$(container_id postgres)"
after_postgres_restart="$(snapshot "$postgres_id")"
[[ "$after_postgres_restart" == "$before_snapshot" ]] || {
  printf 'PostgreSQL restart changed persisted platform counts: before=%s after=%s\n' "$before_snapshot" "$after_postgres_restart" >&2
  exit 1
}

docker "${compose[@]}" restart backend >/dev/null
wait_healthy backend
backend_id="$(container_id backend)"
after_backend_restart="$(snapshot "$postgres_id")"
[[ "$after_backend_restart" == "$before_snapshot" ]] || {
  printf 'Backend restart changed persisted platform counts: before=%s after=%s\n' "$before_snapshot" "$after_backend_restart" >&2
  exit 1
}

paused=false
cold_start_pending=false
cleanup() {
  if [[ "$paused" == true ]]; then
    docker unpause "$postgres_id" >/dev/null 2>&1 || true
  fi
  if [[ "$cold_start_pending" == true ]]; then
    # Failure-only recovery for the explicitly named test project. Backend is
    # not manually restarted here: its configured retry contract must recover
    # once PostgreSQL is available again.
    docker "${compose[@]}" start postgres >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
docker pause "$postgres_id" >/dev/null
paused=true
sleep 9
# Git Bash rewrites /bin/sh to a host path before invoking docker. Disable
# that one argument conversion for the container-side probe; Linux runners
# simply ignore this compatibility environment variable.
outage_probe="$(MSYS_NO_PATHCONV=1 docker exec "$backend_id" /bin/sh -ec 'wget -S -O /dev/null http://127.0.0.1:8080/actuator/health/readiness 2>&1 || true')"
grep -q 'HTTP/1.1 503' <<<"$outage_probe" || {
  printf 'Backend readiness did not report HTTP 503 while PostgreSQL was paused.\n%s\n' "$outage_probe" >&2
  exit 1
}
docker unpause "$postgres_id" >/dev/null
paused=false
wait_healthy postgres
wait_healthy backend

# Deliberately restart Backend while PostgreSQL is stopped. The production
# Flyway retry contract must keep the same Backend process alive for at least
# Docker's restart-policy activation window, then PostgreSQL returning must
# make it healthy without any additional Backend action.
cold_start_pending=true
docker "${compose[@]}" stop postgres >/dev/null
postgres_outage_id="$(container_id_including_stopped postgres)"
postgres_outage_state="none"
[[ -n "$postgres_outage_id" ]] && postgres_outage_state="$(docker inspect --format '{{.State.Status}}' "$postgres_outage_id")"
[[ "$postgres_outage_state" == "exited" ]] || {
  printf 'PostgreSQL was not stopped before Backend dependency-startup verification: state=%s\n' "$postgres_outage_state" >&2
  exit 1
}
backend_startup_id="$(container_id backend)"
[[ -n "$backend_startup_id" ]] || { printf 'Backend container disappeared before dependency-startup verification.\n' >&2; exit 1; }
backend_restart_baseline="$(docker inspect --format '{{.RestartCount}}' "$backend_startup_id")"
backend_started_before="$(docker inspect --format '{{.State.StartedAt}}' "$backend_startup_id")"
docker restart "$backend_startup_id" >/dev/null
sleep 12
backend_startup_state="none"
backend_startup_health="none"
backend_observed_id="$(container_id backend)"
[[ "$backend_observed_id" == "$backend_startup_id" ]] || { printf 'Backend container identity changed during application-level dependency retry.\n' >&2; exit 1; }
backend_startup_state="$(docker inspect --format '{{.State.Status}}' "$backend_startup_id")"
backend_startup_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$backend_startup_id")"
backend_restart_observed="$(docker inspect --format '{{.RestartCount}}' "$backend_startup_id")"
backend_started_observed="$(docker inspect --format '{{.State.StartedAt}}' "$backend_startup_id")"
[[ "$backend_startup_state" == "running" ]] || {
  printf 'Backend exited instead of retrying its unavailable PostgreSQL dependency: state=%s\n' "$backend_startup_state" >&2
  exit 1
}
[[ "$backend_startup_health" != "healthy" ]] || {
  printf 'Backend unexpectedly reported healthy while PostgreSQL was stopped.\n' >&2
  exit 1
}
[[ "$backend_restart_observed" == "$backend_restart_baseline" ]] || {
  printf 'Backend relied on Docker restart instead of Flyway in-process retry: before=%s after=%s\n' "$backend_restart_baseline" "$backend_restart_observed" >&2
  exit 1
}
[[ "$backend_started_observed" != "$backend_started_before" ]] || {
  printf 'Backend restart did not create a new startup attempt for dependency retry verification.\n' >&2
  exit 1
}
docker "${compose[@]}" start postgres >/dev/null
wait_healthy postgres
wait_healthy backend
backend_restart_after_recovery="$(docker inspect --format '{{.RestartCount}}' "$backend_startup_id")"
[[ "$backend_restart_after_recovery" == "$backend_restart_baseline" ]] || {
  printf 'Backend restarted during dependency recovery instead of completing the in-process Flyway retry: before=%s after=%s\n' "$backend_restart_baseline" "$backend_restart_after_recovery" >&2
  exit 1
}
postgres_id="$(container_id postgres)"
after_dependency_recovery="$(snapshot "$postgres_id")"
[[ "$after_dependency_recovery" == "$before_snapshot" ]] || {
  printf 'Dependency-startup recovery changed persisted platform counts: before=%s after=%s\n' "$before_snapshot" "$after_dependency_recovery" >&2
  exit 1
}
scheduled_task_errors="$(docker logs --since "$resilience_started_at" "$backend_startup_id" 2>&1 || true)"
if grep -Fq 'Unexpected error occurred in scheduled task' <<<"$scheduled_task_errors"; then
  printf 'Backend emitted an unhandled scheduled-task error during PostgreSQL resilience verification.\n' >&2
  exit 1
fi
cold_start_pending=false
trap - EXIT

artifact_dir="$repository_root/artifacts/p0-runtime/$(date -u +%Y%m%dT%H%M%SZ)-resilience"
mkdir -p "$artifact_dir"
{
  printf 'postgres_restart_persistence=passed\n'
  printf 'backend_restart_persistence=passed\n'
  printf 'backend_restart_policy=unless-stopped\n'
  printf 'postgres_outage_readiness=http_503\n'
  printf 'postgres_recovery=healthy\n'
  printf 'backend_dependency_startup_retry=passed\n'
  printf 'backend_dependency_startup_outage_seconds=12\n'
  printf 'backend_dependency_startup_state=%s\n' "$backend_startup_state"
  printf 'backend_dependency_startup_health=%s\n' "$backend_startup_health"
  printf 'backend_scheduled_task_errors=none\n'
  printf 'dependency_startup_snapshot=%s\n' "$after_dependency_recovery"
  printf 'snapshot=%s\n' "$before_snapshot"
} > "$artifact_dir/resilience-summary.txt"

printf 'P0 resilience checks passed. Evidence directory: %s\n' "$artifact_dir"
