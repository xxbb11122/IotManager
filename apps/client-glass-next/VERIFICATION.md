# Glass Next 验证记录

## 2026-10-03 Android 局域网接入

当前版本 **1.1.4-glass.4 / code 8**。220 项单元、2 项移动浏览器检查通过；公开 HTTPS 入口、证书、5 个 PKCE 表单与 APK 摘要通过；14 项最终 APK 资源、LAN 默认参数、Debug CA 与签名通过。13 项真实协议检查通过，包括真实账号的 Android/web PKCE 登录、授权 API、刷新、WSS、Backend→DeepSeek 回答、历史/GET 恢复及退出后拒绝刷新。修复了 Keycloak Glass client 缺少 `basic` scope 与退出未撤销 offline refresh token 的问题。实体手机的验收边界见下文。以下 glass.2 和 10 月 2 日记录为历史基线。

当前已安装 APK 的 13 项隔离模拟检查通过，安装摘要与 glass.4 交付副本一致；覆盖移动导航、键盘、历史、性格编辑/启用、后台与进程恢复、横竖屏及 Browser 插件，未调用真实供应商。测试固定并校验初始竖屏，保留导航动画，并在结束时恢复模拟器的配置、网络与端口。

已安装 APK 的真实流程 **6 项全部通过**：真实 PKCE 回调、安全存储、HTTPS Discovery/授权 API、界面显示 DeepSeek 回答、历史/测试会话删除、退出后刷新拒绝。登录/退出专项另有 4 项通过。外部 Browser.open 使用测试替身，真实表单在校验 TLS 的 CLI 提交后交付 Android intent；**手机浏览器 CA 信任及实体手机仍未验收**。本轮累计 6 次真实 Backend Chat POST，包含旧失败尝试，Embedding 为 0；最终 APK 流程只发送 1 次，测试会话已清理。

## 2026-10-03 AI 接入更新

历史版本 **1.1.4-glass.2 / code 6**。218 项单元、13 项浏览器检查最终通过；13 项已安装 APK 模拟联调通过。真实 HTTPS 后端代理、独立 `iot-glass-next` public client、Issuer 与匿名 PKCE 登录表单检查通过。知识库关闭，此阶段未执行真实账号完整登录与 Chat 闭环。以下保留 10 月 2 日的历史基线。

## 2026-10-02 历史基线

验证日期：2026-10-02。基线为当前客户端 **1.1.3**，独立版本为 **1.1.3-glass.1**。

| 验证 | 结果 |
| --- | --- |
| 单元测试 | 204 通过，0 失败 |
| 浏览器测试 | 54 通过，0 失败，0 重试通过；8 个环境用例跳过 |
| 生产构建 | 通过；开发预览与测试数据排除检查通过 |
| Capacitor 同步与 Android Debug 构建 | 通过；JDK 23 / Android SDK 36 |
| APK 身份与签名 | com.iot.manager.glassnext；1.1.3-glass.1 / code 5；v2 签名验证通过 |
| APK 网页资源 | 全部文件摘要与最终 dist 构建一致 |
| 来源工程隔离 | 199 个来源文件摘要未改变 |

## 客户端覆盖

保留最新版的启动动画、局部更新、离线恢复、权限、命令回执、AI 工作区、设备发现、连接与 OIDC 配置。新增玻璃界面测试运行实际 src/main.js、Store 与 API Adapter，在网络与硬件边界提供测试替身。

新增测试验证原生范围滑块仅发送一次命令、回执后才更新上报状态、设备能力字段正确显示、真实天气位置 API 保存，以及材质/减少动画/高对比度切换。

页面在 320、390、414、768、820、1024、1440 像素宽度检查横向溢出。已人工查看手机首页、设备详情、天气，以及桌面设备详情与天气截图。截图使用测试设备数据。

## 安装包与运行

通过 `npm run android:debug` 生成 Debug APK，约 5.72 MiB；独立包名可与原 App 并存。安装包、设备截图及详细运行日志属于本机验证产物，不提交到 Git。

SHA-256：`234e01929aff5724cb97e8ea816b68b5d465158fcf615857c5e143f9c06ae599`

运行说明见 [README](README.md)。本地界面端口为 5190，默认后端代理到 localhost:8080。

## 验证边界

当前本机 localhost:8080 未运行后端。本次没有执行真实设备 BLE/LAN、真机定位、真实 Keycloak 登录或真实 AI 供应商联调；APK 尚未安装到真机。

以下 8 项用例需要显式提供真实环境，因此跳过：

- writes under N and reads plus writes under N-1
- owner can use site chat while the knowledge base remains disabled
- OWNER completes PKCE and can use the protected API and WebSocket
- VIEWER can read but cannot write through the protected API
- four real Keycloak roles enforce write, delete, agent, and two-site boundaries
- PKCE authorization codes and rotated refresh tokens cannot be replayed after logout
- OWNER-issued edge credentials rotate and revoke across Caddy WSS
- creates isolated devices while 100 authenticated WebSockets receive events

新原生回调 `com.iot.manager.glassnext://oauth/callback` 需要在现有 realm 登记，配置示例见 [keycloak-client.example.json](keycloak-client.example.json)。本次未修改现有 Keycloak。

## 复验

单元、浏览器和 APK 检查命令见 [README 的验证说明](README.md#验证)。完整报告和截图在本机 `verification/` 目录生成，并由 `.gitignore` 排除，避免提交设备路径和环境专属数据。
