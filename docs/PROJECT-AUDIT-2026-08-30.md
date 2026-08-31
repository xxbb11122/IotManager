# 项目严格审计报告 / Strict Project Audit

**审计日期：** 2026-08-30
**审计结论：** **有条件通过本地受控试点代码基线；不通过生产发布 / Gate 2。**
**权威范围：** [项目审批意见](PROJECT-APPROVAL-REVIEW.md) >
[项目整改基线](PROJECT-IMPROVEMENT-PLAN.md) >
[P0 Docker 全链路方案](P0-DOCKER-FULL-CHAIN-DEVELOPMENT-PLAN.md)。

本报告不以“代码存在”或“容器 running”判定完成。每一项仅在当前工作树、真实运行结果或
可复现脚本能直接证明时标记为通过。

## 审计矩阵

| 审计项 | 要求 | 当前证据 | 结论 |
| --- | --- | --- | --- |
| 工具链与严格回归 | JDK 17、Node 22、无失败/错误/跳过 | `scripts/verify.ps1 -Strict` 与 `scripts/verify.sh --strict`：Backend 123、Edge Agent 7、Client 86，三端 Playwright 与三套 Vite 构建均通过；PostgreSQL Testcontainers 已真实运行 | **通过** |
| Android 可构建性 | JDK 21、API 36、公开资源无凭据 | `scripts/verify.ps1 -Strict -Android -SkipBackend -SkipWeb -SkipDeploy` 通过，已构建 Debug APK | **通过（Debug）** |
| HTTPS/OIDC/RBAC/WSS | Caddy → Keycloak → Backend，PKCE、四角色、两站点和边缘凭据边界 | `verify-stack.ps1 -Observability` 通过；`client/e2e/runtime-auth.spec.js` 5/5 通过 | **通过（本地集成）** |
| 数据库权限与韧性 | App 无 DDL；数据库中断时 fail-closed；重启不丢数据 | `verify-resilience.ps1 -Confirm RESILIENCE` 通过，readiness 在 PostgreSQL 暂停时为 HTTP 503 | **通过（本地集成）** |
| 逻辑备份恢复 | SHA-256 校验、独立实例恢复、读写烟测、篡改拒绝 | `recovery-drill.ps1` 成功；篡改备份在 `pg_restore` 前被拒绝 | **通过（逻辑恢复）** |
| 物理 WAL/PITR | 受保护 Object Lock 仓、后续 WAL 重放、RPO≤15 分钟 / RTO≤60 分钟 | 脚本已实现，但本地 filesystem integration store 不能代替受保护 S3 演练 | **未通过 / 外部 Gate** |
| 可观测性 | 私有抓取、目标健康、无公网指标暴露 | `verify-stack.ps1 -Observability` 验证了私有 scrape、Prometheus target `up` 与公网 404 | **通过（本地集成）** |
| 告警交付 | 接收器、路由和通知的真实验收 | Alertmanager 已健康，但没有受批准通知接收器的端到端演练 | **未通过 / Gate 3** |
| 运行镜像安全 | 所有运行镜像 HIGH/CRITICAL 关闭，或有批准的精确例外 | Backend 为 0；其余镜像存在未关闭上游或版本元数据风险，CI 已阻断性覆盖 | **未通过 / Gate 2** |
| 供应链证据 | 同一 Git SHA 的绿色 GitHub Actions、SBOM、Secret/依赖/镜像扫描产物 | 工作流已配置，本地未生成对应推送 SHA 的 GitHub Artifact | **未通过 / 外部 Gate** |
| 真实天气与位置 | 真机定位授权、真实网络条件和天气可靠性矩阵 | 服务端 Open-Meteo、缓存、隐私和客户端逻辑已测；真机/供应商审查未完成 | **未通过 / Gate 3** |
| 真实设备 | Android、nRF52840、Shelly 低压负载矩阵 | 模拟/协议与 Edge WSS 已测，物理设备尚未验收 | **未通过 / Gate 3** |
| 生产发布 | 正式域名、ACME、Release 签名、覆盖安装/回滚 | 仅本地 Caddy CA 与 Debug APK | **未通过 / Gate 3** |

## 本轮发现并已修复的问题

1. Maven Wrapper 在某些 Windows IDE / 自动化终端中假设 `powershell` 位于 `PATH`；现已改为
   调用系统 PowerShell 路径。
2. PowerShell 验证器读取 Surefire XML 时，将 `<testsuite name="…">` 的属性误当作节点名；现已
   使用 DOM `LocalName`，使真实失败/跳过统计可靠。
3. 验证器现在为 Maven Wrapper 使用稳定的用户级缓存，避免中断的全局 `.m2` Wrapper 缓存让测试
   在执行前失败。
4. Docker 重启后已重新验证完整运行栈，而不是复用重启前结果。
5. CI 的镜像扫描现在覆盖所有 Compose 运行镜像，而不仅是自构建的四个镜像。
6. Keycloak 的 SQL Server JDBC JAR 曾被尝试裁剪；运行验证证明这会破坏 Quarkus 增量构建元数据，
   已撤销该不兼容改动并保留为安全审计风险，不以删文件伪造“零漏洞”。
