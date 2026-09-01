# IoT Manager

> **Current delivery / 当前交付（2026-09-01）** — IoT Manager is a
> controlled-pilot IoT operations platform, not a production-approved release.
> The current source, verified Android Debug APK checksum, resolved defects,
> release blockers, and acceptance boundary are recorded in the bilingual
> [current project report](docs/CURRENT-PROJECT-REPORT-2026-09-01.md).
>
> **当前交付（2026-09-01）**：IoT Manager 已具备受控试点所需的核心能力，
> 但尚未获得生产发布批准。最新源码、已验证的 Android Debug 安装包校验值、
> 已修复缺陷、遗留风险与验收边界，见双语
> [项目现状报告](docs/CURRENT-PROJECT-REPORT-2026-09-01.md)。

<p align="center">
  <img src="docs/images/iot-manager-overview.svg" alt="IoT Manager project overview / 项目概览" width="100%" />
</p>

<p align="center"><strong>现场设备运营平台 · Real-time IoT Operations Platform</strong></p>

## 项目简介 / Project overview

**中文：** IoT Manager 是面向现场局域网和云端设备的物联网运维平台。它统一设备接入、能力建模、命令确认、遥测告警、实时动态与真实天气环境数据，并提供 Android/PDA、监控大屏和运维控制台三类界面。

**English:** IoT Manager is an operations platform for on-site LAN and cloud-connected devices. It unifies device onboarding, capability profiles, command acknowledgement, telemetry, alerts, real-time activity, and live weather context across Android/PDA, monitoring, and operations-console experiences.

| 核心能力 | Key capability |
| --- | --- |
| 设备发现、认领、分组、归档与活动追踪 | Device discovery, claim, grouping, archive, and activity tracking |
| BLE、本地边缘代理与云端 API 的可替换接入层 | Replaceable BLE, Edge Agent, and cloud API integration boundaries |
| 具备确认回执、幂等性与审计记录的设备命令 | Device commands with acknowledgement, idempotency, and audit history |
| 实时天气、预报、海拔与环境风险状态 | Live weather, forecast, elevation, and environmental risk status |
| 可离线查看缓存、手动下拉刷新、真机位置授权 | Cached offline viewing, pull-to-refresh, and device location permission flows |

## 核心能力 / Core capabilities

**中文：** IoT Manager 是面向受控试点的模块化物联网运维基础。浏览器与 Android 客户端通过 Spring Boot 平台协同工作，可借助现场 Edge Agent 接入局域网设备；每一种可控设备均以可版本化的 Profile 建模，而不是硬编码按钮集合。

**English:** IoT Manager is a modular IoT operations foundation for controlled pilots. It connects browser and Android clients to a Spring Boot platform, supports a site Edge Agent for LAN equipment, and treats every controllable device as a versioned Profile instead of a collection of hard-coded buttons.

## 功能详情 / Included functionality

- **设备运营 / Device operations:** inventory, discovery and claim, archive,
  device groups, alarms, telemetry, activity history, and real-time updates.
- **可靠命令 / Reliable command handling:** profile validation, idempotency,
  audit events, acknowledgement states, and batches of up to 200 site-scoped
  devices.
- **真实接入 / Real adapter boundaries:** direct Android BLE for the nRF52840
  reference switch, plus an outbound WebSocket Edge Agent with Shelly Plus Plug
  S Gen2 RPC control and state read-back.
- **三端运营 / Three operator surfaces:** a mobile/PDA client, a monitoring
  dashboard, and an operations console; the mobile client supports site/cloud
  endpoint switching and read-only offline snapshots.
- **可重复交付 / Repeatable engineering:** Flyway migrations, backend and Edge
  Agent tests, client unit tests, Android APK build automation, and
  Docker/Caddy deployment configuration.

## 实时天气系统 / Real-time weather system

- **真实数据 / Live data:** the backend queries Open-Meteo for weather
  conditions, temperature, humidity, pressure, wind, elevation, hourly
  forecasts, and seven-day forecasts.
- **一次性定位 / One-time location:** the mobile client asks for location only
  after an explicit tap. Approximate Android location is supported and the app
  never starts background location tracking.
- **环境判定 / Environmental status:** temperature, humidity, pressure, ESD,
  and condensation risk are classified as suitable (green), observe (yellow),
  or risk (red) by server-side rules.
- **稳定刷新 / Stable refresh:** cache-aware reads, explicit pull-to-refresh,
  real-time render throttling, a 60-second manual-refresh cooldown, and one
  short automatic retry avoid refresh storms while preserving the last useful
  result.

