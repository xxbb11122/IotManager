FROM postgres:16-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea AS tools

# PG16 client binaries and libpq share the supplier's verified musl ABI.
# Copy no server, gosu or operating-system package metadata from that image.
FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates libedit libssl3 libcrypto3 krb5-libs libldap lz4-libs zstd-libs
COPY --from=tools /usr/local/bin/psql /usr/local/bin/psql
COPY --from=tools /usr/local/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=tools /usr/local/bin/pg_restore /usr/local/bin/pg_restore
COPY --from=tools /usr/local/lib/libpq.so.5* /usr/local/lib/
RUN psql --version && pg_dump --version && pg_restore --version \
    && command -v sha256sum && command -v find && command -v date \
    && mkdir /tmp/retention-probe \
    && find /tmp/retention-probe -maxdepth 1 -type f -name '*.dump' -mtime +30 -delete \
    && rmdir /tmp/retention-probe \
    && test ! -e /usr/local/bin/gosu && test ! -e /usr/local/bin/postgres
USER 999:999
