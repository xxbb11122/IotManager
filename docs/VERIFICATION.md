# Release verification

This project has one release baseline. Before merging or publishing it, verify
the Java services, all Vite applications, the Capacitor Android package, and
the deployment configuration from the same commit.

The current Spring AI phase is documented in
[DeepSeek mock integration](SPRING-AI-DEEPSEEK-MOCK-INTEGRATION-2026-09-30.md):
Chat uses a local HTTP substitute, the knowledge base and production AI remain
disabled, and no real provider request is claimed. When a real pilot is planned,
verify pgvector 0.8.6 is installed in the
live and restored IoT databases before Flyway V27, then run the PostgreSQL
Testcontainers migration and site-isolation tests. Exercise the Caddy upload
route with both Content-Length and chunked multipart bodies at and above the
6 MB request boundary. Verify VIEWER can ask questions and delete only their
own conversations, while knowledge/persona writes require OWNER or ADMIN
and site membership. Confirm an absent key or disabled feature leaves the
existing health and device APIs available; inject remote 429, timeout and
disconnect failures; confirm no secret or prompt body appears in errors,
logs, metrics or front-end bundles. Restore a backup containing AI documents,
vectors, personas and conversations before enabling AI in production. A
passing local build without Docker or provider credentials does not satisfy
the runtime or remote-model acceptance gates.

## Required toolchains

- Java services: JDK 17 and Maven 3.9+.
- Web applications and Capacitor sync: Node.js 22.x and npm. The strict
  verifier intentionally rejects a different major version.
- Android: JDK 21+, Android SDK Platform 36, Build Tools 36.0.0, and platform
  tools.
- Deployment checks: a running Docker Engine with the Compose v2 plugin.

The default local check covers `backend`, `edge-agent`, `frontend`, `console`,
`client`, and Docker Compose/Caddy syntax. If the Docker CLI is present but the
Engine is stopped, Compose interpolation is still checked and the Caddy
container validation is reported as skipped. Android is opt-in because it needs
a local Android SDK. CI installs the Android prerequisites and runs it by
default.

P0 Docker runtime verification is deliberately separate from the fast baseline:
it creates an isolated Compose project, runs the two-phase Keycloak
OWNER/ADMIN/OPERATOR/VIEWER bootstrap, tests real PKCE/JWT/API/WSS behavior,
token replay/logout handling, role and two-site isolation, verifies Caddy and
private Prometheus boundaries plus database DDL denial, and restores a logical
backup into a different project.
It requires a running Docker Engine and is not satisfied by `docker compose
config` alone.

`start-integration.ps1 -Verify` / `start-integration.sh --verify` runs the
non-destructive `verify-stack` boundary check only. It does **not** pause or
stop PostgreSQL, and it does not perform a restore. Treat resilience and
recovery as separate, explicitly confirmed drills before recording local P0
runtime evidence as complete.

Java service verification uses `clean verify`. The backend permits up to 90
seconds for the forked test JVM to close its multiple RANDOM_PORT
Spring/Tomcat contexts cleanly; this prevents a passing suite from being
forcibly terminated during its orderly shutdown.

## Run locally

PowerShell:

```powershell
./scripts/verify.ps1
./scripts/verify.ps1 -Android
```

Bash:

```bash
bash ./scripts/verify.sh
bash ./scripts/verify.sh --android
```

Use `-SkipBackend`, `-SkipWeb`, and `-SkipDeploy` in PowerShell, or
`--skip-backend`, `--skip-web`, and `--skip-deploy` in Bash, for targeted
local work. Skipping Docker only omits the Compose/Caddy configuration check;
it does not validate a live deployment.

On Windows Git Bash, `scripts/verify.sh` normalizes the Caddyfile host mount
and disables MSYS conversion only for the container-side mount path. The
runtime entry points use the same boundary: Compose files and bind-mount
sources are converted to Docker host paths, while `/bin/sh`, `/scripts`,
`/restore`, and Keycloak container executables are never rewritten as Windows
paths. Windows Schannel alone receives `--ssl-no-revoke` for Caddy's local
integration CA; CA-chain and hostname verification remain enabled. This keeps
the same strict and runtime validation usable on Windows, Linux, and GitHub
Actions.

For the full local P0 runtime path, use the dedicated entry point after Docker
Desktop/Engine is running:

```powershell
.\scripts\runtime\start-integration.ps1 -Verify
```

```bash
bash scripts/runtime/start-integration.sh --verify
```

See [the Docker runbook](../deploy/DEPLOYMENT.md) for cleanup and isolated
recovery-drill commands. Do not append `-v` to Compose cleanup commands while
evidence or backup volumes are still needed.

For the controlled runtime drills, use separate commands after the stack is
healthy:

