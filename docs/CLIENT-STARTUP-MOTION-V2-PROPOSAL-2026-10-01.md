# 启动页动效 v2 设计提案：原生单层揭幕

> 状态：**审核后修订方案，仅供审看；未修改客户端实现或安装包**  
> 反馈：用户确认在最新交付的 1.1.2 Debug 包上，实体设备启动页仍不够连贯，结束得太快。  
> 适用：Android 手机与 PDA 冷启动、温启动；热启动不重播。浏览器整页刷新沿用简化的 Web 方案。
> [并排节奏预览](../artifacts/startup-motion-v2-preview/preview.html)：模拟当前快启与本提案的时间差，不代表真机帧率。

## 已知情况

当前工作区的 1.1.2 实现已统一 Android 与 Web 所用的图标前景图案，并移除了 Web 光晕和阴影。但 Web 启动层仍单独播放 550ms 微缩放；控制器以 450ms 为展示目标、就绪后最多等待 180ms、随后用 220ms 淡出。快速设备上动画可能还在进行时，启动层便开始消失。Android 系统启动页与 Web 启动层仍是两个独立的可见层。

这些代码事实能解释“感觉短”和“衔接可能突变”，但没有目标真机的逐帧录屏与帧轨迹，不能认定某一帧卡顿的唯一根因。用户已确认反馈对应最新交付版本；交付目录中的候选包为 `iot-manager-startup-motion-1.1.2-debug.apk`（SHA-256：`1FDCEEF02A17A6F497DDE4B923364D2D5B95813D25A4104E75AE0ABFBF20FB02`）。实体设备上的已安装包哈希仍待 ADB 核实。

审核还发现两处实现前提需要修正：当前 `startupTransition.markUiReady()` 在 `bootstrapRuntime()` 恢复本地站点、连接配置与设备绑定之前调用；当前 Android 代码只有 `installSplashScreen()`，没有 `StartupVisual` 桥接。以下按**新建桥接、拆分启动阶段**设计。

## 推荐方案

**Android 正常启动只让系统 SplashScreen 承担可见图标和退场。** 继续使用现有应用图标和 `#F3F6F7` 背景，图标静止、不呼吸；当本地首屏稳定、WebView 报告其内容可供下一次绘制时，由原生启动页一次性淡出，露出完整首页。Web 启动层保留为慢启动和浏览器环境的静态回退；WebView 不可用时由原生提供静态错误回退。正常 Android 路径不播放第二段图标动画。

这样把用户看到的运动收敛为一次 `opacity` 变化。背景色、图标视觉中心和系统遮罩由原生层始终保持一致；退场时只揭开已准备好的首页，不再经历“系统图标消失 → Web 图标出现 → Web 图标缩放 → Web 遮罩消失”的接力。

## 时间与状态

| 阶段 | 初始建议 | 触发条件 |
| --- | ---: | --- |
| 系统图标与原生退出视图 | 至少约 800ms，自 `Activity.onCreate` 计时 | Activity 首次绘制后由 `SplashScreenViewProvider` 保持不透明；本地首屏稳定且 WebView 绘制确认后，才允许退场 |
| Web 首屏绘制确认 | 无固定耗时承诺 | 隐藏但保留 Web 回退节点后调用 `postVisualStateCallback`；回调只保证该 DOM 状态可供下一次绘制 |
| 就绪后的补足停留 | `max(0, 800ms − 已运行时间)` | 已慢于 800ms 时不额外等待；不等待联网同步 |
| 原生退出 | 初始 360ms | 退出视图透明度 `1 → 0`，缓出；结束或取消时调用 `remove()`，随后解除首页交互限制 |
| 退场前异常上限 | 从 `Activity.onCreate` 起约 3s | 若尚未开始淡出，进入有可操作重试入口的回退；已开始淡出则让有界动画完成 |

