# 启动页动效 v2 开发方案

> 依据：[审核后修订的 v2 设计提案](CLIENT-STARTUP-MOTION-V2-PROPOSAL-2026-10-01.md)  
> 范围：Android 手机与 PDA 冷启动、温启动；浏览器刷新保留独立 Web 路径。  
> 状态：开发计划；此文档不表示客户端已实现或完成真机验证。

实际实现、模拟器测试和根据实测调整的超时值见 [开发与验证记录](CLIENT-STARTUP-MOTION-V2-IMPLEMENTATION-2026-10-02.md)。

## 目标与交付

正常 Android 启动只显示当前应用图标的一次静态停留和一次原生淡出。首屏在本地状态恢复且 WebView 可供下一次绘制后才揭开；退场完成后首页才可操作。慢启动、桥接失效、WebView 故障都有可见的静态重试入口。初始参数为 Activity 创建后至少约 800ms 停留、360ms 淡出、退场前约 3s 回退上限；点击图标到可操作的总时长以真机实测为准。

交付物包括客户端改动、自动化测试、手机与目标 PDA 的真机记录、可追溯版本号与 APK 哈希。现有 1.1.2 包只作为基线，不与新版测试结果混用。

## 当前接入点

| 位置 | 当前状态 | 开发动作 |
| --- | --- | --- |
| `client/android/app/src/main/java/com/iot/manager/client/MainActivity.java` | 安装 SplashScreen，但未保存实例和退出视图 | 注册退出监听、计时、状态协调和异常回退 |
| `client/android/app/src/main/java/com/iot/manager/client/StartupVisualPlugin.java` | 尚不存在 | 新建 Capacitor 桥接，按启动编号传递准备与完成事件 |
| `client/android/app/src/main/res/layout/` 与 `res/values/` | 尚无独立的原生启动错误页 | 新增静态错误视图、文案和重试入口 |
| `client/src/js/platform/startup-transition.js` | 移除 Web 覆盖层时同时停止看门狗并解除 `inert` | 拆分隐藏、最终删除、交互解锁及回退恢复 |
| `client/src/js/platform/native-startup-visual.js` | 尚不存在 | 新建 Web 侧桥接适配器，浏览器环境直接跳过原生协议 |
| `client/index.html` | 覆盖层图标仍有 550ms 微缩放，内联脚本提供 4 秒重试 | Android 正常路径改为静态；保留无需主模块即可运行的回退入口 |
| `client/src/main.js` | 第 205 行过早调用 `markUiReady()`；`activateEndpoint()` 等待网络同步 | 切分本地首屏与在线任务，首屏提交后才准备揭幕 |
| `client/src/js/render-coordinator.js` | 已有同步 `forceFull()` | 在本地状态集中应用后提交首屏 DOM，退场期间暂缓结构性更新 |

## 开发顺序与完成条件

### 1. 先做原生可行性原型

在 `MainActivity` 保存 `SplashScreen.installSplashScreen(this)` 返回值，并设置 `setOnExitAnimationListener`。让 Activity 正常请求首次绘制，在回调拿到 `SplashScreenViewProvider` 后保持其完全不透明。确认下方已附着、`VISIBLE` 的 WebView 能在此期间收到 `postVisualStateCallback`。用 Android 11、Android 12+ 和目标 PDA 验证；不以 `setKeepOnScreenCondition` 等待 JS 或绘制回调，该条件如需保留只能快速读原生布尔状态。

**完成条件：**三类设备上都能在原生视图未移除时收到 WebView 绘制回调，且无空白或第二个可见图标。若目标设备不满足此条件，先调整原生遮挡实现并重新审看视觉效果，再继续业务改造。

### 2. 建立原生交接状态机与桥接

新增原生协调器，例如 `StartupCoordinator.java`，由 `MainActivity` 持有。使用 `SystemClock.elapsedRealtime()` 记录 Activity 起点；每次启动或手动重试分配递增 `launchId`。协调器只接受当前编号的事件，集中控制以下状态：

| 状态 | 进入条件 | 下一步 |
| --- | --- | --- |
| `COVERING` | 原生退出视图保持不透明；Web 覆盖层仍可见，首页 `inert` | 异步确认 Web 回退层已可绘制，等待本地首屏 |
| `PREPARING` | Web 已提交本地首屏，隐藏但保留 Web 覆盖层 | 向 WebView 提交该 DOM 的绘制确认请求 |
| `FRAME_READY` | 当前 `launchId` 的绘制回调返回 | 退出视图已取得且到达 Activity 起点后 800ms 时开始淡出；若已超过则立即开始 |
| `EXITING` | 原生透明度开始从 1 到 0 | 360ms 动画结束或取消时只执行一次 `remove()`，发送完成事件 |
| `WEB_FALLBACK` | 退场前超时，且尚未隐藏的 Web 覆盖层已确认可绘制 | 直接释放原生视图；让现有 Web 静态页和重试入口接管 |
| `NATIVE_FALLBACK` | 覆盖层已隐藏但首屏未确认，或 WebView/桥接不可用 | 先放入原生静态错误视图与重试按钮，再移除启动视图 |

原生可通过**有界、异步**的 `evaluateJavascript` 检查 `#startup-overlay`、图标资源和可见状态，再用单独的 `postVisualStateCallback` 标记 `WEB_FALLBACK_READY`；不替换 Capacitor 自有的 WebViewClient。首页与回退层的绘制确认不能共用一个标志。3 秒计时只管理尚未开始的退场；淡出开始后取消该计时，并设置短时动画兜底。所有计时、WebView 操作和视图移除在 UI 线程执行，`remove()` 有幂等保护。

