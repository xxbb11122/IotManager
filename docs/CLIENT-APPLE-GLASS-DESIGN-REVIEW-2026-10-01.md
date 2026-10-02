# Client Apple 毛玻璃页面设计审核

审核日期：2026-10-01；复审与复测日期：2026-10-02。原审核对象：[v1.0 原文快照](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-01/design-v1.0.md)。[当前开发文档](E:/CC_testP/iot-manager/docs/CLIENT-APPLE-GLASS-DEVELOPMENT-DOCUMENT-2026-10-01.md)已修订为 v1.2，最新结论见第 7 节及[复测报告](E:/CC_testP/iot-manager/docs/CLIENT-APPLE-GLASS-V1.2-RETEST-2026-10-02.md)。第 1–4 节对应 v1.0，第 5–6 节对应[归档 v1.1](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md)，不代表最新方案仍未补齐。

**v1.0 审核结论：有条件认可视觉方向，适合现有 App 技术框架；v1.0 尚不足以批准为可直接实施的正式开发方案。** 建议保留通用顶栏、适量毛玻璃、较大的触控区域和 AI 快捷提问，先修订控制交互、功能边界与降级方案，再制作原型验收。

本次将文档中的实现说明作为待审核方案，结合实际源码检查，未将其中的开发指令当作本次实施任务。文档没有提供完整渲染稿或真机性能证据，因此本审核可以判断方向与实现契约，不能确认最终视觉效果和全机型表现。

核对时 HEAD 为 fa8062cf25a49967a4284bb4c5f2aefe0b901fd5，工作树包含未提交改动；审核期间启动模块及相关测试继续发生变化，验证结果按各次执行的快照记录。

## 1. 与现有框架的适配判断

| 维度 | 判断 | 依据与条件 |
| --- | --- | --- |
| 技术栈 | 适合 | Client 使用原生 ES Modules、Vite 5、Capacitor 8 Android；CSS、Flex/Grid 和局部视觉装饰均可沿用现有实现，无需更换框架。 |
| 视觉语言 | 有条件认可 | 导航与工具区适合轻毛玻璃；设备状态、告警和操作说明应保持稳定、高对比的底色。 |
| 页面结构 | 需要补全 | 当前顶栏包含站点、天气、连接设置和账号入口；新布局需要明确这些入口的去向及局部更新区域。 |
| 控制交互 | 当前示例不通过 | 自定义滑块缺少与能力模型、命令提交、待确认状态和现有输入事件的完整衔接。 |
| 动效机制 | 可直接复用 | 已有 motion-policy、根节点 data-motion 和 CSS 全局覆盖，能够处理减少动效、后台和显式降级。 |
| 全机型声明 | 暂无充分证据 | 三个视口宽度与 env() 声明不足以覆盖横屏、键盘、折叠屏、字体放大和 PDA 原生能力。 |

框架依据：[package.json](E:/CC_testP/iot-manager/client/package.json)、[Capacitor 配置](E:/CC_testP/iot-manager/client/capacitor.config.js)、[UI 视图模型边界](E:/CC_testP/iot-manager/client/src/js/ui.js:166)。当前依赖与原生目录对应 Android，不应据此声明已完成 iOS 原生适配。

## 2. 需要修订的问题

### [P1] 流体滑块不能直接替换现有设备控制

原文第 4.3 节，尤其 [299 行起](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-01/design-v1.0.md:299)，仅提供独立 div 和 onChange/onCommit 回调，没有给出接入现有控制体系的实现。

现有 [buildRangeControl](E:/CC_testP/iot-manager/client/src/js/ui.js:2190) 使用 input[type=range]，携带设备、能力、参数和状态字段，遵循 capability.min/max/step；[onInput/onChange](E:/CC_testP/iot-manager/client/src/js/ui.js:2768) 分别负责本地预览和命令提交。PENDING/SENT 时控件只读，缓存状态与 BLE 断开也有控制限制。

