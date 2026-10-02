# Apple Glass 独立组件与演示页面深度审核

审核日期：2026-10-02。结论：**当前实现不通过 v1.2 方案符合性及可测试功能演示验收，不建议直接接入 App。** 文档的总体分层和状态约束可以继续采用，但独立代码偏离了这些约束，并存在已复现的交互及数据安全问题。

本次仅审核用户指定的四个文件。附带文档中的开发步骤作为审核依据，没有据此执行生产接入。四个文件的审核前后 SHA-256 完全一致；新增内容仅为本报告和隔离审核证据。

| 审核对象 | 本次判断 |
| --- | --- |
| `client/apple-glass-standalone.js` | ES Modules 和 DOM 工厂形式适合现有技术栈；命令、能力、AI 状态、取消和无障碍契约不合格 |
| `client/apple-glass-preview.html` | 页面可以启动；多处参数接错，部分操作仅弹提示，缺少可重复验证的状态闭环 |
| `client/test/apple-glass-standalone.test.js` | 10 项通过；属于简化 DOM 的组件冒烟，无法证明预览功能、业务安全或设计验收通过 |
| `docs/CLIENT-APPLE-GLASS-DEVELOPMENT-DOCUMENT-2026-10-01.md` | 总体方向与框架相容，明确区分原型和 App 验收；双列 CSS 示例仍需修正可用宽度判断 |

当前生产入口、`client/src`、Vite 配置及 package 脚本中未发现对待审组件或预览页的引用。本次浏览器请求也只访问隔离审核页面和组件。因此，下列 P1 表示进入后续开发前必须优先修复的问题，不表示已发生生产设备误操作或生产数据泄露。

## 1. 测试结果及证据边界

环境：Windows、Node.js v24.14.0、Playwright 1.62.0、Chromium 151.0.7922.34。

| 检查 | 实际结果 |
| --- | --- |
| 原文件的 Node 单元测试 | **10 通过，0 失败，退出码 0** |
| 本次真实浏览器专项审核 | **49 项：6 通过、43 未达预期、0 采集错误** |
| 审核脚本退出码 | **1**，表示存在未达预期项 |
| 初始页面和组件探针的未捕获运行错误 | 0；能够运行不等于功能正确 |
| 生产服务、外部服务和设备请求 | 未发生 |
| 四个待审文件内容 | 审核前后哈希一致 |

49 项是针对高风险路径和方案约束的专项检查，43 个失败项归并为下文 16 个问题，不能解释为 43 个相互独立的缺陷，也不是项目全量测试的通过率。

通过项为六台设备初始渲染、密度切换、正常滑动先预览后一次提交、AI 快捷按钮只填写输入框、无未捕获错误、无生产或外部服务请求。

预览中的滑动使用真实鼠标事件及浏览器指针捕获。取消、多指身份和移除节点的边界检查使用真实浏览器 DOM 上的合成 PointerEvent；仅在隔离组件探针中替代浏览器不能授予合成事件的 pointer capture，未修改组件源码。字体检查为 200% 计算字号压力测试。以上均不能替代 Android/PDA、TalkBack、系统字号、安全区或软键盘真机验收。

证据：

- [完整检查结果及前后哈希](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/results.json)
- [原单元测试 TAP](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/original-unit-tests.tap)
- [可复现审核脚本](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/audit.mjs)
- [背景采样与对比度计算](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/contrast.py)
- [390px 页面](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/preview-390.png)、[320px 页面](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/preview-320.png)、[820px 页面](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/preview-820.png)
- [强制颜色模式](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/preview-forced-colors.png)、[320px / 200% 字号压力](E:/CC_testP/iot-manager/artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/preview-320-text-200.png)

审核脚本使用临时 loopback 端口、只提供两个待审资源和空白探针页面，完成后自行关闭。当前浏览器的 `127.0.0.1:5188` 页面没有作为这四个文件的测试证据。

## 2. 优先修复问题

### F01 · P1 · 外部文本直接进入 innerHTML，可执行事件处理器

主要位置：[AI 消息插值，842–856 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:842)。相同路径还存在于站名 393/398、设备名称和说明 531–532、候选设备 1009–1010、活动内容 1071–1075 行；图标参数也允许直接注入 SVG/HTML。

