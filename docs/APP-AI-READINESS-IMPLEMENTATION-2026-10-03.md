# App AI 功能完善与验收记录

日期：2026-10-03。交付对象为现有 `client/`，延续最新启动动画与底栏动效。版本为 **1.1.4 / versionCode 6**。

## 1. 完成内容

| 改动 | 解决的问题 |
| --- | --- |
| 登录配置引导 | 受保护 API 返回 401 时，未配置登录服务的 App 直接提示补齐登录配置，避免卡在空的站点选择页面。 |
| 两种连接模式均支持登录 | 现场 LAN 和互联网远程都显示 Issuer、客户端 ID、回调地址；填写部分字段时要求补齐。开发环境允许三项均为空。 |
| 连接测试区分登录前后 | 收到 401 后验证 OIDC Discovery 的实际 Issuer；显示“需要登录”，不把尚未取得授权的 API 或 WebSocket 标为通过。原生请求不响应 AbortSignal 时，测试仍有明确超时。 |
| 检查连接 | 重新读取服务器身份、站点权限、AI 开关与能力。同一核验身份下保留会话、草稿和 Retry-After 冷却时间；身份改变或 401 / 403 时清理旧内容。 |
| 联网恢复 | AI 页面处理 online / offline 事件。联网后重新核验配置并通过 GET 查询原请求；运行中的 Chat POST 保留其结果处理权。进入后台暂停自动恢复。 |
| 示例问题 | 点击示例只填入输入框，明确点击“发送”后才请求服务器。 |
| App 网页入口 | Caddy 增加 `/app/`，部署现有 App 的网页构建；配置公开 OIDC 元数据和登录、退出回调。 |
| 启动与构建 | 启动 watchdog 移至独立脚本，适配 Caddy 的 `script-src 'self'`；Android 与网页分别使用 `/` 和 `/app/` 资源路径。Docker 构建上下文排除密钥目录、环境文件和签名文件。 |

现有聊天、历史、性格版本管理、请求幂等及恢复继续使用项目 API。供应商密钥保留在服务器，App 不直接调用 DeepSeek。知识库保持关闭，Embedding 使用 `none`。

## 2. 当前服务与使用入口

本机 Docker Engine、Backend、Keycloak、PostgreSQL、Caddy 和备份容器已恢复健康。当前远程 Chat 配置已启用，使用兼容协议适配器及 `deepseek-flash`。仅 Caddy 发布 80 / 443，宿主机的 8080 并未发布 Backend。

