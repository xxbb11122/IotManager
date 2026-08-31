#!/bin/sh
set -eu

# WAL archiving is only healthy when the remote repository was reached
# recently and no locally spooled, unuploaded WAL has exceeded its allowed
# recovery-point objective window.
archive_dir="${WAL_ARCHIVE_DIR:?WAL_ARCHIVE_DIR is required}"
status_dir="${WALG_STATUS_DIR:-/var/lib/wal-g/status}"
remote_max_age="${WALG_ARCHIVE_REMOTE_MAX_AGE_SECONDS:-120}"
pending_max_age="${WALG_ARCHIVE_MAX_PENDING_SECONDS:-900}"

case "$remote_max_age" in ''|*[!0-9]*) exit 1 ;; esac
case "$pending_max_age" in ''|*[!0-9]*) exit 1 ;; esac

remote_marker="$status_dir/archive-remote-last-success.epoch"
[ -r "$remote_marker" ] || exit 1
remote_epoch="$(cat "$remote_marker")"
case "$remote_epoch" in ''|*[!0-9]*) exit 1 ;; esac
now="$(date -u +%s)"
[ "$now" -ge "$remote_epoch" ] || exit 1
[ $((now - remote_epoch)) -le "$remote_max_age" ] || exit 1

for wal_file in "$archive_dir"/*; do
  [ -f "$wal_file" ] || continue
  wal_name="$(basename "$wal_file")"
  printf '%s' "$wal_name" | grep -Eq '^([0-9A-F]{24}|[0-9A-F]{8}\.history)$' || continue
  modified_epoch="$(stat -c %Y "$wal_file")"
  case "$modified_epoch" in ''|*[!0-9]*) exit 1 ;; esac
  [ "$now" -ge "$modified_epoch" ] || exit 1
  [ $((now - modified_epoch)) -le "$pending_max_age" ] || exit 1
done
