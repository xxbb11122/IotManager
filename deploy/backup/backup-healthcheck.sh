#!/bin/sh
set -eu

# A retained dump is not sufficient evidence that the backup loop is healthy.
# This check accepts only the atomically written success marker from the most
# recent complete dump/checksum pair and fails closed once it becomes stale.
backup_dir="${BACKUP_DIR:-/backups}"
interval="${BACKUP_INTERVAL_SECONDS:-86400}"
max_age="${BACKUP_MAX_AGE_SECONDS:-}"

case "$interval" in
  ''|*[!0-9]*) exit 1 ;;
esac
if [ -z "$max_age" ]; then
  max_age=$((interval + 600))
fi
case "$max_age" in
  ''|*[!0-9]*) exit 1 ;;
esac

status_file="$backup_dir/.backup-last-success"
[ -r "$status_file" ] || exit 1
epoch="$(sed -n 's/^epoch=//p' "$status_file" | head -n 1)"
backup_name="$(sed -n 's/^backup=//p' "$status_file" | head -n 1)"
recorded_checksum="$(sed -n 's/^checksum=//p' "$status_file" | head -n 1)"
case "$epoch" in ''|*[!0-9]*) exit 1 ;; esac
case "$backup_name" in ''|.*|*/*|*'\\'*) exit 1 ;; esac
printf '%s\n' "$recorded_checksum" | grep -Eq '^[[:xdigit:]]{64}$' || exit 1

backup_file="$backup_dir/$backup_name"
checksum_file="$backup_file.sha256"
[ -s "$backup_file" ] || exit 1
[ -r "$checksum_file" ] || exit 1
sidecar_checksum="$(awk 'NR == 1 { print $1; exit }' "$checksum_file")"
[ "$sidecar_checksum" = "$recorded_checksum" ] || exit 1

now="$(date -u +%s)"
[ "$now" -ge "$epoch" ] || exit 1
[ $((now - epoch)) -le "$max_age" ]
