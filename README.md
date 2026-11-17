# IoT Manager

<p align="center">
  <img src="docs/images/iot-manager-overview.svg" alt="IoT Manager project overview" width="100%" />
</p>

<p align="center">
  <strong>面向现场设备、边缘网络与云端平台的可审计 IoT 运维系统</strong><br />
  <em>Auditable IoT operations across field devices, edge networks, and cloud-connected services.</em>
</p>

<p align="center">
  <img alt="Java 17" src="https://img.shields.io/badge/Java-17-blue" />
  <img alt="Spring Boot" src="https://img.shields.io/badge/Spring%20Boot-4.0.8-brightgreen" />
  <img alt="Node.js 22" src="https://img.shields.io/badge/Node.js-22-green" />
  <img alt="Android API 36" src="https://img.shields.io/badge/Android-API%2036-3DDC84" />
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169E1" />
  <img alt="Docker Compose" src="https://img.shields.io/badge/Docker-Compose-2496ED" />
  <img alt="App AI" src="https://img.shields.io/badge/App%20AI-Spring%20AI-7C3AED" />
  <img alt="Release status" src="https://img.shields.io/badge/Release-R1%20Pilot%20Candidate-orange" />
</p>

> [!TIP]
> ### 🤖 App AI 助手：服务器托管、权限可控、性格可定制
>
> 在 Android/PDA 客户端内直接进入 AI 工作区，使用远程 Chat、会话历史和版本化 AI 性格。OWNER / ADMIN 可管理性格版本；模型请求通过 IoT Manager 后端和 Spring AI 发往当前 DeepSeek 兼容服务，供应商密钥只留在服务器，也可在服务器配置中更换兼容供应商。
>
> **当前边界：** AI Chat 是可选试点能力，`IOT_AI_ENABLED=false` 时默认关闭；知识库和 Embedding 也保持关闭。当前不宣称 AI 已通过正式生产审批或已能检索站点知识库。查看 [Glass Next App 介绍](apps/client-glass-next/README.md)与[App 验证记录](apps/client-glass-next/VERIFICATION.md)。

> [!IMPORTANT]
> **Current release status / 当前发布状态**
>
> IoT Manager 当前是 **R1 受控试点候选项目（Controlled-Pilot Candidate）**，并非已批准的正式生产版本。新增的 App AI 聊天属于独立试验范围，生产默认关闭；站点知识库也默认关闭。
>
> **2026-10-29** 的发布门禁离线模拟为 **79/79 通过**；它验证合成配置下的判断和阻断逻辑。正式审核、保护环境、专用 runner、正式签名和已批准的回滚基线仍需接入。提交后的结果以该提交的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/workflows/ci.yml) 和 [P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/workflows/runtime-e2e.yml) 为准。
>
> **Passing local tests or Quick CI is not production approval.** 受保护的不可变发布门禁、签名版本回滚、远端 WAL-G PITR/RPO/RTO、持续负载、真实设备与新 APK 的完整 HTTPS/OIDC 验收尚未关闭。

## What is IoT Manager?

**IoT Manager** 是一个面向单组织多站点、现场局域网设备、边缘代理和云端服务的模块化 IoT 运维平台。当前部署基线是单主机 Docker Compose 的受控试点，不宣称多租户 SaaS 或高可用集群。

它不是单纯的设备开关面板，而是围绕 **设备身份、能力模型、命令确认、遥测、告警、实时状态、权限边界、恢复能力和可审计发布** 构建的完整运维链路。

The platform provides a unified operational boundary for:

- device onboarding, discovery, claim, grouping, and archive;
- versioned device capability profiles;
- acknowledged and idempotent device commands;
- telemetry, activity history, alerts, and real-time updates;
- Android/PDA, monitoring-dashboard, and operations-console experiences;
- an optional, server-mediated AI chat workspace with conversation history and versioned personas (disabled by default);
- Keycloak OIDC / PKCE authentication and site-scoped RBAC;
- Edge Agent connectivity for LAN devices;
- PostgreSQL backup, WAL-G recovery design, and observability;
- immutable release artifacts, SBOM, provenance, image scanning, and evidence gates.

