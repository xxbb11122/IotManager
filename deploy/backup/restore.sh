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
toc_file="$(mktemp /tmp/iot-restore-toc.XXXXXX)"
filtered_toc_file="${toc_file}.filtered"
trap 'rm -f "$toc_file" "$filtered_toc_file"' EXIT HUP INT TERM
pg_restore --list "$backup_file" > "$toc_file"

# PostgreSQL initialization preinstalls pgvector as the admin role so Flyway
# can use it without granting the application or backup owner superuser rights.
# A custom dump includes the extension and its comment. Restore all business
# objects as the constrained owner, but never DROP/COMMENT that admin-owned
# extension. Reject a missing or incompatible target extension before changing
# any database objects rather than silently omitting its archive entries.
vector_entries="$(awk '$4 == "EXTENSION" && $5 == "-" && $6 == "vector" { count++ } END { print count + 0 }' "$toc_file")"
if [ "$vector_entries" -gt 1 ]; then
  echo "Backup contains multiple pgvector extension entries; refusing restore." >&2
  exit 65
fi
if [ "$vector_entries" -eq 1 ]; then
  installed_vector_version="$(psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align \
    --dbname "$PGDATABASE" --command="SELECT extversion FROM pg_extension WHERE extname = 'vector'" | tr -d '[:space:]')"
  if [ "$installed_vector_version" != '0.8.6' ]; then
    printf 'Recovery target requires admin-installed pgvector 0.8.6; found %s.\n' "${installed_vector_version:-none}" >&2
    exit 78
  fi
  awk '
    $4 == "EXTENSION" && $5 == "-" && $6 == "vector" { next }
    $4 == "COMMENT" && $5 == "-" && $6 == "EXTENSION" && $7 == "vector" { next }
    { print }
  ' "$toc_file" > "$filtered_toc_file"
  pg_restore --use-list="$filtered_toc_file" --clean --if-exists --no-owner --no-privileges \
    --dbname "$PGDATABASE" "$backup_file"
else
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$PGDATABASE" "$backup_file"
fi
echo "Restore completed. Run migration/health smoke checks before reopening traffic."
