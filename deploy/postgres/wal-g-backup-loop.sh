#!/bin/sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATA:?PGDATA is required}"
status_dir="${WALG_STATUS_DIR:-/var/lib/wal-g/status}"

pgpass_escape() {
  # PostgreSQL .pgpass uses ':' and '\\' as delimiters/escapes. Keep the
  # Secret file opaque and encode it before giving it to libpq.
  printf '%s' "$1" | sed 's/[\\:]/\\&/g'
}

secret_file="/run/secrets/iot_db_owner_password"
if [ ! -r "$secret_file" ]; then
  echo 'Required WAL-G database password is unavailable.' >&2
  exit 78
fi

interval="${WALG_BACKUP_INTERVAL_SECONDS:-900}"
case "$interval" in
  ''|*[!0-9]*) echo 'WALG_BACKUP_INTERVAL_SECONDS must be a positive integer.' >&2; exit 64 ;;
esac
if [ "$interval" -lt 60 ] || [ "$interval" -gt 900 ]; then
  echo 'WALG_BACKUP_INTERVAL_SECONDS must be between 60 and 900 seconds for the P0 RPO target.' >&2
  exit 64
fi

umask 077
passfile="/tmp/wal-g.pgpass"
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
mkdir -p "$status_dir"

record_success() {
  marker="$status_dir/base-backup-last-success.epoch"
  temporary="${marker}.tmp"
  date -u +%s > "$temporary"
  mv "$temporary" "$marker"
}

while true; do
  /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g backup-push "$PGDATA"
  record_success
  sleep "$interval"
done
