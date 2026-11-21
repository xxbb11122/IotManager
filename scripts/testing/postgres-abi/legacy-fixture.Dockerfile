# Laboratory only: preserve the exact glibc/PG16 base and extension source,
# but remove the historical extension's build-host CPU instruction dependency.
# This is NOT an unchanged historical image and is never a release artifact.
FROM ghcr.io/xxbb11122/iot-manager-postgres:sha-0811f80ac849@sha256:6e55d9e27a184d2a08a2b6bb9e00236e98e706af799394b6de338e9995a555f4 AS portable-vector
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git ca-certificates postgresql-server-dev-16 \
    && rm -rf /var/lib/apt/lists/*
ARG PGVECTOR_COMMIT=8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c
WORKDIR /src/pgvector
RUN git init \
    && git remote add origin https://github.com/pgvector/pgvector.git \
    && git fetch --depth 1 origin "${PGVECTOR_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${PGVECTOR_COMMIT}" \
    && make PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config OPTFLAGS="" with_llvm=no \
    && make install PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config with_llvm=no

FROM ghcr.io/xxbb11122/iot-manager-postgres:sha-0811f80ac849@sha256:6e55d9e27a184d2a08a2b6bb9e00236e98e706af799394b6de338e9995a555f4
COPY --from=portable-vector /usr/lib/postgresql/16/lib/vector.so /usr/lib/postgresql/16/lib/vector.so
COPY --from=portable-vector /usr/share/postgresql/16/extension/vector* /usr/share/postgresql/16/extension/
USER postgres
