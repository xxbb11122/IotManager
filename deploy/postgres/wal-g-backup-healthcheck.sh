#!/bin/sh
set -eu

# WAL-G base backups are a secondary recovery boundary. Their health marker
# is written only after a remote backup-push succeeds and persists across a
# sidecar restart so stale success cannot remain green indefinitely.
status_dir="${WALG_STATUS_DIR:-/var/lib/wal-g/status}"
interval="${WALG_BACKUP_INTERVAL_SECONDS:-900}"
max_age="${WALG_BACKUP_MAX_AGE_SECONDS:-}"
case "$interval" in ''|*[!0-9]*) exit 1 ;; esac
if [ -z "$max_age" ]; then
  max_age=$((interval + 300))
fi
case "$max_age" in ''|*[!0-9]*) exit 1 ;; esac

marker="$status_dir/base-backup-last-success.epoch"
[ -r "$marker" ] || exit 1
epoch="$(cat "$marker")"
case "$epoch" in ''|*[!0-9]*) exit 1 ;; esac
now="$(date -u +%s)"
[ "$now" -ge "$epoch" ] || exit 1
[ $((now - epoch)) -le "$max_age" ]
