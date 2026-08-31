#!/usr/bin/env bash
# Perform a physical WAL-G recovery drill into a new Compose project. The
# command is deliberately fail-closed: it only supports the approved remote
# S3-compatible repository and refuses to reuse a recovery volume.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
environment_file="${IOT_ENVIRONMENT_FILE:-$repository_root/deploy/.env}"
source_project="${IOT_COMPOSE_PROJECT:-iot-manager}"
recovery_project="${IOT_RECOVERY_PROJECT:-iot-manager-recovery-$(date -u +%Y%m%d%H%M%S)}"
recovery_timeout_seconds="${IOT_RECOVERY_TIMEOUT_SECONDS:-3600}"
archive_timeout_seconds="${IOT_WAL_ARCHIVE_TIMEOUT_SECONDS:-300}"
expected_flyway_version="${IOT_EXPECTED_FLYWAY_VERSION:-18}"
report_directory="${IOT_RECOVERY_REPORT_DIR:-$repository_root/artifacts/recovery-drill/$(date -u +%Y%m%dT%H%M%SZ)}"

usage() {
  cat <<'EOF'
Usage: IOT_PITR_CONFIRM=PITR bash scripts/runtime/wal-recovery-drill.sh

Required environment:
  IOT_PITR_CONFIRM=PITR       Explicitly authorizes an isolated physical recovery.
  IOT_ENVIRONMENT_FILE=...    Production-shaped Compose configuration using S3 WAL-G storage.

Optional environment:
  IOT_COMPOSE_PROJECT         Existing source project (default: iot-manager).
  IOT_RECOVERY_PROJECT        New, different recovery project name.
  IOT_RECOVERY_TIMEOUT_SECONDS (default: 3600, maximum permitted RTO).
  IOT_EXPECTED_FLYWAY_VERSION (default: 18).
  IOT_RECOVERY_REPORT_DIR     Directory for a redacted JSON evidence report.
EOF
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ "${IOT_PITR_CONFIRM:-}" == "PITR" ]] || {
  printf 'Set IOT_PITR_CONFIRM=PITR only after an independent recovery target has been approved.\n' >&2
  exit 64
}
[[ -f "$environment_file" ]] || { printf 'Environment file was not found: %s\n' "$environment_file" >&2; exit 66; }
[[ "$source_project" != "$recovery_project" ]] || { printf 'Recovery project must differ from the source project.\n' >&2; exit 64; }
[[ "$recovery_timeout_seconds" =~ ^[0-9]+$ ]] && (( recovery_timeout_seconds > 0 && recovery_timeout_seconds <= 3600 )) || {
  printf 'IOT_RECOVERY_TIMEOUT_SECONDS must be between 1 and 3600.\n' >&2
  exit 64
}
[[ "$archive_timeout_seconds" =~ ^[0-9]+$ ]] && (( archive_timeout_seconds > 0 && archive_timeout_seconds <= 900 )) || {
  printf 'IOT_WAL_ARCHIVE_TIMEOUT_SECONDS must be between 1 and 900.\n' >&2
  exit 64
}

environment_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$environment_file" | tail -n 1 || true)"
  [[ -n "$line" ]] || { printf 'Required value %s is missing from %s\n' "$key" "$environment_file" >&2; exit 64; }
  printf '%s' "${line#*=}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

[[ "$(environment_value WALG_STORAGE_MODE)" == "s3" ]] || {
  printf 'Physical recovery drills require WALG_STORAGE_MODE=s3; the filesystem integration repository is not a production recovery target.\n' >&2
  exit 64
}

docker info >/dev/null

# Git Bash rewrites Unix-looking container paths before Docker receives them.
# Pass host-side Compose and volume paths in Docker's native Windows form, then
# suppress rewriting only for invocations that contain container-side paths.
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

source_compose=(compose --project-name "$source_project" --env-file "$(docker_host_path "$environment_file")" -f "$(docker_host_path "$repository_root/deploy/docker-compose.yml")")
recovery_compose=(compose --project-name "$recovery_project" --env-file "$(docker_host_path "$environment_file")" -f "$(docker_host_path "$repository_root/deploy/docker-compose.yml")" -f "$(docker_host_path "$repository_root/deploy/docker-compose.recovery.yml")")
source_postgres_id="$(docker "${source_compose[@]}" ps -q postgres | head -n 1)"
[[ -n "$source_postgres_id" ]] || { printf 'Source PostgreSQL service is not running in project %s.\n' "$source_project" >&2; exit 69; }
source_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$source_postgres_id")"
[[ "$source_health" == "healthy" ]] || { printf 'Source PostgreSQL is not healthy: %s\n' "$source_health" >&2; exit 69; }

