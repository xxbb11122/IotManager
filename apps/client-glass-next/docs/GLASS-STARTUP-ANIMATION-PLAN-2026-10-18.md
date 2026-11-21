# IoT Manager Glass 启动动画整改方案

> 日期：2026-10-18<br>
> 状态：前期设计记录；后续实施采用快速候选配置，见[实施记录](GLASS-STARTUP-ANIMATION-IMPLEMENTATION-2026-10-18.md)<br>
> 对象：`apps/client-glass-next`，包名 `com.iot.manager.glassnext`，设计基线版本 `1.1.4-glass.5`<br>
> 输入：用户提供的 `D:/Chrome下载/iot_manager_startup_animation_plan.md`、当前工程源码，以及此前“实机不丝滑、退场太快”的反馈。

## 1. 现状与判断

Android 冷启动由原生协调器持有系统 SplashScreen 的退出视图作为盖板；Web 启动遮罩主要承担浏览器启动与原生故障回退。现有 `markUiReady()` 在 Android 路径中隐藏 Web 遮罩，等待原生 `prepareReveal()`、`WebView.postVisualStateCallback()` 和 `exitComplete`，之后才解除 `#app.inert`。因此，原文所说的原生 `800 + 360ms` 再叠加 Web `700 + 280ms`，并非正常启动的实际时序。

| 项目 | 当前代码 | 方案判断 |
| --- | --- | --- |
| Android 最短驻留、退场 | 800ms、360ms | 用户认为太快；先录制基线，再试验 1000ms 驻留和现有 360ms 退场。慢启动仍由首帧就绪决定，不额外累加固定时长。 |
| Web 独立退场 | 700ms、280ms | 只在浏览器和 Web 回退路径使用，分别调校。 |
| 原生超时、Web 救援 | 8s、9.5s | 保留可恢复路径，按同一个 `launchId` 处理完成和重试。 |
| 本地初始化 | 先恢复安装 ID 和 BLE 绑定/历史，再依次读取其他设置 | BLE 历史按绑定逐个全量读取，确实可能拖慢首个可用画面；应从首屏门槛移出。 |
| 远程同步 | `await startupReady()` 完成后才开始 | 存在可测量的空档；有有效凭据时可试验受控预取，但不能让网络回调干扰退场帧。 |
| Web 看门狗 | 600ms 显示等待文字，4s 改为失败文字 | 正常 Android 路径会被原生盖板挡住，并非 4s 必然闪错；回退时需防止显示过期的失败状态。 |
| 图标与背景 | 系统启动主题使用 `@mipmap/ic_launcher_foreground`，底色 `#F3F6F7`；Web 遮罩底色 `#eff5f6` | 活跃启动主题不是原文所指的默认机器人矢量图。底色和图标裁切仍有可见差异，需要统一设计令牌。 |
| 120ms 探测 | 原生探测 Web 回退图像，准备就绪后停止 | 先记录探测次数和耗时；保留等效故障兜底后再改为事件通知或退避探测。 |

本方案以当前源码为准，不编辑反编译得到的 `index-*.js`，也不把理论帧率写作已验证结果。

## 2. 目标与启动状态契约

### 2.1 用户看到的过程

1. 点击图标后，系统启动窗立即显示**当前 App 图标**及统一底色。图标素材集中管理，后续换图时同步生成 Android 与 Web 启动资源。
2. 原生盖板接管后，图标做轻微、连续的缩放或透明度呼吸。建议先试 `1 → 1.015 → 1`、约 1.8s 一个周期；仅作用于图标 View，不对全屏背景做模糊、缩放或常驻 `will-change`。短启动可在首个周期未结束时直接退场。
3. 本地界面渲染完成且 WebView 可提交可见帧后，盖板以目前的缓动曲线淡出。快速启动试验总观感约 1.3–1.5s；具体以录屏和帧数据选定。慢启动等待真实首帧，不另加“完整播放一轮”的硬性延迟。
4. 退场完成并收到匹配 `launchId` 的 `exitComplete` 后，移除 Web 遮罩、解除 `#app.inert`。失败时显示当前可见层的重试入口。

