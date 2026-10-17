# Glass Next 1.1.4-glass.5 开发与验收记录

日期：2026-10-18（Asia/Shanghai）。本轮实现审核开发文档中的 M1–M5：材质一致性、语义、可访问性、回归测试及安装包交付。性能自适应、Store 重写、BLE 协议下发和流式 AI 属于后续独立项目。

## 交付身份

| 项目 | 值 |
| --- | --- |
| App 版本 | 1.1.4-glass.5 |
| Android versionCode | 9 |
| 包名 | com.iot.manager.glassnext |
| 构建源码提交 | 2364bf542f413077f023ac6fe9f63f96a9353d32 |
| 构建状态 | App 构建输入已提交，build-info 标记 dirty=false |
| APK 大小 | 6,118,809 bytes |
| APK SHA-256 | `6c0752a259675d8072d3746b8d31da578d7eace6c7432b1cc4e2a0a26644a94f` |
| 签名 | apksigner 验证通过，与 glass.4 APK 的证书一致 |
| 包内网页资源 | 14 个文件与最终 dist 逐文件 SHA-256 一致 |

APK 由上述源码提交构建。构建之后的测试等待修正和本记录不改变交付包的运行时源码。原有工作区差异和 glass.4 APK 已保留在本机验证目录；未提交环境配置、账号、密钥、设备日志或 APK 二进制。

## 实现结果

| 原整改项 | 本轮实现 | 验证关联 |
| --- | --- | --- |
| 1 启动遮罩 | 与主界面统一背景和高光；保留启动协调、重试、减少动画及无 JS 恢复；补高对比度兜底 | T10 |
| 2 顶栏/底栏/入口 | 入口增加材质边界，保留 48px 目标；导航保持 sticky，未引入定位 !important | T02、T09、原生导航检查 |
| 3 空状态/列表 | 仅独立设备空状态增加可降级面板；不启用未经设备测量的 content-visibility | T01、T09 |
| 4 详情状态 | 保留一张连续详情面板，内部状态通过标题、留白与分隔线表达 | T05 |
| 5 控制区 | 删除无调用的旧 buildLevelControl；保留能力校验范围滑块、命令幂等与 ACK；模式按钮补 aria-pressed | T05、T06 既有命令回归 |
| 6 回执/动态/元数据 | 保持连续排布及真实回执含义，没有给六个子区叠加光学卡片 | T05、T06 |
| 7 BLE/LAN 摘要 | 补一致的 CSS 玻璃，不新增摘要光学层 | T01、T09 |
| 8 表单 | 输入材质选择器改为组件范围；保留原生输入及可见焦点；不向空元素注入层 | T03、T07 |
| 9 分段外框 | 补 CSS 材质；实色及系统高对比度均正确降级 | T02、T09 |
| 10 天气 | 逐时预报增加边界；主指标保持平面；位置保存、展开状态及阅读锚点回归通过 | T08、原天气交互测试 |
| 11 AI 等待区 | 增加有语义底色的状态区；停止等待和查询恢复不重复发送问题 | T01、AI 恢复及原生恢复检查 |
| 12 AI 性格 | 名称框最小 48px、textarea 最小 88px；字段内边距和焦点恢复；支持 4000 字保存/启用 | T07、原生性格检查 |
| 13 AI 历史 | 修复内边距；长标题最多三行，DOM 保留完整文本；窄屏操作区可换行 | T07 |
| 14 提示与 Toast | Notice/AI 错误按 tone 同时定义文字、边界与底色；Toast 使用可读磨砂材质，fixed 宿主不变 | T04、T09 |

另外修复当前工作区中 AI 根容器被透明化的问题：设备列表布局容器保持透明，AI 根容器恢复 CSS 材质。AI 字段、消息、历史不再各自叠加独立折射层；可选光学 chunk 加载失败时工作区仍可读、可输入。

所有新增材质增强通过 `@supports` 和最终 `data-glass` 控制，避免系统已经选择实色而导航仍有滤镜。通用光学宿主使用低优先级定位规则、禁止不适合的元素及重复层；没有重写业务适配器、鉴权或状态仓库。

## 测试结果