## Why this project?

| 现实问题                   | IoT Manager 的处理方式                                             |
| -------------------------- | ------------------------------------------------------------------ |
| 多站点与多角色隔离         | Organization / Site Membership + OWNER / ADMIN / OPERATOR / VIEWER |
| 设备型号差异               | Versioned Device Profiles，而不是硬编码 UI                         |
| 指令是否真正执行           | Command lifecycle + acknowledgement + audit events                 |
| 局域网设备无法直接暴露公网 | Outbound Edge Agent WSS                                            |
| BLE 与云端控制共存         | Android native BLE + Backend / Edge abstraction                    |
| 网络不稳定                 | Cached snapshot、reconnect、idempotency、state reconciliation      |
| 运维可观测性               | Actuator + Prometheus + Alertmanager                               |
| 数据损坏与误操作           | Logical backup + WAL-G recovery design                             |
| 构建产物一致性             | Immutable digest + SBOM + provenance + runtime / recovery evidence |
| CI 平台偶发失败            | Stage isolation + retry / fallback policy + fail-closed Gate       |
| AI 运维辅助需要权限和成本边界 | 服务器侧模型密钥、站点隔离、请求恢复和默认关闭的功能开关             |

## Core capabilities

### Device operations

- 设备发现、认领、分组、归档与活动追踪；
- 设备 Profile 与能力校验；
- 遥测、状态、告警和实时 WebSocket 更新；
- 单设备与批量命令；
- 命令幂等、ACK、失败状态与审计历史；
- 多站点数据边界与跨站访问隔离。

### Edge & field connectivity

- Android 原生 BLE 与 Web Bluetooth fallback；
- Site Edge Agent 通过 outbound WSS 连接平台；
- Shelly Plus Plug S Gen2 RPC 控制与状态回读；
- nRF52840 reference-switch BLE profile 与参考固件源码；真实设备验收仍待完成。

### Identity & security

- Keycloak OIDC 与 Authorization Code + PKCE；
- Spring Security OAuth2 Resource Server / JWT；
- OWNER / ADMIN / OPERATOR / VIEWER 四角色模型；
- Organization / Site membership authorization；
- Android Keystore token storage；
- Caddy HTTPS / WSS；
- per-Agent credential rotation / revocation；
- Docker Secret、私有运行时 Secret 卷与最小权限 PostgreSQL 应用角色。

### Weather & environmental context

- Open-Meteo 实时天气；
- 温度、湿度、气压、风、海拔和预报；
- ESD、condensation 与环境风险分级；
- 明确用户触发的一次性定位；
- 缓存、刷新限流和失败保留策略。

### Mobile experience & App AI / 移动体验与 App AI

