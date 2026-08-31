#!/bin/sh
set -eu

: "${IOT_RESTORE_CONFIRM:?Set IOT_RESTORE_CONFIRM=RESTORE after validating the target database}"
: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSFILE:?PGPASSFILE is required}"

if [ "$IOT_RESTORE_CONFIRM" != "RESTORE" ]; then
  echo "Refusing restore: IOT_RESTORE_CONFIRM must exactly equal RESTORE" >&2
  exit 64
fi

backup_file="${1:?Usage: restore.sh /backups/file.dump}"
if [ ! -f "$backup_file" ]; then
  echo "Backup file does not exist: $backup_file" >&2
  exit 66
fi
checksum_file="$backup_file.sha256"
if [ ! -r "$checksum_file" ]; then
  echo "Backup checksum sidecar is required: $checksum_file" >&2
  exit 66
fi

# Compare the digest field rather than asking sha256sum -c to resolve the
# stored file name. Earlier backup versions wrote an absolute /backups path;
# the restored pair intentionally lives under /restore. Both formats remain
# safe as long as the signed sidecar digest matches this exact dump.
expected_checksum="$(awk 'NR == 1 { print $1; exit }' "$checksum_file")"
if ! printf '%s\n' "$expected_checksum" | grep -Eq '^[[:xdigit:]]{64}$'; then
  echo "Backup checksum sidecar is malformed: $checksum_file" >&2
  exit 65
fi
actual_checksum="$(sha256sum "$backup_file" | awk '{ print $1 }')"
if [ "$actual_checksum" != "$expected_checksum" ]; then
  echo "Backup checksum verification failed: $backup_file" >&2
  exit 65
fi

echo "Restoring $backup_file into PostgreSQL database $PGDATABASE on $PGHOST"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$PGDATABASE" "$backup_file"
echo "Restore completed. Run migration/health smoke checks before reopening traffic."
