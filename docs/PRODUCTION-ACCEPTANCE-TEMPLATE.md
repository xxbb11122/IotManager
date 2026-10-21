# IoT Manager 发布验收单

复制本文件填写独立候选记录。初始状态 PENDING；空白、模拟结果、旧候选证据和无法读取的链接不得记 PASS。

## 候选身份

| 字段 | 内容 |
| --- | --- |
| candidate ID / 完整源码 SHA | PENDING |
| 不可变镜像清单与 evidence OCI digest | PENDING |
| Android applicationId / versionCode / versionName | PENDING |
| APK / AAB SHA256 | PENDING |
| APK 证书 SHA256 / 商店分发证书 SHA256（若适用） | PENDING |
| 构建工作流链接、身份清单 | PENDING |
| 验收执行时间 / 执行人 / 审批人 | PENDING |

## 验收结果

| 项目 | 通过标准和必填证据 | 状态 |
| --- | --- | --- |
| 严格 CI | 同 SHA，Java 两时区、四端浏览器/构建、安全、两个 Android 均通过；没有意外跳过 | PENDING |
| 仓库保护 | 只读 preflight PASS；默认分支 required quick-gate、独立审核、禁止 bypass/强推/删除 | PENDING |
| 正式签名 | SDK verify、可信证书/包名/版本号与嵌入源码身份一致，无 debug/明文网络 | PENDING |
| 实机基础 | 手机及真实 PDA 型号、Android/WebView 版本、最低配置、安装与冷/热启动原始记录 | PENDING |
| BLE | 权限拒绝/恢复、扫描、绑定、读写、命令确认、断连重连、重复操作；真实固件版本与设备标识脱敏 | PENDING |
| 身份与联网 | 真实受信任 HTTPS/LAN/OIDC/WSS；四角色越权拒绝、登出/撤销、跨组织/站点隔离 | PENDING |
| 离线恢复 | 断网、重连、旧缓存不串账号、命令状态不误报成功 | PENDING |
| App 升级回退 | 旧→新→兼容旧业务包→新，同 appId/证书、递增 code，绑定/历史/分区数据完整；原始旧 APK 不作为兼容包 | PENDING |
| Backend 回退 | N 写→N−1 读写→N 读，镜像不同、同数据库、迁移历史不变、时间字面值及 UTC 均正确 | PENDING |
| 可访问性 | 大字 200%、减少动态效果、对比度、横竖屏、前后台、读屏关键流程 | PENDING |
| 容量与长稳 | 批准的设备数/并发/时长/成功率与 p95/p99 阈值；资源曲线、错误与断线统计、清理结果 | PENDING |
| 固件 | 准确源码/工具链/板型、构建日志、产物哈希、刷写与真实设备回归 | PENDING |
| 恢复 | 专用隔离 runner、真实备份与 WAL/PITR 证明、篡改备份拒绝；RPO/RTO 数值与业务批准目标 | PENDING |
| 运维 | TLS/DNS/告警联系人、密钥托管轮换、保留策略、灰度比例与停止/回退条件 | PENDING |
| AI | 默认关闭时填写 OUT_OF_SCOPE 并记录部署开关；开启须补真实供应商质量/隐私/费用/超时验收 | PENDING |

## 管理员配置清单

默认分支至少要求 `quick-gate` 与独立 PR 审核、dismiss stale reviews、enforce admins，禁止 force push 与删除。需要业务上更高审批数时取更严格值。

`r1-recovery-drill`、`r1-rollback-drill`、`android-release` 环境：受保护分支、至少一名有效审核人、prevent self review、禁止管理员绕过。注册带 `self-hosted` / `linux` / `iot-manager-recovery` 标签的专用在线 runner，保持现有恢复脚本的隔离约束。

Android 保护环境配置以下 secret/variable；不要把私钥或密码填进此文档：

| 名称 | 类型/用途 |
| --- | --- |
| IOT_CLIENT_RELEASE_KEYSTORE_BASE64 / IOT_GLASS_RELEASE_KEYSTORE_BASE64 | secret，各 App 既有正式 keystore 的 Base64 |
| IOT_CLIENT_RELEASE_STORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD，Glass 对应 IOT_GLASS_RELEASE_* | secret，每个完整名称都含对应 App 前缀，详见发布运维手册 |
| RELEASE_GOVERNANCE_READ_TOKEN | 仅用于预检的只读 token；需读取 branch protection、environments、repository runners；默认 token 无权时必须提供 |
| ANDROID_CLIENT_CERT_SHA256 / ANDROID_GLASS_CERT_SHA256 | variable，每个 app 的可信构建签名证书指纹 |
| ANDROID_CLIENT_LAST_RELEASE_VERSION_CODE / ANDROID_GLASS_LAST_RELEASE_VERSION_CODE | variable，已分发最高版本；首次正式发布明确填 0，后续发布后及时更新 |

正式构建入口：[Verified Android Release Build](../.github/workflows/android-release.yml)。只在变更已审核合入受保护默认分支后，从默认分支手动执行。APK 本地分发证书与 Play App Signing 的商店分发证书可能不同，实机验收按实际渠道记录。

预检命令：`node scripts/ci/release-readiness-preflight.mjs --repository xxbb11122/IotManager --output artifacts/preflight.json`。它不改变仓库设置，PASS 仅代表配置检查通过。

最终结论：PENDING。所有适用 P0/P1 证据齐全且责任人批准后填写 GO；任何缺项保持 NO-GO 并列出责任人与下一步。