- Capacitor Android/PDA 客户端包含设备、AI、动态、添加四个主入口；局部状态更新、手动下拉刷新、重连与减少动态效果支持旨在降低频繁重绘和闪屏；
- AI 页面支持问答、会话历史、按角色管理的版本化性格及不重复提交的请求恢复；模型调用、密钥和权限检查均在后端；
- [独立 Glass Next Android App](apps/client-glass-next/README.md)在保留设备、BLE、天气、登录和启动体验的同时提供 AI 工作区；
- Glass Next 工作区已实施内容实色化、连续设备列表、AI 底部输入和局部更新优化；同机生产构建对照、模拟范围及未验证项见[综合整改与复审记录](docs/GLASS-APP-COMPREHENSIVE-IMPLEMENTATION-REVIEW-2026-11-10.md)；
- 2026-11-17 `Glass 1.1.4-glass.8 / Android code 13`：[登录与天气定向修复](docs/APP-LOGIN-WEATHER-TARGETED-FIX-2026-11-17.md)补齐登录阶段提示、超时/取消、显式默认配置恢复，以及再次审核中的 RR-01/RR-02 天气失效链路。后端、两客户端和浏览器定向回归共 157 项通过；另有 TLS/PKCE/WSS/真实 Chat 协议检查通过。此结果不代表手机外部浏览器、真实 GPS/BLE、正式签名或生产发布已经验收。Targeted login-feedback and weather-validity fixes pass 157 scoped regression tests, plus a separate live protocol/Chat check; real-device and production-release acceptance remain open.
- 生产环境默认 `IOT_AI_ENABLED=false`、`IOT_AI_KNOWLEDGE_ENABLED=false`。知识库/向量迁移代码已存在，但 Embedding 供应商与真实索引验收未完成，**不得将其描述为已上线功能**；
- 既有安装包曾在 Android 16 模拟器完成专项验证；本轮界面修改的原生模拟器验证受 SDK 故障影响未执行。真机 GPS/BLE、完整原生 OIDC 与真实模型调用仍是验收项。

### Operations & recovery

- PostgreSQL 16 + Flyway；
- Logical Backup；
- WAL-G 归档与物理恢复工作流；远端受保护 PITR 和目标 RPO/RTO 尚无正式验收证据；
- Prometheus + Alertmanager；
- isolated logical recovery drill；
- protected PITR workflow boundary。

## Architecture

```mermaid
flowchart LR
    A[Android / PDA] -->|HTTPS + WSS| C[Caddy]
    B[Monitoring Dashboard] -->|HTTPS + WSS| C
    O[Operations Console] -->|HTTPS + WSS| C
    C -->|/auth| K[Keycloak]
    C -->|/api /ws| S[Spring Boot Backend]
    S --> P[(PostgreSQL 16 / Flyway)]
    S --> W[Open-Meteo]
    S --> M[Prometheus]
    S -.->|AI enabled only| AI[Remote Chat Provider]
    E[Site Edge Agent] -->|Outbound WSS| C
    E --> D[LAN / Shelly Devices]
    A -->|Native BLE| N[nRF52840 / BLE Devices]
    P --> LB[Logical Backup]
    P --> WG[WAL-G Archive / Backup]
    M --> AM[Alertmanager]
```

## Release Integrity

The following diagram is the **target release contract**, not a claim that the protected release gate has already passed.

```mermaid
flowchart TD
    S[Exact source SHA] --> Q[Quick CI]
    S --> T[Release topology discovery]
    T --> B[6 Buildable Images]
    B --> R[GHCR Immutable Digests]
    T --> X[8 Runtime / Security Artifacts]
    R --> X
    X --> V[Trivy Digest Scan]
    X --> SB[SBOM + Provenance]
    V --> RT[12-Service Normal Runtime]
    SB --> RT
    RT --> RE[Recovery + wal-g-recovery]
    RE --> U[13-Service Candidate Union Evidence]
    U --> G[Release Integrity Gate]
```

| Evidence domain                 | Required result |
| ------------------------------- | --------------: |
| Buildable images                |       **6 / 6** |
| Runtime / security artifacts    |       **8 / 8** |
| Normal runtime services         |     **12 / 12** |
| Recovery-added services         |       **1 / 1** |
| Release-candidate service union |     **13 / 13** |
| Unexpected digest mismatch      |           **0** |
| Missing required evidence       |           **0** |

Release and recovery gates are **fail-closed**: a skipped scan, missing evidence, digest mismatch, terminated runner, failed recovery verification, or unapproved HIGH/CRITICAL finding cannot be treated as PASS.

## Current verification / 当前验证边界

以下记录分别标明测试日期和范围。新的提交需要独立的 CI 与发布验收；本地模拟结果不能外推为云端运行或生产批准。

