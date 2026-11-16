# Glass App AI 接入与验收

后续版本 **glass.4 / code 8** 已提供手机局域网入口与新安装包，并修复登录身份与退出撤销，最新地址和验收范围见 [Android 手机接入记录](ANDROID-PHONE-CONNECTION-2026-10-03.md)。本文保留 glass.2 阶段的历史证据，下面的本机地址不是当前手机配置。

日期：2026-10-03。交付目录：`apps/client-glass-next/`。版本：**1.1.4-glass.2 / Android versionCode 6**，包名 `com.iot.manager.glassnext`。

## 使用入口

当前 Windows 电脑访问 **[Glass App](http://127.0.0.1:5190/)**，使用既有 IoT Manager 账号登录，选择已授权站点，点击底栏 **AI**，填写问题后点击“发送”。登录账号来自项目 Keycloak，Caddy CA 是证书颁发机构。

页面保留液态玻璃、轻毛玻璃、实色、减少动画、启动动画和水晶输入框。快捷提问仅填入草稿；历史可打开与删除自己的会话；性格保存、版本启用仅开放给组织所有者或管理员。已有会话沿用创建时的性格版本。

AI 由服务器调用远程 DeepSeek，当前 Chat 模型为 `deepseek-flash`，通过兼容协议适配器接入。知识库关闭，Embedding 为 `none`。供应商配置和密钥留在服务器，后续更换兼容服务无需把供应商密钥加入 App。

以上地址仅用于这台电脑。Android 手机需要另行配置手机可访问、证书受信任的 HTTPS 服务器地址。此前未提供真机与可访问域名，本次没有将本机浏览器回调写入 Android 安装包。

## 完成的整改

| 项目 | 实现 |
| --- | --- |
| AI 控制器 | 同步原客户端 1.1.4 的身份核验、登录配置引导、连接检查、断网及恢复逻辑。 |
| 草稿和会话 | 同一核验身份下检查连接保留草稿、消息和冷却时间；身份变化、401 / 403 清理旧内容。 |
| 请求恢复 | 后台暂停轮询；回到前台或进程重启后通过 GET 查询保存的请求，不重复提交 Chat POST。 |
| 连接设置 | LAN 与互联网模式均显示公开 OIDC 字段；部分填写必须补齐；401 后验证 Discovery，明确提示登录前尚未验证授权 API / 实时连接。 |
| 玻璃界面 | 保留现有玻璃层、水晶输入框与三个快捷提问的专用回调；增加登录和重新检查入口。 |
| 实际后端 | 开发代理从未发布的宿主机 8080 改为当前 Caddy HTTPS 入口；指定集成 CA 并校验证书和域名。 |
| 独立登录 | 当前 realm 登记 `iot-glass-next` public client，Authorization Code + S256；未启用 implicit、密码授权或 service account。 |
| 构建隔离 | 本机浏览器配置放在 `.env.development.local`，Android / 生产构建不加载它。版本名与 Android code 同步提升。 |

### 当前公开配置

| 配置 | 值 |
| --- | --- |
| Glass 浏览器入口 / 回调 | `http://127.0.0.1:5190/` |
| 开发代理目标 | `https://iot-manager.localhost` |
| 浏览器 API / WS | `/api/v1` / `ws://127.0.0.1:5190/ws/devices` |
| Issuer | `https://iot-manager.localhost/auth/realms/iot-manager` |
| Public client | `iot-glass-next` |
| Android 回调 | `com.iot.manager.glassnext://oauth/callback` |

开发代理转换 Origin 以访问项目同源后端，仍由后端验证 Bearer 身份与权限；仅绑定 loopback。CA 文件仅供该代理进程信任使用，未关闭 TLS 校验。7 个项目 Docker 容器健康，服务继续运行。

原版网页 [App 入口](https://iot-manager.localhost/app/) 同时可用。本次纠正其 Caddy 构建配置中的客户端名为 realm 已登记的 `iot-web`，重新构建并部署 Caddy，匿名 PKCE 请求已到达实际登录表单。

## 自检结果

| 检查 | 结果与边界 |
| --- | --- |
| Glass 单元测试 | **218 通过 / 0 失败**；包含身份变化、401、超时、联网恢复及请求幂等。 |
| 浏览器检查 | **13 项最终通过**：AI 8、玻璃主界面 4、移动端导航 1；在独立 5191 测试服务器运行，网络与硬件边界使用测试替身。 |
| Android 已安装 APK | **13 项通过**；键盘、系统 Back、历史、4000 字符性格、版本启用、旋转、安全区、后台停轮询、进程重启 GET 恢复及 Browser 插件均使用隔离模拟服务。总共 2 次模拟 Chat POST，无真实供应商调用。 |
| 生产构建 | Vite、开发预览排除、Capacitor 同步、公开环境检查及 Gradle Debug 构建均通过。 |
| APK 资源和签名 | 13 个最终 dist 文件与 APK 内资源摘要一致；实际服务器 Chat 密钥在内存中扫描，未发现嵌入资源；APK v2 签名通过。 |
| 部署入口 | Glass HTML、玻璃样式、HTTPS 后端代理可达；未登录 API 返回 401；Issuer、证书、域名、公开 client 与回调到登录表单均通过。没有提交账号密码。 |

初次浏览器运行有 1 项快捷提问测试失败：新测试未提供玻璃 UI 使用的 `aiQuickPrompt` 专用回调，补齐与实际主入口一致的回调后该项单独复测通过，其余 12 项已通过。保留原有生产回调。

原生测试工具增加首次安装 Preferences 的保存与恢复支持、截图缓冲容量、截图等待绘制完成，以及提前记录失败状态，避免诊断失败时误写通过结果。最终结论依据完成全部 13 项的已安装 APK 测试。

### 验证边界

本次没有执行真实账号的完整 PKCE 登录和 App 到项目后端再到 DeepSeek 的问答闭环，也没有使用真机。原生和浏览器功能测试使用模拟服务。此前直接向供应商发送的 1 次小额 Chat 连通检查记录在 [原版 App 验收](APP-AI-READINESS-IMPLEMENTATION-2026-10-03.md)，不能替代这里的完整登录与问答验收。本次真实 Chat / Embedding 调用为 0。

## 安装包与证据

安装包：[iot-manager-glass-1.1.4-glass.2-debug.apk](../artifacts/release/glass-ai-ready-20261003/iot-manager-glass-1.1.4-glass.2-debug.apk)。独立包名可与原 App 并存。这是 Debug 包，发布版仍需既有 Release 签名流程。

SHA-256：`BA8CC46338AD07DE0C06C9E51FB1CC2A19813549D8A8AD770180A5C618B9DAAF`。

证书 SHA-256：`55135dbb4ac115bc0db023544ccc184472f9023f51bf767161a0ca6ba11a6e0d`。

- [单元日志](../artifacts/glass-ai-ready-20261003/unit-tests.tap)
- [浏览器首次检查](../artifacts/glass-ai-ready-20261003/browser-tests.log)与[修正后复测](../artifacts/glass-ai-ready-20261003/browser-recheck.log)
- [原生检查结果](../artifacts/glass-ai-ready-20261003/android-native/native-ai-results.json)与[原生日志](../artifacts/glass-ai-ready-20261003/native-ai.log)
- [Android 构建](../artifacts/glass-ai-ready-20261003/android-build.log)、[资源摘要](../artifacts/glass-ai-ready-20261003/apk-assets.json)、[签名](../artifacts/glass-ai-ready-20261003/apk-signature.log)
- [实际 Glass 入口与登录表单检查](../artifacts/project-start-20261003/glass-entry.json)与[原版 App 入口检查](../artifacts/project-start-20261003/app-entry.json)