设备名称、AI 回复等本应为数据，却直接拼入 HTML。使用不访问网络、只写入页面内存标志的图片错误事件载荷，**设备、AI、站点、候选设备、活动五条路径均执行了事件处理器**。这已证明组件缺少数据与可执行标记的边界。

修复：普通字段使用 DOM `textContent`；图标使用可信内部定义。确需富文本时建立明确的格式白名单和可靠清洗边界，并补充真实 DOM 的恶意输入回归。不能用“不执行 script 标签”或 Node mock 不触发事件来判定安全。

对应证据：`data-text-not-executable-html`。

### F02 · P1 · 取消、多指及节点失效仍能提交滑块值

位置：[pointerdown/move/up，687–703 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:687)。

实现仅保存 `isDragging`，没有 `pointercancel`、指针身份或活动节点校验。复现结果：

- pointercancel 后再收到移动/释放，提交 75。
- 第二个指针释放可结束第一个指针的拖动，提交 25。
- 非主触点可重写值并提交 85。
- 控件移出 DOM 后，旧节点的迟到释放仍调用提交，提交 25。

方案 227、231、431、579 行要求取消和上下文失效废弃意图。当前实现也没有能力、只读、待确认、站点或设备变化的重新校验入口。独立演示同样应模拟这些限制。

修复：恢复方案中的原生 range 和意图守卫，明确身份、范围、控制许可及页面生命周期；取消后旧节点不能提交，正常刷新保留拖动，新的键盘操作仍可使用。

对应证据：`slider-cancel`、`slider-secondary-up`、`slider-secondary-touch`、`slider-removed`。

### F03 · P1 · 点击立即确认状态，且未发送命令就显示硬件 ACK 成功

位置：[卡片开关 515–519 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:515)、[ACK 文案 668–673 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:668)、[预览直接改设备状态 327–330 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:327)。

卡片先反转状态并显示“在线运行/设备停机”，再调用回调；回调明确返回 false 时，页面仍显示“在线运行”。所有设备，包括监测仪表，均生成可立即切换的按钮；`active` 还混合了通断电与在线状态。滑块初始化时就出现“已完成硬件 ACK 回执校验 · 延迟 12ms”，没有任何对应命令、回执或延迟测量。

现有框架的 [transitionCommand](E:/CC_testP/iot-manager/client/src/js/command-state.js:34) 区分 desiredState 与 reportedState，PENDING/SENT 不确认真实状态。方案 19 行禁止新增列表快捷开关，223–227 行要求保留状态链路和只读限制，47 行禁止无测量的毫秒延迟及无依据的“0 告警”。当前实现均不满足。

修复：列表仅进入详情；按能力提供可用控制；独立 Mock 也应有命令 ID、目标值、上报值及 PENDING/SENT/ACKNOWLEDGED/FAILED/UNCONFIRMED，只有模拟回执到达后确认状态。未测量数据显示未知，并在页面明确标注模拟模式。

对应证据：`tile-does-not-confirm-rejected-command`、`slider-no-ack-before-command`、`preview-header-uses-input-context`。

### F04 · P1 · AI 发送绕过忙碌状态，拒绝发送仍丢失草稿

位置：[doSend/Enter，922–931 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:922)。

发送只检查非空文本，直接调用回调并清空输入，不等待返回结果。第一条请求尚未完成时，第二条问题仍调用回调，实测两次调用且发送按钮仍可用；回调返回 false 时，草稿也被清空。没有 enabled/loading/busy/pending/长度/冷却门禁。中文输入法 `isComposing=true` 的 Enter 同样触发一次发送。

现有 [aiCanSend](E:/CC_testP/iot-manager/client/src/js/ai/ai-state.js:22) 和 [AI controller.send](E:/CC_testP/iot-manager/client/src/js/ai/ai-controller.js:107) 已定义这些状态。快捷按钮当前只修改 DOM input，没有控制器草稿状态接口，不能直接接入既有状态更新流程。

修复：通过一个发送控制器和草稿状态入口处理全部动作；未接受请求时保留草稿，发送期间禁用相关入口，拒绝 IME 确认键触发发送。独立版本使用可控 Mock controller 复现同一行为。