| 区域 | 结果 | 复现入口 / 范围 |
| --- | --- | --- |
| 发布门禁 | 2026-10-29：79/79 离线模拟通过，0 外部 I/O 尝试 | [方案和验收](docs/RELEASE-GOVERNANCE-SIMULATION-ACCEPTANCE-2026-10-29.md)；不代表真实 GitHub 审批或部署成功 |
| 发布工具回归 | 2026-10-29：13 通过、0 失败、1 跳过 | Windows 本地运行；Linux runner 注册协议因平台限制跳过 |
| 受控运维模拟 | 2026-10-21：Linux 7/7，双库迁移及新备份链恢复通过 | [运行记录](https://github.com/xxbb11122/IotManager/actions/runs/39574579331)；合成数据，非生产恢复 |
| 应用 CI 与运行态 | 2026-10-21：历史提交 `0cd5b44` 的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/39577950680) 与 [P0 Runtime](https://github.com/xxbb11122/IotManager/actions/runs/39577950722) 成功 | P0 的正式 immutable job 跳过；不代表本提交 CI 或正式 Gate 已通过 |
| 真实治理配置 | 2026-10-27：4 PASS、2 FAIL、2 UNKNOWN | [复检报告](docs/RELEASE-READINESS-RECHECK-2026-10-27.md)为当时快照，不能替代实时复查 |

更早的 Android 模拟器与应用测试记录见[历史项目状态](docs/PROJECT-STATUS-2026-10-01.md)。正式发布仍需对同一候选 SHA 执行受保护 Gate、签名、恢复与回滚验收。

### Android debug package / 调试安装包

本地构建产物位于 `client/android/app/build/outputs/apk/debug/app-debug.apk`，不会纳入 Git。成功的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/workflows/ci.yml) 会为**对应提交 SHA** 上传 `iot-manager-debug-apk-<SHA>`，Actions 产物保留 14 天。仅供开发与测试；正式发布必须使用受保护的 Release 签名并核对升级前证书与版本。

### Production-release blockers

1. a clean protected GitHub Release Integrity Gate for the exact candidate SHA, including immutable runtime evidence for all required services;
2. protected GHCR digest, scan, SBOM, provenance, and runtime-evidence closure;
3. signed candidate N and N−1 plus an approved protected runner to verify rollback from N to N−1;
4. real remote S3-compatible WAL-G PITR with measured RPO ≤ 15 minutes and RTO ≤ 60 minutes;
5. capacity, load, and long-running stability baselines;
6. real Android, GPS/weather, BLE, Edge, and network-condition acceptance;
7. external weather-provider quota, failover, privacy, and operational review;
8. for optional AI: real-provider quality/cost/privacy review, full HTTPS/OIDC/native acceptance, pgvector upgrade-and-restore evidence, and a separate knowledge-base/Embedding gate.

## Technology stack

| Layer             | Technology                                               |
| ----------------- | -------------------------------------------------------- |
| Backend           | Java 17, Spring Boot 4.0.8, Spring MVC, Spring WebSocket |
| Security          | Spring Security, OAuth2 Resource Server, JWT, Keycloak   |
| Persistence       | PostgreSQL 16, Spring Data JPA / Hibernate, Flyway; V27 requires pgvector 0.8.6 even when AI is off |
| Optional AI       | Spring AI 2.0.1, server-side OpenAI-compatible Chat adapter; disabled by default |
| Edge Agent        | Java 17, outbound WebSocket, profile-based drivers       |
| Web               | Node.js 22, Vite, ES Modules                             |
| Testing           | JUnit Jupiter, Testcontainers, Playwright                |
| Mobile            | Capacitor 8, Android API 24–36                           |
| Reverse proxy     | Caddy                                                    |
| Observability     | Spring Actuator, Micrometer, Prometheus, Alertmanager    |
| Backup / Recovery | PostgreSQL logical backup, WAL-G                         |
| Container         | Docker, Docker Compose, Buildx / BuildKit                |
| Registry          | GitHub Container Registry                                |
| Supply chain      | Trivy, Gitleaks, CycloneDX SBOM, Build provenance        |
| CI/CD             | GitHub Actions                                           |

