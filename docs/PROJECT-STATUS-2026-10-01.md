# IoT Manager 当前项目说明与公开版自检 / Project status and disclosure audit

> 更新日期：2026-10-01（Asia/Shanghai）
> 定位：单组织多站点 IoT 运维平台，R1 受控试点候选；**不是正式生产发布批准书**。
> 范围：本次 GitHub 说明、已提交的应用/服务端/部署源码，以及本地可复现验证。历史文档只作背景，发布 Gate 以当次提交的工作流和签字证据为准。

## 1. 产品定位与边界

平台以“站点—设备—能力—命令—遥测/告警—审计”为主线，支持 Android/PDA、监控页、运维控制台和站点 Edge Agent。当前运行基线为单主机 Docker Compose；Keycloak 负责 OIDC，Caddy 提供 TLS/WSS，PostgreSQL 16 持久化业务数据。它并非多租户 SaaS、高可用集群，也不能仅凭本地绿色测试宣称正式上线。

| 模块 | 已落地代码 | 当前未关闭的验收边界 |
| --- | --- | --- |
| 设备与站点 | 多站点授权、发现/认领、Profile、分组、归档、单/批量命令、幂等与 ACK 审计 | 真实 Shelly/nRF52840、1000 设备负载及长期弱网仍需现场证据 |
| 实时与移动端 | 设备 WebSocket、Edge 出站 WSS、BLE 适配、缓存/重连、下拉刷新、局部重绘与减少动态效果 | 真机 GPS/BLE/网络切换、原生 OIDC 和实际闪屏观测仍需验收 |
| 天气环境 | Open-Meteo、位置、预报、温湿度/气压/海拔及环境风险分级 | 供应商配额、隐私、备用源与多地域真实位置验证仍待完成 |
| 身份与安全 | Keycloak OIDC/PKCE、JWT、站点角色授权、TLS/WSS、最小权限数据库角色、受保护 Secret 挂载 | 正式域名/证书、移动端完整登录、渗透及发布审批仍需执行 |
| AI Chat（可选） | [服务端接口](../backend/src/main/java/com/iot/manager/ai/AiController.java)、[移动端工作区](../client/src/js/ai/ai-controller.js)、历史/性格与幂等请求恢复；密钥保留在服务端 | 生产默认关闭；本轮未以新 APK 完成真机 HTTPS/OIDC 和真实供应商验收，不能当作生产功能 |
| 知识库/Embedding | V26/V27/V28 迁移与受控 API 代码已存在 | 功能默认关闭；尚无确定的 Embedding 供应商、真实索引、恢复及发布证据 |
| 运维与恢复 | Flyway、逻辑备份、WAL-G 工作流、Actuator/Prometheus/Alertmanager、CI 安全/SBOM 检查 | 远端受保护 PITR、RPO≤15 分钟/RTO≤60 分钟、签名回滚和 Release Integrity Gate 未签发 |

特别注意：PostgreSQL 的 [V27 向量迁移](../backend/src/main/resources/db/migration-postgresql/V27__add_site_ai_vectors.sql)并不随 AI 功能开关跳过；已有数据卷升级前仍需按[部署手册](../deploy/DEPLOYMENT.md)安装并核对 pgvector 0.8.6。关闭 AI 不能绕开迁移前置条件。

## 2. 2026-10-01 本地复测与证据边界

| 检查 | 本轮结果 | 边界 |
| --- | --- | --- |
| Backend Maven `verify` | 53 个 Surefire 套件、189 项测试，0 失败/错误/跳过 | JDK 17、本机 Docker 可用；并非目标生产主机验证 |
| Edge Agent Maven `verify` | 7 项测试，0 失败/错误/跳过 | 真实现场网关与设备仍待测试 |
| Client `npm run test` / `npm run build` | 194 项单测通过，Vite 生产构建及预览代码隔离检查通过 | Node.js 22，本地构建 |
| Console / Frontend | 分别 1 / 2 项测试通过，生产构建通过 | 浏览器真实身份及跨站点运行需部署环境 |
| Client Playwright 关键场景 | AI、导航动效、启动动画、移动端主流程共 11/11 通过 | 本地页面测试，不代替实体手机或供应商调用 |
| Android `npm run android:debug` | 1.1.1 / `versionCode=3` Debug APK 构建成功，Capacitor Browser 已同步 | JDK 23 + SDK 36；Debug 签名不是 Release 签名 |
| Compose `config --quiet` | 通过 | 只证明配置可展开，不证明容器运行态 |

同日较早的本地 Android 16 模拟器记录显示：已安装的 1.1.1 Debug APK 在隔离模拟服务上完成 11/11 项专项检查，包含软键盘、系统返回、后台暂停、进程重启恢复、底栏与旋转安全区。该记录使用模拟回复，**没有调用真实 DeepSeek，也未完成真机原生 OIDC**；本轮未重新执行该原生模拟。原始日志、模拟器截图、APK、密钥和数据库备份保留在本机忽略提交的目录，不作为 GitHub 仓库文件发布。

