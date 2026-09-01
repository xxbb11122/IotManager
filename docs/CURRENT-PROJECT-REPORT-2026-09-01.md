# IoT Manager 当前项目报告 / Current Project Report

**报告日期 / Date:** 2026-09-01  
**代码基线 / Source baseline:** `e31467a1e7fdefeeab78bde0a27f10a40cd82c38`  
**发布结论 / Release conclusion:** **受控试点可用；不批准生产发布。** / **Suitable for controlled-pilot use; not approved for production release.**

This is the current project-facing status document. Approval and release gates
remain governed by [PROJECT-APPROVAL-REVIEW.md](PROJECT-APPROVAL-REVIEW.md),
[PROJECT-IMPROVEMENT-PLAN.md](PROJECT-IMPROVEMENT-PLAN.md), and the image
security baseline. This report does not override those gates.

本报告是当前项目对外说明入口。审批与发布门禁仍以
[PROJECT-APPROVAL-REVIEW.md](PROJECT-APPROVAL-REVIEW.md)、
[PROJECT-IMPROVEMENT-PLAN.md](PROJECT-IMPROVEMENT-PLAN.md) 和镜像安全基线为准；
本报告不改变任何既定 Gate。

## 1. 产品定位 / Product position

IoT Manager is an operations platform for on-site LAN and cloud-connected
equipment. It supports three operator experiences: Android/PDA field work,
a monitoring dashboard, and an operations console. The product is designed
for controlled, single-organization multi-site pilots—not for unrestricted
public deployment.

IoT Manager 是面向现场局域网与云端设备的运维平台，包含 Android/PDA 现场端、
监控大屏和运维控制台三个操作界面。当前目标是单组织、多站点的受控试点，
不是可直接公开部署的生产 SaaS。

## 2. 已交付能力 / Delivered capability

| 范围 / Area | 已实现内容 / Delivered behavior | 状态 / Status |
| --- | --- | --- |
| 设备运维 / Device operations | Device discovery and claim, versioned Profiles, grouping, archive, telemetry, alerts, activity history, and site-scoped real-time updates. | 已实现 / Implemented |
| 可靠命令 / Reliable commands | Profile validation, idempotency, expiry, acknowledgement/read-back states, audit trail, and site-scoped batches up to 200 targets. | 已实现 / Implemented |
| 真实接入边界 / Real adapters | Android BLE boundary for the nRF52840 reference switch and an outbound Edge Agent path for Shelly Plus Plug S Gen2 RPC control/read-back. | 已实现；真实设备验收待完成 / Implemented; physical-device acceptance pending |
| 多端与权限 / Multi-surface access | PDA client, monitoring dashboard, operations console, Authorization Code + PKCE, JWT/RBAC, organization/site scope, four roles, and Android Keystore-backed tokens. | 已实现 / Implemented |
| 天气与环境 / Weather and environment | Open-Meteo live data, elevation, temperature, humidity, pressure, forecast, server-side green/yellow/red environmental rules, cached fallback, privacy controls, and pull-to-refresh. | 已实现；备用供应商待审批 / Implemented; fallback supplier pending approval |
| 刷新体验 / Refresh UX | Render throttling, explicit pull-to-refresh, one short automatic retry, 60-second weather refresh cooldown, and `429 + Retry-After` protection. | 已实现 / Implemented |
| 生产基础资产 / Production foundation | PostgreSQL 16, Flyway, Docker Secrets, least-privilege roles, Caddy TLS/WSS, Keycloak bootstrap, logical backup/restore scripts, WAL-G configuration, Prometheus and Alertmanager. | 代码/部署资产已实现；生产证据未齐 / Implemented in code/assets; production evidence incomplete |

## 3. 当前质量证据 / Current quality evidence

| 验证项 / Verification | 结论 / Result |
| --- | --- |
| Backend + Edge Agent（JDK 17） | GitHub Actions strict verification passed, including PostgreSQL Testcontainers. |
| Three web surfaces（Node 22） | GitHub Actions strict verification passed, including configured Playwright coverage and production builds. |
| Android Debug APK（Node 22 + JDK 21 + API 36） | GitHub Actions passed; a local clean rebuild also passed on 2026-09-01. |
| Compose static configuration | Passed locally with generated non-secret configuration. |
| Historical full-stack runtime test | Earlier full Docker evidence covered Keycloak, PostgreSQL, Caddy, PKCE/JWT/RBAC/WSS, fail-closed database restart, logical restore, and tamper refusal. |
| Latest observability-image runtime evidence | **Not yet renewed.** The GitHub runner was externally stopped during the new image build (exit 143); that is neither a test pass nor a proven product defect. A clean rerun is required. |

## 4. 当前安装包 / Current installation package

**Artifact:** `client/android/app/build/outputs/apk/debug/app-debug.apk`  
**Build type:** Debug, unsigned for production distribution  
**Built:** 2026-09-01 21:08:55 (Asia/Shanghai)  
**Size:** 5,785,066 bytes  
**SHA-256:** `1CBB6F4A8DB8C44E131019778F83415B9F4F31488F161BE104637CCA60CBA690`

The APK is intended only for internal Android installation and controlled
testing. Android will show an “unknown source” prompt when it is side-loaded.
It must not be represented as a production release: release signing,
key custody, installation/rollback validation, and real-device acceptance are
still required.