对应证据：`ai-awaits-inflight-send`、`ai-rejected-send-keeps-draft`、`ai-ime-enter-no-send`。

## 3. 其他功能、设计与测试问题

### F05 · P2 · 忽略 step，非法范围可提交，数值与填充不同步

位置：[滑块参数 620–627 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:620)、[初始填充 657 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:657)、[Math.round 681 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:681)。

组件没有 step 参数，全部取整。min=0/max=1/step=0.1 时，60% 位置实际提交 1，填充却是 60%；初始 value=250/max=100 显示 250% 和 100% 填充。相等、倒置、Infinity、NaN 范围分别仍提交 25、50、Infinity、NaN。

修复：按方案共享范围契约，保留非法定义错误标记；有效范围使用原生 range 归一化数值，input/output/读屏/提交一致，非法或未知值禁用且说明原因。禁止所有能力共用整数百分比。

证据：`slider-decimal-step`、`slider-invalid-range`、`slider-out-of-range-initial`。

### F06 · P2 · 预览参数与组件 API 不一致，多处回调没有接上

| 预览调用位置 | 传入参数 | 组件实际接收 | 实际影响 |
| --- | --- | --- | --- |
| [顶栏 173–182 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:173) | bleLatency / bleStatus / envSummary | linkStatus / weatherText / onlineSummary | 室内 23.5°C 被忽略，显示默认室外 28°C 和 4 台/0 告警 |
| [列表 284–294 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:284) | placeholder / filterOptions / activeFilter | 无相应参数 | 预设分类和选中 ID 被忽略 |
| [抽屉 383–389 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:383) | label | 无 label 参数 | 灯具和空调都显示“阀门精密开度流体调节” |
| [详情 416–429 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:416) | device.telemetry / onAction | device.pressure/temp / onSliderCommit | 传感器显示默认出水压力 4.2 Bar、管温 34°C；提交没有业务回调 |
| [扫描 442–448 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:442) | devices / onClaimDevice / onToggleScan / isScanning | candidates / onClaim / onQrScan | 三个工业候选变成两个默认产品，认领按钮没有预览回调，扫描状态无控制入口 |
| [AI 487–493 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:487) | quickChips | quickPrompts | 四个指定预设全部被忽略 |

修复：统一并记录组件参数契约，在预览中直接使用契约。给每个页面增加真实挂载后的内容与回调断言。遥测按设备能力展示，不能用另一个设备类型的默认值兜底。扫描等超出第一阶段范围的入口须明确限定为模拟或暂不可用。

证据：`preview-header-uses-input-context`、`preview-ai-requested-presets`、`preview-scan-candidates-and-claim`、`preview-slider-capability-label`、`preview-detail-uses-telemetry`、`preview-detail-commit-wired`。

### F07 · P2 · 搜索和筛选仅弹提示，结果列表没有变化

位置：[搜索/筛选回调 293–294 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:293)、[无条件遍历全部设备 320 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:320)。

搜索不存在的名称后仍有六台设备；六台均在线时选择“离线未连”仍有六台。组件可将回调交给宿主，但本预览没有实现宿主筛选逻辑，不能展示为已完成搜索或筛选。

修复：在独立状态中保存查询/筛选条件，派生结果列表及数量，提供空结果状态；切换密度或返回列表时保持这些条件。

证据：`preview-search-filters`、`preview-offline-filter`。

### F08 · P2 · 设置导航进入空白页，程序化导航的高亮选择器错误

位置：[清空并分发页面 267–278 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:267)、[导航高亮选择器 255 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:255)、[实际导航类 790 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:790)。

底栏创建 settings 按钮，但渲染分支没有 settings，点击后 main 子节点数为 0。程序化切换查找 `.apple-nav-item`，实际组件使用 `.nav-tab-btn`；从 AI 页通过顶栏打开扫描后，AI 仍显示选中。连接、账号和天气详情入口也未形成方案要求的可达路径。

修复：使用统一路由表驱动内容与导航；为所有可见入口提供可用页面或明确说明，未知路由不能清空页面。补全独立设置及材质控制入口。

