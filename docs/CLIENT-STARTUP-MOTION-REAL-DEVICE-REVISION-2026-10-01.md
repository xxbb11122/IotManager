# IoT Manager 实机启动动效修订设计与实施方案 v1.1

> 日期：2026-10-01
> 状态：Web 启动层与有上限退场已实现并构建 Android Debug 1.1.2；浏览器与 Android 模拟器基本回归通过，**原生/Web 首帧连续性与实体设备流畅度尚未验收**。
> 范围：`client` 的 Android 手机/PDA 冷启动、温启动，以及浏览器整页重新加载；热启动仅恢复当前界面，不重播开屏。
> 反馈输入：用户在实体设备上观察到“启动页面不够丝滑、节奏太快”。尚未收到机型、系统/WebView 版本或逐帧录屏，因此不能把具体丢帧位置写成已复现结论。

## 1. 开发前实现与问题边界

| 观察 | 证据 | 结论等级 |
| --- | --- | --- |
| Android 系统启动页使用 `ic_launcher_foreground`，Web 启动层使用完整的 `ic_launcher.png`。两者前景裁切、留白和外轮廓不同。 | `client/android/app/src/main/res/values/styles.xml`；`client/index.html` | 源码与素材确认；实际跳变幅度待真机测量 |
| Web 图标和光晕各运行 420ms，遮罩退出为 150ms；`createClientUi()` 同步构建界面后即调用 `markUiReady()`，无需等图标动画完成。退场时图标/光晕动画被暂停。 | `client/index.html`；`client/src/main.js`；`client/src/js/platform/startup-transition.js` | 源码确认；可解释“过快/突然停住”，实机时长待测 |
| 图标有 `drop-shadow`，光晕是放大至 185% 的径向渐变。 | `client/index.html` | 有额外绘制/合成风险；**不是已证明的丢帧根因** |
| 改动前 `markUiReady()` 在遮罩淡出前即解除底层 `inert`，同时使遮罩 `pointer-events: none`。 | `client/src/js/platform/startup-transition.js` | 源码确认；淡出时可能点击尚未看清的设备界面，应修正交互边界 |
| 现有自动化验证遮罩出现/移除、减少动态效果和失败重试；已有 Android 模拟器回归，但没有目标真机帧时间证据。 | `client/e2e/startup-animation.spec.js`；`docs/CLIENT-AI-MOTION-UPDATE-2026-10-01.md` | 测试范围确认；不能声明真机丝滑 |

以上问题中，图标不一致和过早截断是优先修复对象。WebView 初始化、首屏同步 DOM 构建、图像解码或全屏遮罩合成也可能造成卡顿；只在真机轨迹中定位后才能决定是否进一步优化启动路径。

## 2. 设计目标与非目标

1. 原生启动画面到 Web 首帧保持**同一背景、同一图标可见轮廓和视觉中心**，没有白/黑闪帧或图标尺寸突变。
2. 快速冷启动的视觉节奏比当前从容，但不通过等待网络、BLE、天气或登录结果来延长启动；设备壳层已就绪后的额外装饰等待有硬上限。
3. 一次启动只播放一次；前后台切换、热启动、站点切换、重连和页面导航都不重播。
4. 在底层界面尚被遮住时不允许触发隐蔽的设备操作。减少动态效果模式立即显示静态状态并尽快进入界面。
5. 不追求固定 30fps、不全局启用 `will-change`，也不以“让闪屏更久”掩盖真实掉帧。

## 3. 推荐视觉方案：静态原生承接 + Web 单次柔和揭幕

### 3.1 素材与画面

- 本轮 Web 启动层改用现有 Android `ic_launcher_foreground.png` 前景图案，白色圆底承接原生图标背景；两端**最终可见轮廓与尺寸**仍须用真机逐帧核对。若存在裁切或尺寸跳变，再从统一母版分别导出符合 Android SplashScreen 遮罩规则的原生/Web 资源，不能仅凭文件名相同判定视觉一致。
- 保留当前 `#F3F6F7` 背景，并核对原生启动主题、普通窗口、WebView 背景和 HTML 首帧的实际颜色。图标居中位置以安全区内的视觉中心校准手机竖屏与 PDA 横屏。
- Android 系统图标保持静态；仅 Web 端做一次轻微的 `scale(1 → 1.02 → 1)`。删除动效中的扩散光晕与 `drop-shadow`，先保留最少的 `transform`/`opacity` 运动区域。资源应在首帧可靠加载，不能先出现空图标再补绘。
- 当图标提前进入退场时，从**当前缩放值连续过渡**到最终静止态，不使用 `animation-play-state: paused` 留下中途尺寸。底层壳层与遮罩只做一次短交叉淡入/淡出，不叠加首页整体位移。

