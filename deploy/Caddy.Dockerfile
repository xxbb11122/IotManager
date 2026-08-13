# Build the monitoring dashboard for the site root.
FROM node:22-alpine AS frontend-build
WORKDIR /workspace
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build the operations console with an explicit sub-path asset base.
FROM node:22-alpine AS console-build
WORKDIR /workspace
COPY console/package.json console/package-lock.json ./
RUN npm ci
COPY console/ ./
RUN npm run build -- --base=/console/

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /workspace/dist /srv/frontend
COPY --from=console-build /workspace/dist /srv/console