Android 系统启动窗出现到 `SplashScreenViewProvider` 交给 App 之间的时段由系统负责。图标呼吸从 App 获得该 View 后开始；不承诺从点击图标的第一帧就能播放自定义动画。[Android SplashScreen 指南](https://developer.android.com/develop/ui/views/launch/splash-screen)、[SplashScreenViewProvider API](https://developer.android.com/reference/androidx/core/splashscreen/SplashScreenViewProvider)。

### 2.2 状态机

```text
SYSTEM_SPLASH
    ↓ onSplashReady
NATIVE_COVERING ── Web 本地 UI 已渲染 + 可见帧已提交 ──→ NATIVE_EXITING
    │                                                   ↓ 动画结束 / 系统减少动画
    │                                               INTERACTIVE
    ├── 8s 超时 ──→ NATIVE_RECOVERY ── 重试 ──→ NATIVE_COVERING（新 launchId）
    └── Web 桥接不可用且 Web 回退图像已就绪 ──→ WEB_FALLBACK
                                                       ↓ Web 退场或 Web 重试
                                                   INTERACTIVE / WEB_ERROR
```

- `NATIVE_COVERING` 和 `NATIVE_EXITING` 时，`#app` 一直保持 `inert`；待真实盖板移走才开放触控和辅助技术访问。
- `postVisualStateCallback()` 用于确认所需 DOM 状态已进入可绘制的 WebView 帧；页面提交回调本身不足以证明 CSS、图片和本地界面已绘好。[WebView API](https://developer.android.com/reference/android/webkit/WebView)。
- 所有定时器、动画、回调和重试均检查 `launchId`、销毁状态与当前阶段，避免旧启动回调移除新盖板。
- 减少动画或系统关闭动画时直接显示已就绪画面；仍保留首帧就绪和超时保护。

## 3. 开发步骤

### 阶段 A：先量出实机基线

在现有源码和 APK 上增加可关闭的启动事件记录，不改变启动顺序。原生使用 `SystemClock.elapsedRealtime()`；Web 使用 `performance.now()`；通过桥接交换一次时间锚点，形成同一条启动时间线。

记录 `Activity` 创建、`onSplashReady`、WebView 可用、安装 ID、绑定元数据、BLE 历史、配置加载、OAuth 回调、首个本地渲染、`prepareReveal`、`frame_ready`、退场开始/结束、首个可操作画面、首批远程数据应用，以及探测次数。记录阶段耗时、数量和错误类别；不记录令牌、设备密钥或用户数据。

同一台手机和 PDA 分别录制至少 20 次冷启动、10 次温启动；覆盖离线和正常网络。保存帧时间线、录屏、版本及 APK SHA-256，以便比较“停顿来自 I/O、Web 主线程还是原生退场”。

### 阶段 B：统一图标与盖板视觉

建立一个启动素材来源及生成/校验脚本，把 Android `mipmap`、Web 启动 `<img>` 指向同一版图标；保留 Web 独立启动和回退时所需资源。统一系统窗 `startup_background`、Web 页面底色和退场后首屏底色，检查图标裁切、圆角与视觉尺寸。顶栏品牌标记与 App 图标若设计不同，允许作为页面内标识，但启动阶段只使用 App 图标。

在 `StartupCoordinator` 获取 `SplashScreenViewProvider.getIconView()` 后，为图标加轻微动画。阶段切换、系统减少动画、进入后台、重试、`finishExit()` 和 `destroy()` 都停止动画并恢复 View 属性。原生盖板继续做单层透明度退场，暂不引入全屏缩放、模糊或第二层光环。

先保留 800/360ms 作为对照，再试验 1000/360ms。用同设备录屏盲看和首个可操作时间决定参数；若 1000ms 仍显仓促，可在 1100ms 附近小步调校，避免把真实慢启动再叠加固定等待。

### 阶段 C：把非首屏历史读取移出启动门槛

维持安装 ID、BLE 绑定元数据、站点、连接配置、启动 URL 和 OIDC 回调的业务顺序。将互不依赖的只读设置并发读取，使用 `Promise.allSettled()` 收集结果后按固定顺序更新状态；每项保留既有失败回退和提示。

首屏只恢复 BLE 设备摘要及离线状态。历史活动在首次可操作后按需加载或分批加载，进入设备详情时有可识别的加载/失败状态。历史读取结果只写入仍然存在、仍属当前账户或站点的绑定；避免切换站点、重试或卸载后旧请求写回。IndexedDB 查询若已支持分页则使用分页；否则先测量历史条数和耗时，再决定是否增加分页接口。

### 阶段 D：受控试验远程预取

先保证本地画面和退场稳定。仅在当前 endpoint、站点、有效令牌及 `activationRevision` 均已确定、且无需先完成令牌刷新时，尝试预取站点列表。预取只发起请求并缓存结果；首页状态更新、设备与天气请求在退场后按现有依赖顺序执行。请求使用取消/版本检查，endpoint、账户或站点改变时废弃旧结果。

将预取放在独立开关后，对照开启与关闭时的退场帧间隔、请求完成时间和首批数据可见时间。若 WebView 主线程或网络回调使退场变卡，关闭该开关，优先保留顺滑退场。需要刷新令牌或处理 OIDC 回调的启动路径继续走现有鉴权顺序。

### 阶段 E：梳理状态提示与故障兜底

Web 看门狗保留 `stop()`、`fail()` 和重试契约，增加“等待、慢启动、确定失败、完成”的显式状态。原生盖板存在时，Web 的 4s 计时不得生成稍后突然露出的旧错误文案；原生 8s 恢复层负责可见重试。Web 独立启动和原生桥接失效时，由 Web 遮罩提供可见状态和重试。正常慢启动可以显示等待反馈，但不能提前宣告失败。

对 120ms 探测先计数并确认停止条件。之后可由 Web 图像加载完成事件通知原生，原生保留一次可见帧确认；无通知时采用有上限的退避探测和 8s 故障路径。改动前后都验证 JS 未执行、图片加载失败、桥接拒绝、Activity 重建和重试，防止留下白屏。

## 4. 修改范围

| 文件 | 计划改动 |
| --- | --- |
| `android/app/src/main/java/com/iot/manager/glassnext/StartupCoordinator.java` | 启动事件、图标轻动效与生命周期清理、驻留时长试验、探测策略；保留帧检查和超时回退。 |
| `android/app/src/main/res/values/colors.xml`、`styles.xml`、图标资源 | 统一系统启动底色和图标素材映射。 |
| `index.html` | Web 回退遮罩与系统启动视觉一致；保留高对比度、焦点、48px 重试按钮和无 JS 提示。 |
| `public/startup-watchdog.js` | 状态化提示，清理过期失败信息，保持原 API。 |
| `src/js/platform/startup-transition.js` | 明确阶段和 `launchId` 校验；只在可见层退出后解锁；完善超时与重试清理。 |
| `src/main.js`、`src/js/platform/cache-repository.js` | 分离首屏必需数据与 BLE 历史；并发独立读取；在安全条件下试验站点预取。 |
| `test/startup-transition.test.js`、`e2e/startup-animation.spec.js` | 补充状态、回退、重试、减少动画和可访问性回归。 |

## 5. 验收与发布门槛

| 场景 | 必须观察到的结果 |
| --- | --- |
| 冷启动、温启动、后台返回 | 图标和背景不跳变；退场无白帧、双图标或短暂露底；后台返回不重播完整冷启动。 |
| 快速本地就绪 | 比较 800/360 与候选 1000/360 的录屏；选中的节奏让图标有可感知的停留，额外首个可操作等待与所选驻留增量相符。 |
| 3–7s 慢启动 | 有持续、克制的视觉反馈；不出现“先失败再成功”的可见闪烁；远程请求或 BLE 历史不阻塞首个本地画面。 |
| 8s 超时、9.5s 救援、JS/图片/桥接失败 | 到达正确的恢复层；重试可用；旧 `launchId` 的事件不影响新一次启动。 |
| OIDC 回调、令牌临期、切换 endpoint/站点、离线 | 鉴权与站点依赖正确，预取结果不串号，不重复提交设备命令。 |
| 减少动画、系统关闭动画、高对比度、强制颜色 | 无非必要动画；文字、重试按钮和焦点仍可见、可操作。 |
| 实机帧与交互 | 手机和 PDA 的冷/温启动逐帧检查；记录退场期长帧和 `p50/p95` 首个可操作时间，不以 CSS 属性推断“稳定 60fps”。 |

自动化至少执行现有启动单元与浏览器测试、Android 构建和新增故障回退测试。浏览器测试只能证明 Web 路径；“已解决实机卡顿”必须以同一安装包的手机/PDA 录屏和帧数据确认。每个版本保存源码提交、构建命令、APK SHA-256、设备型号/Android 版本及结果摘要。

## 6. 实施顺序与回退

按“测量 → 素材和原生图标动画 → 本地读取拆分 → Web 状态 → 可选预取 → 实机验收”推进，每阶段独立提交并对比上一阶段数据。若新增图标动画产生长帧，关闭该动画；若预取增加退场抖动，关闭预取；若探测改造影响故障恢复，回到当前探测逻辑。保持 `postVisualStateCallback()`、`exitComplete`、`launchId` 和原生恢复层的既有安全边界。

本文件是实施方案，不代表代码、APK 或实机体验已完成整改。
