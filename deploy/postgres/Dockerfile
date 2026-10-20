# Build only the PostgreSQL WAL-G command and the storage backends the
# deployment contract exposes: local filesystem and S3.  Omitting unrelated
# Azure/GCS/Swift/SSH adapters removes their unused cloud SDK attack surface
# from the backup binary while preserving every documented runtime mode.
FROM golang:1.26.10-bookworm@sha256:ee3901c61e423732605a51f1b8157c849ec01194ea0a274213b5202b2c11e7bf AS wal-g-build

ARG WAL_G_VERSION=v3.0.9
ARG WAL_G_SOURCE_COMMIT=3e493188db28335fb93a45bd680c6ff8fc3028c1

WORKDIR /src
# Real compatible v1 tag history lets Go stamp its own canonical module
# version. The upstream module path has no /v3 suffix. Do not forge a version
# with ldflags or rename its package to bypass the scanner.
RUN set -eux; \
    git init; \
    git remote add origin https://github.com/wal-g/wal-g.git; \
    git config remote.origin.promisor true; \
    git config remote.origin.partialclonefilter blob:none; \
    git fetch --filter=blob:none origin "${WAL_G_SOURCE_COMMIT}" '+refs/tags/v1.*:refs/tags/v1.*'; \
    git checkout --detach "${WAL_G_SOURCE_COMMIT}"; \
    test "$(git rev-parse HEAD)" = "${WAL_G_SOURCE_COMMIT}"; \
    git merge-base --is-ancestor v1.1 HEAD

# StorageAdapters is the sole registry used by WAL-G configuration.  Keep the
# S3 and FILE entries required by wal-g-env.sh and remove every unsupported
# adapter/import before Go resolves the production dependency graph.
RUN set -eux; \
    sed -i \
      -e '\|pkg/storages/azure|d' \
      -e '\|pkg/storages/gcs|d' \
      -e '\|pkg/storages/sh|d' \
      -e '\|pkg/storages/swift|d' \
      -e '\|pkg/storages/oss|d' \
      -e '/{"GS", gcs.SettingList, gcs.ConfigureStorage},/d' \
      -e '/{"AZ", azure.SettingList, azure.ConfigureStorage},/d' \
      -e '/{"SWIFT", swift.SettingList, swift.ConfigureStorage},/d' \
      -e '/{"SSH", sh.SettingList, sh.ConfigureStorage},/d' \
      -e '/{"OSS", oss.SettingList, oss.ConfigureStorage},/d' \
      internal/storage_adapter.go; \
    grep -Fq '{"S3", s3.SettingList, s3.ConfigureStorage},' internal/storage_adapter.go; \
    grep -Fq '{"FILE", nil, fs.ConfigureStorage},' internal/storage_adapter.go; \
    ! grep -Eq 'pkg/storages/(azure|gcs|sh|swift|oss)' internal/storage_adapter.go

# Upgrade every high-severity module previously embedded in the PostgreSQL
# binary, then verify checksums before compiling.  The command intentionally
# uses module mode rather than WAL-G's historical vendored dependency set.
RUN --mount=type=cache,id=iot-manager-walg-go-mod,target=/go/pkg/mod \
    set -eux; \
    # Keep externally fetched module resolution resilient to temporary Go
    # proxy transport failures without accepting an incomplete dependency set.
    for attempt in 1 2 3 4 5; do \
      if go get github.com/jackc/pgx/v5@v5.10.0 golang.org/x/oauth2@v0.36.0 golang.org/x/crypto@v0.57.0 golang.org/x/net@v0.60.0 google.golang.org/grpc@v1.83.2; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        exit 1; \
      fi; \
      sleep "$((attempt * 5))"; \
    done; \
    go mod verify

RUN --mount=type=cache,id=iot-manager-walg-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=iot-manager-walg-go-build,target=/root/.cache/go-build \
    set -eux; \
    CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X github.com/wal-g/wal-g/cmd/pg.walgVersion=${WAL_G_VERSION} -X github.com/wal-g/wal-g/cmd/pg.gitRevision=${WAL_G_SOURCE_COMMIT} -X github.com/wal-g/wal-g/cmd/pg.buildDate=source-build" \
      -o /out/wal-g ./main/pg; \
    /out/wal-g --version; \
    go version -m /out/wal-g | tee /out/wal-g-build-info.txt; \
    grep -Eq '^[[:space:]]*mod[[:space:]]+github.com/wal-g/wal-g[[:space:]]+v1[.]1[.]' /out/wal-g-build-info.txt; \
    chmod 0555 /out/wal-g

FROM postgres:16-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea AS pgvector-build
ARG PGVECTOR_COMMIT=8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c
RUN apk add --no-cache build-base git clang llvm-dev ca-certificates
WORKDIR /tmp/pgvector
RUN git init \
    && git remote add origin https://github.com/pgvector/pgvector.git \
    && git fetch --depth 1 origin "${PGVECTOR_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${PGVECTOR_COMMIT}" \
    && make OPTFLAGS="" CLANG=clang \
    && make install CLANG=clang

FROM postgres:16-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea

# Keep the application's existing UID/GID contract across the libc change.
RUN test "$(id -u postgres)" = 70 && test "$(id -g postgres)" = 70 \
    && sed -i '/^postgres:/s/:70:70:/:999:999:/' /etc/passwd \
    && sed -i '/^postgres:/s/:70:/:999:/' /etc/group \
    && chown -R 999:999 /var/lib/postgresql /var/run/postgresql \
    && test "$(id -u postgres)" = 999 && test "$(id -g postgres)" = 999 \
    && apk upgrade --no-cache

COPY --from=wal-g-build /out/wal-g /usr/local/bin/wal-g
COPY --from=wal-g-build /out/wal-g-build-info.txt /usr/local/share/iot-manager/wal-g-build-info.txt
COPY --from=pgvector-build /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/vector.so
COPY --from=pgvector-build /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
COPY --chmod=0555 postgres/runtime-entrypoint.sh /usr/local/bin/iot-runtime-entrypoint.sh
COPY --chmod=0555 postgres/runtime-abi-init.sh /docker-entrypoint-initdb.d/99-iot-runtime-abi.sh
COPY postgres/wal-g-env.sh postgres/wal-g-push.sh postgres/wal-g-fetch.sh postgres/wal-g-archive-loop.sh postgres/wal-g-backup-loop.sh postgres/wal-g-archive-healthcheck.sh postgres/wal-g-backup-healthcheck.sh postgres/application-role-psql.sh /usr/local/bin/
COPY postgres/install-vector-existing.sh /usr/local/bin/install-vector-existing.sh

# The compose service and every WAL-G sidecar run as UID 999, so the official
# entrypoint never needs gosu. Removing this unused privileged-transition
# helper eliminates its embedded Go runtime CVEs from the final image.
RUN rm -f /usr/local/bin/gosu \
    && chmod 0555 /usr/local/bin/wal-g /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g-push.sh /usr/local/bin/wal-g-fetch.sh /usr/local/bin/wal-g-archive-loop.sh /usr/local/bin/wal-g-backup-loop.sh /usr/local/bin/wal-g-archive-healthcheck.sh /usr/local/bin/wal-g-backup-healthcheck.sh /usr/local/bin/application-role-psql.sh /usr/local/bin/install-vector-existing.sh

# postgres-data is prepared by the one-shot volume initializer before this
# image starts. Keeping the final image unprivileged prevents an application
# or WAL-G compromise from running as root inside the container.
USER postgres
ENTRYPOINT ["/usr/local/bin/iot-runtime-entrypoint.sh"]
CMD ["postgres"]