证据：`preview-settings-view`、`preview-scan-candidates-and-claim` 的 nav 字段。

### F09 · P2 · 控制值、AI 草稿与会话在重建时丢失

位置：[抽屉固定 value=75，385–390 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:385)、[每次重新定义 messages，460–479 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:460)、[只向节点追加消息，494–507 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:494)。

灯具拖到 30% 并提示同步后，重新打开仍是 75%。未发送 AI 草稿离开页面后为空；已发送问题返回 AI 页后也消失。延迟回复追加到旧的、已移除的消息节点，无法形成持续会话；定时回调还会对当前窗口执行滚动。

修复：由页面之外的独立 store/controller 保存设备上报、命令、草稿与消息。按站点/设备/会话范围管理状态与异步任务，渲染只读取状态；切换和销毁时处理未完成任务。对于多站点，需新增隔离测试，当前演示没有实现可验证的站点切换。

证据：`preview-slider-persists-value`、`preview-ai-draft-survives-navigation`、`preview-ai-conversation-survives-navigation`。

### F10 · P2 · 复制、站点切换和刷新提示与实际动作不一致

位置：[站点切换 178 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:178)、[复制回调 483 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:483)、[活动刷新 544–547 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:544)。

复制按钮显示“已复制到剪贴板”，实测剪贴板写入次数为 0。站点按钮称“已列出 4 个园区”，没有站点列表或切换状态。活动组件不接收 onRefresh，也不渲染刷新入口，该回调不会被调用。AI 延迟 600ms 后声称“正在下发至边缘网关，响应延时 14ms”，未发生对应请求。

修复：只在实际动作完成后显示成功；可模拟的动作改变 Mock 状态并可复查，未实现的能力明确标识。剪贴板操作处理成功和失败；活动刷新使用有效接口及入口。

证据：`preview-copy-writes-clipboard`；其余为源码路径核对，不计作独立动态通过项。

### F11 · P2 · 小屏双列、小字与低对比不符合工控读取要求

位置：[固定双列 589 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:589)、[名称/说明样式 531–532 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:531)、[预览 440px 上限 76 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:76)、按钮尺寸 416/474/915 行。

320/390/414px 始终双列，卡片宽度分别约 127/162/174px；320px 名称会截断。200% 字号压力下设备名有效宽 101px，文本需求约 182–208px。正文多为 11–13px，状态 badge 9.5px。站点按钮高 33px、扫描 30×30、设备开关 32×32、AI 发送 28×28、导航高 44px，低于方案 48px 主操作目标。

390px 页面中“制冷中 · 23.5°C”前景 RGB(100,116,139)，其中心背景采样约 RGB(95,104,123)，对比度约 **1.18:1**，未达到方案 4.5:1 目标。采样暂时隐藏该文字而保持布局，从背景截图取 5×5 中位数，避免把抗锯齿文字像素当成底色；这是该位置的样本，不是整页对比度全量认证。背景动画和透明材质也会改变读数。

修复：移动端单列、名称合理折行、正文和辅助字号按方案设置、扩展真实触控区域。内容使用稳定底色，检查所有状态下的对比度。固定 440px 的手机外壳只能展示手机样机，不能证明 768/820px 宿主布局适配。

证据：`layout-mobile-single-column`、`layout-200-percent-text`、`touch-targets-at-least-48`、`design-subtitle-contrast` 及截图。

### F12 · P2 · 键盘、读屏与控制抽屉缺少必要语义

位置：[设备卡片 DIV 462/523 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:462)、[滑块 DIV 652 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:652)、[发送图标按钮 912–920 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:912)、[抽屉构建 352–410 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:352)。

设备详情入口不能聚焦或 Enter 打开。滑块没有原生 range、role、tabIndex、键盘控制及可读的值语义。AI 发送按钮没有可访问名称。抽屉无 dialog/aria-modal，打开时焦点仍在外部，Escape 不关闭，也没有焦点约束或返回路径。搜索和 AI 输入只靠 placeholder。

修复：详情入口采用适当的原生按钮结构，避免按钮嵌套；恢复原生 range；为图标按钮和输入提供名称。抽屉采用可访问的对话框行为，验证进入、循环、Escape、关闭后焦点恢复及触屏读屏。

