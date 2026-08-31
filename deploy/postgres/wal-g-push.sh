#!/bin/sh
set -eu

archive_file="${1:?archive file path is required}"
exec /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g wal-push "$archive_file"