新建 `StartupVisual` 插件：`getLaunchState()` 返回当前 `launchId` 和距 4 秒 Web 兜底点的剩余时间；Web 先订阅带编号的完成/失败事件，再隐藏覆盖层并调用 `prepareReveal({ launchId, reducedMotion })`。若原生已经进入回退或剩余时间为零，Web 保持静态回退，不再准备揭幕。原生只在 Web 已隐藏覆盖层、提交当前首屏后调用 WebView 绘制 API；回调成功且满足停留时间后淡出。Web 的减少动态效果偏好与原生动画开关任一要求减少动画时，都在绘制确认后跳过补足停留和淡出。过期回调、重复调用、Activity 销毁及重试后的旧事件全部忽略。原生错误页使用 `#F3F6F7`、同一图标和独立的“重新加载”按钮；手动重试使 WebView 重新加载并创建新编号，渲染进程故障时重建 Activity。不得自动无限重试。

**完成条件：**状态机单元测试覆盖重复回调、3 秒超时、动画取消、重试与旧编号；在错误路径下按钮可用，原生启动视图只移除一次。

### 3. 调整 Web 覆盖层与启动阶段

在 `startup-transition.js` 分开实现 `hideForNative()`、`finishNativeExit()`、`restoreFallback()` 和浏览器专用的 Web 淡出路径。`hideForNative()` 只隐藏 Web 覆盖层，保留 DOM、静态图标、看门狗及重试按钮，`#app.inert` 和 `aria-hidden` 继续生效。仅在收到当前 `launchId` 的原生退场完成事件后，才删除覆盖层、停用看门狗并解锁首页。依据 `getLaunchState()` 返回的剩余时间安排 Web 兜底；若到 Activity 起点后约 4 秒仍未收到完成信号，恢复 Web 静态回退页与重试入口，防止首页可见却不可操作。浏览器路径不调用原生插件，按设计提案使用独立时长。

把 `bootstrapRuntime()` 改成“本地首屏”和“在线补全”两个阶段。前者读取本机安装 ID、设备绑定、站点、连接配置及可立即读取的会话状态，失败时使用明确的默认或错误状态；后者进行令牌刷新、接口同步、设备与天气加载。当前 `OidcSessionManager.restore()` 在令牌需刷新时会联网，因此不能原样放在首屏门槛内。首屏状态一次性应用后调用 `renderCoordinator.forceFull('startup_local_ready', viewModel())`，确认 `.app-shell` 与选中站点、连接状态一致，再隐藏 Web 覆盖层并请求原生绘制确认。冷启动 OAuth 回调要先确定应显示的页面；超出上限走可重试回退。

在线补全可以与原生淡出并行，但会改变首屏结构的更新暂存至退场完成或回退接管后再提交，避免淡出中页面跳变。热启动和前后台恢复不创建新 `launchId`、不重播动画。Android 正常路径的 Web 图标不再呼吸；未来更换图标时，原生启动资源、Web 回退资源和错误页图标一并更新。

**完成条件：**正常路径没有第二段 Web 图标；本地站点/配置不在揭幕后突然替换；任何分支均不会提前解除 `inert` 或永久锁住首页。

### 4. 验证、调参和交付

先运行 `client` 的 `npm test`、`npm run test:e2e -- e2e/startup-animation.spec.js`、`npm run build` 和 `npm run android:debug`。扩充 `client/test/startup-transition.test.js` 与 `client/e2e/startup-animation.spec.js`；给原生协调器增加 `:app:testDebugUnitTest`，在可用 Android 设备上运行 `:app:connectedDebugAndroidTest`。浏览器 E2E 验证静态回退和重试；原生集成测试验证绘制回调、交接、系统返回键和无障碍减少动态效果。模拟本地读取慢、回调延迟或丢失、JS 主模块失败、WebView 故障、网络离线与 OAuth 冷启动。

手机和目标 PDA 各做至少 20 次冷启动、10 次温启动，并检查后台恢复。记录版本号、APK SHA-256、Android/WebView 版本、刷新率、省电模式、点击到可操作时间的中位数与 P95；逐帧核对空白闪帧、双图标、图标位置跳变、连续丢帧和误触。60Hz 的帧预算为 16.7ms，90Hz 为 11.1ms；退场段不得出现连续两帧以上可见停顿。若主线程阻塞导致 360ms 淡出不稳，先修阻塞；仍无法稳定时按设计提案退回静态直接揭幕。800ms/360ms 只在同一目标设备完成基线对比后调整。

通过后生成高于 1.1.2 的唯一候选版本与 Debug APK，记录哈希；安装验证时用 ADB 核对设备上实际包的版本，确保用户反馈与候选包一一对应。发布包另走现有签名与回归流程。

## 实施边界

- 不把网络请求、令牌刷新或重型计算放进 SplashScreen 的主线程条件回调。AndroidX 文档规定该条件在每次绘制前检查，必须快速返回。
- `postVisualStateCallback` 表示当前 DOM 可供**下一次绘制**，不是屏幕已经显示该帧；真机帧记录是最终验收依据。WebView 必须处于附着、可见的有效状态。
- 3 秒回退上限依赖主线程仍可处理消息。进程或主线程完全冻结时，应采集 ANR/阻塞栈定位，不能依靠启动动画逻辑自行恢复。

## API 依据

- [AndroidX SplashScreen](https://developer.android.com/reference/androidx/core/splashscreen/SplashScreen)
- [Android SplashScreen 指南](https://developer.android.com/develop/ui/views/launch/splash-screen)
- [WebView `postVisualStateCallback`](https://developer.android.com/reference/android/webkit/WebView#postVisualStateCallback(long,%20android.webkit.WebView.VisualStateCallback))
