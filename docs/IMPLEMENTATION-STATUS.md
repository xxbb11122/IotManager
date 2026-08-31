# IoT Manager 实施状态（非审批文件）

> **归档说明（2026-08-21 快照）：** 本文件保留早期实施记录，不再作为当前
> R1 收尾状态或 Gate 证据的依据。请使用
> [R1-COMPLETION-IMPLEMENTATION-STATUS.md](R1-COMPLETION-IMPLEMENTATION-STATUS.md)
> 获取当前实现、最新测试计数和明确的外部阻塞项。
>
> **2026-08-30 对账：** 下文保留的是历史快照，不能引用其中的 Docker、Testcontainers、
> 测试计数或 Gate 结论。当前审计请使用
> [R1 收尾实施状态](R1-COMPLETION-IMPLEMENTATION-STATUS.md)、
> [运行镜像安全状态](IMAGE-SECURITY-STATUS.md) 和
> [严格项目审计](PROJECT-AUDIT-2026-08-30.md)。

**状态：** R0→R1 代码与部署资产已完成本地验证；尚未申请 Gate 2，不能视为生产发布授权。<br>
**日期：** 2026-08-21<br>
**权威基线：** [PROJECT-APPROVAL-REVIEW.md](PROJECT-APPROVAL-REVIEW.md) v1.3 > [PROJECT-IMPROVEMENT-PLAN.md](PROJECT-IMPROVEMENT-PLAN.md) v1.6 > [FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md](FEATURE-EXPANSION-EVALUATION-AND-ROADMAP.md) v1.3

> 本文只记录已落地代码、可重复验证和外部阻塞项；不改变 R1/R2 范围、Gate 或发布授权。R1.1 的事件闭环、健康分、命令模板、二维码，以及 R2 的 Redis、mTLS、工单和报表仍未获得提前实施授权。

## 已落地的代码与资产

- **身份与授权：** Spring Security JWT Resource Server、组织/站点/空间服务端隔离、角色映射、`/api/v1/**` 契约和旧 `/api/**` 弃用标记；浏览器监控端、企业控制台和 Android 客户端均使用 Authorization Code + PKCE。
- **Token 与实时连接：** Web 仅使用 `sessionStorage` 会话级令牌；Android 使用 Keystore 加密存储；REST 自动尝试一次刷新；WebSocket 通过 `Sec-WebSocket-Protocol: iot-bearer.<token>` 传递令牌，不再把 bearer token 放进 URL。
- **最小多站点：** 三端均加载授权站点；监控端与控制台切换后重建站点范围的 WebSocket、清理/刷新旧视图，控制台设备、统计、命令、告警、审计、分组与天气请求均带所选 `siteCode`。
- **生产边界：** `prod` Profile 强制 HTTPS/WSS、受限 CORS、关闭 H2 与模拟器；Caddy/Keycloak/PostgreSQL 16/非 root 后端镜像/每日逻辑备份 Compose 资产已提供。Keycloak 数据库密码以 `KCRAW_DB_PASSWORD` 注入，避免高熵密码中的 `$` 被表达式解析。
- **Agent 与命令：** 独立 Agent 凭据仅保存 BCrypt 摘要，支持签发、轮换、撤销与审计；Edge WSS 按 Agent/站点绑定校验；命令继续保留幂等、过期、串行、读回确认与 `UNCONFIRMED`。
- **可观测性：** 受限 Actuator 健康探针与 Prometheus 指标、结构化日志、`X-Request-Id`/`X-Trace-Id`、单实例 API 限流、命令/天气/WebSocket 指标已实现。部署后的 Prometheus 抓取与告警规则仍需现场验证。
- **天气可靠性与隐私：** 60 秒手动刷新冷却与 `429 + Retry-After`、缓存降级、刷新结果/耗时、供应商调用目的/结果/耗时审计、HMAC 坐标指纹、原始响应坐标脱敏和 30 天后坐标粗化均已实现；V18 会清理旧的原始载荷和明文坐标指纹。
- **迁移：** Flyway V1–V18 连续且不复用；V16 为多站点授权查询索引，V17 为天气刷新可观测字段，V18 为天气隐私与供应商调用审计。
- **持续验证（已替换）：** `.github/workflows/ci.yml` 是唯一基础 CI，包含 Java、
  Web/客户端、Android、部署与供应链检查；`.github/workflows/runtime-e2e.yml`
  负责完整 Compose 验证，物理 WAL/PITR 则由受保护的 `recovery-drill.yml` 执行。

