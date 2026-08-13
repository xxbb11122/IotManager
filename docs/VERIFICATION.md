# Release verification

This project has one release baseline. Before merging or publishing it, verify
the Java services, all Vite applications, the Capacitor Android package, and
the deployment configuration from the same commit.

## Required toolchains

- Java services: JDK 17 and Maven 3.9+.
- Web applications and Capacitor sync: Node.js 22+ and npm.
- Android: JDK 21+, Android SDK Platform 36, Build Tools 36.0.0, and platform
  tools.
- Deployment checks: Docker with the Compose v2 plugin.

The default local check covers `backend`, `edge-agent`, `frontend`, `console`,
`client`, and Docker Compose/Caddy syntax. Android is opt-in because it needs
a local Android SDK. The CI workflow installs the Android prerequisites and
runs it by default.

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

For Java service verification, make sure `mvn --version` reports Java 17. For
an Android build, point `ANDROID_SDK_ROOT` (or `ANDROID_HOME`) at an SDK with
API 36 and Build Tools 36.0.0, and ensure the Java used by Gradle is JDK 21 or
newer.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `master` and `codex/**`, pull
requests, and manual dispatch. It contains independent jobs for:

- Maven tests and packaging for the backend and Edge Agent on JDK 17.
- Client unit tests plus all three Vite builds on Node 22.
- Capacitor synchronization and an Android debug APK on JDK 21/API 36.
- Docker Compose interpolation/schema validation, Caddy syntax validation, and
  a build of the backend plus both static web images.

The Android job uploads `app-debug.apk` as a short-lived build artifact. A
repository variable `ENABLE_ANDROID_CI=false` can temporarily suppress that
job during an external Android SDK or runner outage; it should not be used as
a normal release setting.

The deployment job does not request TLS certificates, publish images, start
the stack, or test a public domain.
