# App 动效更新与 AI 回归验收

日期：2026-10-01。更新包：Android Debug 1.1.1 / versionCode 3。

## 1. 更新内容

本次将最新底部导航优化纳入 App 安装包：设备、AI、动态、添加四个入口共用一个滑动选中底板，位移过渡 200ms，图标反馈 150ms。快速切换立即更新页面和 aria-current；AI 历史与性格子页继续高亮 AI。减少动态效果时直接显示最终选中位置。

已从上一版 1.1.0 APK 检查到旧包没有新增选中底板；新 APK 已包含 nav-selection-offset 和 bottom-nav--has-selection 样式。源码版本、Web 构建版本与 Android 版本同步提升为 1.1.1。同一模拟器以相同证书从 versionCode 2 覆盖升级至 3。

## 2. 自检结果

| 项目 | 本次结果 | 证据 |
| --- | --- | --- |
| 客户端单元测试 | 194 项通过，失败和跳过均为 0。 | [Node 日志](../artifacts/release/app-ai-motion-20261001/client-unit.log) |
| 浏览器回归 | 11 项通过：底栏 1 项、启动 3 项、AI 6 项、移动端主流程 1 项。覆盖快速切换、同项点击、焦点保留、AI 子页、320px 窄屏及减少动态效果。 | [浏览器日志](../artifacts/release/app-ai-motion-20261001/client-browser.log) |
| Web / Android 构建 | Vite、开发预览隔离检查、公共构建环境检查及 assembleDebug 均成功。 | [构建日志](../artifacts/release/app-ai-motion-20261001/android-build.log) |
| 安装升级 | 同签名覆盖安装成功，已安装 APK 的版本和 SHA-256 与交付包一致。 | [安装日志](../artifacts/release/app-ai-motion-20261001/android-install.log)、[构建清单](../artifacts/release/app-ai-motion-20261001/build-manifest.json) |
| 已安装 APK 原生模拟 | 11 项全部通过，新增底栏几何位置、快速打断、DOM 保留和减少动态效果检查；既有问答、键盘、历史、性格、后台、进程重启、旋转和 Browser 返回均通过。 | [原生结果](../artifacts/release/app-ai-motion-20261001/native-ai-results.json)、[运行日志](../artifacts/release/app-ai-motion-20261001/native-ai-smoke.log) |
| 密钥及重复请求 | 11 个打包 Web 文本资产中未发现服务器当前 Chat 密钥；两个模拟问题仅两个 POST，导航及恢复不重复提交。 | 同上构建清单及原生结果。 |

原生导航用例运行于 Android 16 的实际安装包 WebView；快速切换由连续 DOM 点击触发，减少动态效果通过 WebView 媒体设置模拟。实体设备触感、系统动画设置及性能仍需真机验收。截图：[底栏](../artifacts/release/app-ai-motion-20261001/native-ai-bottom-navigation.png)、[聊天](../artifacts/release/app-ai-motion-20261001/native-ai-chat.png)、[横屏](../artifacts/release/app-ai-motion-20261001/native-ai-landscape.png)。

## 3. 交付

- [下载 1.1.1 Debug APK](../artifacts/release/app-ai-motion-20261001/iot-manager-ai-1.1.1-debug.apk)。同签名的 1.1.0 Debug 可覆盖升级。
- applicationId：com.iot.manager.client；versionName：1.1.1；versionCode：3。
- 包大小、SHA-256 和签名证书以[构建清单](../artifacts/release/app-ai-motion-20261001/build-manifest.json)为准。
- [AI 开发与验收记录](APP-AI-IMPLEMENTATION-2026-10-01.md)、[原生测试复现](APP-AI-NATIVE-TEST-2026-10-01.md)、[底栏动效设计](CLIENT-BOTTOM-NAV-MOTION-2026-10-01.md)。

上一版 [1.1.0 构建清单](../artifacts/release/app-ai-20261001/build-manifest.json)及安装包保留，便于核对更新前后版本。

本次请求全部使用独立模拟服务，未调用 DeepSeek 或 Embedding。真机、完整 HTTPS/OIDC 登录、新 APK 真实 DeepSeek 联调及正式发布签名仍待验收；当前交付为 Debug 包。
