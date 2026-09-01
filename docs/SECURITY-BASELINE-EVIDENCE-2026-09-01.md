# 安全基线证据（2026-09-01）

**状态：未通过发布门禁；扫描工具链、SBOM 制品及 Docker Runtime E2E 均已完成可复现验证。**

本文记录提交 `3d785dfbbb90063cc1836c978e7b584b01c9d5d7` 的 GitHub Actions
`Verify release baseline` 运行证据。对应的
[security-baseline 作业](https://github.com/xxbb11122/IotManager/actions/runs/33470465453/job/99739013934)
使用一次安装、固定版本的 Trivy `v0.70.0` 完成实际扫描；它替代了已退役的
Trivy `v0.65.0` 下载资产。扫描器、漏洞数据库和所有扫描步骤均真实执行，未使用
`ignore-unfixed`、`.trivyignore` 或降级严重等级。

最新复验提交为 `b8628c5`，对应
[security-baseline 作业](https://github.com/xxbb11122/IotManager/actions/runs/33472836972/job/99745915660)
与 [Docker Runtime E2E](https://github.com/xxbb11122/IotManager/actions/runs/33472837038/job/99745915759)。
该复验保留 fail-closed 门禁：所有镜像均被实际扫描，未使用宽泛忽略规则。

## 已通过

| 范围 | 结果 |
| --- | --- |
| Git 历史秘密扫描 | 通过，无泄漏 |
| Maven / npm 依赖清单 | 通过，HIGH / CRITICAL 为 0 |
| Backend 容器镜像 | 通过 |
| Alpine secret-volume initializer | 通过 |
| Docker Compose 配置构建 | 通过 |
| Java、Web、Android 严格回归 | 通过 |

## 初始扫描阻断项（历史记录）

| 组件 | 实际扫描结果 | 处理决定 |
| --- | --- | --- |
| CycloneDX SBOM | 输出目录不存在，生成失败 | 后续同日复验已关闭：生成目录已预创建且制品上传成功。 |
| Caddy 自构建镜像 | `usr/bin/caddy` 6 HIGH；构建信息被识别为未标记源代码 pseudo-version，固定版本栏包含 `2.11.4` | 后续同日复验已关闭：改为可被 SBOM 正确识别的发布模块构建，未提交 VEX 或忽略规则。 |
| Keycloak 26.7.2 | RHEL OpenJDK `CVE-2026-22020` HIGH，暂无 fixed version；另有 SQL Server JDBC 版本规范化候选项 | 保持阻断。先核验最新版官方 Keycloak 基础镜像；JDBC 项在证实误报前不移除也不例外。 |
| PostgreSQL 16 Bookworm + WAL-G | Debian 基础包 52 项（37 HIGH / 15 CRITICAL，无 fixed version）；WAL-G 另有 1 HIGH 的 pseudo-version 识别项 | 保持阻断。必须选择仍受支持且可修复的 PostgreSQL 基础镜像，并重做备份、恢复和权限演练。 |
| 逻辑备份镜像 | 同一 PostgreSQL 基础包 52 项，另有 `gosu` 22 项（21 HIGH / 1 CRITICAL） | 保持阻断。逻辑备份镜像与数据库基镜像必须一并更换/硬化，不能只在主数据库镜像删除 `gosu`。 |
| Prometheus 3.14.0 | `prometheus` / `promtool` 均为 `golang.org/x/crypto@0.54.0`，`CVE-2026-56854` CRITICAL，已存在 `0.55.0` 修复 | 升级到含修复依赖的官方、digest 固定版本后重扫。 |
| Alertmanager 0.33.1 | `alertmanager` 22 项（21 HIGH / 1 CRITICAL），`amtool` 24 项（23 HIGH / 1 CRITICAL）；多项已有上游固定版本 | 升级到含修复依赖的官方、digest 固定版本后重扫。 |

## 2026-09-01 最新复验证据

| 范围 | 同一 SHA 的结果 | 结论 |
| --- | --- | --- |
| SBOM | CycloneDX 已成功生成并上传 | 已关闭“输出目录缺失”缺陷。 |
| Caddy | 固定源提交与已补丁 Go 依赖不变；二进制现在内嵌 `github.com/caddyserver/caddy/v2 v2.11.4` 构建元数据，Trivy HIGH / CRITICAL 为 0 | 已关闭源码 pseudo-version 误识别项，未使用 VEX 或忽略规则。 |
| Runtime E2E | 非 root、PKCE、JWT API、四角色 RBAC、浏览器 WSS/边缘凭据 WSS、数据库重启 fail-closed、独立逻辑恢复、篡改备份拒绝、制品脱敏均通过 | 已关闭 JDBC 回滚连接关闭和恢复副本权限两项运行态缺陷。 |
| Keycloak、PostgreSQL/WAL-G、逻辑备份、Prometheus、Alertmanager | 仍有真实 HIGH / CRITICAL 结果，`security-baseline` 聚合步骤失败 | 继续阻断发布；不得将这次 Caddy 修复等同于安全门禁全绿。 |

## 发布判定

当前仓库的功能回归和部署配置验证通过，但**不能**据此宣称“达到生产发布标准”。
`security-baseline` 会继续 fail-closed：任一镜像扫描、SBOM 生成/上传、秘密扫描或依赖
扫描失败都将阻断发布。

PostgreSQL 暂停期间 JDBC 回滚缺少 SQLState 时会穿透定时任务防护器的问题，已由
`ScheduledDatabaseTaskGuard` 的受限连接关闭识别规则和单元测试修复，并在最新完整 Runtime E2E
中通过数据库重启 fail-closed 验证。逻辑恢复与篡改备份拒绝也在独立 Compose 项目中通过。

下一轮整改顺序固定为：

1. 对 Prometheus、Alertmanager、Keycloak 和 PostgreSQL 基础镜像做官方发布版本 + digest
   升级评估；
2. 对每一项升级执行完整 Docker Runtime E2E、PostgreSQL 恢复演练与新的同 SHA 安全扫描；
3. 仅对被证实为元数据误识别的单条 CVE 提交含镜像 digest、理由、到期日和审批人的 VEX；
   不能使用宽泛忽略规则；
4. 所有 HIGH / CRITICAL 清零或取得正式风险接受前，Gate 2 / 生产发布维持不批准。