## Repository layout

```text
IotManager/
├── backend/                 Spring Boot platform API
├── edge-agent/              Site Edge Agent
├── frontend/                Monitoring dashboard
├── console/                 Operations console
├── client/                  Web / Android PDA client
├── firmware/                nRF52840 reference firmware (device validation pending)
├── profiles/                Versioned device profiles
├── deploy/                  Docker / Caddy / Keycloak / PostgreSQL assets
├── scripts/
│   ├── ci/                  Release-integrity and evidence tooling
│   └── runtime/             Runtime / recovery orchestration
├── .github/workflows/       Quick CI, Runtime, Security, Recovery, Release Gate
└── docs/                    Audit, verification, runbooks, development records
```

## Quick start

### Requirements

- JDK 17 — Backend / Edge Agent
- JDK 21+ — Android build
- Node.js 22
- Android SDK Platform 36 + Build Tools 36.0.0 — Android build
- Docker + Docker Compose for the full deployment path

### Backend API

```bash
cd backend
mvn spring-boot:run
```

The default `dev` profile uses a local H2 database and exposes the API at `http://localhost:8080`. This profile is **not** the production identity, TLS, or persistence configuration.

### Client

```bash
cd client
npm ci
npm run dev
```

### Monitoring frontend

```bash
cd frontend
npm ci
npm run dev
```

### Operations console

```bash
cd console
npm ci
npm run dev
```

Local Vite defaults: monitoring `http://localhost:5173`, console `http://localhost:5174`, client `http://localhost:5175`. A physical phone cannot use the computer's `localhost`; configure a reachable HTTPS API, WSS endpoint and OIDC issuer before real-device acceptance. For the single-host Compose topology, external routes are `https://<DOMAIN>/`, `/console/`, `/api/v1`, `/auth/`, `wss://<DOMAIN>/ws/devices`, and `wss://<DOMAIN>/ws/edge/v1` (see [deployment runbook](deploy/DEPLOYMENT.md)).

### Android debug build

```bash
cd client
npm ci
npm run android:debug
```

The resulting `client/android/app/build/outputs/apk/debug/app-debug.apk` is a **debug-signed** test package. A release APK/AAB requires protected signing inputs and separate acceptance; do not replace an installed package with a different certificate without first planning data preservation.

### Docker integration and migration note

Use the [deployment runbook](deploy/DEPLOYMENT.md) for secrets, TLS/WSS, database roles, backup and recovery. `docker compose config` verifies syntax only. **Flyway V27 uses pgvector even with AI disabled**; existing volumes require the documented extension preflight. The PostgreSQL 16 Alpine musl image cannot directly reuse an incompatible glibc data volume: follow the [logical migration and new backup-chain runbook](docs/RELEASE-OPERATIONS-DEVELOPMENT-AND-RUNBOOK-2026-10-21.md), and preserve the source. Never edit an applied migration or run a destructive restore on a live volume.

### Strict verification

```bash
bash scripts/verify.sh --strict
```

```powershell
./scripts/verify.ps1 -Strict
```

Targeted checks are `mvn verify` in `backend/` and `edge-agent/`, `npm run test && npm run build` in each Vite app, and `npm run test:e2e` in `client/`. CI additionally builds the Android Debug APK and runs source/security/SBOM gates. A successful Quick CI run is **not** the protected production-release gate.

### Offline release governance simulation / 发布门禁离线模拟

From the repository root with Node.js 22:

```bash
node scripts/testing/release-governance-simulation.mjs --output artifacts/release-governance-simulation/summary.json
```