recovery_volume="${recovery_project}_postgres-data"
if docker volume inspect "$recovery_volume" >/dev/null 2>&1; then
  printf 'Refusing physical recovery because target volume already exists: %s\n' "$recovery_volume" >&2
  exit 73
fi

bootstrap_user="$(environment_value POSTGRES_BOOTSTRAP_USERNAME)"
database_name="$(environment_value IOT_DB_DATABASE)"
owner_user="$(environment_value IOT_DB_OWNER_USERNAME)"
marker_id="pitr-drill-$(date -u +%Y%m%dT%H%M%SZ)-$$"
restore_point_name="pitr_drill_$(date -u +%Y%m%d%H%M%S)_$$"
marker_epoch="$(date -u +%s)"
marker_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Capture an explicit base backup *before* the marker. The recovery override
# below fetches this exact backup rather than LATEST, so the marker can only
# appear after PostgreSQL has replayed a subsequently archived WAL segment.
# A one-shot invocation uses PGPASSWORD only inside the disposable container;
# it is never echoed or written into the report.
backup_output="$(docker_container_paths "${source_compose[@]}" --profile application run --rm --no-deps --entrypoint /bin/sh wal-g-backup \
  -ec 'export PGPASSWORD="$(cat /run/secrets/iot_db_owner_password)"; /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g backup-push "$PGDATA"' 2>&1)"
base_backup="$(printf '%s\n' "$backup_output" | grep -oE 'base_[0-9A-Z_]+' | tail -n 1 || true)"
[[ "$base_backup" =~ ^base_[0-9A-Z_]+$ ]] || {
  printf 'Unable to determine the base backup identifier created for this physical drill.\n' >&2
  exit 70
}

# The marker gives the drill a concrete recoverability assertion without
# touching application tables. It lives in an explicit drill-only schema and
# carries no user, device, coordinate, secret, or token data.
docker "${source_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d "$database_name" \
  -v owner_user="$owner_user" \
  -v marker_id="$marker_id" <<'SQL'
