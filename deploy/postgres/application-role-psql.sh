#!/bin/sh
# Execute one local PostgreSQL command as the restricted Backend DML role.
# This helper lives only in the PostgreSQL image: it prevents recovery checks
# and runtime policy tests from mounting the application credential into the
# separate logical-backup sidecar.
set -eu

: "${IOT_DB_USERNAME:?IOT_DB_USERNAME is required}"
: "${IOT_DB_DATABASE:?IOT_DB_DATABASE is required}"

secret_file="${IOT_DB_APP_PASSWORD_SECRET_FILE:-/run/secrets/iot_db_app_password}"
if [ ! -r "$secret_file" ]; then
  echo "Required application PostgreSQL password secret is unavailable: $secret_file" >&2
  exit 78
fi

pgpass_escape() {
  printf '%s' "$1" | sed 's/[\\:]/\\&/g'
}

umask 077
passfile="${TMPDIR:-/tmp}/application-role-pgpass-$$"
cleanup() {
  rm -f "$passfile"
}
trap cleanup EXIT HUP INT TERM

password="$(cat "$secret_file")"
if [ -z "$password" ]; then
  echo "Required application PostgreSQL password secret is empty: $secret_file" >&2
  exit 78
fi

printf '%s:%s:%s:%s:%s\n' \
  '127.0.0.1' \
  '5432' \
  "$(pgpass_escape "$IOT_DB_DATABASE")" \
  "$(pgpass_escape "$IOT_DB_USERNAME")" \
  "$(pgpass_escape "$password")" > "$passfile"
unset password
chmod 600 "$passfile"

# Do not use exec: the EXIT trap must remove the transient credential file
# after both successful and failed psql calls.
set +e
PGPASSFILE="$passfile" psql -h 127.0.0.1 -p 5432 -U "$IOT_DB_USERNAME" -d "$IOT_DB_DATABASE" "$@"
status=$?
set -e
exit "$status"
