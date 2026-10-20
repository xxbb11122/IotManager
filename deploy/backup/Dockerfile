FROM postgres:16-trixie@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d AS tools

# Keep the PG16 client ABI while excluding the server, gosu and WAL-G.
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates libpq5 libreadline8t64 liblz4-1 libzstd1 zlib1g \
    && rm -rf /var/lib/apt/lists/*
COPY --from=tools /usr/lib/postgresql/16/bin/psql /usr/local/bin/psql
COPY --from=tools /usr/lib/postgresql/16/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=tools /usr/lib/postgresql/16/bin/pg_restore /usr/local/bin/pg_restore
RUN psql --version && pg_dump --version && pg_restore --version \
    && command -v sha256sum && command -v find && command -v date \
    && test ! -e /usr/local/bin/gosu && test ! -e /usr/local/bin/postgres
USER 999:999