See the bilingual [weather feature development guide](docs/weather-feature-development.md) for API contracts, data flow, and validation coverage.

## 当前状态 / Current status

**中文：** 当前版本是可运行的 MVP 与受控试点基础，仍不是已审批的生产发布版。生产代码与部署资产已包含 JWT/RBAC、组织/站点授权、三端 Authorization Code + PKCE、Android Keystore 令牌存储、PostgreSQL 16、Secret 挂载、最小权限数据库角色、两阶段 Keycloak 四角色集成引导、Caddy TLS/WSS、逻辑备份、WAL-G、内部 Prometheus/Alertmanager 与独立恢复演练入口。历史本地 Docker 全链路、真实 PKCE/JWT/RBAC 与逻辑恢复冒烟证据可追溯，但不能替代干净 GitHub Runner、真实 S3 WAL/PITR、供应商审查和真实设备 Gate 证据。

**English:** This is a functional MVP and controlled-pilot foundation, **not an
approved production release**. The production code and deployment assets now
include JWT/RBAC, organization/site scoping, Authorization Code + PKCE on all
three operator surfaces, Android Keystore token storage, PostgreSQL 16,
backup scripts, Actuator/Prometheus, structured logging, rate limiting, a
strict WSS boundary, Docker Secret mounts, least-privilege database roles,
two-phase Keycloak four-role integration bootstrap, Caddy TLS/WSS, WAL-G,
and an isolated restore-drill entry point. Historical local full-stack
PKCE/JWT/RBAC and isolated logical-recovery smoke evidence exists under
`artifacts/p0-runtime/`; it is not a replacement for a clean GitHub Runner
execution. The current source tree additionally contains four-role/two-site
runtime coverage, internal Prometheus/Alertmanager checks, and a protected
physical WAL/PITR drill. Clean Runner evidence, protected S3 recovery
evidence, supplier review, and physical-device Gate evidence still remain.
Runtime images are pinned and continuously scanned, but the latest local
assessment still contains unresolved upstream HIGH/CRITICAL findings; see the
[runtime image security status](docs/IMAGE-SECURITY-STATUS.md). This is a
release gate, not a claim that those findings have been accepted.

See [Device Profiles](profiles/README.md), [Edge Agent](edge-agent/README.md),
the [project progress overview](docs/PROJECT-PROGRESS-OVERVIEW.md), the
[P0 Docker full-chain development plan](docs/P0-DOCKER-FULL-CHAIN-DEVELOPMENT-PLAN.md),
the [R1 completion implementation status](docs/R1-COMPLETION-IMPLEMENTATION-STATUS.md),
the [runtime image security status](docs/IMAGE-SECURITY-STATUS.md),
the [strict project audit](docs/PROJECT-AUDIT-2026-08-30.md),
and [release verification](docs/VERIFICATION.md) for the supported contracts
and acceptance checks.

## Prerequisites

- Node.js 22.x and npm (the strict verifier rejects a different major version).
- JDK 17 for the Spring Boot backend. The host default Maven Java runtime may be Java 8, so select JDK 17 before running backend commands. The Windows verifier keeps Maven Wrapper downloads in a stable per-user cache and does not require `powershell` to be on `PATH`.
- JDK 21+ for Android builds. Capacitor 8 cannot be built with JDK 17 source compatibility.
- Android SDK Platform 36, Build Tools 36.0.0, platform tools, and an API 36 emulator or Android device for App verification.

## Run locally

Open separate PowerShell windows for each service.

### Backend API (`http://localhost:8080`)

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location backend
mvn spring-boot:run
```

The default `dev` profile uses a local file-backed H2 database at `backend/data/iotdb` and exposes the H2 console at `http://localhost:8080/h2-console`. H2 and its console are development-only; do not use either for a production deployment.

PostgreSQL Flyway migrations V1–V18 build the current production device, command, agent, site-weather, reliability,
identity, membership, per-agent credential, and immutable audit-context schema. H2 additionally applies V19 to align its long-text compatibility types with Hibernate. V19 is permanently H2-only; the next shared or PostgreSQL production migration is V20. The dev profile uses `baseline-on-migrate`
so an existing local H2 database is registered at its current baseline and then checked by
Hibernate validation, rather than being recreated or mutated by Hibernate. Future production
migrations continue after V20; see `docs/PROJECT-IMPROVEMENT-PLAN.md` for the reserved version
ranges and Gate 2 requirements.

### Mobile/web client (`http://localhost:5175`)

