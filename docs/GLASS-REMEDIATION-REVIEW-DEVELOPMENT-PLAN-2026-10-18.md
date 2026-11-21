# IoT Manager Glass：整改计划审核与开发方案

审核日期：2026-10-18（Asia/Shanghai）  
文档版本：1.0  
适用工程：`E:\CC_testP\iot-manager\apps\client-glass-next`  
当前源码版本：`1.1.4-glass.4`，Android `versionCode=8`  
建议交付版本：`1.1.4-glass.5`，建议 `versionCode=9`，实施前重新检查版本占用  
状态：**审核完成；整改尚未实施；没有生成或发布 glass.5 APK。**

## 1. 审核结论

原计划可作为问题线索，但**不能按原文直接作为已完成的发布记录，也不建议将整段补丁直接追加到构建文件**。需要先修订基线、设计判断和验收条件，再按源码模块实施。

本次确认的主要问题是：提示条背景语义色被覆盖、AI 单行输入框高度异常、AI 表单及历史条目内边距不足、AI 错误文字颜色与普通提示混同，以及 AI 输入焦点不可见。另有一个仅存在于当前工作区的 AI 根容器透明化回归，原计划的补丁没有消除它。

原计划把设备详情内部透明区域和天气指标的平面排布都判为缺陷，证据不足。源码明确采用“外层连续材质、内部通过标题和留白分区”的设计。默认保留该设计；不恢复所有内部区域的独立玻璃卡片。

隔离浏览器试验还确认，原补丁会把站点与天气入口的高度从 48px 缩小到 38px/34px，并在系统高对比度已经选择实色时继续开启导航滤镜。这两项需要改正。

建议将本轮范围限定为**样式一致性、语义和可访问性整改**。帧率自适应、状态仓库结构共享、BLE 协议下发和 AI 流式输出分别进入后续迭代，不与玻璃样式版本混合交付。

## 2. 输入、基线与证据边界

### 2.1 审核输入

- 用户提供的[整改计划](/D:/Chrome下载/iot_manager_glass_remediation_plan.md)。其中的代码和“已通过/已打包”表述均作为待核查内容。
- 当前独立 App 的源码、已有测试、Android 构建元数据和本地 APK。
- 工作区已有的[AI 渲染定位报告](/E:/CC_testP/iot-manager/玻璃渲染问题-定位报告.md)。该报告自述为静态分析；本次对有关结论补做了浏览器核查。

### 2.2 必须区分三个对象

| 对象 | 本次核查结果 | 对开发的约束 |
| --- | --- | --- |
| 已有 glass.4 APK | 包名 `com.iot.manager.glassnext`；版本 `1.1.4-glass.4` / code 8；约 6.00 MB | 用作交付物基线，不能把当前源码状态直接等同于该 APK |
| 当前工作区 | Git HEAD `1bb5075`；包版本仍为 glass.4；两个玻璃文件有未提交改动 | 后续实施前保留改动及摘要，逐项合并；本次未覆盖这些改动 |
| 计划声称的 glass.5 | 在本次可核对材料中，没有对应的 APK、源码版本摘要和完整验证报告 | 标记“待开发/待验收”，不能继续写“全部通过、已完成” |

当前两处未提交改动为：

1. `src/css/liquid.css:38` 把 `[data-region='ai-content']` 加入透明化规则。
2. `src/js/appearance/glass-surfaces.js:7` 从 `panels` 中移除了 `ai-workspace`。

已有 APK 中确实包含原计划引用的 `index-BoMULST1.js` 和 `index-CCYoJ8ia.css`。但 APK 的 CSS 中**没有** `ai-content` 透明化选择器，JS 白名单中**包含** `ai-workspace`。因此，当前 AI 根容器回归不能追溯为该 APK 已有的问题。

APK SHA-256：

```text
e75535421d827ee9ee121230a624323292ef01d95de5a253bcd58dbb658517a0
```

APK 内 `build-info.json` 标记来源提交 `80a7d3493192a30d0803eb817c50e32f82046b5d`，并标记 `dirty=true`。该提交号不能单独证明所有构建源码，后续必须同时保存工作区差异和文件摘要。

证据：[APK 检查](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/apk-inspection.json)、[APK 关键片段](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/apk-source-snippets.json)、[AI CSS 基线对照](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/ai-css-comparison.json)。

