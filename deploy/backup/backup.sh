#!/bin/sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSFILE:?PGPASSFILE is required}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$BACKUP_DIR/.${PGDATABASE}-${timestamp}.dump.tmp"
backup="$BACKUP_DIR/${PGDATABASE}-${timestamp}.dump"
checksum_temporary="$BACKUP_DIR/.${PGDATABASE}-${timestamp}.dump.sha256.tmp"
checksum="$backup.sha256"

umask 077
pg_dump --format=custom --no-owner --no-privileges --file "$temporary"
mv "$temporary" "$backup"
# Store a portable basename in the sidecar. A recovery mounts the pair into an
# isolated directory, so an absolute path such as /backups/... would not be
# valid there. restore.sh also accepts legacy sidecars by comparing the hash
# field directly, allowing older retained backups to remain recoverable.
(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$backup")" > "$(basename "$checksum_temporary")"
)
mv "$checksum_temporary" "$checksum"

# Health must represent a *recent, complete* backup rather than the mere
# presence of an old dump on the persistent volume. Publish the marker only
# after both the dump and its checksum have been atomically moved into place.
status_temporary="$BACKUP_DIR/.backup-last-success.tmp"
status_file="$BACKUP_DIR/.backup-last-success"
{
  printf 'epoch=%s\n' "$(date -u +%s)"
  printf 'backup=%s\n' "$(basename "$backup")"
  printf 'checksum=%s\n' "$(awk 'NR == 1 { print $1; exit }' "$checksum")"
} > "$status_temporary"
mv "$status_temporary" "$status_file"

# Retention is intentionally constrained to the configured backup directory.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.dump.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

printf '%s\n' "Created PostgreSQL backup: $backup"