800ms 停留加 360ms 淡出，意味着**从 Activity 起点计算的最快正常路径也约 1.16 秒**；点击图标到 Activity 创建之前还有系统耗时，因此不承诺点击到可操作固定为 1.0–1.3 秒。以目标手机和 PDA 的冷启动实测中位数、P95 及帧时间校准上述参数。设备本来启动较慢时不再补足 800ms。Android 图标资源声明的动画时长不会控制 SplashScreen 实际停留时长。

### 正常交接：先确认首屏，再揭开

1. `Activity.onCreate` 安装 SplashScreen 并注册退出监听。允许 Activity/WebView 正常请求首次绘制；退出监听取得 `SplashScreenViewProvider` 后，**保持该视图完全不透明**，让 WebView 在其下方准备首屏。原生还需单独确认初始 Web 覆盖层已可绘制，记录 `WEB_FALLBACK_READY`。不在 `setKeepOnScreenCondition` 中等待 JS、WebView 回调、计时器或 I/O；如保留该条件，它只快速读取原生状态标志。
2. Web 先完成**本地首屏阶段**：恢复本地设备绑定、站点及连接配置，应用这些会改变首屏的状态，等待对应 UI 渲染提交。当前 `activateEndpoint()` 中会等待 `synchronizePlatformEndpoint()`，实施时需把本地首屏提交与网络同步拆开。网络、远端设备数据和在线鉴权刷新可继续执行，但不作为揭幕门槛；揭幕期间发生的结构性页面更新延至退场完成后显示。冷启动 OAuth 回调等尚未确定初始页面的场景，不提前报告首屏稳定。
3. Web 将原有启动覆盖层**仅隐藏，不删除**，保留其节点、静态图标和重试入口；`#app` 继续保持 `inert` 与 `aria-hidden`。新的 `StartupVisual` 桥接向原生报告本次启动的编号。原生在 WebView 已附着且可见时调用 `postVisualStateCallback`，确认隐藏覆盖层后的 DOM 状态可供下一次绘制。回调完成且达到最短停留时间后，才启动原生淡出。
4. 原生退场结束或取消时只调用一次 `SplashScreenViewProvider.remove()`，并把本次编号的完成信号交给 Web；Web 随后删除已隐藏的覆盖层、停用其看门狗、解除首页交互限制。旧编号或过期回调不能再次退场或解锁。如果 Web 到 `Activity` 起点后约 4 秒仍未收到退场完成信号，它恢复保留的 Web 覆盖层及重试入口，维持 `#app.inert`，避免“首页可见却永久不可点”。

### 超时与失败：每条分支都有可见内容

| 3 秒上限到达时 | 显示内容与处理 |
| --- | --- |
| 尚未隐藏 Web 覆盖层，且其绘制已确认 | 原生视图直接移除，露出仍然存在的**静态 Web 回退页**；保留“正在准备”及原有 4 秒重试入口，待应用后续就绪时由 Web 完成回退页退场。 |
| 已隐藏 Web 覆盖层，但首页绘制确认未返回 | 不直接露出未经确认的首页。原生先显示同背景、同图标的**静态错误回退视图**及“重新加载”按钮，再移除 SplashScreen 退出视图；重试重建本次启动状态。 |
| WebView 未附着、无法绘制、桥接失效或渲染进程故障 | 进入同一原生错误回退视图；其文字和重试入口不依赖 Web JS 执行。 |

Web 回退层的绘制确认与首页绘制确认是两个不同状态；只有确知前者仍可显示，才直接释放到 Web 回退。原生错误回退视图仅用于异常路径，正常启动仍只有一次可见图标退场。超时后的迟到回调按启动编号丢弃；每个分支都只移除一次原生启动视图。

3 秒计时从 Activity 创建起算，进入淡出后取消该计时，另用短时限确保动画必定结束或取消。若超时发生在退出监听尚未提供视图之前，先记下回退决定，取得视图后立即执行。主线程完全冻结属于 ANR，仍需按帧轨迹和阻塞栈单独处理。

### 异常与偏好

