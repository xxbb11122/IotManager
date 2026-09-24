#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mode="$(printenv IOT_RUNTIME_MODE 2>/dev/null || true)"
digest_manifest="$(printenv IOT_DIGEST_MANIFEST 2>/dev/null || true)"
image_environment_file="$(printenv IOT_DIGEST_ENV_FILE 2>/dev/null || true)"
release_services_file="$(printenv IOT_RELEASE_SERVICES_FILE 2>/dev/null || true)"
release_candidate_file="$(printenv IOT_RELEASE_CANDIDATE_FILE 2>/dev/null || true)"
release_topology_file="$(printenv IOT_RELEASE_TOPOLOGY_FILE 2>/dev/null || true)"
backup_input=''
[[ -n "$mode" ]] || mode=local

while (( $# > 0 )); do
  case "$1" in
    --mode)
      shift
      mode="$1"
      ;;
    --digest-manifest)
      shift
      digest_manifest="$1"
      ;;
    --digest-env-file)
      shift
      image_environment_file="$1"
      ;;
    --release-services)
      shift
      release_services_file="$1"
      ;;
    --release-candidate)
      shift
      release_candidate_file="$1"
      ;;
    --release-topology)
      shift
      release_topology_file="$1"
      ;;
    --help|-h)
      printf 'Usage: %s /absolute/path/to/backup.dump [--mode local|immutable] [--digest-manifest path] [--digest-env-file path] [--release-services path] [--release-candidate path] [--release-topology path]\n' "$0"
      exit 0
      ;;
    --*)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 64
      ;;
    *)
      [[ -z "$backup_input" ]] || { printf 'Only one backup file may be supplied.\n' >&2; exit 64; }
      backup_input="$1"
      ;;
  esac
  shift
done

[[ -n "$backup_input" ]] || { printf 'A backup file is required.\n' >&2; exit 64; }
case "$mode" in
  local|immutable) ;;
  *) printf 'Recovery mode must be local or immutable.\n' >&2; exit 64 ;;
esac

backup_file="$(realpath "$backup_input")"
[[ "$backup_file" == *.dump ]] || { printf 'Backup file must use the .dump extension.\n' >&2; exit 64; }
checksum_file="${backup_file}.sha256"
[[ -f "$checksum_file" ]] || { printf 'Backup checksum sidecar was not found: %s\n' "$checksum_file" >&2; exit 66; }
backup_name="$(basename "$backup_file")"
checksum_name="$(basename "$checksum_file")"
[[ "${IOT_RESTORE_CONFIRM:-}" == RESTORE ]] || { printf 'Set IOT_RESTORE_CONFIRM=RESTORE after validating the independent target.\n' >&2; exit 64; }

source_project="${IOT_COMPOSE_PROJECT:-iot-manager-p0}"
recovery_project="${IOT_RECOVERY_PROJECT:-iot-manager-p0-recovery}"
environment_file="${IOT_ENVIRONMENT_FILE:-$repository_root/deploy/.env.integration}"
[[ "$source_project" != "$recovery_project" ]] || { printf 'Recovery project must differ from the source project.\n' >&2; exit 64; }
[[ -f "$environment_file" ]] || { printf 'Environment file was not found: %s\n' "$environment_file" >&2; exit 66; }
docker info >/dev/null

