#!/bin/sh
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
case "$interval" in
  ''|*[!0-9]*) echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2; exit 64 ;;
esac
if [ "$interval" -lt 60 ]; then
  echo "BACKUP_INTERVAL_SECONDS must be at least 60" >&2
  exit 64
fi

while true; do
  /bin/sh /scripts/backup.sh
  sleep "$interval"
done
