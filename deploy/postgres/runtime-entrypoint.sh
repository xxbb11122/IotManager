#!/bin/sh
set -eu
case "${1:-}" in -*) set -- postgres "$@" ;; esac
if [ "${1:-}" = postgres ] && [ -s "${PGDATA:?PGDATA is required}/PG_VERSION" ]; then
  actual="$(cat "$PGDATA/.iot-runtime-abi" 2>/dev/null || true)"
  if [ "$(cat "$PGDATA/PG_VERSION")" != '16' ] || [ "$actual" != 'pg16-musl-alpine3.24-v1' ]; then
    echo 'Refusing PostgreSQL startup: this data directory has no matching musl runtime ABI marker. Migrate glibc/unknown data with a verified logical dump into a new volume; do not relabel an existing directory.' >&2
    exit 78
  fi
fi
exec docker-entrypoint.sh "$@"
