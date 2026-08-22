# IoT Manager R1 deployment runbook

This folder deploys the approved R1 stack: Caddy TLS termination, Spring Boot
resource server, PostgreSQL 16, Keycloak OIDC, daily logical backups, and the
monitoring/operations web applications. It is not an authorization to claim
R2: Redis, mTLS, external immutable/WAL backup storage, k6/ZAP/Trivy/Gitleaks
evidence, and real-device acceptance still require their respective gates.

## Public endpoints

| Use | Address |
| --- | --- |
| Monitoring UI | `https://<DOMAIN>/` |
| Operations UI | `https://<DOMAIN>/console/` |
| REST API | `https://<DOMAIN>/api/v1` (`/api` remains a deprecated compatibility alias) |
| Device WebSocket | `wss://<DOMAIN>/ws/devices` |
| Edge Agent WebSocket | `wss://<DOMAIN>/ws/edge/v1` |
| Keycloak | `https://<DOMAIN>/auth/` |

Only Caddy publishes ports `80` and `443`. PostgreSQL, Keycloak management,
and Spring Boot remain Docker-internal. Spring Boot liveness/readiness and
Prometheus endpoints are intentionally not reverse-proxied to the public
internet.

## Preconditions

- A Linux host with Docker Engine and Docker Compose v2.
- An A/AAAA record for `DOMAIN` pointing to the host; firewall ingress permits
  TCP `80` and `443`.
- A protected deployment checkout. Do not copy only `deploy/`; the two Docker
  builds use the repository root as their context.
- A secret manager or protected host file for `deploy/.env`. It must never be
  committed or copied into an APK.

## First deployment

1. Copy the template and fill every `replace-with-...` value with unique,
   high-entropy secrets, including `IOT_WEATHER_FINGERPRINT_SECRET`. Keep
   `IOT_DB_URL=jdbc:postgresql://postgres:5432/iot_manager` for this bundled
   single-host stack. The Keycloak database password is supplied through
   `KCRAW_DB_PASSWORD`, so a `$` in a generated password is preserved literally
   rather than being interpreted as a Keycloak expression.

   ```bash
   cd deploy
   cp .env.example .env
   chmod 600 .env
   ```

2. Start PostgreSQL, Keycloak and Caddy. The backend may restart until the
   initial owner mapping in the next step is complete; this is expected and
   fail-closed.

   ```bash
   docker compose up -d --build postgres keycloak caddy
   docker compose logs -f keycloak
   ```

3. Open `https://<DOMAIN>/auth/admin/`, sign in with
   `KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME`, and create the first operator user.
   Assign it the **OWNER** realm role in `iot-manager`. Copy that user's
   immutable Keycloak subject/ID into `IOT_BOOTSTRAP_OWNER_SUBJECT`; fill the
   remaining `IOT_BOOTSTRAP_*` organization and site values. This maps the
   verified identity to the platform's first organization/site membership; it
   does not store a password in PostgreSQL.

4. Start the complete stack and verify containers are healthy/running.

   ```bash
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=200 backend keycloak backup caddy
   ```

5. Configure the Android connection as follows after signing in:

   ```text
   API:               https://<DOMAIN>/api/v1
   WebSocket:         wss://<DOMAIN>/ws/devices
   OIDC Issuer URL:   https://<DOMAIN>/auth/realms/iot-manager
   OIDC Client ID:    iot-mobile
   OIDC callback:     com.iot.manager.client://oauth/callback
   ```

   The mobile client uses Authorization Code + PKCE and Android Keystore-backed
   token storage. It never requires a copied bearer token.

   The monitoring UI at `/` and operations console at `/console/` detect the
   HTTPS deployment and use the same `iot-web` public OIDC client with PKCE.
   They retain tokens only for the browser session and send WebSocket tokens in
   the `iot-bearer.<token>` subprotocol, never in a query string.

## Smoke checks

```bash
curl -fsSI https://<DOMAIN>/
curl -fsSI https://<DOMAIN>/console/
curl -fsSI https://<DOMAIN>/auth/realms/iot-manager/.well-known/openid-configuration
curl -i https://<DOMAIN>/api/v1/devices
```

The last command must return `401` without a bearer token. After an OWNER logs
in through a configured client, `GET /api/v1/sites` must return only its
membership sites. Validate the private readiness/metrics endpoints from a
monitoring container on the `internal` network; do not expose them through
Caddy as a convenience shortcut.

## Backups and restore rehearsal

The `backup` service creates a PostgreSQL custom-format dump immediately and
then every 24 hours in the `postgres-backups` volume. It writes a SHA-256 side
car and retains the configured number of days.

```bash
docker compose exec backup /bin/sh /scripts/backup.sh
docker compose logs --tail=100 backup
docker volume inspect deploy_postgres-backups
```

Never first-test a restore against the live database. For a disposable target,
set `PGHOST`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` to that target and run:

```bash
IOT_RESTORE_CONFIRM=RESTORE /bin/sh deploy/backup/restore.sh /path/to/iot_manager-<timestamp>.dump
```

Record the dump checksum, migration version, restore start/end timestamps,
application readiness result, and a read/write smoke result. R1 release still
requires an external encrypted/immutable backup destination and a tested WAL
archive that demonstrates RPO <= 15 minutes and RTO <= 60 minutes; this local
logical backup is a deployable mechanism, not evidence that those operational
targets have been met.

## Updates and rollback

Build and start from a reviewed Git revision:

```bash
docker compose up -d --build
docker compose ps
```

Before any rollback, take and checksum a backup, record the active image/git
revision, and check Flyway compatibility. Do not roll back a database schema
by deleting volumes or editing Flyway history. Use a forward-compatible
application image or a separately rehearsed restore plan.

## Keycloak import note

`iot-manager-realm.json` is imported only when the realm does not already
exist. Changes to the file do not mutate an existing production realm; make
reviewed changes through the Keycloak administration API/UI, export a reviewed
realm artifact, and rehearse the result in a non-production environment.