```powershell
.\scripts\runtime\verify-resilience.ps1 -Confirm RESILIENCE
.\scripts\runtime\recovery-drill.ps1 -BackupFile C:\path\to\iot_manager-<timestamp>.dump -Confirm RESTORE
```

```bash
IOT_RESILIENCE_CONFIRM=RESILIENCE bash scripts/runtime/verify-resilience.sh
IOT_RESTORE_CONFIRM=RESTORE bash scripts/runtime/recovery-drill.sh /absolute/path/to/iot_manager-<timestamp>.dump
```

The resilience drill checks persistent data across normal restarts, PostgreSQL
readiness fail-closed behavior, bounded Flyway startup retries, continuous
restart-policy configuration, and the absence of unhandled scheduled-task
errors during the outage window. The logical recovery drill uses an isolated
Compose project and never grants the backup sidecar the application DML
password.

For Java service verification, make sure `mvn --version` reports Java 17. On
Windows, `scripts/verify.ps1` supplies a stable user-local Maven Wrapper cache
when `MAVEN_USER_HOME` is not set and the wrapper invokes the system PowerShell
path directly, so an IDE-managed `PATH` does not need to contain `powershell`.
For
an Android build, point `ANDROID_SDK_ROOT` (or `ANDROID_HOME`) at an SDK with
API 36 and Build Tools 36.0.0, and ensure the Java used by Gradle is JDK 21 or
newer.

## Continuous integration

`.github/workflows/ci.yml` runs on every push, pull request, and manual
dispatch. It contains independent jobs for:

- Maven tests and packaging for the backend and Edge Agent on JDK 17.
- Client unit/E2E tests, independent frontend/console Playwright tests, and
  all three Vite builds on Node 22.
- Capacitor synchronization and an Android debug APK on JDK 21/API 36.
- Docker Compose interpolation/schema validation, Caddy syntax validation, and
  a build of the backend plus both static web images.
- Blocking Trivy scans for every image referenced by the production-shaped
  Compose topology. A release remains blocked when an upstream HIGH/CRITICAL
  finding has no approved, precise exception; see
  [runtime image security status](IMAGE-SECURITY-STATUS.md).

The Android job uploads `app-debug.apk` as a short-lived build artifact. A
repository variable `ENABLE_ANDROID_CI=false` can temporarily suppress that
job during an external Android SDK or runner outage; it should not be used as
a normal release setting.

The deployment job does not request TLS certificates, publish images, start
the stack, or test a public domain.

`.github/workflows/runtime-e2e.yml` adds the P0 full-stack job for
deployment/security changes and manual dispatch. It uses Caddy's private
integration CA only on the runner, scans generated Secret values out of the
runtime evidence before upload, keeps source/recovery volumes separate, and
starts the internal-only observability profile. It also proves application DDL
is rejected with PostgreSQL SQLSTATE `42501`, verifies that the backup sidecar
mounts only the constrained owner credential, exports an owner-owned
recovery-drill relation, and restores a fresh owner-only logical backup.
Physical WAL/PITR evidence is
separate: `.github/workflows/recovery-drill.yml` runs only on the protected
self-hosted recovery runner and never uses the filesystem integration store.

## App AI implementation, October 1, 2026

See the [public project status and evidence boundary](PROJECT-STATUS-2026-10-01.md).
The backend has passed 189 tests with Docker available and zero skips, including
H2 and PostgreSQL request recovery, deletion races, atomic persistence and
V28 upgrade/older-write compatibility. Client Node tests passed 194 cases.
The previous full client browser regression passed 48 cases; 8 environment-dependent
deployment cases were skipped. After the navigation animation update, 11 related
browser cases passed: 6 AI workspace, 1 bottom navigation, 3 startup and 1 mobile
workflow. The 194 Node cases also passed again.

The Android Debug 1.1.1 APK (versionCode 3) builds with Platform 36 and the Browser plugin. Public
build environment checks pass; the configured server chat key was absent from
the packaged web assets. The emulator now boots using the existing SDK through
an ASCII alias. Eleven installed-APK mock checks passed, including bottom navigation
alignment/interrupted taps/reduced-motion media, native HTTP,
Preferences, keyboard and Back, persona, background pause, process restart,
rotation with safe-area checks, and Browser open/return. The tested APK hash
matches the local delivery manifest; raw emulator logs, APK and screenshots are
not committed to this public repository. See the
[public evidence boundary](PROJECT-STATUS-2026-10-01.md).

The local record shows a same-certificate upgrade from Debug 1.1.0 to 1.1.1.
See the [public status summary](PROJECT-STATUS-2026-10-01.md); the APK,
manifest and isolated mock evidence remain local-only until a same-SHA CI
artifact is available.

The native run uses an isolated mock and does not certify complete OIDC login,
real-device TLS, native HTTP timeout/cancellation, or a real DeepSeek call from
the new APK. A reachable phone HTTPS endpoint and test phone remain unavailable.