BEGIN;
CREATE SCHEMA IF NOT EXISTS r1_recovery_drill AUTHORIZATION :"owner_user";
ALTER SCHEMA r1_recovery_drill OWNER TO :"owner_user";
CREATE TABLE IF NOT EXISTS r1_recovery_drill.markers (
  marker_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE r1_recovery_drill.markers OWNER TO :"owner_user";
INSERT INTO r1_recovery_drill.markers (marker_id) VALUES (:'marker_id');
COMMIT;
SQL
# Record a named restore point after the marker. Unlike a wall-clock target
# chosen after upload, the restore point is a durable WAL record in the exact
# segment we subsequently fetch from the approved repository. PostgreSQL can
# therefore always promote at this explicit point even when the source becomes
# quiet after the segment is archived.
restore_point_lsn="$(docker "${source_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d "$database_name" -At \
  -v restore_point_name="$restore_point_name" -c "SELECT pg_create_restore_point(:'restore_point_name')")"
[[ "$restore_point_lsn" =~ ^[0-9A-F]+/[0-9A-F]+$ ]] || {
  printf 'PostgreSQL returned an invalid restore-point LSN: %s\n' "$restore_point_lsn" >&2
  exit 70
}
wal_segment="$(docker "${source_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d "$database_name" -At \
  -v restore_point_lsn="$restore_point_lsn" -c "SELECT pg_walfile_name(:'restore_point_lsn'::pg_lsn)")"
[[ "$wal_segment" =~ ^[0-9A-F]{24}$ ]] || { printf 'PostgreSQL returned an invalid marker WAL segment name.\n' >&2; exit 70; }
docker "${source_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d "$database_name" \
  -c 'SELECT pg_switch_wal()' >/dev/null
docker "${source_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d "$database_name" \
  -c 'CHECKPOINT' >/dev/null

# A successful base-backup fetch alone does not prove PITR. Poll the real WAL-G
# repository until the now-closed segment containing the post-backup marker can
# be fetched by the archive sidecar, then recover from the pinned older base.
archive_deadline=$((SECONDS + archive_timeout_seconds))
while true; do
  if docker_container_paths "${source_compose[@]}" --profile application exec -T wal-g-archive /bin/sh -ec \
    "rm -f /tmp/${wal_segment}.pitr-probe; /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g wal-fetch '${wal_segment}' /tmp/${wal_segment}.pitr-probe; test -s /tmp/${wal_segment}.pitr-probe; rm -f /tmp/${wal_segment}.pitr-probe" >/dev/null 2>&1; then
    break
  fi
  (( SECONDS < archive_deadline )) || {
    printf 'WAL segment %s was not retrievable from the approved repository within %ss.\n' "$wal_segment" "$archive_timeout_seconds" >&2
    exit 1
  }
  sleep 5
done

export IOT_RECOVERY_TARGET_NAME="$restore_point_name"
export IOT_RECOVERY_BASE_BACKUP="$base_backup"
recovery_started_epoch="$(date -u +%s)"
marker_age_seconds=$(( recovery_started_epoch - marker_epoch ))
if (( marker_age_seconds > 900 )); then
  printf 'RPO assertion failed before recovery: marker age is %ss, above the 900s target.\n' "$marker_age_seconds" >&2
  exit 1
fi

mkdir -p "$report_directory"
docker "${recovery_compose[@]}" config --quiet
docker "${recovery_compose[@]}" up -d --build volume-init wal-g-recovery postgres

deadline=$((SECONDS + recovery_timeout_seconds))
while true; do
  recovery_postgres_id="$(docker "${recovery_compose[@]}" ps -q postgres | head -n 1)"
  recovery_health="none"
  [[ -n "$recovery_postgres_id" ]] && recovery_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$recovery_postgres_id")"
  [[ "$recovery_health" == "healthy" ]] && break
  (( SECONDS < deadline )) || { printf 'Recovery PostgreSQL did not become healthy within %ss.\n' "$recovery_timeout_seconds" >&2; exit 1; }
  sleep 5
done

recovered_marker="$(docker "${recovery_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d "$database_name" -At \
  -v marker_id="$marker_id" -c "SELECT marker_id FROM r1_recovery_drill.markers WHERE marker_id = :'marker_id'")"
[[ "$recovered_marker" == "$marker_id" ]] || { printf 'Recovered database does not contain the drill marker.\n' >&2; exit 1; }

recovered_version="$(docker "${recovery_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d "$database_name" -Atc \
  'SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1')"
[[ "$recovered_version" == "$expected_flyway_version" ]] || {
  printf 'Recovered Flyway version is %s; expected %s.\n' "$recovered_version" "$expected_flyway_version" >&2
  exit 1
}

write_marker="${marker_id}-write-proof"
docker "${recovery_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$bootstrap_user" -d "$database_name" \
  -v marker_id="$write_marker" -c "INSERT INTO r1_recovery_drill.markers (marker_id) VALUES (:'marker_id')" >/dev/null

recovery_finished_epoch="$(date -u +%s)"
rto_seconds=$(( recovery_finished_epoch - recovery_started_epoch ))
if (( rto_seconds > 3600 )); then
  printf 'RTO assertion failed: recovery took %ss, above the 3600s target.\n' "$rto_seconds" >&2
  exit 1
fi

report_file="$report_directory/report.json"
cat > "$report_file" <<EOF
{
  "drill": "wal-g-physical-recovery",
  "sourceProject": "$source_project",
  "recoveryProject": "$recovery_project",
  "markerId": "$marker_id",
  "markerTime": "$marker_time",
  "recoveryTargetName": "$restore_point_name",
  "recoveryTargetLsn": "$restore_point_lsn",
  "recoveryTargetWalSegment": "$wal_segment",
  "markerAgeSeconds": $marker_age_seconds,
  "rpoTargetSeconds": 900,
  "rtoSeconds": $rto_seconds,
  "rtoTargetSeconds": 3600,
  "flywayVersion": "$recovered_version",
  "baseBackup": "$base_backup",
  "replayedWalSegment": "$wal_segment",
  "readWriteProof": true,
  "status": "passed"
}
EOF

printf 'WAL-G physical recovery drill passed. RPO marker age: %ss; RTO: %ss.\n' "$marker_age_seconds" "$rto_seconds"
printf 'Redacted evidence: %s\n' "$report_file"
printf 'The independent recovery project is retained for inspection: %s\n' "$recovery_project"
