# IoT Manager Glass 启动链路实施与测试记录

日期：2026-10-18（Asia/Shanghai）<br>
工程：`apps/client-glass-next`<br>
版本：**1.1.4-glass.6 / Android versionCode 11**<br>
包名：`com.iot.manager.glassnext`<br>
设计依据：[启动开发文档](GLASS-STARTUP-ANIMATION-DEVELOPMENT-2026-10-18.md)<br>
状态：**核心开发、自动化回归和 Android 模拟器功能验证完成；手机/PDA 性能与真实环境发布验收待执行。**

## 1. 交付与源码身份

仓库保留脱敏的[验证摘要](GLASS-6-STARTUP-VERIFICATION.json)。以下 APK、录屏和原始日志仅保存在本机 `artifacts/glass-startup-development-20261018/`，未上传 Git；表内文件名均相对此目录。

- 调试 APK（`IoT-Manager-Glass-1.1.4-glass.6-debug.apk`，本机产物）
- Android 启动录屏（`glass6-native-startup.mp4`，本机产物）
- 原始验证目录（`glass-startup-development-20261018`，本机产物）
- 构建与来源清单（`manifest.json`，本机产物）

构建基于 Git HEAD `0c0ed0393f880d6483ce72632bdaa8980a3a4afe` 与本轮工作区改动，`build-info.json` 明确标注 `dirty=true`，没有将工作区状态冒充已提交版本。构建 UTC 时间为 `2026-10-18T06:22:49.610Z`。源码摘要和差异保存于本机验证目录。该 APK 生成于提交前工作区，源码提交不改变包内历史 build-info；未发布 Release。

APK SHA-256：

```text
B4A556F62CA44BEB7E2512E4C3048DB6189CE47FA0977C06E34042BF0BA7B656
```

实现保留在独立 Glass App 中；传统 `client/` 无本轮差异。附件及原开发方案作为输入保存，没有执行附件里的反编译补丁。

## 2. 已实现的行为

| 模块 | 当前行为与边界 |
| --- | --- |
| 本地首屏 | 安装身份、绑定摘要、站点、端点、待定位、启动 URL 独立读取，单项等待上限 1800ms；按依赖顺序应用结果。超时不重复生成安装 ID，也不接受迟到快照。 |
| 身份保护 | 未核实的临时安装身份不能恢复其他安装的 BLE 绑定，不能保存新绑定。恢复的 BLE 连接显示 OFFLINE/DISCONNECTED，不把缓存连接当作在线 GATT。 |
| 动态历史 | 首屏不读取每个绑定的全量历史；打开设备时读取 50 条，之后通过“查看全部→加载更多本地动态”翻页。按绑定、时间、ID 的 IndexedDB 复合索引读取，边界不重复。 |
| 就绪分层 | 本地界面就绪、可交互、首批数据结束分别管理。显示未完成或当前作用域失效时不应用预取，不写成功状态。 |
| 视觉与数据 | 可选站点预取与退场并行，只缓冲结果；交互解锁且上下文仍有效后应用。有效令牌、无临期刷新和非 OIDC 回调是必要条件；相同范围 single-flight。 |
| 端点持久化 | 启动时不重复等待端点设置写入；退场后写入并串行化，避免较早写操作覆盖后续选择。旧 Preferences 令牌不返回给会话。 |
| Native/Web 所有权 | Android 正常路径只播放原生退场；Web 遮罩作为后备。保持主页 inert/aria-hidden，收到匹配完成事件或确认盖板已移除后再解锁。 |
| 启动身份 | 新协议使用 activityInstanceId + launchId；Activity 重建与重试后旧 ready/事件不能作用于新一轮。先安装完成监听，再查询状态和申请退场。 |
| 失联与错误 | 完成事件丢失时有界查询；未知 Native 状态不盲目解锁。确定失败后保持恢复页，迟到 ready 不越过错误终态。重试会建立新 attempt 并防连点。 |
| 原生回退 | Web 遮罩先报告就绪并通过可见帧确认。无事件时最多 4 次退避探测，间隔 250/500/1000/1000ms，仅一个 evaluateJavascript 在途。8s 后安全交给已确认的 Web 遮罩或显示原生恢复页。 |
| 生命周期 | 退场进后台时停止、复位装饰动画；前台重新确认帧。销毁清理 timer、rAF、listener、Animator、预取与读取任务，取消不等同于成功。 |
| 等待反馈 | 500ms 等待提示、4s 非致命慢提示、Web 7.5s 可重试；确定模块错误可提前恢复。Native 持有遮罩时 Web 不另行暴露第二个重试入口。 |
| 可访问性 | reduced motion、系统禁用动画、hidden/degraded、实色和高对比度有独立降级。错误状态停止光环；文案与重试按内容排布，320px、横屏、200% 字体下不重叠。 |
| 素材 | Web 使用独立 public/assets/startup-icon.png，与当前 Android 活跃前景 PNG 摘要一致；底色统一 #eff5f6。图片失败显示静态 IoT 文字。沿用现有图标，没有另行重绘品牌。 |
| 可观测性 | Web 保存有界、白名单字段的启动阶段记录，DEV 提供 __iotStartupTrace；Native DEBUG 输出 StartupVisual 阶段与单调时钟。APK build-info 和本轮清单用于关联来源。未加入 reportFullyDrawn 或完整生产遥测。 |

