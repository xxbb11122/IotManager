#!/bin/sh
set -eu

: "${IOT_RESTORE_CONFIRM:?Set IOT_RESTORE_CONFIRM=RESTORE after validating the target database}"
: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

if [ "$IOT_RESTORE_CONFIRM" != "RESTORE" ]; then
  echo "Refusing restore: IOT_RESTORE_CONFIRM must exactly equal RESTORE" >&2
  exit 64
fi

backup_file="${1:?Usage: restore.sh /backups/file.dump}"
if [ ! -f "$backup_file" ]; then
  echo "Backup file does not exist: $backup_file" >&2
  exit 66
fi
if [ -f "$backup_file.sha256" ]; then
  (cd "$(dirname "$backup_file")" && sha256sum -c "$(basename "$backup_file").sha256")
fi

echo "Restoring $backup_file into PostgreSQL database $PGDATABASE on $PGHOST"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$PGDATABASE" "$backup_file"
echo "Restore completed. Run migration/health smoke checks before reopening traffic."