### 2.3 本次实际执行

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| 当前源码单元测试 | 220 通过，0 失败 | 现有业务与状态契约回归 |
| 当前源码浏览器测试 | 共 64 项：56 通过、8 跳过、0 失败、0 flaky | 隔离环境中的现有交互与响应式回归 |
| 原计划 CSS 与白名单试验 | 15 条场景记录；0 页面异常；0 外部请求 | 当前源码 UI 在 390×844 Chromium 中的计算样式、局部布局及模式切换 |
| APK/CSS 核查 | 已完成 | 文件身份、构建片段、相同 AI 根节点的 CSS 差异 |
| glass.5 APK / 真机验收 | 未执行 | 没有据此宣称已完成发布 |

白名单试验只在浏览器 DOM 中模拟原计划的新增项，CSS 从附件提取后注入；没有改工程实现。附件中的 `buildLevelControl` JS 替换没有执行。本次也没有测试真机 GPU、BLE 硬件、系统浏览器信任或真实 AI 供应商调用。

8 个跳过项分别涉及：回滚数据兼容、真实 AI，以及 5 项真实鉴权/角色/令牌/Edge 链路与 1 项千设备运行负载。这些条件未启用；不能把 56 个浏览器通过项表述成全链路验收完成。

证据：[单元日志](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/unit-tests.log)、[浏览器报告](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/e2e-results.json)、[样式试验](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/style-probe.json)。

## 3. 需要优先修订的问题

严重度定义：P1 为本轮整改交付前必须解决的回归或证据缺口；P2 为一致性和布局问题；P3 为清理或独立优化。本次没有依据认定为 P0 故障。

### R01 · P1：发布状态与构建基线混同

**问题：** 原计划把所有问题写成“已通过”，并声称已打入 glass.5，但没有附带可核对的版本、摘要、测试场景和报告。同时，工作区与 glass.4 APK 已存在实际差异。

**解决：** 将“现象复现”“源码修复”“浏览器通过”“APK 通过”“真机通过”分别记录。每条问题关联测试 ID、源码提交/差异、截图和 APK SHA-256。发布前核对源代码、`package.json`、锁文件、Gradle、APK 与 `build-info.json`。

**验收：** 任一标记“已完成”的条目都能追溯到同一份交付物；缺少证据时保留“待验证”。

### R02 · P1：当前 AI 根容器回归未被原补丁消除

**位置：** [liquid.css:30](/E:/CC_testP/iot-manager/apps/client-glass-next/src/css/liquid.css:30)、[glass-surfaces.js:7](/E:/CC_testP/iot-manager/apps/client-glass-next/src/js/appearance/glass-surfaces.js:7)。

相同节点同时匹配 `.ai-workspace` 的玻璃规则和 `[data-region='ai-content']` 的透明化规则。后者在后，覆盖背景、边框、滤镜和阴影。本次对照结果为：APK CSS 的根容器有渐变背景和 `blur(12px)`；工作区 CSS 为透明、无边框、`backdrop-filter:none`。

原计划重新把 `ai-workspace` 加入光学白名单后，光学组件可能提供可见边缘，但根容器 CSS 冲突仍存在。光学脚本加载失败时，CSS 兜底依然缺失。

**解决：** 设备列表的布局容器继续透明；从该透明化规则中移除 AI 根容器。默认采用“AI 工作区一层 CSS 玻璃，内部内容按语义排布”。根容器是否额外开启光学折射应单独决定，不与恢复 CSS 背景绑定。

**验收：** AI 聊天、历史、性格三页均有稳定外层材质；阻断可选光学 chunk 后仍可读、可输入、可操作；保留 `data-region='ai-content'` 作为局部更新锚点。

### R03 · P1：原补丁破坏系统高对比度的材质降级

**位置：** 附件对 `.app-header.app-header--glass`、`.bottom-nav.bottom-nav--glass` 的无条件滤镜规则；当前 [glass.css:79](/E:/CC_testP/iot-manager/apps/client-glass-next/src/css/glass.css:79) 和 [glass-appearance.js](/E:/CC_testP/iot-manager/apps/client-glass-next/src/js/appearance/glass-appearance.js)。

浏览器试验中，系统 `prefers-contrast: more` 已使根节点 `data-glass='solid'`，但补丁后的顶栏/底栏仍为 `blur(16px) saturate(1.25)`。原因是：系统降级不等于用户将 `data-material` 改为 `solid`；补丁的选择器又压过了原媒体查询中的低优先级规则。

**解决：** 所有玻璃滤镜通过最终有效材质 `data-glass` 管理。实色、高对比度和 forced-colors 的规则覆盖新引入组件；使用系统颜色、可见边界和焦点。启动遮罩在 `#app` 外，另写媒体查询兜底。

减少动画与减少透明度继续分别控制，不能将 `prefers-reduced-motion` 直接解释成必须改用实色。后台时光学效果关闭，回来后按有效材质恢复。

