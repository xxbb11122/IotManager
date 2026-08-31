# Build a Caddy binary from the fixed upstream source commit with the currently
# fixed Go toolchain and transitive security updates. The release image is
# intentionally minimal so curl/OpenSSL packages from a general-purpose base
# cannot become part of the public reverse-proxy attack surface.
FROM golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 AS caddy-build
ARG CADDY_VERSION=v2.11.4
# v2.11.4 is an annotated tag; this is its peeled source commit.
ARG CADDY_SOURCE_COMMIT=e2eee6a7fce366321294c9c2a79f3146891dcbdf
WORKDIR /src
RUN set -eux; \
    git init; \
    git remote add origin https://github.com/caddyserver/caddy.git; \
    git fetch --depth 1 origin "${CADDY_SOURCE_COMMIT}"; \
    git checkout --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${CADDY_SOURCE_COMMIT}"
RUN --mount=type=cache,id=iot-manager-caddy-go-mod,target=/go/pkg/mod \
    set -eux; \
    # proxy.golang.org occasionally terminates an HTTP/2 download mid-stream.
    # Retry only transient module resolution work; a final checksum/compile
    # failure remains fatal and therefore cannot be hidden by this loop.
    for attempt in 1 2 3 4 5; do \
      if go get golang.org/x/crypto@v0.55.0 golang.org/x/net@v0.57.0 google.golang.org/grpc@v1.82.1 && go mod tidy; then \
        break; \
      fi; \
      if [ "$attempt" -eq 5 ]; then \
        exit 1; \
      fi; \
      sleep "$((attempt * 5))"; \
    done; \
    go mod verify
RUN --mount=type=cache,id=iot-manager-caddy-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=iot-manager-caddy-go-build,target=/root/.cache/go-build \
    set -eux; \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X github.com/caddyserver/caddy/v2.Version=${CADDY_VERSION#v}" -o /out/caddy ./cmd/caddy; \
    /out/caddy version; \
    mkdir -p /runtime/data /runtime/config /runtime/srv/frontend /runtime/srv/console; \
    chown -R 65534:65534 /runtime

# Build the monitoring dashboard for the site root.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS frontend-build
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY shared/ ../shared/
RUN npm run build

# Build the operations console with an explicit sub-path asset base.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS console-build
WORKDIR /workspace/console
COPY console/package.json console/package-lock.json ./
RUN npm ci
COPY console/ ./
COPY shared/ ../shared/
RUN npm run build -- --base=/console/

# Distroless provides only the static runtime prerequisites and CA roots.
# Caddy only writes persisted state; the compose volume initializer assigns
# these locations to the unprivileged runtime UID.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --chown=65534:65534 --from=caddy-build /out/caddy /usr/bin/caddy
COPY --chown=65534:65534 --from=caddy-build /runtime/data /data
COPY --chown=65534:65534 --from=caddy-build /runtime/config /config
COPY --chown=65534:65534 --from=caddy-build /runtime/srv /srv
COPY --chown=65534:65534 deploy/Caddyfile /etc/caddy/Caddyfile
COPY --chown=65534:65534 --from=frontend-build /workspace/frontend/dist /srv/frontend
COPY --chown=65534:65534 --from=console-build /workspace/console/dist /srv/console

# The official Caddy image supplies these locations. Declare them explicitly
# because the distroless runtime intentionally has no inherited shell profile
# or writable home directory.
ENV XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data

# The service keeps only NET_BIND_SERVICE at runtime, declared in Compose, so
# it can serve HTTP(S) without retaining a root process.
USER 65534:65534
ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--environ", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
