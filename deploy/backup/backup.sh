#!/bin/sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$BACKUP_DIR/.${PGDATABASE}-${timestamp}.dump.tmp"
backup="$BACKUP_DIR/${PGDATABASE}-${timestamp}.dump"

umask 077
pg_dump --format=custom --no-owner --no-privileges --file "$temporary"
mv "$temporary" "$backup"
sha256sum "$backup" > "$backup.sha256"

# Retention is intentionally constrained to the configured backup directory.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.dump.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

printf '%s\n' "Created PostgreSQL backup: $backup"