### 3.2 时间预算（初值，须按目标真机校准）

下表中的 Web 时间以 HTML 启动层首次 `requestAnimationFrame` 回调为计时代理，**不是已证明的屏幕实际呈现时间**，也不把 Android 系统启动页时长假设为固定值。该锚点在延迟加载主模块之前记录，避免把模块下载/执行时间再算成装饰停留。

| 阶段 | 建议初值 | 行为与中断规则 |
| --- | ---: | --- |
| 原生 SplashScreen | 系统决定 | 相同底色、静态图标；不为凑时长强行延长系统页。 |
| Web 首帧稳定 | 0–100ms | 相同图标/底色静态承接，避免一进 WebView 就跳尺寸。 |
| 图标微动 | 约 400–550ms | 缓入缓出、峰值不超过 102%；只运行一次；准备好可平滑提前退出。 |
| 壳层可绘制后的视觉缓冲 | 最多 180ms | 按下述公式计算；已显示够久时为 0。不等待远端数据。 |
| 遮罩退场 | 220ms | 仅淡出；结束时移除遮罩并开放底层交互。 |

本轮采用明确的 Web 时序规则：`缓冲 = max(0, min(450ms − Web 首帧机会以来时间, 180ms − 壳层就绪后已等待时间))`。因此早就绪也不会直接截断到 150ms；慢就绪则不再附加缓冲。Android 系统启动页的实际显示时间不受此公式控制，必须单独记录，不能拿整个冷启动强行验收为固定 0.6–0.9 秒。若壳层迟于微动完成，图标保持静态，约 600ms 后才显示现有“正在准备”文案；4 秒失败重试边界保留。

在正常快速启动路径下，壳层就绪后的**额外阻挡上界为 180ms 绘制机会/缓冲 + 220ms 退场**；动画事件丢失时使用 320ms 退场清理兜底。此延迟是“更从容”与“更早可点”之间的显式取舍；若现场操作测试认为它仍过长，优先缩短缓冲，而不是降低帧率。遮罩可见期间不把点击透传到底层设备控件。

### 3.3 就绪与生命周期

- `ready` 仅表示初始 App 壳层已挂载；不等于设备数据/登录成功。退场前等待两个 Web 绘制机会，最多 180ms，随后进入有上限的遮罩淡出。`requestAnimationFrame` **不保证 Android WebView 已经呈现首帧**，实体设备连续性仍须录屏/轨迹验收。
- 原生系统启动页继续由 Android 管理，Web 首帧用相同前景图案和背景承接。曾试行 `WebView.postVisualStateCallback` 桥接，但现有 API 36 模拟器冷启动中未在预期时限返回，故本轮撤回，不能把超时路径冒充绘制确认。若真机仍显示原生页退出早于 Web 首帧的空白，需依据轨迹再设计原生退出监听和重叠时序。
- 用户退到后台时停止装饰运动；返回前台直接显示当前可信状态，不补播。Android 热启动按系统行为不显示新的 SplashScreen；浏览器完整重新加载视为新启动。
- 开启减少动态效果时：无缩放、无光晕、无额外停留或淡出；壳层就绪后立即移除遮罩。仍需在 Android 真机核对系统设置是否正确传给 WebView。

## 4. 性能诊断与实施顺序

1. **锁定版本和复现样本**：记录 APK `versionName/versionCode`、签名/哈希、手机/PDA 型号、Android 及系统 WebView 版本、刷新率、是否省电模式、冷热启动定义。分别采集正常与减少动态效果模式；保留能看到原生图标到首页的录屏。
2. **建立时间线**：记录 Activity 创建、系统页退出、Web HTML 首帧、图标解码、`createClientUi()` 完成、Web 壳层可绘制、遮罩退场和首个可响应输入。用真机 FrameTimeline/Perfetto 及 WebView 开发者工具核查卡在原生绘制、WebView 启动、JS 长任务、绘制还是合成。先测后判根因。
3. **小范围修订**：已统一到现有 Android 前景图案，移除 Web 光晕和阴影；启动控制器已按上限时序退场并在遮罩移除后才解锁输入。原生桥接试验不稳定，未保留。未改变业务启动请求和资源状态契约。
4. **验证与回退**：补自动化的“提前 ready、中途 ready、慢 ready、失败、后台/恢复、减少动态效果、快速点击被遮挡控件”用例。若目标低端设备未达到顺滑门槛，降级为静态图标 + 200ms 左右的单次淡出，而非固定 30fps 或继续加长遮罩。

