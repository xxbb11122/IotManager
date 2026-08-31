# Build only the PostgreSQL WAL-G command and the storage backends the
# deployment contract exposes: local filesystem and S3.  Omitting unrelated
# Azure/GCS/Swift/SSH adapters removes their unused cloud SDK attack surface
# from the backup binary while preserving every documented runtime mode.
FROM golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 AS wal-g-build

ARG WAL_G_VERSION=v3.0.7
ARG WAL_G_SOURCE_COMMIT=6ea13b90a3198bd5c8f8ac2ae323f28e33cf9f06

WORKDIR /src
RUN set -eux; \
    git init; \
    git remote add origin https://github.com/wal-g/wal-g.git; \
    git fetch --depth 1 origin "${WAL_G_SOURCE_COMMIT}"; \
    git checkout --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${WAL_G_SOURCE_COMMIT}"

# StorageAdapters is the sole registry used by WAL-G configuration.  Keep the
# S3 and FILE entries required by wal-g-env.sh and remove every unsupported
# adapter/import before Go resolves the production dependency graph.
RUN set -eux; \
    sed -i \
      -e '\|pkg/storages/azure|d' \
      -e '\|pkg/storages/gcs|d' \
      -e '\|pkg/storages/sh|d' \
      -e '\|pkg/storages/swift|d' \
      -e '/{"GS", gcs.SettingList, gcs.ConfigureStorage},/d' \
      -e '/{"AZ", azure.SettingList, azure.ConfigureStorage},/d' \
      -e '/{"SWIFT", swift.SettingList, swift.ConfigureStorage},/d' \
      -e '/{"SSH", sh.SettingList, sh.ConfigureStorage},/d' \
      internal/storage_adapter.go; \
    grep -Fq '{"S3", s3.SettingList, s3.ConfigureStorage},' internal/storage_adapter.go; \
    grep -Fq '{"FILE", nil, fs.ConfigureStorage},' internal/storage_adapter.go; \
    ! grep -Eq 'pkg/storages/(azure|gcs|sh|swift)' internal/storage_adapter.go

# Upgrade every high-severity module previously embedded in the PostgreSQL
# binary, then verify checksums before compiling.  The command intentionally
# uses module mode rather than WAL-G's historical vendored dependency set.
RUN --mount=type=cache,id=iot-manager-walg-go-mod,target=/go/pkg/mod \
    set -eux; \
    # Keep externally fetched module resolution resilient to temporary Go
    # proxy transport failures without accepting an incomplete dependency set.
    for attempt in 1 2 3 4 5; do \
      if go get github.com/golang-jwt/jwt/v4@v4.5.2 github.com/jackc/pgx/v5@v5.9.0 golang.org/x/oauth2@v0.36.0 golang.org/x/crypto@v0.55.0 golang.org/x/net@v0.57.0 google.golang.org/grpc@v1.82.1 && go mod tidy; then \
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
    chmod 0555 /out/wal-g

FROM postgres:16-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825

COPY --from=wal-g-build /out/wal-g /usr/local/bin/wal-g
COPY postgres/wal-g-env.sh postgres/wal-g-push.sh postgres/wal-g-fetch.sh postgres/wal-g-archive-loop.sh postgres/wal-g-backup-loop.sh postgres/wal-g-archive-healthcheck.sh postgres/wal-g-backup-healthcheck.sh postgres/application-role-psql.sh /usr/local/bin/

# The compose service and every WAL-G sidecar run as UID 999, so the official
# entrypoint never needs gosu. Removing this unused privileged-transition
# helper eliminates its embedded Go runtime CVEs from the final image.
RUN rm -f /usr/local/bin/gosu \
    && chmod 0555 /usr/local/bin/wal-g /usr/local/bin/wal-g-env.sh /usr/local/bin/wal-g-push.sh /usr/local/bin/wal-g-fetch.sh /usr/local/bin/wal-g-archive-loop.sh /usr/local/bin/wal-g-backup-loop.sh /usr/local/bin/wal-g-archive-healthcheck.sh /usr/local/bin/wal-g-backup-healthcheck.sh /usr/local/bin/application-role-psql.sh

# postgres-data is prepared by the one-shot volume initializer before this
# image starts. Keeping the final image unprivileged prevents an application
# or WAL-G compromise from running as root inside the container.
USER postgres