证据：`preview-card-keyboard-navigation`、`slider-native-keyboard`、`preview-ai-send-accessible-name`、`preview-sheet-has-dialog-semantics`、`preview-sheet-focus`、`preview-sheet-escape-closes`。

### F13 · P2 · 安全区变量没有映射，横向挖孔无法避让

位置：[顶栏 padding 49–52 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:49)、[底栏 padding 185 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:185)。

组件使用未定义的 `--safe-top/--safe-bottom`，没有将 `--safe-area-inset-*` 或 env 映射进去，左右 padding 固定 12px。注入 top/right/bottom/left=24/18/30/16px 后，实测仍为 6/12/8/12px。

修复：按方案 95–98、120–121 行映射四方向变量，明确内容、顶栏、底栏和抽屉的补偿责任，避免重复累计。之后再验证原生 padding、横屏、分屏和键盘。

证据：`safe-area-injected-variables`。桌面注入测试证明 CSS 契约未接上，不代表真机已测。

### F14 · P2 · 全内容玻璃化、材质降级和减少动效未落实

位置：[全卡片滤镜 119–126 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:119)、[常驻 AI 动画 242 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:242)、[雷达动画 331 行](E:/CC_testP/iot-manager/client/apple-glass-standalone.js:331)、[预览背景动画 43/54/65 行](E:/CC_testP/iot-manager/client/apple-glass-preview.html:43)。

卡片、消息和控制内容均用透明渐变和 blur(28px)/saturate(200%)，导航内部胶囊再次滤镜，偏离方案“导航轻玻璃、内容高对比”。没有 @supports 实色基础、高对比材质覆盖或 auto/solid 设置入口；设置 data-material=solid 后，顶栏和卡片仍使用 blur(28px)。

减少动效只关闭 AI 边框：三个背景光团和雷达仍循环。强制颜色模式中滑块渐变变为 none、填充背景透明，又没有原生滑块或替代标记，轨道不能表达当前位置。

修复：稳定内容底色、轻导航材质；提供真正有效的 auto/solid 入口，使用系统颜色及可见控件的强制颜色样式。静态 AI 边框，减少动效及页面隐藏时停止所有非必要循环。PDA 性能须同机比较；本次没有帧率、GPU 或耗电测量，不能声称性能达标。

证据：`material-solid-entry`、`material-solid-contract`、`motion-reduced-background-stops`、`motion-reduced-radar-stops`、`forced-colors-fill-visible`。

### F15 · P2 · 测试只证明冒烟，且确认了与方案冲突的行为

位置：[简化 DOM 22–109 行](E:/CC_testP/iot-manager/client/test/apple-glass-standalone.test.js:22)、[卡片立即翻转测试 165–191 行](E:/CC_testP/iot-manager/client/test/apple-glass-standalone.test.js:165)、[单次滑块测试 223–244 行](E:/CC_testP/iot-manager/client/test/apple-glass-standalone.test.js:223)、[AI 测试 265–291 行](E:/CC_testP/iot-manager/client/test/apple-glass-standalone.test.js:265)。

mock 不解析完整 HTML/CSS、不模拟事件传播、原生 range 值与有效性、真实焦点、指针捕获或无障碍树；querySelector 只查少数直接子节点，innerHTML 仅按字符串猜测按钮/input。组件正常回调通过，不代表预览传参正确。详情组件被导入却未被测试。

卡片测试期望立即翻转，实际上固化了 v1.2 禁止的列表控制行为；滑块只测整数正常释放，AI 只测填写后立即清空，没有任何拒绝或异步门禁断言。CSS 类名匹配不能验证布局、颜色、48px 触控或材质降级。

修复：保留纯逻辑单测，针对真实预览增加浏览器集成测试；加入 F01–F14 的异常与状态用例。用可控时钟和 Mock 回执测试待确认/失败/未知，避免只验证 toast 或固定截图存在。

组件源码第 3 行的“全页面 100% 完整覆盖版”与空白设置、缺失入口和测试覆盖不符，应改为可验证的范围说明。单元测试 10/10 不能作为全页面、App 或原生验收通过依据。