```powershell
Set-Location client
npm install
npm run dev
```

For the local Vite proxy, no environment values are required. When the PDA client needs to connect to a backend endpoint explicitly, use the API prefix and the complete WebSocket endpoint:

```powershell
$env:VITE_API_BASE_URL = 'http://localhost:8080/api/v1'
$env:VITE_WS_URL = 'ws://localhost:8080/ws/devices'
npm run dev
```

The Android App uses the native Capacitor BLE adapter. When the same client is opened in a browser, its Web Bluetooth fallback requires a secure context; plain HTTP on a LAN address will not enable browser BLE access.

### Basic prototype loop

- **Simulated LAN:** list candidates with `GET /api/v1/discovery/lan?siteCode=demo-site`, claim one with `POST /api/v1/discovery/lan/{candidateId}/claim`, then submit a command with `POST /api/v1/devices/{id}/commands`. Command state progresses through `PENDING`, `SENT`, then `ACKNOWLEDGED` or `FAILED`; the client receives updates from `/ws/devices` and can query `GET /api/v1/commands/{commandId}`.
- **BLE:** the Android App scans and connects through the native BLE plugin; the browser build retains a Web Bluetooth fallback. BLE bindings remain local to the App installation and are separate from simulated LAN discovery, so a local BLE device is not automatically registered as a backend LAN device.

### Device Profiles and operations

Device capabilities are defined once under `profiles/definitions/` and are used by
the backend command validator and the mobile client control renderer. A profile
declares its supported transports, controls, commands, state fields, parameter
constraints, and telemetry fields. The first delivery includes:

- `legacy-generic-v1` for simulated/API-controlled actuators.
- `nordic-nrf52840-switch-v1` for the reference BLE switch.
- `shelly-plus-plug-s-v1` for a Shelly Plus Plug S reached through an Edge Agent.

The platform persists profile identity on each device and rejects commands that
the assigned profile does not support. Devices can be grouped within a site,
controlled in batches (up to 200 targets), archived without deleting their
history, and inspected through command event and telemetry history APIs.

### Site Edge Agent (real LAN path)

Run the Edge Agent inside the same LAN as the equipment. It maintains one
outbound WebSocket to the platform, sends discovery/telemetry, accepts command
requests, and returns a final receipt after the device driver confirms state.
The included driver supports Shelly Plus Plug S Gen2 with `Switch.Set` followed
by `Switch.GetStatus` read-back.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location edge-agent
mvn package
java -jar target/iot-edge-agent-0.1.0-SNAPSHOT.jar --config C:\ProgramData\iot-manager\edge-agent.properties
```

Copy `edge-agent/src/main/resources/edge-agent.properties.example` outside the
repository and set `backend.websocket.url` to
`ws://<platform-host>:8080/ws/edge/v1` locally, or
`wss://<public-domain>/ws/edge/v1` when using the Caddy deployment. See
[edge-agent/README.md](edge-agent/README.md) for the supported driver and
configuration details.

## Security boundary / 安全边界

The development profile intentionally uses open CORS, an open WebSocket endpoint,
the H2 console, and demo data. Keep it on a controlled LAN and never expose it
as a public service. The production profile requires explicit HTTPS origins and
Keycloak-issued JWTs for user APIs; `/ws/devices` is site-scoped and
`/ws/edge/v1` requires the per-agent `X-Iot-Agent-Credential` and
`X-Iot-Agent-Token` headers. Production also requires WSS (or a trusted proxy
forwarding `X-Forwarded-Proto: https`).

Provision an agent credential through the admin-only
`POST /api/v1/edge-agents/credentials` endpoint. The secret is returned once;
only its BCrypt digest and rotation/revocation audit are stored. The current
implementation is the R1 credential foundation, not a substitute for a live
deployment, backup/restore evidence, mTLS, and Gate acceptance work.

### Operations frontend (`http://localhost:5173`)

```powershell
Set-Location frontend
npm install
npm run dev
```

### Operations console (`http://localhost:5174`)

```powershell
Set-Location console
npm install
npm run dev
```

## Verify