在这台 Windows 电脑打开：**[App 网页入口](https://iot-manager.localhost/app/)**。使用已有 IoT Manager 账号登录，选择已授权站点，再进入底栏 **AI**。该地址使用项目的 Caddy 集成 CA；CA 校验、域名校验及登录权限仍然有效。

| 本机网页配置 | 值 |
| --- | --- |
| API | `https://iot-manager.localhost/api/v1` |
| WebSocket | `wss://iot-manager.localhost/ws/devices` |
| Issuer | `https://iot-manager.localhost/auth/realms/iot-manager` |
| 公开客户端 | `iot-web` |
| 登录及退出回调 | `https://iot-manager.localhost/app/` |

网页构建已配置这些公开信息，登录使用既有 Authorization Code / PKCE 流程。Keycloak 配置已对账并验证幂等，未启用密码授权。

### Android 安装与连接

安装包：[iot-manager-client-1.1.4-debug.apk](../artifacts/release/app-ai-ready-20261003/iot-manager-client-1.1.4-debug.apk)。这是与原调试证书一致的 Debug 包，`adb install -r` 已成功覆盖安装到测试模拟器。

手机接入时，在“连接设置”填写手机实际能访问的、证书受信任的 HTTPS 地址：

| Android 配置 | 值 |
| --- | --- |
| API | `https://<手机可访问域名>/api/v1` |
| WebSocket | `wss://<手机可访问域名>/ws/devices` |
| Issuer | `https://<手机可访问域名>/auth/realms/iot-manager` |
| 公开客户端 | `iot-mobile` |
| 回调 | `com.iot.manager.client://oauth/callback` |

保存、登录、选择授权站点，再点击 AI 中的“检查连接”。手机上的 `localhost` 指向手机自身，不能直接使用上述电脑入口。当前 `client/.env.local` 仍是此前的 LAN HTTP 配置且未配置 OIDC；本轮未用未经验证的手机地址覆盖它。新版安装包需要通过连接设置指定正式端点。

## 3. 本轮实际验证

| 检查 | 结果与边界 |
| --- | --- |
| Client Node | **230 / 230**，0 失败、0 跳过。新增登录配置缺失、重检保留、身份切换清理、停机恢复、联网恢复、运行中 POST 保护及限流冷却回归。 |
| 浏览器 | **13 / 13**：8 个 AI 工作区用例、1 个连接及移动页面用例、3 个启动用例、1 个底栏动效用例。使用隔离模拟接口。 |
| Android 构建 | `npm run android:debug` 成功；SDK 36、Build Tools 36.0.0、JDK 23。 |
| 已安装 APK | **13 / 13**：原生 HTTP、草稿重检、示例不自动提交、历史、4000 字符性格、软键盘与返回键、恢复元数据、后台暂停、进程重启 GET 恢复、旋转、安全区及 Browser 打开/返回。使用隔离模拟服务。 |
| APK 身份 | 包名、版本、签名及已安装 APK 的 SHA-256 与交付文件一致；已扫描 12 个打包网页资源，未发现实际 Chat 密钥。结果见[交付清单](../artifacts/release/app-ai-ready-20261003/manifest.json)。 |
| Docker / TLS | 运行边界 smoke 通过；App HTML、脚本、样式、版本与 OIDC Discovery 已通过校验证书的只读检查，未登录 `/api/v1/me` 仍返回 401。 |
| Keycloak | 新增 App 回调后对账成功，两次执行结果一致。 |
| 真实供应商连通 | **1 次**通用 Chat 请求，HTTP 200，回答非空；108 tokens，0 Embedding 请求，未发送站点数据、未输出密钥或回答正文。 |

供应商连通检查直接访问远程兼容接口，**不能作为新 App → 登录 → Backend → DeepSeek 全链路已通过的证明**。本轮未修改后端业务或迁移，也未重跑上一轮的 189 项后端测试；那些结果属于此前验收记录。

### 自检中发现并闭环的问题

1. 连接页面的 LAN 模式缺少登录字段：已补齐并通过浏览器验证。
2. 浏览器工作流原先没有模拟 `/me`，新增身份核验使其出现 500：补齐隔离模拟接口，未忽略运行错误。
3. 原生测试在请求登记前读取恢复记录：改为等待模拟服务器登记该请求后核对元数据。
4. 模拟器重启联网时 AI 停留在离线状态：增加网络事件处理，修复后 13 项原生验证全部通过。
5. 强制重检会清除客户端冷却时间：同一核验身份下保留 Retry-After，并增加回归。

## 4. 证据与复验

本轮原始日志位于 `artifacts/app-ai-readiness-20261002/`，最终安装包、清单及验收副本位于 `artifacts/release/app-ai-ready-20261003/`。目录开始日期早于本报告；以交付清单与实际文件哈希为准。原始截图与安装包保留在本机，不代表已发布 CI 产物。

```powershell
# 在 client/ 执行：
npm test
npx playwright test e2e/ai-workspace.spec.js e2e/mobile-client.spec.js e2e/startup-animation.spec.js e2e/bottom-navigation-motion.spec.js --workers=1
npm run android:debug

# 在仓库根目录执行，要求 Docker 已启动：
.\scripts\runtime\verify-stack.ps1 -TimeoutSeconds 60
.\scripts\runtime\reconcile-keycloak-realm.ps1 -VerifyIdempotence

# 使用 verify-stack 导出的公有 CA；不修改系统信任：
$env:IOT_APP_CA_FILE='artifacts/release/app-ai-ready-20261003/verification/caddy-integration-root.crt'
node scripts/runtime/verify-app-entry.mjs
```

`verify-ai-provider.mjs` 只在显式设置 `IOT_LIVE_AI_ACCEPTANCE=true` 后执行一次付费请求，输出脱敏统计，供更换供应商后检查连通。本轮已通过，重复执行会再次计费。

## 5. 剩余验收边界

目前没有手机可访问的正式 HTTPS 端点及测试真机。完整原生 OIDC 登录、证书信任、冷/热启动深链竞争，以及新 APK 经项目服务器调用真实 DeepSeek，仍需在该端点和真机上验收。模拟器 Browser 打开/返回用例没有进行真实身份认证。

正式 Android 发布还需要既有受保护发布签名；当前交付为 Debug 验证包。更换 AI 供应商继续修改服务器地址、模型、允许主机及受保护密钥，App 协议保持独立。知识库另待远程 Embedding 供应商确定后开发与启用。