**验收：** 显式实色与系统强制实色分别测试；所有受管理材质的滤镜关闭，光学层为 off/隐藏；退出系统高对比度后正确恢复原选择。

### R04 · P1：AI 错误语义与焦点仍不完整

**位置：** [ai.css:8](/E:/CC_testP/iot-manager/apps/client-glass-next/src/css/ai.css:8)、[glass-layout.css:54](/E:/CC_testP/iot-manager/apps/client-glass-next/src/css/glass-layout.css:54)。

当前 `.ai-notice` 的后置规则覆盖了错误变体的背景和文字颜色。原补丁恢复错误背景，但没有恢复文字色；试验中仍为普通提示色 `rgb(72,98,108)`。`role='alert'` 仍存在，因此应描述为视觉区分不足，不能说所有错误语义都丢失。

AI 名称输入框聚焦后，原样式与补丁样式的 `outline` 都为 `none 0px`。聊天输入区可有外框反馈，但性格页字段没有等效焦点提示。

**解决：** 将提示的背景、文字、图标和边界按 tone 一并定义；恢复所有 AI 文本输入的可见焦点。保留错误文案及 `alert/status` 角色，不仅依靠颜色表达结果。

普通文本对比度按至少 4.5:1、大号文本至少 3:1 验收；透明背景必须按实际合成结果检查，不能只比较 CSS 中的一对颜色。焦点可见要求参照 [W3C Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)；文字对比度参照 [W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。

### R05 · P1：原补丁缩小已建立的移动触控区域

原样式的站点和天气入口均为 48px；补丁试验分别变成 38px 和 34px。此前的 [glass-client 浏览器测试](/E:/CC_testP/iot-manager/apps/client-glass-next/e2e/glass-client.spec.js) 并没有覆盖这些新增样式的尺寸断言。

**解决：** 保留项目现有 48px 交互目标约定，视觉上紧凑可通过内部高光或伪元素实现。AI 单行输入建议也统一为最小 48px，而不是原补丁的 42px。48px 是本项目验收约定，不作为对 WCAG 最小尺寸条款的转述。

**验收：** 手机宽度下站点、天气、导航及主要操作按钮的实际矩形尺寸达标；长站点名和横屏不遮挡相邻入口。

### R06 · P2：CSS 修补仍受到既有高优先级规则覆盖

原补丁的 `input.ai-input` / `textarea.ai-input` 高度和内边距生效，但其背景与边框声明会被 `liquid.css:71` 的通用输入选择器覆盖。试验中最终背景仍为 `rgba(255,255,255,0.42)`，没有采用补丁声明的新背景。

**解决：** 梳理规则来源后合并到所属组件；修正高优先级通用选择器，避免不断追加更强的选择器。用计算样式验收每项目标属性。

选择器中 `:is()`、`:not()` 的优先级依据其参数计算；同级规则还受源码顺序影响，参照 [W3C Selectors Level 4](https://www.w3.org/TR/selectors-4/#specificity-rules)。

### R07 · P2：把连续材质误判为覆盖缺口

[device-detail.css:1](/E:/CC_testP/iot-manager/apps/client-glass-next/src/css/device-detail.css:1) 明确说明采用一整张连续材质；[glass-surfaces.js:27](/E:/CC_testP/iot-manager/apps/client-glass-next/src/js/appearance/glass-surfaces.js:27) 明确避免给六个详情子区叠加独立光学卡片。天气主指标也位于已有外层天气面板之内。

原补丁确实能把状态子区变回卡片，但这属于设计变更，会增加层级和内边距，不应被包装成必需的缺陷修复。

**解决：** 保留外层面板、内部分隔线及状态标题。只有在可读性测试证明具体区域边界不足时，补局部低成本底衬；不为六个子区全部叠加滤镜或光学层。

### R08 · P3：旧滑块函数存在样式缺口，但不是当前调用路径

[ui.js:2320](/E:/CC_testP/iot-manager/apps/client-glass-next/src/js/ui.js:2320) 中旧 `buildLevelControl` 确实缺少 fluid 类。不过在本次仓库调用检查中，只找到其定义；当前路径为 `buildCapabilityControl → buildRangeControl → buildValidatedRangeControl`。

当前实现已具有 fluid 类、范围/步长校验、动态填充比例及无效值禁用。不能将“旧函数缺样式”直接推导为“当前设备控制页滑块退化”。

**解决：** 核查扩展接口后删除旧方法，或委托统一构建器；不引入新的固定 0–100 控制路径。实际进度比例保持 `(value-min)/(max-min)`，不能对通用设备直接使用 `value%`。

## 4. 原计划 14 项逐条处置

本表中的“确认”指现象或代码判断得到支持，不代表整改已实施。

| 原编号 | 审核结果 | 本轮处置 | 对应验收 |
| --- | --- | --- | --- |
| 1 启动遮罩 | 实色启动样式属实；是否改为玻璃是视觉统一目标 | 可统一底色与高光；保留 watchdog、重试、无 JS 和减少动画逻辑；不依赖额外光学脚本完成启动 | T10 |
| 2 顶栏/底栏/胶囊 | 胶囊边界较弱属实；当前导航已 sticky，未复现其脱离视口 | 保持 sticky 和现有专用导航 lens；不追加 `!important`；保留 48px；修复高对比度覆盖 | T02、T04、T09 |
| 3 空状态/设备列表 | 列表外层透明，设备空状态本身无边界属实 | 给独立空状态补 CSS 材质；嵌在已有卡片内的空状态保持平面；长列表优化单独评估 | T01、T03 |
| 4 详情状态面板 | 清空内层背景确实存在，但为有注释的连续面板设计 | 保留连续面板；验证状态标题、分隔线、窄屏和长值，不全面恢复子卡片 | T05 |
| 5 控制区 | 旧方法漏类属实；主路径已正确；未选中模式按钮的透明为已有分段设计 | 保护现有能力控件；旧方法仅作清理；选中、禁用、待确认及焦点必须可辨 | T06 |
| 6 命令/动态/元数据 | 透明排布属于详情内部层级设计 | 维持标题和时间线结构；必要时补边界，不能改变命令确认语义 | T05、T06 |
| 7 BLE/LAN 摘要 | 缺独立滤镜属实，但当前 `--surface-muted` 在玻璃模式下已半透明，并非完全实心灰块 | 补一致的 CSS 边界/高光；无需自动增加折射层 | T01、T03 |
| 8 通用表单 | 玻璃丰富度不足可优化；固定“11 个输入框”不是稳定验收口径 | 按组件和状态覆盖；空元素不注入子节点；焦点不只依靠渐变边框 | T03、T07 |
| 9 连接/显示分段 | 托盘缺独立滤镜；底色同样来自可变的半透明 token | CSS 材质与状态一致即可，避免托盘和每个 segment 全部增加光学层 | T02、T03 |
| 10 天气子区域 | hourly 背景透明属实；主指标平面排布为已有连续设计 | 可补逐时项轻边界；保留主指标平面布局；折叠表单优先保证阅读与焦点 | T08 |
| 11 AI 等待区 | 区域无单独包裹属实 | 补 CSS 状态面板，不改变“停止本地等待/查询结果”的行为 | T01、T07 |
| 12 AI 性格 | 名称框 88px、字段内边距为 0 属实；性格正文是否单独卡片为设计选择 | 名称框至少 48px、textarea 至少 88px；补内边距和焦点；长正文正常换行 | T07 |
| 13 AI 历史 | 水平 padding 为 0 属实；原样式已经有 flex，不能说完全缺少 Flex 对齐 | 调整 padding、长标题换行和操作区布局；保留 flex-wrap | T07 |
| 14 Notice/Toast | Notice 背景色被抹白属实，文字色仍保留；Toast 实色属实 | 按 tone 定义完整材质，保证对比度；Toast 宿主仍由 `.toast-region {position:fixed}` 定位 | T04、T09 |

补充：`glass-shell`、`glass-control` 等未命中的白名单项可以清理，但死条目本身不会阻止其他有效类命中，不能把它们认定为所有覆盖缺口的直接根因。

## 5. glass.5 的开发方案

### 5.1 保持的业务契约

- 工程仍位于独立的 `apps/client-glass-next`，保留包名、真实 API/WS、OIDC/PKCE、安全会话及原生适配器。
- CSS/光学节点不能影响控件事件、命令幂等、回执状态、焦点、输入草稿或局部 DOM 复用。
- 已上报状态只依据实际回执更新；装饰动画不制造“已成功”。
- AI 查询结果不能重复 POST；停止本地等待不伪装成取消服务器生成。
- 本次不迁移后端、改凭据、开启 AI 知识库、改变 BLE 编解码或重写 Store。

### 5.2 材质分层规则

“玻璃覆盖”定义为：有一致、可读、可降级的材质表达；**不要求每个组件都有 `<liquid-glass>`**。

| 层级 | 适用组件 | 规则 |
| --- | --- | --- |
| 主材质 | 详情外层、天气主面板、AI 工作区、独立空状态 | 一层 CSS 玻璃；光学折射按区域选择；内部不默认再叠滤镜 |
| 控件材质 | 按钮、分段选中项、站点/天气入口 | 保留触控、焦点、选中/禁用状态；尺寸与定位由组件决定 |
| 语义材质 | Notice、AI notice、Toast、请求等待区 | tone 同时决定文字、图标、边界、底色；优先可读性 |
| 平面内容 | 详情内部状态/元数据、天气主指标、布局容器 | 继承外层材质，通过排版和分隔组织信息 |

不向 `input/select/textarea/img/br/hr` 等不适合的宿主自动挂载光学子节点。所有光学层继续 `aria-hidden`、`inert`、`pointer-events:none`；同一宿主不得重复插入。

### 5.3 具体源码改动

| 文件 | 必做改动 | 实施限制 |
| --- | --- | --- |
| `src/css/liquid.css` | 去除 AI 根透明化误伤；整理 Notice/AI notice 的 tone；补独立摘要、等待、空状态及分段的 CSS 材质 | 合并原规则，不再向文件末尾堆整段同义覆盖；不覆盖详情连续布局 |
| `src/css/glass-layout.css` | 移除全体 AI 输入统一 88px；按 input/textarea 区分；补非聊天字段及历史条目 padding；修正 AI 错误色被覆盖 | 保留 composer 专属布局；历史长标题、按钮允许换行 |
| `src/css/ai.css` | 明确字段、正文、历史和提示的组件基础样式；恢复可见焦点 | 基础样式在实色和光学脚本失效时仍可用 |
| `src/css/glass.css` | 统一最终材质的实色/系统高对比度兜底；保留 48px 和滑块高对比样式 | 同时检查 `prefers-contrast` 与 `forced-colors`；不用无条件导航模糊覆盖媒体查询 |
| `src/css/weather.css` | 若逐时项确有分辨需求，补低成本边界；保持指标平面设计 | 不为所有 hourly/metric 逐个增加 SVG/WebGL 光学组件 |
| `src/js/appearance/glass-surfaces.js` | 审查两处工作区改动与材质分层的关系；本轮不按原计划扩充全部白名单 | 内部六区排除规则保留；布局定位与光学装饰解耦；需要变更时补宿主契约测试 |
| `src/js/appearance/glass-appearance.js` | 核对材质切换、背景状态、组件加载失败及销毁的一致性 | 不合入连续 rAF 性能监控；不改变用户材质选择优先级 |
| `src/js/ui.js` | 仅在核查完成后清理或统一旧 `buildLevelControl`；补充必要的组件语义属性 | 保留能力驱动的 `buildValidatedRangeControl` 及事件契约 |
| `index.html` | 若本版纳入启动视觉统一，修改内联基础材质并补系统高对比度兜底 | 保留无 JS、watchdog、重试和退出协调；不增加固定启动等待 |
| `e2e/`、`test/` | 新增材质/焦点/语义/尺寸契约测试，扩充真实入口覆盖 | 区分源码 UI、生产构建和安装后 APK 三层证据 |

### 5.4 实施示例与约束

以下是整改方向示例，**尚未写入 App、也不代表已完成验证的完整补丁**。开发时需同时删除或合并冲突规则。

```css
/* 只有设备列表布局容器透明；不要同时清空 AI 根材质。 */
#app:not([data-glass='solid']) [data-region='device-list-surface'] {
  background: transparent;
  border: 0;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none;
}

#app .ai-workspace input.ai-input { min-height: 48px; }
#app .ai-workspace textarea.ai-input { min-height: 88px; }
#app .ai-input:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 3px;
}

@media (forced-colors: active), (prefers-contrast: more) {
  #app .ai-input:focus-visible { outline-color: Highlight; }
}
```

全局 `.glass-panel {position:relative}` 若继续保留，不得覆盖本来 sticky/fixed 的组件。优先限制装饰宿主或降低通用规则优先级，保持定位由具体组件掌握；不要依赖越来越多的 `!important` 修补。当前顶/底导航不在普通面板白名单中，已有专用导航 lens，不能为了防范一个假设冲突而重新注入整面板。

完整材质规则应具有实色默认值，只在支持滤镜且有效模式允许时增强。高对比度覆盖须匹配实际最终模式和具体组件选择器；仅在旧媒体查询后追加一条低优先级声明并不可靠。

### 5.5 工作拆分与完成条件

| 顺序 | 工作包 | 依赖 | 完成条件 |
| --- | --- | --- | --- |
| M0 | 冻结基线和修订问题状态 | 无 | 保存 HEAD、差异、输入摘要、APK 摘要；建立 14 项到验收 ID 的映射 |
| M1 | AI 与语义色/焦点修复 | M0 | R02、R04、R06 对应的计算样式和交互测试通过 |
| M2 | 组件材质与系统降级 | M1 | 空状态/摘要/分段/等待区一致；R03、R05 无回归；连续面板保持 |
| M3 | 天气与启动视觉收口 | M2 | 预报可辨、表单状态稳定；启动失败和无 JS 场景可恢复 |
| M4 | 完整回归与构建 | M1–M3 | 原有测试及新增 T01–T10 通过；生产构建不含测试夹具 |
| M5 | 安装包与发布记录 | M4 | T11–T12 完成；版本/签名/摘要一致；逐项标记真实验收状态 |

本轮无需数据库迁移。性能开关、Store 优化和新通信能力不作为 M1–M5 的隐含依赖。

## 6. 测试和验收设计

### 6.1 自动验收矩阵

覆盖 12 个页面：设备列表、详情、动态、添加、BLE、LAN、站点、连接、天气、AI 聊天、AI 历史、AI 性格；另覆盖启动和全局通知。

| ID | 场景 | 必须断言 |
| --- | --- | --- |
| T01 | 独立面板与光学失败 | AI 三页、空列表、摘要、等待区的目标材质生效；光学 chunk 失败时文字、表单和操作可用；不通过单纯“存在 liquid-glass”判定视觉完成 |
| T02 | 模式与系统偏好 | liquid/frosted/solid、forced-colors、prefers-contrast；系统强制实色时所有受管理滤镜关闭；减少动画不擅自改变材质；前后台正确恢复 |
| T03 | 宿主与局部更新 | 空元素没有光学子节点；同一宿主无重复 lens；既有更新不替换正在操作的控件；销毁后 observer/监听器停止；层不截获指针 |
| T04 | 语义色和可读性 | warning/danger/success/info 及 AI 错误的背景、文字、图标/文案可辨；保留 alert/status；实际合成背景下达到目标对比度 |
| T05 | 连续详情 | 仅外层主材质，内区分隔完整；期望/上报标题与长数值可读；320px 无横向溢出；元数据不被误作可控能力 |
| T06 | 设备控制 | 主路径保持有效范围与步长；拖动/键盘提交只发一次；待确认禁用；ACK 前不冒充已上报；无效能力只读；模式选中和焦点可辨 |
| T07 | AI 表单与历史 | 名称 input 高度至少 48px；textarea 至少 88px；输入聚焦有可见提示；历史长标题、删除按钮、4000 字性格及错误不贴边；恢复查询不重复发送问题 |
| T08 | 天气与折叠表单 | 逐时项横向阅读位置保持；指标单位、状态和长值清晰；坐标保存后保持展开与草稿；失败/冷却不伪装成刷新成功 |
| T09 | 导航、Toast、安全区 | 顶栏 sticky、底栏贴视口；滚动到底和返回仍稳定；Toast 宿主 fixed 且不遮关键操作；站点/天气目标至少 48px；桌面侧栏不受移动规则误伤 |
| T10 | 启动 | 正常、慢模块、模块失败、重试、无 JS、减少动画、高对比度；首屏就绪立即释放；启动装饰零业务写请求 |
| T11 | 生产构建 | 不含开发预览/测试设备；第三方 notices 保留；主脚本/CSS/HTML 来自同一构建；光学脚本失败仍可读 |
| T12 | Android 包及安装后检查 | 同一包名及签名；版本递增；APK 内网页资源与 dist 逐文件摘要一致；安装后显示同一构建身份；检查冷/热启动、键盘、安全区与返回 |

视口回归使用 320、390、414、768、820、1024、1440px。至少在目标 Android WebView 上复核；实体手机、软键盘、横竖屏和系统字体放大属于单独的安装后验收，不能用桌面 Chromium 截图替代。

新增测试应验证用户可见行为和样式契约，而不是逐字符比对补丁源码。样式断言以可见边界、有效模式、尺寸与状态为主，避免锁死无关的渐变字符串或散列文件名。

### 6.2 本次审核的复现方式

证据脚本与结果保存在：

```text
E:\CC_testP\iot-manager\artifacts\glass-remediation-audit-20261018
```

该目录中的 `audit.config.mjs` 使用独立 5194 端口；`style-probe.mjs` 将附件 CSS 和白名单变更仅施加到隔离浏览器。`compare-ai-css.mjs` 只比较提取的 APK CSS 与工作区 CSS，不能作为安装后运行验证。

在仓库根目录可重跑：

```powershell
# 先在独立终端启动隔离服务器；不读取真实后端或登录服务。
$env:IOT_DEV_API_TARGET='http://127.0.0.1:9'
$env:IOT_DEV_CA_FILE=''
$env:VITE_API_BASE_URL='/api/v1'
$env:VITE_WS_URL='ws://127.0.0.1:5194/ws/devices'
$env:VITE_OIDC_ISSUER_URL=''
$env:VITE_OIDC_CLIENT_ID=''
$env:VITE_OIDC_REDIRECT_URI=''
$env:VITE_OIDC_SCOPE=''
node apps/client-glass-next/node_modules/vite/bin/vite.js apps/client-glass-next --host 127.0.0.1 --port 5194 --strictPort
```

```powershell
# 另一个终端，工作目录仍为仓库根。
$env:IOT_RUNTIME_BASE_URL=''
$env:IOT_LIVE_AI_ACCEPTANCE='false'
$env:IOT_PLAYWRIGHT_OUTPUT_DIR='E:\CC_testP\iot-manager\artifacts\glass-remediation-audit-20261018\browser-output'
node apps/client-glass-next/node_modules/@playwright/test/cli.js test --config artifacts/glass-remediation-audit-20261018/audit.config.mjs
node artifacts/glass-remediation-audit-20261018/style-probe.mjs
node artifacts/glass-remediation-audit-20261018/compare-ai-css.mjs
```

整改实施后的常规命令在独立 App 目录执行：

```powershell
npm test
npm run test:e2e
npm run build
# 配置本机 JDK/Android SDK 后，生成待验收的新包。
npm run android:debug
```

执行真实环境用例时单独提供环境配置，不沿用隔离服务器配置；结果另行记录。服务端和 AI 真实调用未获得执行任务时，不把它们混入样式回归。

### 6.3 证据样例

- 当前 AI：[截图](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/baseline-ai.png)。
- 原计划补丁后的 AI：[截图](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/proposal-ai.png)。
- 原计划补丁后的详情嵌套卡片：[截图](/E:/CC_testP/iot-manager/artifacts/glass-remediation-audit-20261018/proposal-detail.png)。

这些为合成测试数据和审核夹具截图。浮动提示由夹具主动添加，不表示实际服务器操作成功；不能充当真机或 glass.5 的完成截图。

## 7. 后续架构和性能路线

### 7.1 材质契约集中化：优先于增加更多白名单

近期可建立一个组件材质登记表，记录组件角色、CSS 材质、光学预算、语义 tone 与降级要求。UI 节点的 `data-region` 继续只表示渲染区域，不隐含“必须透明”之类外观约定。

登记表与浏览器覆盖检查共同维护，减少 JS 白名单和 CSS 选择器各自遗漏的情况。迁移按页面进行，保留兼容路径；不为 glass.5 再做一次全 UI 框架重写。

### 7.2 content-visibility：先实验，再宣称优化

`content-visibility:auto` 可以跳过部分屏外渲染工作，但不等同于移除 DOM 或停止自定义元素的 JS/观察器。本项目光学组件的生命周期及尺寸观察不会因为加入该属性就自动形成完整的屏外资源管理。

应单独以 100/500/1000 行夹具验证：首次滚动、返回阅读位置、长标题动态高度、按压期间更新、键盘聚焦、读屏和实时推送。估计高度应覆盖真实卡片边距、网格与内容变高；不能只凭 `116px` 的最小高度宣布收益。

比较开启/关闭时的帧时间、主线程、内存及光学实例数，并记录设备/WebView。没有目标设备证据前不纳入本轮默认启用项。属性语义参照 [W3C CSS Containment Level 2](https://www.w3.org/TR/css-contain-2/#content-visibility)。

### 7.3 帧率自适应：避免永久采样和频繁跳档

当前 motion policy 已分离减少动画、页面隐藏和手动降级；glass appearance 也管理可见性与用户材质选择。新性能策略应复用这些边界。

仅在前台、可见且发生相关交互时做有界采样；排除启动、后台节流和系统切换。需要明确采样窗口、降级阈值、恢复阈值、冷却、迟滞与销毁规则。不能仅凭“连续低于 30fps”就永久覆盖用户选择。

优先减少屏外光学和重复效果，再比较 frosted/solid 的实际成本；毛玻璃本身也有合成成本。该功能应以可关闭的独立实验交付，不计入 glass.5 已完成项。

### 7.4 Store 结构共享：优化发布路径，保留不可变约束

[store.js:263](/E:/CC_testP/iot-manager/apps/client-glass-next/src/js/store.js:263) 的 `publish` 确实重新 normalize 并递归冻结；但 `getState()` 直接返回当前快照，并不在每次读取时全树深克隆。原计划应区分读路径和发布路径。

先测量设备更新、天气更新和相同值推送的耗时分布，再决定优化范围。按变更域保留未变分支引用，保留无变化时不发布、外部输入隔离、旧快照不可变、状态分区和事件 metadata 语义。

不能只删除生产 `Object.freeze` 来宣称完成优化；这会改变代码防止外部修改状态的保障。是否取消运行时冻结，需要在输入隔离、所有权和不可变构造得到证明后单独评审。

保留并扩展 `store.test.js`、`refresh-stability.test.js`、渲染协调与命令测试。重点验证旧快照未改变、重复推送零发布、按压控件不替换、ACK 不抢焦点、跨账号/站点不串数据。

### 7.5 BLE 协议下发：独立协议工程

当前 [ble-profile-registry.js](/E:/CC_testP/iot-manager/apps/client-glass-next/src/js/adapters/ble-profile-registry.js) 不只是硬编码字段表，还包含帧版本、opcode、CRC、随机 token 和确认解析。JSON Schema 能校验描述结构，不能单独替代完整编解码与命令状态机。

若建设后端 Profile，下发格式至少需要：受支持的 codec 类型、版本/兼容范围、服务及特征白名单、字节序/长度/边界、token 和 CRC 规则、确认匹配及超时、权限/来源校验、缓存原子替换和回滚。

不执行下载脚本或 `eval`。未知/不兼容 Profile 继续只读，不回退为任意 GATT 写入。需要固件黄金报文、损坏报文、错误设备确认、断线和重放测试后才能交付。

### 7.6 AI 诊断与流式输出：保留现有幂等恢复契约

当前客户端的 `askAi` 和服务端 `AiController.chat` 采用 JSON 完整结果或 202 等待状态，并提供请求查询、历史和幂等机制。只在前端使用 `ReadableStream` 不能使服务器自动变成流式协议。

先支持“设备详情填入诊断草稿”：只选择必要的已上报状态、采样时间、设备标识和异常码，清楚区分期望与上报；保持站点授权和数据最小化。默认由用户审阅后发送，不以进入 AI 页自动触发供应商调用。

流式能力单独扩展服务端和 capabilities，定义 requestId/事件序号、增量/最终结果、错误/结束、重连与查询恢复，以及计费/幂等边界。无流式能力时继续使用既有 JSON/202 路径；断流后不能自动 POST 一个新的相同问题。

## 8. 构建、发布和回滚

1. 实施前冻结 glass.4 的 APK 摘要、现有差异和本次审核证据，保留用户尚未提交的工作。
2. 在源码目录修改，不直接编辑散列 JS/CSS 或 APK；不以 `Al/Nl/Ps` 等压缩名作为长期修改接口。
3. 协调版本名、锁文件和 Gradle code，保持独立包名 `com.iot.manager.glassnext`。
4. 构建完成后检查生产资源排除、第三方 notices、APK 签名、包身份，以及 APK 内所有网页资源与最终 dist 的摘要一致性。
5. 在已安装包上显示版本/构建身份并完成验收；把未执行的真机/真实协议项目列为未执行。
6. 更新 `VERIFICATION.md` 时按日期追加本次结果，不覆盖旧记录；附问题—测试—构建的对应关系。

若后续发现问题，优先从上一稳定源码重建同包名、同签名且具有更高 `versionCode` 的回退包，以便保留用户配置和会话。不要把卸载清数据作为默认回滚步骤；直接安装较低 code 的旧包也不能视为普遍可用的升级回退方案。

本次交付仅包括审核文档、复现脚本和证据；没有修改 App 实现、发布新包、部署服务或操作现有账号。

## 9. 开发交付清单

- [ ] 统一 APK 与源码基线，保存未提交差异和摘要。
- [ ] 修正 AI 根容器、语义色、焦点和输入高度。
- [ ] 补齐独立状态面板的 CSS 材质，保持连续详情和天气指标布局。
- [ ] 解决三种材质、两种系统高对比度场景及后台状态的降级问题。
- [ ] 保留 48px 触控目标、原生命令控件和局部 DOM 复用契约。
- [ ] 完成 T01–T12，并明确记录真实环境未执行项。
- [ ] 对同一份 APK 完成身份、签名、资源摘要与安装后验收。
- [ ] 将性能、Store、BLE 与流式 AI 分立建项，不混记为 glass.5 已完成。

上述清单均为**后续开发任务**，未因本次审核完成而自动勾选。