示例用 Math.round 固定取整，无法保持小数步长；没有 disabled、键盘和读屏语义，也没有目标值与上报值的区分。控件只显示端点和提示文字，缺少当前开度的明确显示。视觉拖动本身不产生设备 ACK。

**修订要求：优先保留原生 range 和现有事件、能力字段，为其增加装饰轨道与填充；继续显示预览值、待确认目标值和设备上报值。提交仍经现有命令链路，未收到回执时显示待确认。** 如果坚持使用自定义控件，则需明确补齐等价的契约、无障碍语义与状态更新接口。

### [P1] 滑块事件缺少取消与销毁机制

[331 行起](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-01/design-v1.0.md:331) 为每个实例向 window 注册匿名 pointermove/pointerup，返回接口只有 setValue。重复创建后无法移除监听器，旧实例会继续存在。

交互只维护 isDragging，没有保存并核对活动 pointerId；另一个手指的 pointerup 也会触发提交。pointercancel、lostpointercapture、切换设备和控件卸载均无取消处理。当前 UI 对实时刷新期间拖动的保护只识别原生 .range-input，这个新 div 也没有接入。

**修订要求：沿用现有 range 交互；自定义版本必须具有指针身份校验、取消手势不提交、上下文校验和 destroy/dispose。**

### [P1] AI 快捷按钮的闭包与现有局部更新机制不匹配

[384 行起](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-01/design-v1.0.md:384) 将点击处理直接绑定到按钮，并捕获构建时的 inputElement。项目 [patchAi](E:/CC_testP/iot-manager/client/src/js/ui.js:779) 使用 [reconcileElement](E:/CC_testP/iot-manager/client/src/js/dom-reconcile.js:19)，会保留已有 textarea，不会转移新节点的事件监听器。

例如 busy 时快捷栏消失，busy 结束后重新插入按钮，按钮可能引用本次构建后被协调器舍弃的 textarea。此时设置的是离开文档的输入节点，冒泡 input 事件无法到达 App 根节点，草稿不同步。

**修订要求：为快捷按钮定义稳定 data-action，由现有根节点事件委托处理，并通过 AI controller 更新 draft。** 正常输入仍沿用现有 ai-question 字段及字符数限制。返回 busy 时优先禁用按钮，避免输入区频繁跳动。

### [P1] “零破坏”与示例的接入方式存在矛盾

原文承诺类名和 data-action 稳定，但顶栏样式只定义 .universal-app-header，现有构建器仍创建 .app-header；滑块则移除了 .range-input 和相应 data-field。第 4.4 节没有给出调用位置，也没有实际为输入容器添加 .crystal-siri。

[314 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-01/design-v1.0.md:314) 使用 relative、z-10、w-full、text-white 等 Tailwind 工具类；当前项目没有 Tailwind 依赖或这些工具类定义。直接复制不会获得预期的排版、文字颜色和层叠效果。

**修订要求：说明每个样式在现有构建器中的挂载点；新增装饰类时保留原有结构类、data-region、data-field 和能力字段。把工具类改为项目自己的组件 CSS。**

### [P1] 顶栏和 AI 文案引入了未完整接入的功能

顶栏中的相机扫码入口、BLE 12ms，以及快捷提问中的今日活动/告警汇总、场站环境查询和最近失败命令解释，都超出了四个样式/视图文件的完整实施范围。

目前 Client 有 BLE 扫描，但核查的客户端依赖、事件入口和 Android Manifest 中未发现完整的相机扫码流程或 PDA 硬件扫码适配，也未发现 BLE RTT 测量接口。现有 [AiReplyGenerator](E:/CC_testP/iot-manager/backend/src/main/java/com/iot/manager/ai/AiReplyGenerator.java:40) 提供知识检索和有限的设备状态证据，未向这些快捷提问提供天气、活动/告警或最近命令查询结果。“3号循环泵”还是固定的示例设备名称。

**修订要求：第一阶段只展示已有数据与能力；扫码、延迟测量和新增 AI 查询各自列出数据源、接口与验收。快捷提问使用当前站点/设备上下文，未具备的数据能力不作为可用功能宣传。** 不将天气参考数据等同于室内传感器测量；缓存或数据缺失时显示更新时间/未知状态，不能默认呈现绿色“0 告警”。