## 5. 验收门槛

- 至少在一台实际手机和目标 PDA（如可提供）上记录冷启动 20 次、温启动 10 次、热启动 10 次；分离正常/减少动态效果、离线、登录回调和后台恢复。未提供设备时只可标记“待真机验收”。
- 录屏逐帧检查：无空白闪帧、图标轮廓/视觉中心跳变、动画中途定格、重复播放；首屏错误/重试可见且可操作，业务数据慢加载仍由局部状态表达。
- **仅在图标实际运动和遮罩淡出区间**统计慢帧/连续丢帧；有意安排的静态停留不计为丢帧。帧时间按设备实际刷新率记录，并用逐帧录屏核对可见停顿，不把浏览器模拟器结果替代实体设备。若不达标，先查看 trace，再执行静态降级。
- 壳层挂载后的正常绘制机会/装饰缓冲不超过 180ms，遮罩退场目标 220ms；退场前的触摸不触发被遮挡的设备操作。减少动态效果不额外等待。
- Android 与 Web 构建、现有启动 E2E、移动端流程和真机覆盖安装均需通过；APK 版本与源码/构建清单一致，不能用旧包评价新动效。

## 6. 本轮实现位置

| 文件 | 本轮职责与状态 |
| --- | --- |
| `client/android/app/src/main/res/values/styles.xml` 与图标资源 | 原生背景和可见图标校准；必要时调整静态资源。 |
| `client/index.html` | 首帧图像、精简关键 CSS、等待/失败提示与减少动态效果。 |
| `client/src/js/platform/startup-transition.js` | 基于真实就绪的有上限节奏、平滑中断、输入解锁与清理。 |
| `client/src/main.js` | 保持现有壳层就绪信号，不改变数据请求顺序；本轮无需修改。 |
| `client/android/app/src/main/java/com/iot/manager/client/MainActivity.java` | 本轮未改变；系统启动页仍由 Android 管理。若真机轨迹证实原生交接问题，再单独设计退出监听。 |
| `client/e2e/startup-animation.spec.js`、真机验收记录 | 时序、失败、无障碍及性能回归证据。 |

## 7. 本轮实现与验证状态

- 客户端版本提升至 1.1.2 / Android versionCode 4。试行的原生 `StartupVisual` 桥接在模拟器超时，已从最终源码移除；移除后重新同步 Web 资源、构建 Android Debug APK，核对包名/版本/签名，并在项目 API 36 模拟器覆盖安装及冷启动进入 App。最终包不包含该桥接。
- 最终代码复跑 Node 22 客户端单元测试 **198 通过、0 失败**；启动/底栏/移动端浏览器用例 **5 通过、0 失败**；Vite 生产构建与预览隔离检查通过。
- 本地交付包（按仓库规则不纳入 Git）：`artifacts/release/startup-motion-20261001/iot-manager-startup-motion-1.1.2-debug.apk`（6,053,725 字节；SHA-256：`F4896B72BB57AF578496C94CB01F3DE8AE1170AA8DF82329862B1623442AB664`）。包名 `com.iot.manager.client`，`versionCode=4`，`versionName=1.1.2`；签名为 Android Debug，非正式发布签名。安装前应确认现有 App 使用相同签名，否则不能直接覆盖。
- 模拟器默认开发后端不可达，界面显示真实错误/只读状态；该截图不证明联网、设备控制或实体设备帧流畅度。
- 实体设备未连接，尚未获得型号、Android/WebView 版本及录屏。第 5 节真机帧验收保持**待验证**，不得据此宣称用户实机问题已完全解决。

## 8. 参考依据

- [Android SplashScreen 官方指南](https://developer.android.com/develop/ui/views/launch/splash-screen)：系统页显示机制、图标遮罩与退出动画；不要把图标动画时长误当作系统页实际显示时长。
- [Android WebView `postVisualStateCallback` API](https://developer.android.com/reference/android/webkit/WebView)：必要时确认 Web 内容已准备好用于下一次绘制。
- [Android WebView 启动优化](https://developer.android.com/develop/ui/views/layout/webapps/optimize-webview-startup)：WebView 初始化可能在 UI 线程造成启动阻塞，需依据 trace 决定是否优化。
- [Chrome 非合成动画诊断](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations)：低端设备上的非合成动画可能卡顿，需用开发工具确认具体原因。
- [Android 慢帧诊断](https://developer.android.com/topic/performance/issues/render)：使用设备侧帧轨迹分析卡顿，而非仅凭动画总时长判断。
