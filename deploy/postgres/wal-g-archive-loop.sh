#!/bin/sh
set -eu

: "${WAL_ARCHIVE_DIR:?WAL_ARCHIVE_DIR is required}"
retention_seconds="${WALG_ARCHIVE_SPOOL_RETENTION_SECONDS:-86400}"
remote_probe_interval_seconds="${WALG_ARCHIVE_REMOTE_PROBE_INTERVAL_SECONDS:-60}"
case "$retention_seconds" in
  ''|*[!0-9]*) echo 'WALG_ARCHIVE_SPOOL_RETENTION_SECONDS must be a positive integer.' >&2; exit 64 ;;
esac
if [ "$retention_seconds" -lt 60 ]; then
  echo 'WALG_ARCHIVE_SPOOL_RETENTION_SECONDS must be at least 60 seconds.' >&2
  exit 64
fi
case "$remote_probe_interval_seconds" in
  ''|*[!0-9]*) echo 'WALG_ARCHIVE_REMOTE_PROBE_INTERVAL_SECONDS must be a positive integer.' >&2; exit 64 ;;
esac
if [ "$remote_probe_interval_seconds" -lt 15 ]; then
  echo 'WALG_ARCHIVE_REMOTE_PROBE_INTERVAL_SECONDS must be at least 15 seconds.' >&2
  exit 64
fi

status_dir="${WALG_STATUS_DIR:-/var/lib/wal-g/status}"
mkdir -p "$WAL_ARCHIVE_DIR" "$status_dir"
# The PostgreSQL container writes complete segments to WAL_ARCHIVE_DIR and
# this sidecar owns their retry state. Leave PGDATA unset so WAL-G stores its
# small archive-status markers on the writable tmpfs rather than requiring a
# writable mount of the production data directory.
unset PGDATA
# Validate the selected backend before accepting WAL from PostgreSQL. A local
# binary version check is insufficient: backup-list performs a real storage
# read, so invalid S3 credentials/bucket policy keep the service unhealthy.
# The command does not print credentials and an empty repository is valid.
record_epoch() {
  marker="$1"
  temporary="${marker}.tmp"
  date -u +%s > "$temporary"
  mv "$temporary" "$marker"
}

probe_remote() {
  /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g backup-list >/dev/null
  record_epoch "$status_dir/archive-remote-last-success.epoch"
}

probe_remote
last_probe_epoch="$(date -u +%s)"

while true; do
  now_epoch="$(date -u +%s)"
  if [ $((now_epoch - last_probe_epoch)) -ge "$remote_probe_interval_seconds" ]; then
    probe_remote
    last_probe_epoch="$now_epoch"
  fi
  for wal_file in "$WAL_ARCHIVE_DIR"/*; do
    [ -f "$wal_file" ] || continue
    wal_name="$(basename "$wal_file")"
    # PostgreSQL archives 24-hex WAL segments and 8-hex timeline history
    # files. Ignore sidecar state such as .pending/.uploaded so a completed
    # segment is never uploaded repeatedly or renamed into an endless suffix.
    printf '%s' "$wal_name" | grep -Eq '^([0-9A-F]{24}|[0-9A-F]{8}\.history)$' || continue
    /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g wal-push "$wal_file"
    mv "$wal_file" "$wal_file.uploaded"
    record_epoch "$status_dir/archive-wal-last-success.epoch"
  done
  find "$WAL_ARCHIVE_DIR" -maxdepth 1 -type f -name '*.uploaded' -mmin "+$((retention_seconds / 60))" -delete
  sleep 5
done