7. 受保护 WAL 恢复工作流原本会在 Secret 扫描失败后仍因 `always()` 尝试上传 Artifact；现已为扫描步骤
   设定稳定 ID，并仅在该步骤成功时上传恢复证据，阻断失败路径的证据泄露。
8. 所有 GitHub Actions checkout 步骤现统一设置 `persist-credentials: false`；这些工作流不需要写回仓库，
   因此不会在后续步骤保留 `GITHUB_TOKEN` 凭据。
9. `Trivy` Action 原引用遗漏官方 `v` 前缀，会导致 GitHub Actions 无法解析该 Action；现所有 Action
   均固定到已核验的 40 位 commit SHA，并保留原版本注释，消除可变标签与失效标签风险。
10. 供应链工作流现采用“全量采集、末尾统一阻断”：Gitleaks、依赖、构建、所有运行镜像和 SBOM 即使某项
    先失败仍会执行并保留证据，最终聚合步骤会对任一非成功结果 fail-closed。
11. Bash 验证器曾在 Windows Git Bash 中把 Caddy 容器路径错误转换为宿主路径；现仅转换挂载源路径并关闭
    MSYS 对容器路径的重写，完整 Git Bash `--strict` 基线已实际通过。
12. 物理 PITR 演练现先捕获写入恢复标记后的当前 WAL 段，再强制切换并验证该段可取回；证明不再依赖
    `pg_switch_wal()` 边界 LSN 到文件名的隐式映射。

## 2026-08-31 补充审计（本地受控运行态）

以下补充证据不改变本报告的 Gate 2 结论；它们仅关闭已验证的本地 P0 缺陷，不能替代同一
Git SHA 的 GitHub Actions、受保护对象存储或审批签字。

1. 逻辑备份曾因恢复演练 schema 由 owner 账户拥有、而 backup 使用应用 DML 账户运行，导致
   `pg_dump` 在锁表时失败。现 backup 仅挂载 owner Secret 并以 `iot_manager_owner` 运行；应用
   Secret 不进入 backup 容器。最新 owner-only dump 已在独立 Compose 项目恢复，并验证 SHA-256、
   Flyway 最新版本、关键角色、业务表 DML 权限和篡改拒绝。
2. 备份/WAL-G 健康状态不再只看历史文件或启动时 ready 文件。逻辑备份、WAL-G 远端探测、WAL spool
   积压和 base backup 都由成功时间 marker 与最大年龄约束；本地已验证新鲜 marker 通过、过期 marker
   失败。
3. Docker/数据库依赖恢复曾可能超出 `on-failure:5` 的启动预算。Backend、backup 与 WAL-G sidecar
   已改为 `unless-stopped`，Backend 采用有界 Flyway 连接重试，readiness 始终 fail-closed。PowerShell
   和 Git Bash 的受控演练均已验证 PostgreSQL 503、冷依赖启动后自动恢复和无未处理 scheduler error。
4. 物理 PITR 已从上传后采样 wall-clock `recovery_target_time` 改为同一已归档 WAL 内的命名 restore
   point，避免源库静默时目标时间无法到达。该脚本仍明确拒绝 filesystem integration repository；受保护
   S3/Object Lock 演练仍是 Gate 2 外部阻断项。
5. Windows Git Bash 曾将 `/bin/sh`、`/scripts`、`/restore` 和 Keycloak 容器内可执行路径改写为宿主机
   路径，造成恢复或初始化以退出码 127 失败；现已明确区分 Docker host 路径与容器路径，并仅在
   MINGW/MSYS 下禁用后者的参数改写。Caddy 本地 CA 的 Schannel 吊销查询也只在 Windows 下关闭，
   不跳过 CA 链或主机名校验。Git Bash `start-integration.sh --verify`、`verify-stack.sh`、Keycloak
   幂等引导和独立逻辑恢复均已实际通过。

## Gate 2 阻断项（必须关闭）

1. 对 [运行镜像安全状态](IMAGE-SECURITY-STATUS.md) 中每项 HIGH/CRITICAL：升级/替换受支持基础
   镜像，或取得带 digest、CVE、理由、到期日和批准人的精确 VEX / 风险接受。
2. 将当前提交推送到 GitHub，并取得同一 SHA 的 `ci.yml`、`runtime-e2e.yml` 和供应链 Artifact 全绿。
3. 在受保护 S3 / Object Lock 环境运行 `wal-recovery-drill.sh`，保留 RPO/RTO、WAL 重放和读写验证报告。
4. 由审批责任人签发 Gate 2；在此之前不得将本地 Docker 结果描述为生产可用。

## Gate 3 阻断项（必须关闭）

1. 正式域名与 ACME TLS；
2. 受批准的天气备用源 / Geo 供应商、配额、密钥和隐私审查；
3. Android Release 签名、覆盖安装与回滚；
4. nRF52840、Shelly Plus Plug S Gen2 和 Android 真机的最小受控矩阵；
5. Prometheus 告警至真实批准接收器的演练与现场两站点验收。

## 审计后的发布定位

该项目现在适合本地开发、内部演示和受控试点联调。它拥有可验证的 Docker 全链路、身份边界、
数据库 fail-closed、逻辑恢复和 Android Debug 构建能力；但由于运行镜像风险、受保护 PITR、
干净 CI Artifact、真实设备与生产发布证据尚未关闭，**不能标记为生产发布完成**。