For the complete release-baseline verification commands, including the Android
APK and Docker/Caddy configuration checks, see [docs/VERIFICATION.md](docs/VERIFICATION.md).

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location backend
mvn -q -Dtest=IotManagerApplicationTest test
```

```powershell
Set-Location client
npm test
npm run build
```

Build the other Vite applications with `npm run build` from `frontend` or `console`.

## Cloud deployment

The first full-stack deployment serves the monitoring dashboard at `/`, the
operations console at `/console/`, and keeps the mobile API/WebSocket paths at
`/api/v1` and `/ws/devices` (`/api` remains a deprecated compatibility alias).
See [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md) for
the Docker/Caddy setup and acceptance checks.

## Android enterprise client

The Android App packages the existing `client` application with Capacitor. Android builds require JDK 21 or newer; the commands below use the JDK 23 installation verified on this machine. The backend continues to use JDK 17.

### Build the debug APK

```powershell
$env:JAVA_HOME = '<JDK_21_OR_NEWER_HOME>'
$env:ANDROID_SDK_ROOT = '<ANDROID_SDK_ROOT>'
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_SDK_ROOT\platform-tools;$env:Path"

Set-Location client
npm ci
npm run build
npx cap sync android
Set-Location android
.\gradlew.bat clean assembleDebug
```

The generated APK is `client/android/app/build/outputs/apk/debug/app-debug.apk`.

### Install and launch

From `client/android` with an emulator or Android device visible in `adb devices`:

```powershell
$adb = "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe"
& $adb install -r '.\app\build\outputs\apk\debug\app-debug.apk'
& $adb shell am start -n 'com.iot.manager.client/.MainActivity'
```

Open **连接设置** in the App to select a site API or cloud API profile. An Android emulator reaches services running on the host through these addresses:

```text
API:       http://10.0.2.2:8080/api/v1
WebSocket: ws://10.0.2.2:8080/ws/devices
```

For a physical phone or PDA, replace `10.0.2.2` with the backend computer's reachable LAN address. `localhost` on Android refers to Android itself, not the development computer.

For a physical-device build, copy `client/.env.example` to
`client/.env.local` and set the computer's LAN address before running
`npm run build`. The local file is excluded from Git so a public checkout
never contains a personal network address.

### 互联网远程 (cloud endpoint)

Choose **互联网远程** in **连接设置** to operate platform devices through an internet-accessible Spring Boot backend:

```text
API:       https://your-server.example/api/v1
WebSocket: wss://your-server.example/ws/devices
```

Use **测试连接** before saving: it validates the URL format and probes the device list endpoint, reporting a device count or a readable failure reason. The app only switches endpoints after the probe passes.

- Production/cloud endpoints must use HTTPS and WSS. Release builds do not permit cleartext HTTP/WS, so an unencrypted internet endpoint cannot be activated in release.
- Debug builds may use plain HTTP/WS for controlled on-site development against a reachable LAN address.
- After switching, the app refreshes platform state before enabling controls. If the remote endpoint is unreachable, the previous cache stays read-only with a stale indicator; commands are never queued or replayed.
- The demo organization context (`demo-org` / `demo-site` / `/operations/field`) applies to the remote backend, so the cloud instance must have the same demo seed data to run the simulated LAN discovery flow.

Plain HTTP, WS, and WebView mixed content are enabled only when the Android package is debuggable, for controlled local development. Release builds do not inherit those exceptions and will require production HTTPS/WSS configuration in the later security milestone.

### Runtime behavior

- Site and cloud profiles use the same replaceable platform adapter. `accessRoute` describes how the App reaches an operation; `deviceTransport` separately describes how the device reaches the platform boundary.
- Platform snapshots are cached by endpoint and organization. When a snapshot is stale or the endpoint is offline, it is read-only.
- Platform commands are not queued, automatically retried, or resent after lifecycle and endpoint changes. A manual retry creates a new command.
- A known BLE binding can connect and send supported commands without platform access. A write changes `desiredState`, but only a decoded notification, read-back, or response may change `reportedState`.
- A BLE profile that supports writes but has no reliable confirmation ends in `UNCONFIRMED`, displayed as **已发送，设备未提供确认**. This is not treated as an acknowledgement.

The API 36 emulator flow has been exercised for install, launch, navigation, and connection settings. Physical BLE permission, scan, connect, reconnect, known-profile command, and unknown-profile read-only checks still require compatible BLE hardware before production acceptance. The nRF52840 reference firmware is in [firmware/nrf52840-reference-switch](firmware/nrf52840-reference-switch); build it with Zephyr and validate it using a low-voltage load or board LED before controlling physical equipment.

Live Keycloak/PostgreSQL deployment, independent backup/recovery rehearsal,
background BLE, mini-program delivery, release signing, managed distribution,
mTLS, and broader production hardening remain deferred milestones. The
production code path already contains PKCE, JWT/RBAC, site authorization,
per-agent credentials, and rate limiting; these still require deployment and
Gate evidence.
