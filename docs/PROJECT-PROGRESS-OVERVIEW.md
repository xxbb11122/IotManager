# IoT Manager 项目进度介绍 / Project Progress Overview

> **当前状态入口：** 本文已在 2026-08-30 与当前实现对齐；详细的 R1 实施、Gate
> 阻塞项和证据入口以
> [R1-COMPLETION-IMPLEMENTATION-STATUS.md](R1-COMPLETION-IMPLEMENTATION-STATUS.md)
> 与 [IMAGE-SECURITY-STATUS.md](IMAGE-SECURITY-STATUS.md) 为准。

**更新日期：** 2026-08-30<br>
**当前定位：** 面向现场局域网与云端设备的物联网运维平台，当前处于“可运行 MVP + R1 受控试点代码基础”阶段。<br>
**发布结论：** 可用于本地开发、内部演示和受控联调；尚不是已审批的生产发布版本。

> 本文用于项目介绍和进度汇报。发布授权、验收 Gate 和范围优先级以
> [项目审批意见](PROJECT-APPROVAL-REVIEW.md) 为准；已实现代码与验证证据以
> [R1 收尾实施状态](R1-COMPLETION-IMPLEMENTATION-STATUS.md) 为准。

## 1. 项目简介

IoT Manager 将设备接入、设备能力建模、命令下发与确认、遥测/告警、实时动态、站点天气和运维权限统一到一个平台中。它面向现场运维人员、监控人员和管理员，提供三类操作界面：

- **Android/PDA 客户端：** 适合现场巡检、BLE 设备操作、站点切换、天气查看和下拉刷新；
- **监控大屏：** 展示设备状态、实时动态、告警、遥测和站点环境；
- **运维控制台：** 用于设备、Profile、分组、命令、Agent 和站点范围的运营管理。

```mermaid
flowchart LR
    M[Android / PDA 客户端]
    W[监控大屏]
    C[运维控制台]
    P[Spring Boot 平台]
    E[Edge Agent]
    D["现场设备：nRF52840 / Shelly"]
    T["Open-Meteo：天气与预报"]
    DB[(开发 H2 / 生产 PostgreSQL)]

    M --> P
    W --> P
    C --> P
    P <--> E
    E <--> D
    P <--> T
    P <--> DB
```

## 2. 当前已完成内容

| 范围 | 当前进度 | 已交付能力 |
| --- | --- | --- |
| 设备运维基础 | 已完成并本地验证 | 设备发现、认领、分组、归档、活动记录、遥测、告警与实时更新 |
| 设备命令 | 已完成并本地验证 | Profile 能力模型、幂等命令、过期控制、读回确认、`UNCONFIRMED` 状态、批量命令与审计 |
| 三端界面 | 已完成并本地验证 | Android/PDA、监控大屏、运维控制台；三端均支持授权站点上下文 |
| 天气系统 | 已完成并真实接口验证 | Open-Meteo 实时天气、海拔、温湿度、气压、24 小时/7 天预报、环境红黄绿判定、缓存降级与下拉刷新 |
| 刷新体验 | 已完成并本地验证 | 页面刷新节流、60 秒天气手动刷新冷却、`429 + Retry-After`、保留最后可用天气结果 |
| 身份与权限 | 代码/资产已完成 | JWT Resource Server、RBAC、组织/站点/空间隔离、三端 Authorization Code + PKCE、Android Keystore 令牌保存 |
| 多站点 | 已完成并本地验证 | 授权站点列表、站点切换、按站点隔离的 API、缓存和 WebSocket 上下文 |
| Edge Agent | 已完成并自动化验证 | Agent 独立凭据、凭据签发/轮换/撤销、WSS 绑定校验、Shelly Plus Plug S Gen2 与 nRF52840 接入边界 |
| 可观测性 | 代码/资产已完成 | Actuator 健康探针、Prometheus 指标、结构化日志、请求关联 ID、天气/命令/WebSocket 指标与 API 限流 |
| 数据与部署 | 资产已完成 | Flyway V1–V18、PostgreSQL 16、Keycloak、Caddy、非 root 后端镜像、每日逻辑备份脚本和 Compose 编排 |
| CI 验证 | 工作流已配置 | Java 服务、Web/客户端、Android APK、部署镜像四类 GitHub Actions 作业 |

## 3. 关键技术亮点

- **真实天气而非模拟数据：** 后端请求 Open-Meteo，并将天气作为站点环境数据处理；温度、湿度、气压、ESD 与结露风险由服务端统一判定为绿色适宜、黄色观察或红色风险。
- **适合现场网络的连接设计：** PDA 可在“现场 LAN”和“互联网远程”配置之间切换；在保存前会先探测 API 与 WebSocket，避免保存不可用地址。
- **安全实时通信：** 生产模式下 REST 使用 JWT，WebSocket 使用受限的 `Sec-WebSocket-Protocol` bearer 子协议，不在 URL 中暴露令牌。
- **多站点隔离：** 页面切换站点后会重建实时连接并刷新站点数据；后端同时执行组织、站点和空间范围校验。
- **可追溯命令：** 命令具备幂等键、执行状态、结果记录与审计信息，避免网络重试导致重复控制。
- **隐私保护：** 手机定位仅在用户主动操作后获取；天气原始响应会脱敏坐标，持久化指纹采用 HMAC，并按策略进行历史数据粗化。

## 4. 已验证质量快照

验证快照日期为 **2026-08-30**。本地结果如下：

