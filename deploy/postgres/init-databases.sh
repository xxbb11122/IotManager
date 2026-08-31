#!/bin/sh
set -eu

secret() {
  secret_file="/run/secrets/$1"
  if [ ! -r "$secret_file" ]; then
    echo "Required secret is unavailable: $1" >&2
    exit 78
  fi
  value="$(cat "$secret_file")"
  if [ -z "$value" ]; then
    echo "Required secret is empty: $1" >&2
    exit 78
  fi
  printf '%s' "$value"
}

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${IOT_DB_DATABASE:?IOT_DB_DATABASE is required}"
: "${IOT_DB_OWNER_USERNAME:?IOT_DB_OWNER_USERNAME is required}"
: "${IOT_DB_USERNAME:?IOT_DB_USERNAME is required}"
: "${KEYCLOAK_DB_DATABASE:?KEYCLOAK_DB_DATABASE is required}"
: "${KEYCLOAK_DB_USERNAME:?KEYCLOAK_DB_USERNAME is required}"

iot_owner_password="$(secret iot_db_owner_password)"
iot_app_password="$(secret iot_db_app_password)"
keycloak_password="$(secret keycloak_db_password)"

# These scripts run only for a fresh data volume. All dynamic values use psql
# identifier/literal quoting, so database names and high-entropy passwords are
# never interpolated directly into SQL source.
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=iot_database="$IOT_DB_DATABASE" \
  --set=iot_owner="$IOT_DB_OWNER_USERNAME" \
  --set=iot_app="$IOT_DB_USERNAME" \
  --set=keycloak_database="$KEYCLOAK_DB_DATABASE" \
  --set=keycloak_user="$KEYCLOAK_DB_USERNAME" \
  --set=iot_owner_password="$iot_owner_password" \
  --set=iot_app_password="$iot_app_password" \
  --set=keycloak_password="$keycloak_password" <<'SQL'
SELECT format('CREATE ROLE %I', :'iot_owner')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'iot_owner')
\gexec
-- This credential owns Flyway objects and executes WAL-G physical backups.
-- It inherits only pg_read_all_settings below; it remains non-superuser and
-- cannot create roles, databases, or replication connections.
ALTER ROLE :"iot_owner" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'iot_owner_password';

SELECT format('CREATE ROLE %I', :'iot_app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'iot_app')
\gexec
ALTER ROLE :"iot_app" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'iot_app_password';

SELECT format('CREATE ROLE %I', :'keycloak_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'keycloak_user')
\gexec
ALTER ROLE :"keycloak_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'keycloak_password';

SELECT format('CREATE DATABASE %I OWNER %I', :'iot_database', :'iot_owner')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'iot_database')
\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'keycloak_database', :'keycloak_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'keycloak_database')
\gexec
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$IOT_DB_DATABASE" \
  --set=iot_database="$IOT_DB_DATABASE" \
  --set=iot_owner="$IOT_DB_OWNER_USERNAME" \
  --set=iot_app="$IOT_DB_USERNAME" <<'SQL'
REVOKE ALL ON DATABASE :"iot_database" FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"iot_database" TO :"iot_app";
GRANT USAGE ON SCHEMA public TO :"iot_app";
-- WAL-G reads the data directory as the Linux postgres user, but PostgreSQL
-- still requires explicit permission to bracket an online physical backup.
-- WAL-G also uses SHOW data_directory to validate that its read-only PGDATA
-- mount matches the server. Grant the predefined read-only settings role and
-- only the two backup functions to the migration/backup credential; the
-- Backend DML credential never receives either privilege or REPLICATION.
REVOKE ALL ON FUNCTION pg_catalog.pg_backup_start(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_catalog.pg_backup_stop(boolean) FROM PUBLIC;
GRANT pg_read_all_settings TO :"iot_owner";
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_start(text, boolean) TO :"iot_owner";
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_stop(boolean) TO :"iot_owner";
ALTER DEFAULT PRIVILEGES FOR ROLE :"iot_owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"iot_app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"iot_owner" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"iot_app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"iot_owner" IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO :"iot_app";
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$KEYCLOAK_DB_DATABASE" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL

unset iot_owner_password iot_app_password keycloak_password
printf '%s\n' 'PostgreSQL application, migration, and Keycloak roles initialized with least privilege.'