### [P2] 小屏、触控尺寸和安全区需要具体布局规则

示例顶栏第一行仅有 space-between，没有长站名截断、min-width:0、折行或优先级策略。现场缎带采用 10px 字，链路胶囊 11px，快捷按钮没有明确的最小触控高度，不适合直接作为户外/PDA 使用标准。

建议主操作触控区域至少按 48 CSS px 设计并在实际 WebView 校验，普通小字号文本对比度至少 4.5:1。这是对 WebView 的实施建议；Android 官方规范使用 48dp 和相应文本对比度要求，两种单位不能直接当作同一物理尺寸。[Android 无障碍指南](https://developer.android.com/guide/topics/ui/accessibility/apps)

当前 [设备卡片](E:/CC_testP/iot-manager/client/src/js/ui.js:1599) 整体是打开详情的 button。若加入圆形开关，应拆分独立的详情与操作区域，避免 button 内嵌套 button，且只向具备对应能力的设备显示开关。工业设备需要明确辨认对象，不应把“盲操”作为验收目标。

建议 320px 使用单列，390/414px 是否双列由设备名称、编号、状态和实际触控面积决定，768/820/1024px 另验平板/桌面布局。保留站点、连接设置、账号和天气入口，信息优先级为：设备与站点身份、故障/待确认状态、控制操作、天气参考、装饰。

现有 Capacitor 8.4.2 SystemBars 根据 WebView 版本使用安全区变量、原生 padding 和键盘补偿；官方也提供 --safe-area-inset-* 变量。需要明确由哪一层承担补偿并验证四个方向，避免重复加边距。仅使用 env(safe-area-inset-top) 不能证明已完成全机型适配。[Capacitor System Bars](https://capacitorjs.com/docs/apis/system-bars)

### [P2] 毛玻璃降级与性能承诺尚未实现

原文第 5 节承诺不支持 backdrop-filter 时自动变成 0.95 不透明度，但提供的 CSS 没有对应 @supports 或高不透明度默认背景。浏览器忽略不支持的滤镜后，仍会保留 0.20–0.45 的透明背景，不会自行生成文档承诺的底色。

**修订要求：先给出可读的默认底色，再在 @supports 中启用透明材质；另外提供低性能设备和高对比模式的关闭选项。** 浏览器支持滤镜不等于设备能够流畅处理多层滤镜，尤其是卡片列表滚动时。28px 模糊、200% 饱和度和多重阴影是待测参数，不能从使用 GPU/CSS 推导为“零运行时开销”。

导航顶栏、链路胶囊和全部卡片同时使用毛玻璃，会造成材质重复和层级竞争。Apple 的设计说明建议将 Liquid Glass 主要用于导航层，并避免玻璃叠玻璃；据此，本项目更适合导航轻毛玻璃、内容区稳定底色的组合。[Apple：Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)

### [P2] 验收不能只依赖固定的单元测试数量

一次已完成的单元测试快照为 195 项，其中 194 项通过、1 项失败、0 跳过。失败发生在 startup-transition.test.js 导入不存在的 STARTUP_READY_HOLD_LIMIT_MS，属于当次工作树中的启动模块契约问题，不能归因于尚未实施的毛玻璃设计。

工作树更新后的复核中，runtime-presentation 测试出现 createNativeStartupVisual 未定义错误，startup-transition 测试运行超过 6 分钟仍未结束，已终止本次审核启动的该测试子进程。终止后的汇总为 199 项、180 通过、19 失败、0 跳过，其中包含该被终止的用例；这不是正常完成的完整回归，不能作为最终基线。[复核日志](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-01/client-tests.log)

审核期间已有文件发生更新；该快照无法替代提交固定后的基线，也不能证明文档所述的 197 项全部通过。应以实际提交版本、命令退出码和测试结果作为证据。

即使单元测试全部通过，也不覆盖新增控件的排版、误触、读屏、对比度和原生性能。正式实施后还需覆盖：拖动时实时更新、多指/取消手势、待确认时禁用、切换站点/设备、ACK 成功与失败、AI 输入同步、横屏/键盘与材质降级。

## 3. 推荐保留的设计方向

1. 采用标准安全区和通用顶栏，站点名称优先，链路状态简洁；保留现有连接与账号入口。
2. 顶栏、底部导航可使用适量毛玻璃；设备和告警卡片采用高不透明度底色，圆角与阴影统一。
3. 设备控制保留能力模型、原生输入和命令回执，仅改视觉；操作反馈清楚区分预览、待确认和已上报状态。
4. AI 使用更克制的静态渐变边框，聚焦或处理中再适量强调；快捷提问只提供已有证据支持的内容。
5. 继续使用现有 motion-policy 和 data-motion 覆盖。经核查，后台、减少动效和显式降级已有机制，不应将它们重复列为项目缺失能力。

## 4. 本次验证与批准边界

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| 源码与框架核对 | 完成 | 明确方案与现有 UI、状态、事件及原生配置的接入差异。 |
| npm --prefix client test，已完成快照 | 194 通过 / 1 失败 / 0 跳过 | 当次工作树的单元测试结果；不是方案实施后的结果。 |
| npm --prefix client test，工作树更新后复核 | 未正常完成；启动测试超时后终止，另有测试 fixture 错误 | 不能确认全绿基线，详见复核日志与上文说明。 |
| npm --prefix client run build | 通过，含生产预览隔离检查 | 当次现有客户端可以构建；不验证文档代码片段。 |
| 新设计视觉与原生验收 | 尚无证据 | 未确认渲染稿、小屏布局、户外可读性、PDA 扫码或真机性能。 |

**建议批准：修订后的视觉原型阶段。正式实施前先关闭上述 P1 接入问题，并补齐 P2 的布局、降级与验收定义。**

## 5. 2026-10-02 的 v1.1 文档修订

原开发文档已按审核意见调整。以下状态表示方案已写入文档，代码实施与运行验收仍需后续证据。

| 原审核问题 | v1.1 对应调整 | 当前状态 |
| --- | --- | --- |
| 自定义滑块绕开控制契约 | 原生 range 外观增强，保留能力字段、原输入事件、待确认与 ACK 语义 | 方案已修订，待实施与控制回归 |
| 指针取消和监听器泄漏 | 删除独立 window 监听方案，明确取消、多指、上下文与生命周期验收 | 方案已修订，待事件顺序验收 |
| AI 按钮闭包与局部更新不匹配 | 共享预设模块、同步 controller handler、根节点事件委托和实际输入节点同步 | 方案已修订，待草稿与重复 patch 验收 |
| 类名、工具类与挂载位置缺失 | 列出构建器、保留的 DOM 字段及完整文件范围，使用项目组件 CSS | 方案已修订，待入口与 DOM 回归 |
| 功能宣传超出接入能力 | 相机/PDA 扫码、BLE 延迟、实时数据查询另列功能范围；快捷问题改为通用解释 | 第一阶段设计范围已收敛 |
| 小屏、触控、安全区不足 | 单列优先、明确断点、字号/对比度/触控目标及四方向补偿责任 | 方案已修订，待设备实测 |
| 滤镜降级和性能缺少入口 | 默认实色、@supports 增强、连接设置中的 auto/solid 材质选择与性能对比 | 方案已修订，待降级入口与性能验收 |
| 固定测试数与零开销保证 | 改为固定源码版本后的实际测试、构建和原生验收结果 | 原历史证据保留，待建立实施基线 |

修订校验通过：5 段 JavaScript 示例可解析，3 段 CSS 示例可解析，Markdown 代码围栏配对，本地文档链接存在。此校验不等同于 App 代码回归或原生验收。

## 6. 2026-10-02 的 v1.1 复审

**结论：认可视觉方向与框架适配，可以继续制作原型；正式实施方案仍有 1 项 P1、2 项 P2 需要补齐。发布批准仍需代码回归与 Android/PDA 实测。**

v1.1 已正确收敛为导航轻毛玻璃、内容稳定底色，并沿用 ES Modules、原生 range、现有构建器、事件委托和局部更新。AI 快捷提问的共享定义、同步控制器桥接与实际输入节点同步通过了本次局部探针，原先的闭包失效接入问题在方案层面已解决。材质降级入口、功能范围和验收边界也已明确。

本次仅复审文档与对应源码契约，新增审核证据；示例没有合并进生产源码。通过局部探针不代表完整页面视觉或原生验收通过。

### [P1] 多指取消的提交门禁仍不能仅依赖现有 rangeInteraction

对应 v1.1 文档 [225 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md:225)、[227 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md:227)与[321 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md:321)。文档要求多指介入后撤销操作、不发送命令，但只要求复用现有机制，缺少明确的取消记录与提交校验。

在生产 UI 的合成设备上，使用 Chromium 的原生触摸事件：第一指将强度从 20 拖到 82，第二指触碰控制区域，再结束触摸。记录到第二指 `isPrimary=false`，随后主指产生可信的 change，模拟 sendCommand handler 收到一次 `set_level`、`level=82`。这是对真实输入事件路径的复现，未调用设备适配器。

[onPointerDown](E:/CC_testP/iot-manager/client/src/js/ui.js:2833) 对第二指只取消 commandPress，没有取消 rangeInteraction；[onChange](E:/CC_testP/iot-manager/client/src/js/ui.js:2816) 没有检查手势取消记录，仍调用 sendCapabilityCommand。因此，“沿用既有机制即可满足多指取消”尚不成立。这是已有提交链路的缺口，本次并非认定 CSS 改造新引入了误发。

**补齐要求：**把明确的手势提交规则列为实施项。记录开始时的设备/能力、上下文、起始值和取消状态；第二指或 pointercancel 取消该次操作，在后续 change 中拒绝该次指针提交并恢复有效值；提交时再次检查禁用、能力有效性与上下文。取消记录应保留至该次操作收尾，不能在 pointerup 清空后失去识别能力。键盘和 TalkBack 的合法 change 仍需正常提交。

本次 Chromium 的原生 pointercancel 路径没有发送命令；合成的“pointercancel 后再 change”事件顺序则会穿过现有入口。后者仅证明入口缺少独立校验，不能声称当前 Chromium 原生取消必然产生 change。第二指介入后仍提交已有可信事件证据，应优先修复。

关闭条件：多指、取消、拖动时只读变化和上下文切换均不误提交；键盘与 TalkBack 操作保持可用；在目标 WebView/PDA 上复核事件顺序。

### [P2] 无效能力范围缺少明确的禁用与数值统一规则

对应 v1.1 文档 [285 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md:285)、[288 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md:288)与[489 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md:489)。方案将范围约束交给原构建器，但原链路不能覆盖所有无效范围。

用实际 buildRangeControl 配合文档 syncRangeAppearance 复现：`min=20, max=10, step=1, reported=30` 时，原生 input 的值为 20，output 显示 30，aria-valuetext 为 20，填充为 0%，且控件未禁用。操作者与读屏收到不同数值；0% 外观也没有说明能力定义无效。

**补齐要求：**在构建与提交入口明确验证有限的 min/max、max 大于 min 和正的 step。不可控制的范围显示原因并禁用，不能只将填充回退为 0%。有效范围经原生步长归一化后，input、output、读屏值和提交参数使用同一有效数值。

关闭条件：倒置、相等及非有限范围不提交；负数最小值、小数步长、上限不整除步长等有效范围的数值与状态一致。本次负数小数步长与上限不整除步长样例通过，不把它们列为已复现失败。

### [P2] 自绘滑块未提供强制颜色模式下的可见轨道

对应 v1.1 文档 [234 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md:234)至轨道定义，以及[493 行](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/design-v1.1.md:493)。顶栏和 AI 输入框已有高对比分支，range 仍使用 appearance:none 和仅靠渐变绘制的轨道。

在 Chromium 模拟 `forced-colors:active` 后，截图显示只有滑块圆点与数字，整条轨道消失。[截图证据](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/range-forced-colors.png)。强制颜色模式会移除非 URL 的背景图，因此渐变不足以维持轨道可见性。[MDN：forced-colors](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors)

**补齐要求：**增加 range 专用强制颜色规则，使用系统颜色及实线轨道边界，或完整撤销自绘伪元素样式后恢复原生外观。保留焦点、禁用和待确认文字，不能通过关闭系统颜色调整来保留品牌渐变。

关闭条件：强制颜色模式中轨道、滑块、焦点和禁用状态均可辨认；检查 Chromium/WebView 及声明支持的其他引擎。

### 复审证据与限制

| 本次检查 | 结果 | 范围 |
| --- | --- | --- |
| 5 段 JS / 3 段 CSS 解析 | 通过 | 仅语法，不证明接入正确 |
| AI 重复 patch、busy 往返与聚焦节点同步 | 通过 | 使用文档处理函数、生产 field 帮助函数与生产协调器 |
| AI 忙碌拒绝、冷却可填但不可发、未知预设 ID | 通过 | 控制器桥接局部探针，未发送 API 请求 |
| 原生 range 键盘增量 | 通过 | 20 → 21，一次模拟命令回调 |
| 原生 touchCancel | 通过 | 本次 Chromium 未发送命令 |
| 第二指介入后结束触摸 | 未通过 | 可信事件产生一次模拟命令回调 |
| 倒置能力范围 | 未通过 | input/output 不一致，控件未禁用 |
| 自绘 range 强制颜色可见性 | 未通过 | 截图人工复核确认轨道消失 |
| 完整布局、TalkBack、Android/PDA 性能 | 未完成 | 本次不形成发布验收证据 |

浏览器为 Chromium 151.0.7922.34。探针通过本地 Vite 导入 UI 模块，未导入 main.js，命令回调使用内存记录。开发文档及核对源码的 SHA-256 保存在[结果记录](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.1-probe-results.json)，对应[复现脚本](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.1-probe.mjs)。脚本要求本地 Vite 在 127.0.0.1:5187 运行。

本次没有重新执行整套客户端测试；第 4 节的历史测试结果不作为当前通过证据。下一版方案需补齐上述 3 项，再在固定源码版本上实施、回归和真机验收。

## 7. v1.2 完善与复测结论

**最新结论：三项复审缺口已补入可执行方案，隔离原型复测通过，批准进入 App 实施。生产代码落地、完整回归与 Android/PDA 验收仍待完成。**

| v1.1 问题 | v1.2 状态 | 证据 |
| --- | --- | --- |
| P1 多指取消门禁 | 方案与原型验证通过；生产接入待完成 | 多指及迟到 change 不提交；覆盖整页/局部更新、设备/上下文、只读、待确认及销毁；键盘与 ACK 后焦点恢复通过 |
| P2 非法范围和数值不一致 | 方案与原型验证通过；归一化及 UI 合并待完成 | 原始非法定义标记保留，6 类非法定义禁用；负数/小数/不整除上限及微小步长一致 |
| P2 强制颜色轨道 | 方案与原型验证通过；App 样式及多引擎验收待完成 | 系统颜色与实线边界恢复可见轨道，聚焦和禁用截图人工复核通过 |

本轮 27 项隔离验证全部通过，包含 7 段 JS / 3 段 CSS 解析与页面错误检查；另有 33 项现有相关单元回归通过、0 失败、0 跳过。详见[复测报告与命令](E:/CC_testP/iot-manager/docs/CLIENT-APPLE-GLASS-V1.2-RETEST-2026-10-02.md)和[结果数据](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/v1.2/results.json)。

测试前的旧行为仍能在生产模块对照中复现，说明本轮关闭的是方案与原型层面的缺口。完整顶栏/卡片断点、TalkBack、目标 WebView/PDA 事件顺序和性能应在 App 实施后验收，不能把本轮结果记为发布通过。
