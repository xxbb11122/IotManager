# Glass Next 验证记录

## 2026-10-20 剩余测试模拟补测

完成本轮已识别缺口中可在隔离环境执行的补测：7 项 Android 存储延迟/拒绝、真实返回键取消和权限拒绝检查，4 项 CPU 降速/模块恢复检查，9 项实际 SDK/JDK 签名与包完整性负向检查均通过。实验签名 Release 两端完成正常覆盖升级及兼容版本往返，保留 UID、首次安装时间和原生数据；Glass 另验证实际缓存类跨版本读写。最终 APK 源码均为 `de263fa...`、`dirty=false`，未将实验证书作为正式发布证书。

隔离服务新跑 8 场景/10 次执行、1,000 台设备与 100 条认证 WebSocket 通过；不可变镜像实际验证运行态 12/12、恢复合并 13/13，S3 64 MiB/32,768 行在源表清空后恢复且数据指纹一致。已有恢复卷与损坏备份拒绝、内部告警 6 项通过。最终驱动 `37d2fb7` 的 Quick 和普通 P0 CI 成功，Glass 单元 257、旧客户端单元 230、严格浏览器 118 均零失败零跳过；正式不可变分支仍 skipped，独立模拟不替代正式门禁。

**正式发布仍为 NO_GO**：本轮新确认旧客户端在配置读取失败后仍误清会话；实际镜像扫描 8 项中 7 项 FAIL。治理仍为 5 FAIL、3 UNKNOWN，正式签名、目标手机/PDA/BLE、生产存储与完整恢复验收未闭环。前两轮扩展恢复失败和测试准备错误均保留。完整身份、指标、失败、测试 fixture 改动及清理边界见[模拟补测与发布评估](../../docs/REMAINING-SIMULATION-TEST-REPORT-2026-10-20.md)。以下为历史验证记录。

## 2026-10-20 glass.6 登录恢复整改复测

修复连接设置读取超时、失败或取消时误清除有效加密会话的问题。未经确认的配置不恢复会话、不创建默认端点适配器；页面提供重新读取入口。明确切换身份时仍执行原有会话隔离，启动时限保持不变。

**257 项 Glass 单元、77 项隔离页面回归、两轮各 18 项已安装 APK 原生检查通过**；本地 8 项真实服务条件用例仍单独列为 skipped。严格跨端浏览器 CI 118 项零跳过，原客户端单元 230 项通过。Android JVM 5 项、仪器 4 项通过。原生 Browser 使用 App 登录回调实际调用的 `Browser.close()` 验证关闭事件与返回前台，Chrome 首次提示的系统返回取消流程仍是独立验收边界。

被测驱动冻结于 `d895e40d253dc0ee478f51c0a4ba9d620bbe14b5`；APK 为 `1.1.4-glass.6 / code 11`，内嵌提交 `88b2a5501d4d2189b771003a67c68302a2d6d257`、`dirty=false`，14 个网页资源与构建目录摘要一致。两轮安装摘要均为 `ea037b452ab58cbb4acf42c24611532b7218e33984a6af006cb7d02a7df0da58`。后续仅测试驱动与诊断改动，运行时源码一致性已核对。

**正式发布仍为 NO_GO**：治理预检 5 FAIL、3 UNKNOWN，正式签名、不可变发布、目标手机/PDA、生产恢复及冷启动性能尚待验收。软件渲染下启动恢复失败及早期测试准备/Chrome 提示失败均保留，未用后续通过覆盖。

详见[整改与复测报告](../../docs/APP-SESSION-RECOVERY-FIX-VERIFICATION-2026-10-20.md)。以下记录为历史基线。

## 2026-10-18 glass.5 材质与可访问性整改

版本 **1.1.4-glass.5 / code 10**。完成 AI 根容器材质、通知语义色、AI 表单高度/焦点/内边距、独立状态面板、系统高对比度及启动兜底整改；保留连续详情和天气指标布局。Capacitor Android 升级至 8.4.3 修复 CVE-2026-103922，code 9 候选包已撤回。

**220 项单元、68 项浏览器、16 项已安装 APK 模拟器检查通过**；8 项真实环境用例未启用。旧客户端同步同一安全依赖补丁后，230 项单元测试通过。截图实际合成背景的 Notice/AI 错误文本对比度检查通过。安装包内 14 个网页资源与 dist 摘要一致，签名与 glass.4 相同；覆盖升级测试保留原 App 数据标记。

交付包源码提交 `0225d4f91ea08993a65ee518793eb40baba341b3`，构建标记 `dirty=false`。APK SHA-256：`068475f1f3bf097ea35ab459bcc52d4a3930cbd0d946be84ea30a14b689fd3bd`。文件名为 `iot-manager-glass-1.1.4-glass.5-code10-debug.apk`。

原生检查使用专用 Android 36 AVD 和隔离 HTTP 服务，未调用真实 AI 供应商；不代表实体手机、现场 BLE/LAN 或真实 Keycloak 验收。源码构建之后的测试等待修正及文档提交不改变该 APK 的运行时源码。

详见[开发与验收记录](docs/GLASS-5-IMPLEMENTATION-2026-10-18.md)及[脱敏验证摘要](docs/GLASS-5-VERIFICATION.json)。完整报告在本机 `verification/glass5-20261018/`，以下旧版本记录保留为历史基线。

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