## 当前验证证据

以下命令在 2026-08-21 本地执行成功：

| 模块 | 命令 | 结果 |
| --- | --- | --- |
| Backend | `mvn --batch-mode --no-transfer-progress clean verify`（JDK 17） | 111 tests，0 failures，0 errors，1 skipped；未生成 Surefire 强制终止转储 |
| Backend 重点 | 授权、PKCE 配套、API 限流/`Retry-After`、V1–V18、天气隐私、Agent WSS | 通过 |
| PostgreSQL smoke | Testcontainers 用例 | 已编写；Docker Engine 未运行时按前置条件跳过 |
| Edge Agent | `mvn --batch-mode --no-transfer-progress clean verify`（JDK 17） | 7 tests，0 failures，0 errors |
| Client | `npm test` | 84 tests，0 failures |
| Client E2E | `npm run test:e2e` | 1 Playwright 场景通过 |
| Client | `npm run build` | 通过 |
| Android debug APK | `scripts/verify.ps1 -Android -SkipBackend -SkipWeb -SkipDeploy`（JDK 23 / API 36） | 通过；`app-debug.apk` SHA-256 `1CA5D9718E0CB972C4868C9D8D1AE37083719D555C73F7BB5D4AD7AB26E85A51` |
| Monitoring frontend | `npm run build` | 通过 |
| Operations console | `npm run build` | 通过 |
| Deployment | `docker compose --env-file .env.example config --quiet` | 通过 |

监控端和控制台目前没有独立的单元/E2E 测试脚本，已通过生产构建；真实浏览器 PKCE、多站点切换和 WebSocket 握手仍须在已启动的 Keycloak/Compose 环境中执行验收。

## 仍需外部条件或 Gate 证据

- Docker Desktop/Engine 未运行，尚未实际启动 PostgreSQL、Keycloak、Caddy 和 backend 容器，也未运行 Testcontainers PostgreSQL 用例。
- 需要受保护的真实域名、Keycloak 初始 OWNER subject 和生产 Secret，才能完成浏览器/Android PKCE、令牌刷新/注销、CORS/WSS 与多站点授权的端到端验证。
- 备份脚本和恢复流程已提供，但尚未在独立 PostgreSQL 实例演练；外部加密不可变副本、WAL 归档及 RPO ≤15 分钟/RTO ≤60 分钟证据仍缺失。
- nRF52840 与 Shelly Plus Plug S Gen2 的低压负载真实设备验收、手机定位/BLE/网络切换/覆盖安装的 R1 最小矩阵尚未执行。
- QWeather 备用源和 Geo API 仍受合同、配额、隐私与密钥审查约束；未获准前系统只能使用 Open-Meteo + 缓存降级。
- Redis、mTLS、k6、ZAP、Trivy、Gitleaks、R2 规模和 R1.1/R2 功能包均保持未完成，且不应绕过 Gate 提前宣称上线。

## 建议的下一步（按审批顺序）

1. 启动 Docker Engine，在隔离环境执行 Compose、Keycloak Realm 导入、PKCE 登录、`/api/v1/sites`、安全 WebSocket 和 PostgreSQL Testcontainers 冒烟。
2. 对独立 PostgreSQL 实例完成备份恢复演练，记录校验和、迁移版本、恢复时长、应用就绪与读写冒烟证据。
3. 完成真实 nRF52840/Shelly 和 Android R1 最小真机矩阵，再准备 Gate 2/Gate 3 证据包。
4. Gate 批准后，才排期 Redis、mTLS、性能/安全扫描和 R1.1/R2 功能。