if [[ "$mode" == immutable ]]; then
  [[ -n "$digest_manifest" && -f "$digest_manifest" ]] || {
    printf 'Immutable mode requires --digest-manifest <image-digests.json>.\n' >&2
    exit 66
  }
  [[ -n "$image_environment_file" ]] || image_environment_file="$(dirname "$digest_manifest")/image-digests.env"
  [[ -n "$release_services_file" ]] || release_services_file="$(dirname "$digest_manifest")/release-services.json"
  [[ -n "$release_candidate_file" ]] || release_candidate_file="$(dirname "$digest_manifest")/release-candidate.json"
  [[ -n "$release_topology_file" ]] || release_topology_file="$(dirname "$digest_manifest")/release-topology.json"
  for required_file in "$release_services_file" "$release_candidate_file" "$release_topology_file"; do
    [[ -f "$required_file" ]] || { printf 'Immutable mode requires release evidence input: %s\n' "$required_file" >&2; exit 66; }
  done
  manifest_validation_args=(
    validate-digest-manifest
    --candidate "$release_candidate_file"
    --topology "$release_topology_file"
    --services "$release_services_file"
    --manifest "$digest_manifest"
  )
  [[ -n "${IOT_IMAGE_MANIFEST_SHA256:-}" ]] && manifest_validation_args+=(--expected-manifest-sha256 "$IOT_IMAGE_MANIFEST_SHA256")
  [[ -n "${IOT_RELEASE_CANDIDATE_ID:-}" ]] && manifest_validation_args+=(--expected-release-candidate-id "$IOT_RELEASE_CANDIDATE_ID")
  [[ -n "${IOT_SOURCE_SHA:-}" ]] && manifest_validation_args+=(--expected-source-sha "$IOT_SOURCE_SHA")
  node "$repository_root/scripts/ci/release-tools.mjs" "${manifest_validation_args[@]}"
  node "$repository_root/scripts/ci/release-tools.mjs" render-digest-env \
    --manifest "$digest_manifest" \
    --output "$image_environment_file"
fi

# Git Bash rewrites Unix-looking container paths before Docker receives them.
# Convert host-side files to native paths first, then disable that rewrite only
# for invocations that also contain /bin/sh, /scripts, or /restore paths.
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

environment_value() {
  local key="$1"
  local value
  value="$(sed -n "s/^${key}=//p" "$environment_file" | tail -n 1 | tr -d '\r')"
  [[ -n "$value" ]] || { printf 'Required value was not found in the environment file: %s\n' "$key" >&2; exit 66; }
  printf '%s' "$value"
}

bootstrap_user="$(environment_value POSTGRES_BOOTSTRAP_USERNAME)"
database_name="$(environment_value IOT_DB_DATABASE)"
owner_user="$(environment_value IOT_DB_OWNER_USERNAME)"
required_role_codes="${IOT_REQUIRED_ROLE_CODES:-OWNER,ADMIN,OPERATOR,VIEWER}"
[[ "$required_role_codes" =~ ^[A-Z]+(,[A-Z]+)*$ ]] || {
  printf 'IOT_REQUIRED_ROLE_CODES must be a comma-separated uppercase role-code list.\n' >&2
  exit 64
}
required_role_codes="$(printf '%s' "$required_role_codes" | tr ',' '\n' | sort -u | paste -sd, -)"

metadata_file="${backup_file}.metadata.json"
[[ -s "$metadata_file" ]] || { printf 'Backup version metadata is required: %s\n' "$metadata_file" >&2; exit 66; }
backup_checksum="$(awk 'NR == 1 { print $1; exit }' "$checksum_file")"
[[ "$backup_checksum" =~ ^[[:xdigit:]]{64}$ ]] || { printf 'Backup checksum sidecar is malformed.\n' >&2; exit 65; }
source_flyway_version="$(node - "$metadata_file" "$backup_checksum" <<'NODE'
const fs = require('node:fs');
const [metadataPath, checksum] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
if (metadata.schemaVersion !== 1 || metadata.backupSha256 !== checksum || !/^\d+$/.test(String(metadata.sourceFlywayVersion))) {
  throw new Error('Backup metadata is invalid or is not bound to this backup checksum.');
}
process.stdout.write(String(metadata.sourceFlywayVersion));
NODE
)"