主要源码入口：[main.js](../src/main.js)、[bootstrap](../src/js/platform/startup-bootstrap.js)、[transition](../src/js/platform/startup-transition.js)、[Native coordinator](../android/app/src/main/java/com/iot/manager/glassnext/StartupCoordinator.java)。

## 3. 当前参数与实验开关

| 参数 | 默认值 |
| --- | --- |
| Native 最小驻留 / 退场 / 退场兜底 | 180 / 340 / 480ms |
| Web 最小可见 / 退场 / 退场兜底 | 160 / 360 / 500ms |
| 原生恢复 / 救援预算 | 8000 / 9500ms |
| 可选读取等待 / 预取等待上限 | 1800 / 4000ms |

驻留只补足剩余时间；Native 与 Web 不串加两段驻留。系统减少动画时仍校验本地壳与必要帧，不等待装饰周期。上述节奏是快速候选配置，未通过目标手机/PDA 的最终观感与帧率选型。

| 构建配置 | 默认 | 作用 |
| --- | --- | --- |
| VITE_STARTUP_MOTION | true | 启用必要范围内的装饰与透明度退场；false 时关闭装饰。 |
| VITE_STARTUP_DEPTH | false | Web 小范围视觉容器的轻缩放试验，不缩放全屏主页。 |
| VITE_STARTUP_BLUR | false | Web 图标退场局部模糊试验，不模糊全屏。 |
| VITE_STARTUP_PREFETCH | false | 在有效身份下预取站点读取。 |

默认关闭后三项，符合“先测目标设备，再开实验”的门槛。开关示例见 [.env.example](../.env.example)；变更后重新构建。本轮未实施第二阶段的 Web 主导正常原生退场模式。

## 4. 实际测试结果

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| Node 全量单元 | 240 通过，0 失败，0 跳过；开发前基线 220 通过 | unit-final.log（`unit-final.log`，本机产物） |
| 浏览器全量 | 75 通过，8 跳过，0 失败 | e2e-final.log（`e2e-final.log`，本机产物） |
| 最终启动/材质专项 | 22 通过，0 失败 | e2e-final-layout.log（`e2e-final-layout.log`，本机产物） |
| Native JUnit | 5 通过：4 个启动策略测试与 1 个既有模板测试 | native-app-test-build.log（`native-app-test-build.log`，本机产物） |
| Android 仪器 | 4 通过：包身份、恢复页拒绝迟到 ready、Activity 重建隔离、无 JavaScript 重试后 8s 原生恢复 | native-instrumentation-final.log（`native-instrumentation-final.log`，本机产物） |
| Web 生产构建与隔离 | 成功；开发预览与 fixture 未进入输出；公开构建环境检查通过 | android-final-build.log（`android-final-build.log`，本机产物） |
| Debug APK | build → cap sync → assembleDebug 成功；安装后核实 glass.6/code 11 | 同上，及 manifest.json |
| 最终包进程重启 | 3/3 完成原生退出，未进入恢复 | final-native.json（`final-native.json`，本机产物） |
| 最终 WebView DOM | shell 存在；overlay 不存在；inert=false；aria-hidden 已移除；watchdog=completed | native-dom-final.json（`native-dom-final.json`，本机产物） |

新增边界包括共享在途 Promise、旧 Activity/attempt、重复完成、listener 延迟注册后销毁、非本层 transitionend、未知桥接状态、挂起本地读取、预取取消/截止、临时安装身份、v2 历史迁移，以及 55 条本地历史的真实页面分页。

