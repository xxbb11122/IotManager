# R1 收尾开发实施状态 / Implementation Status

**版本：** 1.2
**日期：** 2026-08-30
**对应计划：** [R1-COMPLETION-DEVELOPMENT-PLAN.md](R1-COMPLETION-DEVELOPMENT-PLAN.md)
**结论：** 已完成 P0 运行态缺陷修复并取得本地 Docker 证据；仍不等同于 Gate 2 或 Gate 3 已签发。

## 1. 范围与边界

本次实施严格保持单组织、多站点、单主机 Docker Compose 的 R1 试点范围。未引入
Redis、多 Backend 实例、mTLS、MQTT/Modbus、工单、报表、二维码认领或多租户功能。

下列事项需要真实环境、受保护资源或人工设备，已保留为验收项而不是伪报“完成”：

- 已推送正式 SHA 上的 GitHub Actions Runtime E2E；
- 受保护 S3/Object Lock 存储上的物理 WAL/PITR 演练；
- 正式域名与 ACME；
- Android 真机、nRF52840、Shelly Plus Plug S Gen2 的最小矩阵；
- QWeather 的供应商、配额和隐私审查。

## 2. 已实施工作

| 工作包 | 已完成实现 | 自动化证据入口 |
| --- | --- | --- |
| S0 工具链与迁移 | Maven Wrapper、JDK 17/21/Node 22 固定文件；Windows Wrapper 不再依赖 PATH 中的 `powershell`，严格验证使用稳定的用户级 Wrapper 缓存；Surefire XML 汇总改用 DOM `LocalName`，避免把 `testsuite` 的 `name` 属性误判为节点名；新增 H2 专用 V19 编号守卫，下一条共享/生产迁移保留为 V20 | `MigrationVersionAllocationTest`、`mvnw.cmd`、`scripts/verify.*` |
| S1 CI 与供应链 | 单一 `ci.yml`、删除旧 `verify.yml`、严格失败/错误/跳过统计、Gitleaks、Trivy、CycloneDX SBOM；后端与 Edge Agent Jackson 统一升级至 `2.21.4`；所有外部构建/运行基础镜像采用固定 tag + digest；所有 Compose 运行镜像均已纳入阻断性扫描；前端、控制台和移动端 E2E 均纳入；新增公开 Vite 构建变量凭据门禁；`main`、`master` 和 `codex/**` 均触发验证 | `.github/workflows/ci.yml`、`scripts/verify-public-build-env.js`、`deploy/Dockerfile`、[IMAGE-SECURITY-STATUS.md](IMAGE-SECURITY-STATUS.md) |
| S2 身份与会话 | Keycloak OWNER/ADMIN/OPERATOR/VIEWER 幂等引导；两站点成员隔离；修复 Chromium 原生 `fetch` 绑定导致的 OIDC 发现失败；移除浏览器全局/构建期 Token 注入；真实 PKCE、授权码重放、刷新 Token 重放、注销后 Refresh 拒绝及浏览器 WSS 子协议协商测试 | `shared/browser-oidc.js`、`client/e2e/runtime-auth.spec.js`、`runtime-e2e.yml` |
| S2 数据与恢复 | PostgreSQL 应用 DDL 拒绝、逻辑独立恢复；备份校验侧车文件成为必需项，恢复前强制 SHA-256 验证，CI 覆盖篡改备份拒绝；受控重启和断库 readiness 验证已纳入 Runtime CI；受保护物理恢复从固定基线备份恢复，显式验证后续 WAL 段、RPO≤15min、RTO≤60min | `recovery-drill.*`、`verify-resilience.*`、`wal-recovery-drill.sh`、`recovery-drill.yml` |
| S2 网络 | Caddy 仅暴露 80/443，HTTPS/WSS、严格 CORS、安全头、1MB API 体限制，H2 和 Actuator 公网 404；Caddy、PostgreSQL 与逻辑备份均以非 root 身份运行，Runtime CI 验证 Caddy 仅保留绑定 80/443 所需能力，备份服务为只读根文件系统和零能力集 | `verify-stack.*`、`Caddyfile*`、`runtime-e2e.yml` |
| S3 多站点与天气 | 可选第二站点引导；OWNER 可见两站点，集成 ADMIN/OPERATOR/VIEWER 仅主站点；现有 Open-Meteo 缓存、位置隐私、风险等级、下拉刷新保持站点隔离 | 后端安全测试、三端 Playwright、移动端单元测试 |
| S3 可观测性 | 私有 Prometheus/Alertmanager profile；Docker Secret 抓取令牌；无 Keycloak 指标角色；运行态验证公网 404、私有 scrape 和目标 `up` | `deploy/observability/`、`verify-stack.*` |
| S4 Android | Release 签名只能来自受保护运行时输入，版本号可覆盖，Debug 和 Release 网络边界分离；`android:sync` 与 CI 都会在 Capacitor 同步后、Gradle 打包前强制扫描实际 APK Web 资源中的公开构建凭据 | `client/test/android-release-config.test.js`、`client/package.json`、`scripts/verify-public-build-env.js`、Android CI job |

## 3. 运行与验收命令

本机 Docker Engine 可用时：

```powershell
.\scripts\runtime\start-integration.ps1 -Observability -Verify
```

```bash
IOT_ENABLE_OBSERVABILITY=true bash scripts/runtime/start-integration.sh --verify
```

受控 PostgreSQL 韧性演练会短暂重启并暂停指定的集成项目，必须显式确认：

