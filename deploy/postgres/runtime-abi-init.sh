#!/bin/sh
# The official entrypoint runs this only after initializing a NEW cluster.
set -eu
case "$(cat /etc/alpine-release)" in 3.24.*) ;; *) exit 78 ;; esac
test "$(cat "${PGDATA:?PGDATA is required}/PG_VERSION")" = '16'
printf '%s\n' 'pg16-musl-alpine3.24-v1' > "$PGDATA/.iot-runtime-abi"