浏览器使用本地隔离 API/WebSocket 测试边界；5s、7.5s 提示使用 Playwright 可控时钟。页面测试能验证 DOM、交互和时序，不代替真实硬件/身份服务验收。

跳过的 8 项：真实 Keycloak/API/WSS 5 项、真实 AI 1 项、1000 设备负载 1 项、N→N-1 回滚 1 项。本轮未启用这些环境或提供相应凭据/旧版本服务入口；跳过不计为通过。

## 5. Android 证据的适用范围

使用本机只读隔离 AVD `IotManagerGlass5Audit`，固定 serial `emulator-5586`；Android 16 / API 36，设备模型 sdk_gphone64_x86_64，WebView 133.0.6943.137，1080×2400。Wi-Fi 与移动数据关闭；没有安装至实体手机或发送现场设备指令。

最后一轮原生 `activity_create→exit_completed` 为 **6705 / 5716 / 5856ms**。这是模拟器进程重启日志，不是物理屏幕呈现时间，也不包含完整首批网络数据。不能据此宣称真机提速、60fps 或 p95 达标。

先前 glass.5 基线在构建/回归并发负载下包含超时样本，不能作为有效性能对照。最终包第一次补采时模拟器进程退出，已另起只读 AVD 并关闭 Vulkan 后完成 3/3 与 DOM 核验；保留原始失败/中间日志，不混算成一组对照。

查看：Web 等待截图（`web-startup-waiting.png`，本机产物）、Web 错误恢复截图（`web-startup-recovery.png`，本机产物）、Android 首页截图（`final-native.png`，本机产物）、原生启动录屏（`glass6-native-startup.mp4`，本机产物）。

录屏已解码核验：1080×2400，媒体时长约 6.98s，并保存阶段帧。该录屏为可变帧率，不从媒体时长推导启动耗时或帧率达标结论。

## 6. 兼容性与发布前待验项

1. **目标设备验收：** 仍需目标手机/PDA、最低 API、Android 12+、现场 WebView；按设计记录每种关键环境至少 20 次冷启动、10 次温启动、实际录屏和帧间隔。前后台/读屏/大字号也需在目标硬件复核。
2. **真实身份与业务：** 真实 OIDC 冷回调、令牌刷新/轮换、角色与站点隔离、AI 和设备控制保留原契约；本轮自动化不能代替相应现场验收。
3. **数据库回滚：** 历史分页将 IndexedDB 从 v2 升至 v3，旧记录迁移已通过测试；未经兼容修复的旧 APK 以 v2 打开同库会发生 VersionError。回退动画开关不会降库版本。N→N-1 数据回滚尚未验收，发布回滚方案必须使用能打开 v3 的兼容旧包或另行确定数据恢复流程。
4. **试验效果：** 预取、深度、模糊默认关闭；开启前验证帧代价、认证、429/离线和重复请求。保留 Native 正常退出架构，Web 主导模式留待第二阶段。
5. **发布包：** 当前交付为 Debug 测试包。正式签名、生产入口与最终发布编号仍走现有发布流程；本轮没有发布或替换正式 App。

## 7. 复现

在独立工程执行：

```powershell
npm test
npm run test:e2e
npm run android:debug
```

Native 测试在其 android 目录执行 App 范围任务：

```powershell
./gradlew.bat :app:testDebugUnitTest :app:assembleDebugAndroidTest
```

安装 app-debug.apk 与 app-debug-androidTest.apk 后，针对明确测试 serial 执行：

```powershell
adb -s emulator-5586 shell am instrument -w com.iot.manager.glassnext.test/androidx.test.runner.AndroidJUnitRunner
```

本机 Gradle 使用 JDK 23 / SDK 36。初次 Windows JUnit 进程受 PATH 中 Java 8 路径空格影响，改为当前命令的最小 PATH 后通过。未限定模块的 assembleDebugAndroidTest 会构建 Capacitor 库自身的旧测试 APK 并触发 Kotlin stdlib 冲突；本轮最终使用上面的 App 范围任务，没有为此改动业务依赖。

浏览器故障注入已兼容入口 URL 的 Vite 时间戳参数，防止热更新后拦截失效。Android 既有模板测试中的默认包名断言已修正为当前独立包名。日志中早期失败属于排查记录，最终结果以上表为准。