| 模块 | 验证结果 |
| --- | --- |
| Backend（JDK 17） | 121 项测试，0 失败、0 错误、0 跳过；PostgreSQL 16 Testcontainers 冒烟真实运行 |
| Edge Agent（JDK 17） | 7 项测试全部通过 |
| Android/PDA Web 客户端 | 86 项单元测试全部通过；1 项 Playwright 场景通过 |
| Android | JDK 21、Node 22、API 36 / Build Tools 36.0.0 下完成 Capacitor 同步、公开资源凭据扫描与 Debug APK 构建 |
| 监控大屏与控制台 | 各 1 项 Playwright 场景和生产构建通过 |
| 真实后端冒烟 | 健康检查、站点 API、天气刷新、预报、旧 API 弃用头、刷新限流与 WebSocket 联调通过 |
| Docker 全链路 | TLS/OIDC/401/403/CORS/WSS、四角色两站点、逻辑备份独立恢复、篡改备份拒绝和断库 fail-closed 验证通过 |
| 部署静态检查 | 严格验证脚本、Compose 变量展开和 Caddy 配置通过 |
| 运行镜像安全 | Backend 镜像无 HIGH/CRITICAL；其余运行镜像仍有上游无 fixed version 或版本元数据风险，尚未通过 Gate 2 |

最新 Debug APK 由 Android 构建生成在本地 `client/android/app/build/outputs/apk/debug/app-debug.apk`；该构建产物不纳入 Git，且仅用于内部测试，尚未使用生产签名。

## 5. 当前阶段与边界

### 可以对外说明的状态

- 项目核心业务、三端界面、天气系统、多站点、身份授权和部署资产均已落地；
- 本地自动化、Android 打包及真实天气/后端联调已有验证证据；
- 当前可支持受控网络中的开发、演示和内部安装测试。

### 暂不能对外声明为“生产已上线”的原因

- 本地 Compose、PostgreSQL Testcontainers、Keycloak/Caddy、PKCE/WSS 和逻辑独立恢复已验证；仍缺同一 Git SHA 的干净 CI Runtime Artifact；
- 受保护 S3/Object Lock 上的物理 WAL/PITR、RPO≤15 分钟 / RTO≤60 分钟证据尚未形成；
- 运行镜像仍有未关闭的 HIGH/CRITICAL 上游或元数据发现，未获得批准的 VEX / 风险接受前不能通过 Gate 2；
- nRF52840、Shelly 和真实 Android 手机的定位、BLE、网络切换、覆盖安装测试尚未完成；
- 生产域名、Keycloak OWNER 身份、密钥与天气备用源/逆地理供应商审查尚未完成；
- R1.1 的事件闭环、健康分、命令模板、二维码，以及 R2 的 Redis、mTLS、工单和报表，均未获得提前实施/发布授权。

## 6. 已识别风险与改进项

| 优先级 | 项目 | 说明 |
| --- | --- | --- |
| P0 | 运行镜像漏洞闭环 | Backend 已清零，但 Keycloak、PostgreSQL/WAL-G、Prometheus、Alertmanager 与部分元数据发现仍需上游修复、支持的基础镜像替换或带审批的精确 VEX；详见 `IMAGE-SECURITY-STATUS.md`。 |
| P1 | 正式发布包 | 当前 APK 为 Debug 签名；发布前需要配置 Release 签名、覆盖安装和回滚验证。 |
| P1 | 本机 Java 环境 | 后端必须使用 JDK 17，Android 必须使用 JDK 21+；应清理系统中畸形的 Java 8 `PATH` 项。 |
| P2 | Android 编译警告 | Capacitor BLE 依赖仍会产生 Kotlin/Android API 废弃警告和 Gradle 9 兼容性提示；不阻断当前 Debug 构建，但应在依赖升级时复查。 |
| P2 | 前端业务自动化覆盖 | 三端已有启动级 Playwright 覆盖；设备批控、天气异常与告警确认等关键业务路径仍应扩展场景。 |

## 7. 下一阶段计划

按照当前审批基线，下一步不应先扩展新功能，而应依次完成：

1. 关闭或获得批准的运行镜像 HIGH/CRITICAL 风险例外，并取得同一 Git SHA 的绿色供应链/Runtime CI 证据；
2. 在受保护 S3/Object Lock 环境完成物理 WAL/PITR 演练，形成 RPO/RTO 报告；
3. 以低压负载完成 nRF52840、Shelly 与 Android 真机最小验收矩阵；
4. 完成 Release 签名、覆盖安装、正式域名/ACME 与天气供应商审查后，提交 Gate 2 / Gate 3 所需证据；
5. 只有通过 R1 Gate 后，才按变更审批进入 R1.1 或 R2 的增强功能。

## 8. 相关文档

- [项目 README](../README.md)：项目功能、启动方式和客户端配置；
- [R1 收尾实施状态](R1-COMPLETION-IMPLEMENTATION-STATUS.md)：代码实现与可重复验证证据；
- [运行镜像安全状态](IMAGE-SECURITY-STATUS.md)：镜像审计、未关闭风险与审批动作；
- [严格项目审计](PROJECT-AUDIT-2026-08-30.md)：已证实能力与 Gate 阻断项；
- [验证说明](VERIFICATION.md)：本地、CI、Android 与部署校验命令；
- [项目审批意见](PROJECT-APPROVAL-REVIEW.md)：发布 Gate 与授权边界；
- [项目整改基线](PROJECT-IMPROVEMENT-PLAN.md)：R0/R1/R2 技术整改计划；
- [天气功能开发说明](weather-feature-development.md)：天气 API、隐私、状态规则与验收要求。
