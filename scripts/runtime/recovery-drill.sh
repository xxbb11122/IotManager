#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s /absolute/path/to/backup.dump\n' "$0" >&2
  exit 64
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup_file="$(realpath "$1")"
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
expected_flyway_version="${IOT_EXPECTED_FLYWAY_VERSION:-18}"
required_role_codes="${IOT_REQUIRED_ROLE_CODES:-OWNER,ADMIN,OPERATOR,VIEWER}"
[[ -n "$expected_flyway_version" ]] || { printf 'IOT_EXPECTED_FLYWAY_VERSION must not be empty.\n' >&2; exit 64; }
[[ "$required_role_codes" =~ ^[A-Z]+(,[A-Z]+)*$ ]] || {
  printf 'IOT_REQUIRED_ROLE_CODES must be a comma-separated uppercase role-code list.\n' >&2
  exit 64
}
required_role_codes="$(printf '%s' "$required_role_codes" | tr ',' '\n' | sort -u | paste -sd, -)"

volume_name="${recovery_project}_postgres-data"
if docker volume inspect "$volume_name" >/dev/null 2>&1; then
  printf 'Refusing recovery because target volume already exists: %s\n' "$volume_name" >&2
  exit 73
fi

backup_mount_source="$(docker_host_path "$backup_file")"
checksum_mount_source="$(docker_host_path "$checksum_file")"
compose=(compose --project-name "$recovery_project" --env-file "$(docker_host_path "$environment_file")" -f "$(docker_host_path "$repository_root/deploy/docker-compose.yml")" -f "$(docker_host_path "$repository_root/deploy/docker-compose.integration.yml")")
docker "${compose[@]}" up -d --build volume-init postgres

deadline=$((SECONDS + 120))
while true; do
  postgres_id="$(docker "${compose[@]}" ps -q postgres | head -n 1)"
  health="none"
  [[ -n "$postgres_id" ]] && health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$postgres_id")"
  [[ "$health" == healthy ]] && break
  (( SECONDS < deadline )) || { printf 'Isolated recovery PostgreSQL did not become healthy.\n' >&2; exit 1; }
  sleep 3
done

docker_container_paths "${compose[@]}" --profile application run --rm --no-deps \
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
[[ "$latest_flyway_version" == "$expected_flyway_version" ]] || {
  printf 'Recovered Flyway version is %s; expected %s.\n' "$latest_flyway_version" "$expected_flyway_version" >&2
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

printf 'Logical recovery drill passed in isolated project: %s\n' "$recovery_project"
printf 'The recovery project and volume were retained. Stop it with docker compose --project-name %s down (without -v).\n' "$recovery_project"
