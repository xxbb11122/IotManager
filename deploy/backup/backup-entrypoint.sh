#!/bin/sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

pgpass_escape() {
  # PostgreSQL .pgpass uses ':' and '\\' as delimiters/escapes. Production
  # passwords are allowed to contain either, so encode every field instead of
  # assuming the integration generator's hexadecimal alphabet.
  printf '%s' "$1" | sed 's/[\\:]/\\&/g'
}

# The Compose backup sidecar runs as the restricted migration/backup owner.
# Default to that same secret for deliberate one-shot invocations so a missing
# override cannot silently fall back to the Backend DML credential.
secret_file="${PGPASSWORD_SECRET_FILE:-/run/secrets/iot_db_owner_password}"
if [ ! -r "$secret_file" ]; then
  echo "Required PostgreSQL password secret is unavailable: $secret_file" >&2
  exit 78
fi

umask 077
passfile="/tmp/pgpass"
password="$(cat "$secret_file")"
printf '%s:%s:%s:%s:%s\n' \
  "$(pgpass_escape "$PGHOST")" \
  "$(pgpass_escape "${PGPORT:-5432}")" \
  "$(pgpass_escape "$PGDATABASE")" \
  "$(pgpass_escape "$PGUSER")" \
  "$(pgpass_escape "$password")" > "$passfile"
unset password
chmod 600 "$passfile"
export PGPASSFILE="$passfile"
trap 'rm -f "$passfile"' EXIT HUP INT TERM

exec "$@"