latest_postgres_migration_version() {
  local directory file filename version maximum=0
  local -A seen_versions=()
  for directory in "$repository_root/backend/src/main/resources/db/migration" \
                   "$repository_root/backend/src/main/resources/db/migration-postgresql"; do
    [[ -d "$directory" ]] || { printf 'PostgreSQL migration source is unavailable: %s\n' "$directory" >&2; return 66; }
    for file in "$directory"/V*__*.sql; do
      [[ -f "$file" ]] || continue
      filename="$(basename "$file")"
      [[ "$filename" =~ ^V([0-9]+)__.+\.sql$ ]] || { printf 'Invalid Flyway migration filename: %s\n' "$filename" >&2; return 65; }
      version="${BASH_REMATCH[1]}"
      [[ -z "${seen_versions[$version]+present}" ]] || { printf 'Duplicate effective PostgreSQL Flyway version: V%s\n' "$version" >&2; return 65; }
      seen_versions[$version]="$filename"
      (( 10#$version > maximum )) && maximum=$((10#$version))
    done
  done
  (( maximum > 0 )) || { printf 'No PostgreSQL Flyway migrations were found.\n' >&2; return 66; }
  printf '%s' "$maximum"
}

candidate_flyway_version=''
if [[ "$mode" == immutable ]]; then
  candidate_flyway_version="$(latest_postgres_migration_version)"
  [[ "$candidate_flyway_version" == "$source_flyway_version" ]] || {
    printf 'Immutable candidate Flyway version %s does not match the backup source version %s.\n' \
      "$candidate_flyway_version" "$source_flyway_version" >&2
    exit 1
  }
fi
if [[ -n "${IOT_EXPECTED_FLYWAY_VERSION:-}" && "$IOT_EXPECTED_FLYWAY_VERSION" != "$source_flyway_version" ]]; then
  printf 'Explicit expected Flyway version %s does not match backup source version %s.\n' \
    "$IOT_EXPECTED_FLYWAY_VERSION" "$source_flyway_version" >&2
  exit 1
fi

volume_name="${recovery_project}_postgres-data"
if docker volume inspect "$volume_name" >/dev/null 2>&1; then
  printf 'Refusing recovery because target volume already exists: %s\n' "$volume_name" >&2
  exit 73
fi

backup_mount_source="$(docker_host_path "$backup_file")"
checksum_mount_source="$(docker_host_path "$checksum_file")"
compose=(compose --project-name "$recovery_project" --env-file "$(docker_host_path "$environment_file")")
[[ -n "$image_environment_file" ]] && compose+=(--env-file "$(docker_host_path "$image_environment_file")")
compose+=(-f "$(docker_host_path "$repository_root/deploy/docker-compose.yml")" -f "$(docker_host_path "$repository_root/deploy/docker-compose.integration.yml")")
[[ "$mode" == immutable ]] && compose+=(-f "$(docker_host_path "$repository_root/deploy/docker-compose.immutable.yml")")
start_flags=(-d)
run_flags=(--rm --no-deps)
if [[ "$mode" == local ]]; then
  start_flags+=(--build)
else
  start_flags+=(--no-build --pull never)
  run_flags=(--pull never "${run_flags[@]}")
fi
docker "${compose[@]}" up "${start_flags[@]}" volume-init postgres

deadline=$((SECONDS + 120))
while true; do
  postgres_id="$(docker "${compose[@]}" ps -q postgres | head -n 1)"
  health="none"
  [[ -n "$postgres_id" ]] && health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$postgres_id")"
  [[ "$health" == healthy ]] && break
  (( SECONDS < deadline )) || { printf 'Isolated recovery PostgreSQL did not become healthy.\n' >&2; exit 1; }
  sleep 3
done

docker_container_paths "${compose[@]}" --profile application run "${run_flags[@]}" \
  -e PGHOST=postgres \
  -e PGPORT=5432 \
  -e "PGUSER=$owner_user" \
  -e PGPASSWORD_SECRET_FILE=/run/secrets/iot_db_owner_password \
  -e IOT_RESTORE_CONFIRM=RESTORE \
  -v "$backup_mount_source:/restore/$backup_name:ro" \
  -v "$checksum_mount_source:/restore/$checksum_name:ro" \
  backup /bin/sh /scripts/restore.sh "/restore/$backup_name"

postgres_id="$(docker "${compose[@]}" ps -q postgres | head -n 1)"
latest_flyway_version="$(docker exec -u postgres "$postgres_id" psql -U "$bootstrap_user" -d "$database_name" -Atc 'SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1')"
[[ "$latest_flyway_version" =~ ^[0-9]+$ && "$latest_flyway_version" == "$source_flyway_version" ]] || {
  printf 'Recovered Flyway version is %s; backup metadata records source version %s.\n' "$latest_flyway_version" "$source_flyway_version" >&2
  exit 1
}
failed_migration_count="$(docker exec -u postgres "$postgres_id" psql -U "$bootstrap_user" -d "$database_name" -Atc 'SELECT count(*) FROM flyway_schema_history WHERE NOT success')"
[[ "$failed_migration_count" == 0 ]] || { printf 'Recovered database contains %s failed Flyway migration row(s).\n' "$failed_migration_count" >&2; exit 1; }

required_table_count="$(docker exec -u postgres "$postgres_id" psql -U "$bootstrap_user" -d "$database_name" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('devices', 'app_users', 'roles', 'agent_credentials', 'site_weather_snapshots', 'weather_provider_access_events')")"
[[ "$required_table_count" == 6 ]] || { printf 'Recovered database is missing required platform tables; found %s of 6.\n' "$required_table_count" >&2; exit 1; }

recovered_role_codes="$(docker exec -u postgres "$postgres_id" psql -U "$bootstrap_user" -d "$database_name" -Atc "SELECT coalesce(string_agg(code, ',' ORDER BY code), '') FROM roles WHERE code = ANY(string_to_array('$required_role_codes', ','))")"
[[ "$recovered_role_codes" == "$required_role_codes" ]] || {
  printf 'Recovered database is missing required role codes: expected %s, found %s.\n' "$required_role_codes" "$recovered_role_codes" >&2
  exit 1
}

# The backup service deliberately mounts only the owner credential. Run the
# restricted application-role proof through PostgreSQL's local helper, where
# the app secret is needed for database initialization but never crosses into
# the operational backup sidecar. Passing SQL directly as one psql argument
# avoids both MSYS path rewriting and nested-shell quoting differences.
application_probe="$(docker "${compose[@]}" exec -T postgres application-role-psql.sh \
  -v ON_ERROR_STOP=1 -Atc \
  "BEGIN; CREATE TEMP TABLE iot_recovery_write_probe (id integer NOT NULL); INSERT INTO iot_recovery_write_probe (id) VALUES (1); SELECT count(*) FROM iot_recovery_write_probe; ROLLBACK; SELECT has_schema_privilege(current_user, 'public', 'USAGE'); SELECT has_table_privilege(current_user, 'public.devices', 'SELECT,INSERT,UPDATE,DELETE');")"
grep -qx '1' <<<"$application_probe" || { printf 'Recovered database did not complete the application-role read/write transaction.\n' >&2; exit 1; }
[[ "$(grep -cx 't' <<<"$application_probe")" == 2 ]] || {
  printf 'Recovered database did not retain required application privileges on the public schema and devices table.\n' >&2
  exit 1
}

printf 'Logical recovery drill passed in isolated project: %s (mode: %s)\n' "$recovery_project" "$mode"
printf 'The recovery project and volume were retained. Stop it with docker compose --project-name %s down (without -v).\n' "$recovery_project"

report_directory="${IOT_RECOVERY_REPORT_DIR:-$repository_root/artifacts/recovery-drill/logical}"
mkdir -p "$report_directory"
report_project="$(printf '%s' "$recovery_project" | tr -c 'A-Za-z0-9_-' '_')"
candidate_json=null
[[ -n "$candidate_flyway_version" ]] && candidate_json="$candidate_flyway_version"
cat > "$report_directory/logical-recovery-$report_project.json" <<EOF
{
  "schemaVersion": 1,
  "drill": "logical-backup-recovery",
  "sourceFlywayVersion": $source_flyway_version,
  "candidateFlywayVersion": $candidate_json,
  "recoveredFlywayVersion": $latest_flyway_version,
  "versionsConsistent": true,
  "backupSha256": "$backup_checksum",
  "recoveryProject": "$recovery_project",
  "status": "PASS"
}
EOF
