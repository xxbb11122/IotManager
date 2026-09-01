# Build the two observability servers from their signed upstream release
# commits. The official images currently embed Go dependencies with known
# HIGH/CRITICAL findings; compiling the same release sources with the fixed
# dependency set below keeps the server behavior and configuration contract
# while producing an auditable, non-root runtime image.
FROM golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 AS prometheus-build

ARG PROMETHEUS_VERSION=v3.14.0
ARG PROMETHEUS_SOURCE_COMMIT=d7598b7141418fa35be2b5ec5d0fefb634199610

WORKDIR /src
RUN set -eux; \
    git init; \
    git remote add origin https://github.com/prometheus/prometheus.git; \
    git fetch --depth 1 origin "${PROMETHEUS_SOURCE_COMMIT}"; \
    git checkout --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${PROMETHEUS_SOURCE_COMMIT}"
# The signed upstream release already has a tidy module graph. Avoid re-resolving
# its test-only closure: it does not affect the runtime binary and exceeds the
# hosted-runner build window. `go get`, checksum verification, and the binary
# module assertion below still make the patched dependency explicit and audited.
RUN --mount=type=cache,id=iot-manager-prometheus-go-mod,target=/go/pkg/mod \
    set -eux; \
    for attempt in 1 2 3 4 5; do \
      if go get golang.org/x/crypto@v0.55.0 && go mod verify; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        exit 1; \
      fi; \
      sleep "$((attempt * 5))"; \
    done
RUN --mount=type=cache,id=iot-manager-prometheus-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=iot-manager-prometheus-go-build,target=/root/.cache/go-build \
    set -eux; \
    CGO_ENABLED=0 go build -p=4 -trimpath \
      -ldflags "-s -w -X github.com/prometheus/common/version.Version=${PROMETHEUS_VERSION#v} -X github.com/prometheus/common/version.Revision=${PROMETHEUS_SOURCE_COMMIT}" \
      -o /out/prometheus ./cmd/prometheus; \
    /out/prometheus --version; \
    go version -m /out/prometheus | grep -Eq '^[[:space:]]*dep[[:space:]]+golang.org/x/crypto[[:space:]]+v0.55.0'
RUN mkdir -p /out/rootfs/etc/prometheus

FROM golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 AS alertmanager-source

ARG ALERTMANAGER_VERSION=v0.33.1
ARG ALERTMANAGER_SOURCE_COMMIT=2c8da51e03f3dbbed24f9711ca2d76aab4eef9c5

WORKDIR /src
RUN set -eux; \
    git init; \
    git remote add origin https://github.com/prometheus/alertmanager.git; \
    git fetch --depth 1 origin "${ALERTMANAGER_SOURCE_COMMIT}"; \
    git checkout --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${ALERTMANAGER_SOURCE_COMMIT}"

# The Alertmanager release tag deliberately excludes ui/app/dist. The Go
# server embeds that directory at compile time, so rebuild the signed release
# UI with its locked npm dependency graph before compiling the patched server.
# This stage is not part of either runtime image; the Node image is pinned to
# the current linux/amd64 Docker Hub manifest for reproducible CI builds.
FROM node:22-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS alertmanager-ui-build

COPY --from=alertmanager-source /src/ui/app/package.json /src/ui/app/package-lock.json /workspace/
WORKDIR /workspace
RUN npm ci --ignore-scripts
COPY --from=alertmanager-source /src/ui/app/ /workspace/
RUN npm run build; \
    test -f /workspace/dist/index.html; \
    test -d /workspace/dist/assets

FROM alertmanager-source AS alertmanager-build

# Preserve the signed release's existing tidy graph and only change the audited
# runtime modules required by the security baseline. The subsequent `go build`
# is the authoritative compile-time graph validation.
COPY --from=alertmanager-ui-build /workspace/dist /src/ui/app/dist
RUN --mount=type=cache,id=iot-manager-alertmanager-go-mod,target=/go/pkg/mod \
    set -eux; \
    for attempt in 1 2 3 4 5; do \
      if go get golang.org/x/crypto@v0.55.0 golang.org/x/net@v0.58.0 golang.org/x/text@v0.41.0 golang.org/x/mod@v0.40.0 google.golang.org/grpc@v1.82.1 && go mod verify; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        exit 1; \
      fi; \
      sleep "$((attempt * 5))"; \
    done
RUN --mount=type=cache,id=iot-manager-alertmanager-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=iot-manager-alertmanager-go-build,target=/root/.cache/go-build \
    set -eux; \
    CGO_ENABLED=0 go build -p=4 -trimpath \
      -ldflags "-s -w -X github.com/prometheus/common/version.Version=${ALERTMANAGER_VERSION#v} -X github.com/prometheus/common/version.Revision=${ALERTMANAGER_SOURCE_COMMIT}" \
      -o /out/alertmanager ./cmd/alertmanager; \
    /out/alertmanager --version; \
    go version -m /out/alertmanager | grep -Eq '^[[:space:]]*dep[[:space:]]+golang.org/x/crypto[[:space:]]+v0.55.0'; \
    go version -m /out/alertmanager | grep -Eq '^[[:space:]]*dep[[:space:]]+golang.org/x/net[[:space:]]+v0.58.0'; \
    go version -m /out/alertmanager | grep -Eq '^[[:space:]]*dep[[:space:]]+golang.org/x/text[[:space:]]+v0.41.0'; \
    go version -m /out/alertmanager | grep -Eq '^[[:space:]]*dep[[:space:]]+golang.org/x/mod[[:space:]]+v0.40.0'; \
    go version -m /out/alertmanager | grep -Eq '^[[:space:]]*dep[[:space:]]+google.golang.org/grpc[[:space:]]+v1.82.1'
RUN mkdir -p /out/rootfs/etc/alertmanager

# Distroless deliberately excludes a shell and wget. Compile one small,
# read-only HTTP ready probe from the same fixed Go toolchain instead of
# adding a general-purpose package manager or shell to either runtime image.
FROM golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 AS healthcheck-build

COPY deploy/monitoring/http-ready.go /src/http-ready.go
RUN --mount=type=cache,id=iot-manager-monitor-healthcheck-go-build,target=/root/.cache/go-build \
    set -eux; \
    CGO_ENABLED=0 go build -trimpath -ldflags '-s -w' -o /out/http-ready /src/http-ready.go

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab AS prometheus

COPY --chown=65534:65534 --from=prometheus-build /out/prometheus /usr/bin/prometheus
COPY --chown=65534:65534 --from=healthcheck-build /out/http-ready /usr/bin/http-ready
COPY --chown=65534:65534 --from=prometheus-build /out/rootfs/etc/prometheus /etc/prometheus

USER 65534:65534
ENTRYPOINT ["/usr/bin/prometheus"]

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab AS alertmanager

COPY --chown=65534:65534 --from=alertmanager-build /out/alertmanager /usr/bin/alertmanager
COPY --chown=65534:65534 --from=healthcheck-build /out/http-ready /usr/bin/http-ready
COPY --chown=65534:65534 --from=alertmanager-build /out/rootfs/etc/alertmanager /etc/alertmanager

USER 65534:65534
ENTRYPOINT ["/usr/bin/alertmanager"]
