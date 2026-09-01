# 运行镜像安全状态 / Runtime Image Security Status

**版本：** 1.1
**日期：** 2026-09-01
**状态：** 已完成 CI 复验；**不构成 Gate 2 批准或生产发布授权。**

本文件是 [P0 Docker 全链路开发方案](P0-DOCKER-FULL-CHAIN-DEVELOPMENT-PLAN.md) 和
[R1 收尾实施状态](R1-COMPLETION-IMPLEMENTATION-STATUS.md) 的安全补充。它刻意记录
未关闭风险，避免把“镜像已更新、服务能启动”误写成“镜像已达到发布门槛”。

## 审计方法与范围

- 使用 Docker Scout `v1.18.1` 扫描 Compose 当前运行的本地镜像，仅统计 HIGH / CRITICAL；
- 扫描**没有**使用 `--ignore-unfixed`、`--ignore-base` 或漏洞抑制文件；
- 镜像版本均已固定为 tag + digest，或由固定源码提交构建；
- GitHub Actions 的 `security-baseline` 现会阻断性扫描所有部署运行时镜像：Backend、Caddy、
  Keycloak、PostgreSQL/WAL-G、逻辑备份、volume initializer、Prometheus 和 Alertmanager；
- Scout 原始 SARIF 是本机临时审计证据，不提交含环境路径的报告。发布证据必须由同一 Git SHA
  上的 CI 重新生成并保留。

## 2026-08-30 本地结果

| 运行组件 | 当前版本/构建 | HIGH | CRITICAL | 审计结论 |
| --- | --- | ---: | ---: | --- |
| Backend | `iot-manager-backend:local` | 0 | 0 | 本地镜像通过。 |
| Caddy | 固定 Caddy `v2.11.4` 源码提交、distroless 运行时 | 6 | 0 | Scanner 将源码构建的 PURL 识别为 `2.0.0-…+dirty`；二进制实际报告 `2.11.4`。这是元数据误报候选，仍需可验证的 VEX/工具链修正后才能作为 Gate 例外。 |
| PostgreSQL/WAL-G | PostgreSQL 16 Bookworm + WAL-G `v3.0.7` 固定源码提交 | 6 | 2 | 7 项来自 Bookworm 基础包且当前无上游 fixed version；另 1 项将源码构建的 WAL-G 识别为伪版本，实际 `wal-g --version` 为 `v3.0.7`。未关闭。 |
| Keycloak | 官方 Keycloak `26.7.2` | 10 | 1 | 10 项来自官方 RHEL 9 基础包且显示 `not fixed`；另 1 项将实际文件 `mssql-jdbc-13.2.1.jre11.jar` 识别成缺失后缀的 PURL。**不得删除该 JAR**：Keycloak Quarkus 增量构建元数据会因此失效。未关闭。 |
| Prometheus | `v3.14.0` 固定 digest | 2 | 0 | 1 项为源码版本元数据，另 1 项为 `golang.org/x/crypto@0.54.0`；需等待或重建含上游修复的版本。未关闭。 |
| Alertmanager | `v0.33.1` 固定 digest | 12 | 8 | 官方镜像内 Go 标准库、`x/crypto`、`x/net`、`x/mod`、gRPC 的上游依赖风险。未关闭。 |
| 逻辑备份 | `postgres:16-bookworm` 固定 digest | — | — | 与 PostgreSQL Bookworm 基础包风险同源；已加入 CI 扫描，需以 CI 结果作为正式计数。 |
| 初始化器 | `alpine:3.20` 固定 digest | — | — | 已加入 CI 扫描，需以 CI 结果作为正式计数。 |

## 已完成的可操作整改

1. Backend 已升级到 Spring Boot `3.5.16`，Byte Buddy `1.17.8`，并将 Backend / Edge Agent
   Jackson 对齐到 `2.21.4`。
2. Caddy 使用固定 `v2.11.4` 源码、更新的 Go 依赖和 distroless 非 root 运行时；配置与真实
   HTTPS/WSS 运行态已验证。
3. PostgreSQL/WAL-G 仅保留已部署的 filesystem / S3 适配器，WAL-G 由固定 `v3.0.7` 源码构建，
   并移除了在固定非 root 模式下不需要的 `gosu`。
4. Keycloak 已升级到官方 `26.7.2`，并通过实际 PKCE、四角色、两站点及 WSS 回归；曾验证过移除
   SQL Server 驱动会导致 Keycloak 启动失败，因此该“裁剪”被明确撤销。
5. Prometheus / Alertmanager 已升级到当前选定的 `v3.14.0` / `v0.33.1`，其配置、私有抓取和
   目标健康状态已在运行态验证。

## 2026-09-01 CI 复验

最新提交 `b8628c5` 的严格 CI 证据见
[security-baseline](https://github.com/xxbb11122/IotManager/actions/runs/33472836972/job/99745915660)
和 [Docker Runtime E2E](https://github.com/xxbb11122/IotManager/actions/runs/33472837038/job/99745915759)。

- Caddy 采用官方自定义构建模式：一个独立的微型 main module 导入固定的 Caddy `v2.11.4` 源码，
  同时保留 `x/crypto@0.55.0` 等已审查依赖更新。二进制 build information 现在能准确声明 Caddy
  版本，Trivy 的 Caddy HIGH / CRITICAL 为 `0 / 0`。
- SBOM 目录已在生成前创建，CycloneDX 制品已经上传；秘密扫描、Maven/npm 清单扫描、Backend 与
  initializer 镜像扫描均通过。
- Runtime E2E 完整通过，包括真正浏览器 PKCE、四角色、WSS、数据库重启 fail-closed、逻辑备份恢复
  与篡改校验和副本拒绝。备份恢复只在独立 Compose 项目中执行。
- Keycloak、PostgreSQL/WAL-G、逻辑备份、Prometheus、Alertmanager 仍存在未关闭的实际扫描结果，
  因此聚合安全门禁继续失败。它们必须通过上游修复或已批准的精确风险接受关闭，不能以 Caddy 的
  元数据修复为由降低扫描标准。

## Gate 2 前必须完成的决策

以下任一做法都需要负责人审批和同一 SHA 的 CI 证据；本仓库不会自行把未修复 HIGH/CRITICAL
漏洞静默排除：

1. 上游发布修复后升级并重扫；
2. 在不改变 Keycloak、备份和恢复行为的前提下，更换到受支持且已修复的基础镜像，并重做全量
   Runtime E2E / 恢复演练；
3. 对确证为版本元数据误报的条目，附上可审计的 VEX（含镜像 digest、CVE、理由、到期日、批准人），
   然后在 CI 中仅对该精确条目应用例外；
4. 对无 fixed version 的真实基础镜像漏洞，获得正式风险接受或继续阻断发布。

在上述事项关闭前，`security-baseline` 的阻断性镜像扫描应保持失败语义；这比生成一份看似绿色、
实际忽略风险的 CI 报告更符合本项目的审批基线。