The simulation uses synthetic repository settings and in-memory requests to exercise environment protection, branch rules, runner labels, signing metadata and rollback inputs. A simulated request remains pending and does not approve a release. See the [reviewed plan](docs/RELEASE-GOVERNANCE-SIMULATION-PLAN-2026-10-29.md), [acceptance report](docs/RELEASE-GOVERNANCE-SIMULATION-ACCEPTANCE-2026-10-29.md) and [synthetic test evidence](docs/evidence/release-governance-simulation-20261029.json).

For Docker Runtime, Android, release-integrity, and recovery verification, see:

- [Verification](docs/VERIFICATION.md)
- [CI / Release runbook](docs/CI-RELEASE-RUNBOOK.md)
- [Deployment](deploy/DEPLOYMENT.md)

## Device profiles

Current reference profiles include:

- `legacy-generic-v1`
- `nordic-nrf52840-switch-v1`
- `shelly-plus-plug-s-v1`

See [Device Profiles](profiles/README.md).

## Security boundary

The `dev` profile is for local development and must not be exposed as a production service.

Production-shaped operation requires JWT, HTTPS/WSS, explicit origins, site-scoped authorization, least-privilege DB roles, protected secrets, immutable release evidence, security scans, and recovery gates.

The mobile client does not store an AI supplier key. Remote Chat credentials belong in server-side protected secret files, not `.env`, browser storage, APK assets, Git history, logs or screenshots. The AI switch must remain off until the selected provider, privacy/cost limits, identity flow and recovery plan are accepted. Debug builds permit local cleartext development endpoints; release builds do not.

HIGH/CRITICAL findings remain release blockers unless fixed or covered by an explicitly approved, scoped, expiring VEX.

## Documentation

- [Verification](docs/VERIFICATION.md)
- [CI / Release](docs/CI-RELEASE-RUNBOOK.md)
- [Release governance simulation and acceptance](docs/RELEASE-GOVERNANCE-SIMULATION-ACCEPTANCE-2026-10-29.md)
- [Release operations and database migration runbook](docs/RELEASE-OPERATIONS-DEVELOPMENT-AND-RUNBOOK-2026-10-21.md)
- [Deployment](deploy/DEPLOYMENT.md)
- [Device Profiles](profiles/README.md)
- [Edge Agent](edge-agent/README.md)
- [Image security](docs/IMAGE-SECURITY-STATUS.md)
- [R1 implementation status](docs/R1-COMPLETION-IMPLEMENTATION-STATUS.md)
- [Current project status, AI scope and evidence audit](docs/PROJECT-STATUS-2026-10-01.md)
- [Mobile motion/flicker review](docs/APP-MOTION-FLICKER-IMPLEMENTATION-REPORT-2026-09-27.md)
- [Weather feature design](docs/weather-feature-development.md)
- [Historical assessment (2026-09-02)](docs/PROJECT-PROGRESS-EVALUATION-2026-09-02.md)

## Delivery decision / 交付判断

| 范围 | 当前判断 |
| --- | --- |
| 设备、站点、天气、边缘与三端界面 | 已有可运行实现，处于 R1 受控试点候选；新提交仍需同 SHA 的 CI/运行态复验 |
| App 动效与可选 AI Chat | 代码及本地/模拟器专项测试已完成；真实手机、完整 HTTPS/OIDC、真实模型与成本/隐私验收未完成 |
| 知识库、Embedding 与向量检索 | 保留代码和迁移，默认关闭；供应商、维度、索引、恢复及发布验收未完成 |
| 正式生产发布 | **未批准**；受保护发布、签名回滚、远端 PITR、RPO/RTO、容量和实体设备证据仍待补齐 |

**License:** this repository currently has no `LICENSE` file; public visibility alone does not define reuse terms. 请勿在 Issue、PR 或附件中上传真实密钥、Token 或现场隐私数据。

<p align="center">
  <strong>IoT Manager</strong><br />
  Device operations · Edge connectivity · Real-time state · Recovery · Auditable delivery
</p>