| 层次 | 结果 | 范围 |
| --- | --- | --- |
| 单元 | 220 通过，0 失败 | 现有状态、命令、鉴权、缓存、平台及原生配置契约 |
| 浏览器 | 68 通过，8 跳过，0 失败、0 flaky | 原有 56 项与新增 12 项材质契约 |
| 已安装 APK | 15 项检查通过 | Android 36 x86_64 / Pixel 6 测试 AVD；使用原生插件和隔离 HTTP 后端 |
| 生产构建 | 通过 | 开发预览/夹具排除、公开构建环境策略、Capacitor 同步 |
| 包身份与资源 | 通过 | 包名、code、版本、签名及 14 个 dist 资源摘要 |
| 覆盖升级 | 通过 | 安装 glass.4 并写入测试数据后升级；最终交付包覆盖安装后数据标记仍在 |

新增浏览器测试覆盖：

- 12 个页面 × 320、390、414、768、820、1024、1440px 宽度，AI/连接页面文字放大 200%。
- 光学加载失败、重复注入、焦点/草稿保留、后台效果暂停及销毁。
- liquid/frosted/solid、prefers-contrast 和 forced-colors 的有效材质与恢复。
- Notice/AI 错误的语义色，以及截图实际合成背景上的文本对比度至少 4.5:1。
- 连续详情、能力选中状态、48px 入口、天气预报边界和无 JavaScript 恢复。

安装后检查覆盖：原生平台/版本/安装摘要、材质及两类系统高对比度、底部导航、草稿快捷填入、原生 HTTP 与安全文本、连接复查、软键盘与系统返回、历史、性格字段焦点、4000 字性格与乐观版本校验、恢复元数据、后台暂停、进程重启 GET 恢复、横竖屏及 Browser 插件返回。

测试工具针对新 WebView 使用 `noDefaults` 连接 CDP，避免不支持的浏览器上下文下载管理；尺寸检查允许物理像素取整。浏览器返回前等待 Android 窗口焦点，截图等待有上限，避免后台 rAF 暂停造成测试挂起。

原有 WebSocket 回归区分“合并启动中的读取”和“进入冷却”；仍要求启动及三次重连只有一次实际设备列表读取。

## 验收边界

8 项真实环境用例没有启用：回滚数据兼容、真实 AI、真实 Keycloak/API/WSS/角色/令牌/Edge，以及千设备负载。不能将这些用例记为通过。

原生检查使用独立 AVD、隔离服务和测试会话，真实 AI 供应商调用为 0；它验证 App/原生插件链路，不代表真实 Keycloak、实体手机 CA 信任、BLE 硬件或现场 LAN 已验收。没有执行实体手机性能基准，也没有修改后端部署。

## 复现与证据

完整本机日志、截图和结构化报告位于被 Git 忽略的 `verification/glass5-20261018/`：

```text
unit-tests.log
browser-tests.log
e2e-results.json
android-build.log
apk-verification.json
upgrade-check.json
native-tests.log
native/native-ai-results.json
```

仓库保留脱敏的[验证摘要](GLASS-5-VERIFICATION.json)，完整设备日志与临时测试环境不上传。

常规回归：

```powershell
npm ci --no-audit --no-fund
npm test
npm run test:e2e
npm run android:debug
```

Windows 下设置本机 JDK 23 / Android SDK 后可校验构建物：

```powershell
.\scripts\verify-debug-apk.ps1 -Output verification/apk-verification.json
# 提供上一稳定 APK 时还会检查证书一致性。
.\scripts\verify-debug-apk.ps1 -PreviousApk <previous-apk> -Output verification/apk-verification.json
```

安装后隔离回归仅对专用 Android 模拟器执行：

```powershell
$env:IOT_ANDROID_SERIAL='emulator-5560'
$env:IOT_NATIVE_OUTPUT_DIR='verification/android-native'
node scripts/native-ai-smoke.mjs
```

需先安装待测 Debug APK，确保本机 8080 测试端口可用。脚本恢复测试前的偏好、网络、旋转及端口；不要将其用于实体手机。浏览器报告可通过 `IOT_PLAYWRIGHT_REPORT_FILE` 和 `IOT_PLAYWRIGHT_OUTPUT_DIR` 分开保存，避免专项重跑覆盖完整回归结果。

## 后续事项与回滚

帧率策略、结构共享、BLE Profile 下发和流式 AI 仍按开发文档的独立路线推进；本次没有以删除不可变约束或为每个组件增加折射层来替代性能验证。

保留独立包名、现有后端连接设置和登录回调。若需回退，使用稳定源码、相同签名与更高 versionCode 重新构建，优先保留用户数据；不默认卸载清数据。
