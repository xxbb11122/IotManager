#!/bin/sh
# Run inside the upgraded PostgreSQL container before starting Backend when
# the data volume already exists. This is deliberately a separate admin step.
set -eu
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${IOT_DB_DATABASE:?IOT_DB_DATABASE is required}"
PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"
export PGPASSWORD
psql --set=ON_ERROR_STOP=1 --host=127.0.0.1 --username="$POSTGRES_USER" \
  --dbname="$IOT_DB_DATABASE" --command="CREATE EXTENSION IF NOT EXISTS vector VERSION '0.8.6'"
installed="$(psql --set=ON_ERROR_STOP=1 --host=127.0.0.1 --username="$POSTGRES_USER" \
  --dbname="$IOT_DB_DATABASE" --tuples-only --no-align \
  --command="SELECT extversion FROM pg_extension WHERE extname = 'vector'")"
if [ "$installed" != "0.8.6" ]; then
  printf 'Expected pgvector 0.8.6; found %s. Review the extension upgrade before Flyway V27.\n' "$installed" >&2
  exit 78
fi
printf 'pgvector %s is installed in %s.\n' "$installed" "$IOT_DB_DATABASE"
