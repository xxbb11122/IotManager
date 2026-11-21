# Android 局域网 AI 接入与验收

日期：2026-10-03。目标为当前 Windows Docker 环境与同一网络的 Android 手机。Glass 版本 **1.1.4-glass.4 / Android code 8**，包名 `com.iot.manager.glassnext`。

## 手机入口

先在手机浏览器打开 **[手机接入页](http://10.243.182.2/mobile/)**。页面提供公开 CA、安装包、连接参数与操作步骤。

1. 下载 `caddy-root-ca.cer`，在 Android 设置搜索“CA 证书”或“安装证书”，选择安装 CA 证书，按手机系统提示完成。
2. 重新打开浏览器。下载并安装 **[新版 Glass APK](https://10.243.182.2/mobile/iot-manager-glass-1.1.4-glass.4-debug.apk)**；已有 Glass App 时更新到这个版本。
3. 使用现有项目账号登录，选择已授权站点，进入底栏 **AI**，填写问题并发送。快捷提问只填入草稿。

也可使用 **[Glass 网页 App](https://10.243.182.2/glass/)**。以上地址仅适用于同一网络，电脑须保持开机且 Docker 运行。

当前使用 Caddy 内部 CA；手机浏览器与登录自定义标签页需要信任该 CA。[Caddy 官方 TLS 说明](https://caddyserver.com/docs/caddyfile/directives/tls)解释了内部 CA 的信任要求。APK Debug 资源内置当前公开 CA，保持 TLS 证书与主机校验；Release 沿用既有配置。[Android 网络安全配置](https://developer.android.com/privacy-and-security/security-config)说明了 Debug 信任锚与新版 Android 的用户 CA 行为。旧 APK 仅改地址不保证证书可用。

CA SHA-256：`67:D7:4A:26:F1:57:4F:FA:2B:CE:9C:84:4B:86:55:88:A2:53:58:A5:F9:7E:41:DB:26:73:C8:C3:EC:E4:64:C0`。应与下载证书一致。

## 完整公开配置

新版安装包已预填。已有连接配置时，更新 APK 后打开“连接设置”，选择“现场 LAN”，核对并测试、保存。

| 字段 | 值 |
| --- | --- |
| 手机网页 | `https://10.243.182.2/glass/` |
| REST API | `https://10.243.182.2/api/v1` |
| WebSocket | `wss://10.243.182.2/ws/devices` |
| OIDC Issuer URL | `https://10.243.182.2/auth/realms/iot-manager` |
| OIDC Client ID | `iot-glass-next` |
| Glass Android 回调 | `com.iot.manager.glassnext://oauth/callback` |
| Glass 网页回调 | `https://10.243.182.2/glass/` |

本表适用于 Glass App。原版 App 的包名、客户端及回调不同。`127.0.0.1`、`localhost` 和 `10.0.2.2` 均不能作为这部手机访问电脑的地址。未登录直接请求 `/api/v1/me` 返回 **401**，表示需登录。

Chat 由服务器通过 Spring AI 兼容适配器调用 DeepSeek，知识库与 Embedding 保持关闭。供应商密钥只在受保护的服务器目录，通过 Docker secret 提供给 Backend，不进入网页、安装包或公开下载目录。

## 当前环境的运行与恢复

在仓库根目录执行：

```powershell
.\scripts\runtime\start-phone-lan.ps1
```

脚本检查电脑仍持有 `10.243.182.2`，必要时启动现有 D 盘 Docker Desktop，再以当前已构建镜像恢复服务并等待健康状态，并通过专用脚本对账 Glass public client、PKCE 与默认身份 scope，验证重复执行结果一致。此脚本用于恢复已经配置的当前环境，首次安装须先完成常规两阶段部署与 realm 对账。

本环境叠加顺序如下，保留数据库和 CA 卷：

- 环境：`deploy/.env.integration` → `deploy/.runtime/iot-manager-p0/runtime.env` → `deploy/.runtime/iot-manager-p0/phone-lan.env`。
- Compose：`deploy/docker-compose.yml` → `deploy/docker-compose.integration.yml` → `deploy/docker-compose.phone-lan.yml`；项目名 `iot-manager-p0`，profile `application`。
- 网关：`deploy/Caddyfile.phone-lan`；`default_sni` 使未发送 SNI 的 IP 地址客户端取得对应证书。[Caddy 全局选项](https://caddyserver.com/docs/caddyfile/options#default-sni)。
- 公开静态目录：`deploy/.runtime/iot-manager-p0/phone-web`；只含网页构建、APK、连接参数及公开 CA。

电脑 IP 改变时，需同步 LAN 环境、服务器 Issuer、Keycloak 回调、Glass 构建公开配置和下载页面，再重新构建及验证。当前电脑的 `http://127.0.0.1:5190/` 开发端口仅供电脑使用。

## 本轮修复

1. **登录后 API 403**：Glass public client 缺少 Keycloak `basic` scope，导致 access token 缺少 `sub`。核对现有身份与数据库授权一致后，通过默认 client-scope assignment API 补齐 `basic` 等身份 scope；保留现有用户、角色与站点授权。Keycloak 的 [25.0 升级说明](https://github.com/keycloak/keycloak/blob/main/docs/documentation/upgrading/topics/changes/changes-25_0_0.adoc)说明了 `sub` 与 `basic` 的关系。`deploy/keycloak/reconcile-glass-client.sh` 已纳入当前 LAN 启动流程；重复对账验证通过。
2. **退出后刷新令牌仍可使用**：App 请求 `offline_access`，只执行 RP logout 不能撤销离线 refresh token。现在先清除本地会话，再调用 Discovery 的 revocation endpoint，最后执行 RP logout。两个新增单元测试覆盖本地即时失权、撤销失败报告；真实 Android/web 协议测试验证退出后刷新返回 400。[Keycloak OIDC endpoint 说明](https://www.keycloak.org/securing-apps/oidc-layers)。
3. **手机 HTTPS 与公开入口**：当前 Caddy 通过 LAN IP 提供 Glass、API、WSS 与登录服务；HTTP 接入页只提供 CA、步骤与公开下载参数。供应商密钥仍通过服务器 secret 提供。

## 已执行的验证

| 检查 | 结果与范围 |
| --- | --- |
| 网关与 Compose | LAN 覆盖配置、Caddy 验证、启动脚本与身份对账通过；本轮恢复后 7 个服务全部 healthy。 |
| HTTPS 公开入口 | 9 类检查通过：IP 与 CA 校验、静态资源/CSP、401、Android CORS、拒绝其他 Origin、私有端点 404、Discovery、5 个匿名 PKCE 表单及下载摘要。 |
| 新版 APK | Gradle Debug 构建与 v2 签名通过；14 个最终 dist 资源摘要一致；LAN 默认参数及内置 CA 匹配；未发现服务器 Chat 密钥嵌入。 |
| Android 安装 | 已安装到本任务模拟器，安装版本为 glass.4 / code 8，安装 APK 摘要与公开交付副本一致。 |
| 已安装 APK 模拟检查 | 当前安装包 13 项全部通过，退出时测试配置与端口恢复成功。覆盖移动导航、快捷草稿、原生 HTTP、连接复查、键盘/Back、历史、4000 字符性格与启用、后台停轮询、进程重启 GET 恢复、旋转/安全区，以及隔离登录页的 Browser 插件。仅 2 次模拟 Chat POST。 |
| 单元测试 | 当前版本 220 项通过，0 失败，包含退出撤销的两个新增用例。 |
| 本轮浏览器检查 | 2 项通过：移动导航/连接设置无溢出；水晶快捷提问需主动发送，检查连接保留草稿。独立测试服务器使用模拟网络。 |
| 真实认证与生成 | 13 项真实协议检查全部通过：Android/web PKCE、nonce、真实 token exchange、身份/站点、刷新、Android Origin 的授权 WSS、AI 状态/性格、1 次真实 Backend→DeepSeek 回答、历史与 GET 恢复、删除测试会话、退出后刷新拒绝。TLS 使用当前 CA 和 IP 主机名校验。 |
| 已安装 APK 真实流程 | 6 项全部通过：安装摘要与原生运行、内置 CA 下的 HTTPS Discovery、真实 PKCE 回调/安全存储/授权 API、界面显示真实 DeepSeek 回答、原生历史与测试会话删除、退出清除安全存储且刷新返回 400。另有登录/退出专项 4 项通过，未调用 Chat。 |
| 真机 | 尚未连接测试手机；实际手机网络、证书信任、系统浏览器回调、界面登录与问答待验收。 |

此前 **218 项单元 / 13 项浏览器检查**属于 glass.2 / code 6 基线，见 [历史 Glass AI 验收](GLASS-APP-AI-IMPLEMENTATION-2026-10-03.md)，不能算成本轮全部重复执行。

当前证据位于 `artifacts/phone-lan-20261003/`：`entry-check.json`、`apk-check.json`、`apk-signature.log`、`unit-tests.log`、`browser-check.log`、`android-native/native-ai-results.json`、`live-ai-check.json`、`android-live/native-live-results.json`、`android-session/native-live-results.json`、`test-cleanup.json` 与 `summary.json`。真实协议测试使用 App 的 `OidcSessionManager` 与 `ApiClient`，凭据与令牌只在进程内存中，不输出账号密码、令牌、站点内容或回答正文；它不能替代真机界面回调验收。

真实 APK 测试在本任务模拟器上运行实际安装包。仅外部 `Browser.open` 用测试边界记录 URL，登录表单通过校验当前 CA/IP 的 CLI 提交，再以 Android VIEW intent 交付真实 PKCE 回调；App 的 token exchange、安全存储、原生 HTTPS 与 AI 界面保持实际运行。测试先验证 Browser 边界替身生效，避免打开线上登录网页。模拟 Browser 插件测试只打开隔离页。**以上没有验证手机系统浏览器信任 CA，也没有验证实体手机。**

本轮累计 **6 次真实 Backend Chat POST**：协议测试 2 次（含修复退出前的 1 次），安装包测试 4 次（含修正测试工具空响应、登录按钮定位等问题前的 3 次）。最终真实 APK 流程为 1 次 Chat POST，显示非空回答，删除测试会话；只读盘点确认本轮 Android 验收会话剩余 0。Embedding 调用为 0。旧失败记录保留，不计入通过次数。

## 真机验收仍需完成

电脑当前只检测到本任务的 Android 模拟器，尚未检测到实体手机。请将手机通过 USB 连接电脑，开启 USB 调试并在手机上允许此电脑；电脑端可随后安装上述 APK、检查手机网络与继续实际验收。CA 安装按 Android 系统提示在手机上完成。

| 手机验收项 | 当前状态 |
| --- | --- |
| 手机打开 HTTP 接入页，下载文件 | 待真机；电脑校验为 HTTP 200。 |
| 安装 CA 后，系统浏览器打开 HTTPS 登录页 | 待真机。 |
| 安装 glass.4，已有项目账号登录并回到 App | 待真机；模拟器的真实回调/授权 API 通过。 |
| 授权站点 AI 生成、历史恢复与再次登录 | 待真机；模拟器的真实 AI 与退出流程通过。 |

电脑的 Glass 开发入口 `http://127.0.0.1:5190/` 已恢复。独立测试服务器与本任务模拟器在测试结束后停止，Docker 服务和手机入口继续运行。

## 安装包

稳定交付副本：[Glass Android Debug APK](../artifacts/release/glass-ai-phone-20261003/iot-manager-glass-1.1.4-glass.4-debug.apk)。

APK SHA-256：`E75535421D827EE9EE121230A624323292EF01D95DE5A253BCD58DBB658517A0`。

独立包名可与原版 App 并存。这是当前局域网 Debug 包；公网部署和正式 Release 签名另按现有发布流程执行。