- **慢启动**：按上表选择已确认的 Web 回退页或原生错误回退视图，不显示空白页，也不无限覆盖重试入口。
- **减少动态效果**：首屏绘制确认后立即移除原生视图并完成 Web 交接，不执行 800ms 补足或 360ms 淡出；异常仍按上表回退。
- **热启动/前后台恢复**：保持现有页面，不重播。
- **浏览器刷新**：没有原生层时，静态图标显示到壳层可绘制；快速路径建议约 700ms 可见时间加 280ms 淡出，慢路径立即退场。此参数独立于 Android 调节。
- **交互**：正常路径在原生退出完成后才解除 Web 首页的 `inert`；回退路径的重试按钮必须可点。音量键、系统返回键遵循 Android 默认行为，不因装饰动画排队。

## 实现边界

1. `MainActivity` 保存启动起点和退出视图，注册 `setOnExitAnimationListener`；用主线程短操作更新状态和触发动画，确保动画结束、取消及超时只调用一次 `remove()`。首屏绘制确认在退出监听持有的不透明视图后方进行，避免以 `setKeepOnScreenCondition` 阻断 WebView 绘制。若使用该条件，其回调只能读取布尔状态，不能阻塞主线程。
2. **新建** `StartupVisual` Capacitor 插件及 Web 侧适配器；协议包含启动编号、准备揭幕、绘制确认、退场完成与失败回退。所有 WebView API 调用在创建它的线程上执行，确保 WebView 已附着且 `VISIBLE`。`postVisualStateCallback` 只证明当前 DOM 状态可供下一次绘制，需靠真机录屏确认揭幕后没有空白帧。
3. 将当前 Web 启动控制器的“隐藏图标层”“删除图标层”“停止看门狗”“解除 `inert`”拆成独立步骤。Web 回退页在正常原生退出完成前一直可恢复；任何计时器或回调都不能提前解锁。浏览器路径独立使用原有覆盖层，不调用原生桥接。
4. 拆分 `bootstrapRuntime()` 的本地首屏提交与 `activateEndpoint()` 的远端同步；把就绪信号从当前过早的 `markUiReady()` 移到本地首屏渲染提交之后。必要的初始页面状态须先稳定，网络结果不拖长启动动画。
5. 准备不依赖 Web JS 的原生静态错误回退与重试入口。Android 当前最低 API 为 24，`postVisualStateCallback` 的最低 API 为 23；使用现有 `core-splashscreen` 兼容路径，分别验证 Android 11 与 Android 12+。未来更换图标时沿用同一启动资源生成流程。

## 真机验收

- 核对反馈 APK 的版本号、哈希、设备型号、Android/WebView 版本、刷新率与省电模式。采集点按桌面图标到首页可点的完整录屏；若可用，再采集 FrameTimeline/Perfetto。
- 手机与目标 PDA 各做冷启动 20 次、温启动 10 次；另测离线、登录回调、后台恢复和减少动态效果。逐帧检查空白闪帧、图标位置或尺寸跳变、重复图标、退场卡顿及误触。
- 人为延迟本地首屏、绘制回调、桥接响应并模拟 WebView 加载失败，逐项核对上表的回退分支；检验超时后的迟到回调、动画取消及重试不会重复移除视图或让首页永久不可点。
- 以设备刷新率计算帧预算：60Hz 为 16.7ms、90Hz 为 11.1ms。退场段不应出现连续两帧以上的可见停顿；记录帧时间分布和实际“点击到可操作”时长，不以模拟器结果代替真机。
- 若原生退出仍在目标设备掉帧，优先根据轨迹消除启动期主线程阻塞；在无法消除时，回退为静态图标直接揭幕，避免继续叠加动效。

## 参考

- [Android SplashScreen 指南](https://developer.android.com/develop/ui/views/launch/splash-screen)
- [AndroidX SplashScreen API](https://developer.android.com/reference/androidx/core/splashscreen/SplashScreen)
- [WebView `postVisualStateCallback`](https://developer.android.com/reference/android/webkit/WebView#postVisualStateCallback(long,%20android.webkit.WebView.VisualStateCallback))