### F16 · P2 · 方案双列 CSS 示例仍按视口宽度，未兑现可用宽度条件

位置：[开发文档 202–203 行](E:/CC_testP/iot-manager/docs/CLIENT-APPLE-GLASS-DEVELOPMENT-DOCUMENT-2026-10-01.md:202)。

正文 55–56 行要求按实际内容宽度，考虑 820px 侧栏及分屏；示例却仅用 @media(min-width:768px) 无条件双列。隔离加载该 CSS 后，820px 视口、390px 内容区得到 189px+189px 两列。现有 App [820px 侧栏规则](E:/CC_testP/iot-manager/client/src/css/style.css:1545) 会进一步压缩内容，不能仅凭视口宽度判断。

修复：明确最小卡片可用宽度和字体压力规则，通过容器查询或宿主布局状态决定列数。新增“宽视口+窄内容区”测试。文档第 10 节的 27/33 项历史结果已经限定在方案原型和相关单元回归，不应延伸成这份独立代码的验收结果。

证据：`document-grid-uses-available-width`。

## 4. 与 v1.2 和现有框架的适配判断

| 契约 | 文档/框架要求 | 当前待审实现 |
| --- | --- | --- |
| 技术形式 | 原生 ES Modules、Vite、DOM | 形式兼容，浏览器可运行 |
| 设备能力 | min/max/step、控制类型、只读及许可 | 固定整数百分比与统一开关，缺少许可模型 |
| 命令 | desired 与 reported 分开；待确认、失败、未知分别显示 | 点击立即变化、无条件 ACK 文案 |
| 设备入口 | 列表进入详情，既有站点/连接/账号/天气可达 | 列表直接控制；部分入口缺失或仅提示 |
| 滑块 | 原生 range、取消守卫、局部更新与键盘 | 自定义 DIV 和 isDragging |
| AI | 共享预设、控制器草稿、发送门禁、范围隔离 | DOM 草稿、固定消息、无异步门禁或站点范围 |
| 设计层次 | 导航轻玻璃、稳定内容底色、单列小屏 | 内容批量滤镜、玻璃叠加、始终双列 |
| 运行策略 | 安全区、实色入口、强制颜色、减少动效 | 缺少完整入口和降级策略 |

因此，“语法和 DOM 形式可用”成立，“已适配现有 App 的业务框架”不成立。独立开发可以继续保留隔离文件，不需要为演示接入真实设备或生产后端；应以可控 Mock 和现有契约实现行为，而不是把固定成功文案作为功能演示。

## 5. 建议整改及重新验收顺序

1. 修复文本渲染边界；恢复原生滑块，解决取消、非法范围、身份和只读守卫。
2. 建立独立 Mock store、命令状态机和 AI controller；提供成功、失败、结果未知、离线只读及 AI 冷却等可选择场景。
3. 统一组件参数与回调，补全路由和设置，完成实际搜索/筛选/复制，并让设备值、草稿及会话可复查。
4. 按 v1.2 修正内容底色、小屏列数、字体、触控、焦点、安全区及材质/动效策略，同时修正文档的可用宽度示例。
5. 重新运行原单元测试和本次 49 项专项检查；新增上下文/能力更新、后台恢复和异步销毁的自动化用例。再根据明确的独立范围执行浏览器及 Android/PDA 验收。

只有上述关键路径通过后，才能把交付标为“可用于正常功能测试的独立演示”。本报告没有修复或合并待审实现。

## 6. 复现命令

在仓库根目录执行：

```powershell
node --test --test-timeout=15000 --test-reporter=tap client/test/apple-glass-standalone.test.js
node artifacts/client-apple-glass-review/2026-10-02/standalone-deep-audit/audit.mjs
```

专项脚本复用本机已安装的 `client/node_modules/@playwright/test`、Chromium 及 Python/Pillow。失败会写入 results.json 并返回 1；检查项的采集错误返回 2。运行不启动或修改生产项目，不需要使用 `serve-standalone.mjs`，也不会覆盖正在运行的 5188 服务。

本次未运行生产 App 全量构建/回归，也未做原生设备与性能测试；这些结果不能由当前组件冒烟或桌面模拟推导。