```powershell
.\scripts\runtime\verify-resilience.ps1 -ProjectName iot-manager-p0 -Confirm RESILIENCE
```

```bash
IOT_RESILIENCE_CONFIRM=RESILIENCE \
IOT_COMPOSE_PROJECT=iot-manager-p0 \
bash scripts/runtime/verify-resilience.sh
```

受保护的物理恢复演练仅允许审批后的 S3 环境执行：

```bash
IOT_PITR_CONFIRM=PITR \
IOT_ENVIRONMENT_FILE=/secure/iot-manager/.env \
IOT_COMPOSE_PROJECT=iot-manager \
bash scripts/runtime/wal-recovery-drill.sh
```

不要对生产或未知 Compose 项目执行 `down -v`。物理演练只能销毁其工作流自己创建的
`iot-manager-gate2-pitr-*` 恢复项目。

## 4. 2026-08-30 本机验证记录

| 范围 | 结果 | 说明 |
| --- | --- | --- |
| Backend `mvn test` (JDK 17) | 121 tests，0 failures，0 errors，0 skipped | 包含浏览器 WSS 静态子协议、PostgreSQL/Flyway 兼容性及 production readiness 数据库依赖守卫。 |
| Client unit tests | 86 tests，0 failures/errors/skipped | 已通过。 |
| Client mobile Playwright | 1/1 | 已通过。 |
| Frontend Playwright | 1/1 | 已通过。 |
| Console Playwright | 1/1 | 已通过。 |
| 三个 Vite 构建 | 全部成功 | 已通过。 |
| 三端生产依赖审计 | 0 vulnerabilities | `frontend`、`console`、`client` 均以 npmjs 官方审计端点运行 `npm audit --omit=dev --audit-level=high`。 |
| Gitleaks 仓库扫描 | 通过 | 扫描 27 个提交，未发现 Secret 泄漏；同一推送 SHA 的 CI 仍须留存正式证据。 |
| 运行镜像安全审计 | **Gate 未关闭** | Docker Scout 已对当前本地镜像执行 HIGH/CRITICAL 审计：Backend 为 0，其他镜像存在上游无 fixed version 或源码版本元数据风险。CI 已改为扫描全部 Compose 运行镜像，且不使用 `ignore-unfixed`；精确计数、误报候选和审批动作见 [IMAGE-SECURITY-STATUS.md](IMAGE-SECURITY-STATUS.md)。 |
| 公开 Vite 构建变量门禁 | 通过 | 已禁止 `VITE_*` Token、Secret、Password、Private Key 或 API Key；发布链路只能由 OIDC 运行时会话提供凭据，开发期的内存端点覆盖不会持久化。 |
| Android 同步资源扫描与 Debug APK | 通过 | 已在 JDK 21、Node 22、Android API 36 / Build Tools 36.0.0 下执行 `npx cap sync android`、公开资源凭据扫描和 `assembleDebug`；CI 仍负责同一 SHA 的正式构建产物。 |
| Compose 静态配置 | application + observability + recovery override 均通过 | 确认恢复服务仅拥有一次性 `CAP_CHOWN`，其余能力均被删除。 |
| Docker Runtime 边界检查 | 通过 | `verify-stack.ps1 -Observability` 生成了本地红脱敏证据；Caddy、Keycloak、PostgreSQL、Backend、Prometheus/Alertmanager 均健康。 |
| Docker 非 root 运行态 | 通过 | 隔离 Compose 验证 PostgreSQL/备份 UID 为 999，Caddy UID 为 65534；Caddy 仅有 `NET_BIND_SERVICE` 并通过 HTTPS 200，备份服务为只读根文件系统、零能力集且生成 `.dump/.sha256`；Runtime CI 已加入同等断言。 |
| Docker PKCE / RBAC / WSS | 5/5 | OWNER 登录/API/浏览器 WSS，VIEWER 只读，四角色两站点边界，令牌重放/登出失效，边缘凭据轮换与吊销均通过。CI 环境仍使用已安装的本地 CA；Windows 本地绕过仅由显式测试变量开启。 |
| Docker PostgreSQL 韧性 | PowerShell + Git Bash 均通过 | PostgreSQL/Backend 重启前后迁移、角色、设备、命令快照一致；暂停 PostgreSQL 时 Backend readiness 返回 HTTP 503，恢复后两端均恢复 healthy。 |
| 独立逻辑恢复 | 通过 | 在 `iot-manager-p0-recovery-audit-ccebf16c` 完成最近备份恢复，验证 18 条 PostgreSQL 迁移、关键表、四角色数据与应用账号临时读写事务。 |
| 篡改备份负向验证 | 通过（退出码 65） | SHA-256 不匹配时在调用 `pg_restore` 前被拒绝。 |
| 物理 PITR / 受保护 S3 | 未执行 | 当前本机不具备受保护 Object Lock 桶、凭据、网络隔离 runner 与人工审批；不得以逻辑恢复替代该证据。 |

## 5. Gate 状态

- **Gate 2：未签发。** 本地运行态、逻辑恢复和后端测试已补齐；仍缺正式推送 SHA 的 CI Runtime 结果、受保护物理 WAL/PITR 报告、全部运行镜像 HIGH/CRITICAL 风险关闭或经批准的精确 VEX、供应链工作流结果和审批签字。
- **Gate 3：未签发。** 还需要两站点三端真实环境、天气可靠性报告、Prometheus 告警验收、签名 Release 覆盖安装、真机与真实设备矩阵、域名/ACME 和签字。

后续执行应以该计划的 Gate 清单为准，不能因仓库代码完成而提前宣称生产可用。