上一公开提交 `83e6bc7` 的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/36424040632) 与 [P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/runs/36424040548) 均成功；那是旧 SHA 的证据。本次新增 AI/Android 代码推送后，必须查看**新提交 SHA** 的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/workflows/ci.yml) 和 [P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/workflows/runtime-e2e.yml)，不能沿用上述结论。

### 首次推送后的安全扫描反馈

首次提交 `3cccd0a` 的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/36803981487) 在源码安全扫描处阻断：`jackson-databind 2.21.4` 被报告 3 项 HIGH（CVE-2026-68497、CVE-2026-91776、CVE-2026-91777）；其余 Java/Web/Android/Compose 构建任务成功。`quick-gate` 的失败是安全任务失败的连带结果。第一步将 Backend 的 Jackson BOM 升为同一维护分支的 [2.21.7](https://github.com/FasterXML/jackson/wiki/Jackson-Release-2.21)；[第二次扫描](https://github.com/xxbb11122/IotManager/actions/runs/36804771243) 明确把剩余 3 项定位到独立的 `edge-agent/pom.xml`，因此也将 Edge Agent 的直接版本统一到 2.21.7。必须再以新 SHA 扫描；没有关闭扫描或以未经批准的 VEX 绕过阻断。

`3eebf209` 的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/36805038678) 随后全部通过，包括源码安全、SBOM、Java、三端 Web、Android Debug、Compose 配置与 quick-gate。对应 [P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/runs/36805038653) 仍失败：新库启动时备份 sidecar 早于 Backend 的 Flyway 迁移读取 `flyway_schema_history`，反复重启，使非 root 运行态检查失败。本次修复将 Backend 就绪与首份逻辑备份健康设为有界启动前置条件；是否真正关闭该门禁，须以修复提交的新运行记录为准。

`b49773a` 的 [Quick CI](https://github.com/xxbb11122/IotManager/actions/runs/36818967163) 已全部通过；[P0 Docker Runtime](https://github.com/xxbb11122/IotManager/actions/runs/36818967120) 证明上述启动竞态已关闭，并推进到独立逻辑恢复步骤。该步又暴露管理员预装的 pgvector 扩展与受限恢复角色的权限冲突：`pg_restore --clean` 试图执行 `DROP/COMMENT EXTENSION vector`。本次追加仅对该扩展的 TOC 条目做定向排除，且恢复前必须确认目标库 pgvector 版本为 0.8.6；其他对象仍执行正常恢复。最终结果以新 SHA 的全链路运行态为准。

## 3. 公开说明审核 / README self-check

| 审核项 | 结论 |
| --- | --- |
| 定位 | README 将现状限定为 R1 受控试点候选，未把本地绿色测试等同 Gate 2/3 或生产批准。 |
| 功能覆盖 | 设备、Edge、三端、天气、身份、安全、AI、恢复、CI/供应链、固件、部署入口和仓库结构均有介绍；AI 与知识库分别标明默认关闭。 |
| 证据归属 | 本地复测、上一 SHA 的公开 CI、当次推送后的待验证工作流被明确区分；不以模拟器冒充真机。 |
| 安全与隐私 | 未在 README 写入服务器密钥、Token、数据库密码或私有部署地址；API 示例使用占位域名。 |
| 链接与可运行性 | README 相对链接、概览图和仓库内目标已核对；开发命令与本轮工具链、实际目录及配置一致。 |
| 交付边界 | Debug APK 与受保护 Release 签名分开说明；无 `LICENSE` 文件的事实公开标注；原始本机产物不纳入 Git。 |

## 4. 下一步优先级

1. 以本次推送 SHA 取得 Quick CI、Android 和 P0 Docker Runtime 结果，先修复任何失败检查；不能只看旧 SHA 全绿。
2. 在隔离环境复核旧 PostgreSQL 数据卷升级、V27/V28 迁移、AI 关闭时主业务可用、备份与回退；保留脱敏证据。
3. 建立手机可访问且证书受信任的 HTTPS API/WSS/OIDC 环境，完成真机安装、身份、GPS、BLE、网络切换、动效与长时间弱网矩阵。
4. AI 试点另行完成真实供应商、成本/隐私、故障注入与权限验收；知识库/Embedding 不随 Chat 自动开放。
5. 最后关闭受保护发布、镜像风险、签名回滚、远端 PITR/RPO/RTO 与容量门禁；未获得审批前维持“受控试点候选”状态。

主要操作入口：[README](../README.md) · [部署手册](../deploy/DEPLOYMENT.md) · [验证说明](VERIFICATION.md) · [发布运行手册](CI-RELEASE-RUNBOOK.md)。