该 APK 仅用于内部 Android 安装与受控测试；侧载时 Android 会提示未知来源。
它不是生产发布包：正式签名、密钥托管、覆盖安装/回滚验证和真机验收仍未完成。

## 5. 缺陷修复集合 / Resolved defect set

| 编号 / ID | 已修复问题 / Resolved issue | 处理结果 / Result |
| --- | --- | --- |
| FIX-01 | 手机端频繁自动刷新影响操作与天气接口稳定性。 | Added render throttling, pull-to-refresh, cooldown, a single retry, server `429 + Retry-After`, and cached fallback. |
| FIX-02 | 本地/LAN 连接与 WebSocket 地址配置容易失配。 | Added explicit API/WSS connection settings, test feedback, and validated Caddy API/WSS boundary paths. |
| FIX-03 | Java 24 与 Spring Boot 3.2 / Hibernate 6.3 dependency set caused startup failures. | Standardized backend verification on JDK 17 and documented the Android JDK 21 boundary. |
| FIX-04 | JDBC pool failure during database outages could emit a secondary rollback exception. | Made the rollback path tolerate a closed JDBC connection while preserving fail-closed readiness. |
| FIX-05 | Linux Compose secret delivery and Caddy privilege checks were not portable/reliable enough. | Hardened secret mounts, non-root Caddy validation, local Caddy CA trust, and evidence redaction. |
| FIX-06 | Trivy setup used a retired scanner asset and could fail before scanning. | Pinned and installed the scanner once; final aggregation remains fail-closed. |
| FIX-07 | Caddy image metadata caused false-positive Go dependency attribution. | Rebuilt with auditable Caddy build metadata and fixed dependency set; the latest scan cleared its HIGH/CRITICAL findings. |
| FIX-08 | Alertmanager source build failed because its Git release tag excludes `ui/app/dist`. | Rebuild the locked frontend from the signed source tag before compiling the patched binary; clean Runner validation is pending. |

## 6. 尚未达到目标的项目 / Goals not yet achieved

### P0 release blockers / P0 发布阻断项

1. **运行镜像 HIGH/CRITICAL 漏洞尚未全部关闭。** Caddy has been cleared,
   but Keycloak, PostgreSQL/WAL-G, logical backup, and some upstream runtime
   image findings remain open. Prometheus/Alertmanager source rebuilds must
   complete a clean scan before their status can change. No exception,
   suppression, or hidden ignore list has been added.
2. **最新提交缺少干净 GitHub Runner 的完整 Compose 运行态证据。** The
   latest run stopped externally while building, so the full Keycloak →
   PostgreSQL → Caddy → Backend path must be rerun successfully on one SHA.
3. **受保护对象存储上的物理 WAL/PITR 演练未形成 RPO/RTO 证据。** The target
   remains RPO <= 15 minutes and RTO <= 60 minutes in a protected S3/Object
   Lock environment.

### P1 controlled-pilot gaps / P1 试点缺口

1. **真实设备与真机验收未完成。** nRF52840, Shelly Plus Plug S Gen2, Android
   location permission, BLE behavior, LAN/mobile-network switching, and
   reinstall/upgrade scenarios need a recorded acceptance matrix.
2. **正式 Android 发布包未完成。** Only a Debug APK exists. Release signing,
   keystore custody, versioning, upgrade/rollback, and distribution evidence
   are required before issuing an end-user package.
3. **天气备用供应商未投入使用。** Open-Meteo is the active source. QWeather
   / geocoding fallback needs contract, quota, privacy, key-management, and
   availability review before activation.
4. **External observability validation is incomplete.** Internal
   Prometheus/Alertmanager assets exist, but live alert routing, dashboard
   operation, retention, and incident response need pilot evidence.

### Deferred by approved scope / 已按审批范围延后

- R1.1: incident lifecycle, profile-aware health score, command templates,
  QR claim.
- R2: Redis realtime bus/distributed locking, mTLS, k6 scale tests,
  ZAP/Trivy/Gitleaks gates, work orders, reports, and map overview.

These are deliberately not claimed as delivered and must not be pulled forward
without the relevant Gate approval.

## 7. 建议的下一步 / Recommended next steps

1. Rerun the current Docker runtime and security workflows; record image scan
   evidence for the rebuilt monitoring images.
2. Close upstream image risks by a supported image upgrade or an approved,
   documented VEX/risk decision—never by suppressing a finding.
3. Execute the protected S3/Object Lock WAL/PITR drill and record RPO/RTO.
4. Complete the physical device + Android acceptance matrix.
5. Produce and validate a production-signed Android release package, then
   submit Gate 2/Gate 3 evidence.

## 8. 相关文档 / Related documents

- [Release verification](VERIFICATION.md)
- [Runtime image security status](IMAGE-SECURITY-STATUS.md)
- [Security baseline evidence](SECURITY-BASELINE-EVIDENCE-2026-09-01.md)
- [R1 completion implementation status](R1-COMPLETION-IMPLEMENTATION-STATUS.md)
- [P0 Docker full-chain plan](P0-DOCKER-FULL-CHAIN-DEVELOPMENT-PLAN.md)
- [Project approval review](PROJECT-APPROVAL-REVIEW.md)
