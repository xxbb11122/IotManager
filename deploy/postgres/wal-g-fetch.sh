#!/bin/sh
set -eu

wal_name="${1:?WAL segment name is required}"
destination="${2:?restore destination is required}"
exec /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g wal-fetch "$wal_name" "$destination"
