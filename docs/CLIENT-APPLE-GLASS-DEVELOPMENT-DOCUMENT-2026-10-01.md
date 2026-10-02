# 移动端（Client）Apple 风格轻毛玻璃与通用工控页面开发方案

> **文档版本**：v1.2（二次审核修订版，示例复测；待 App 实施与原生验收）  
> **初稿日期**：2026-10-01  
> **修订日期**：2026-10-02  
> **适用框架**：原生 ES Modules、Vite 5、Capacitor 8 Android / PDA  
> **审核依据**：[页面设计审核报告](E:/CC_testP/iot-manager/docs/CLIENT-APPLE-GLASS-DESIGN-REVIEW-2026-10-01.md)  
> **验证状态**：本版补齐多指取消、范围校验及强制颜色轨道；测试记录见第 10 节。示例在隔离页面接入生产 UI 模块验证，尚未合并到 App，不代表已完成完整视觉、业务回归或真机验收。

## 1. 设计方向与实施范围

采用“导航区轻毛玻璃、内容区高对比”的设计。保留 Apple 风格的克制层次、圆角和触控反馈，优先让现场人员辨认站点、设备、连接与命令结果。

Apple 的 Liquid Glass 设计说明建议将材质主要用于导航层，并避免玻璃叠玻璃；本方案借鉴其分层原则，用普通 CSS 实现轻毛玻璃，不宣称复现原生光学折射。[Apple：Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)

| 区域 | 修订后的设计 | 实施边界 |
| --- | --- | --- |
| 顶栏、底部导航 | 浅色高不透明度背景，支持时启用轻模糊，细边框与轻阴影 | 沿用原导航、站点、连接、账号和天气入口 |
| 设备列表 | 稳定底色、18px 圆角、名称与状态清楚分层 | 第一阶段继续点击卡片打开详情，不新增列表快捷开关 |
| 详情控制 | 原生 range 加渐变轨道与明确数值，待确认状态采用现有语义色 | 保留能力模型、输入事件、命令提交与 ACK 链路 |
| 告警、离线与缓存提示 | 固定底色，文字与图标共同表示状态 | 不以装饰颜色代替状态说明，不把未知显示为正常 |
| AI 输入区 | 静态渐变边框，聚焦时适量强调；快捷提问保持稳定布局 | 只填写草稿，发送仍由现有发送按钮与状态门禁控制 |

第一阶段覆盖现有 Android / PDA 客户端及浏览器页面。iOS 原生工程、相机扫码、PDA 硬件扫码、BLE 延迟测量、AI 天气/告警/最近命令检索另列功能开发与验收，不作为本次视觉改造的已具备能力。

## 2. 信息层级、顶栏与多屏布局

### 2.1 通用顶栏

系统时间、信号与电池由原生系统栏提供。页面使用安全区，不绘制模拟挖孔或系统状态栏。

```text
┌────────────────────────────────────────────┐
│ 当前站点名称 ▾              [连接] [账号]  │
│ 平台连接正常 · 室外参考 28°C · 更新 09:40   │
├────────────────────────────────────────────┤
│ 设备名称 / 编号                            │
│ 在线、缓存、待确认或失败的明确说明          │
│                                            │
├────────────────────────────────────────────┤
│    设备       AI       动态       添加      │
└────────────────────────────────────────────┘
```

图中文字是布局示意，实际内容来自视图模型。顶栏第一行放站点选择与连接/账号入口；第二行放链路状态和可点击的天气摘要。温湿度与结露提示标为室外参考，并显示更新时间或缓存说明。完整天气详情继续通过 `open-weather` 打开。

链路说明来自 `runtime.accessRoute` 和 `connectionHealth`；单设备 BLE 状态放在对应设备详情。没有真实测量值时不显示毫秒延迟，没有完整告警数据时不显示“0 告警”。

### 2.2 布局规则

| 可用宽度 / 情况 | 布局规则 | 验收重点 |
| --- | --- | --- |
| 320–359 CSS px | 设备单列；站名可截断；右侧连接/账号使用有名称的图标按钮；次要信息允许折行 | 无横向溢出，主操作区域不挤压 |
| 360–767 CSS px | 默认单列设备卡片，信息区可弹性折行 | 390/414px 不强制双列；设备编号与状态仍易辨认 |
| 768 CSS px 及以上 | 在卡片实际可用宽度足够时使用双列 | 同时考虑 820px 起现有侧栏对内容宽度的影响 |
| 横屏 / 折叠屏 / 分屏 | 以实际内容宽度重新布局，处理四个方向安全区 | 左右挖孔、窗口变化与原生 padding 不重复补偿 |
| 字体放大至 200% / 软键盘打开 | 允许文字折行与页面滚动，保持输入与发送入口可达 | 不固定卡片高度，不截断操作说明或错误信息 |

主操作按至少 48 CSS px 的触控区域设计，并在 WebView/PDA 上验证实际尺寸；正文建议 16px，辅助说明 14px，12px 仅用于次要时间等信息。普通文本对比度目标至少 4.5:1，较大文字至少 3:1；状态同时提供文字或图标。Android 官方使用 48dp，两种单位需结合设备密度验证。[Android 无障碍指南](https://developer.android.com/guide/topics/ui/accessibility/apps)

### 2.3 安全区的补偿责任

沿用当前 Capacitor SystemBars 的处理方式，根据 WebView 版本确认原生 padding、CSS 注入变量和键盘补偿。CSS 优先读取 `--safe-area-inset-*`，以 `env()` 为 fallback；四个方向分别应用到顶栏、内容和底部导航，不在多个父子容器重复累计。真机验收记录 Android 版本、WebView 版本和实际边距。[Capacitor System Bars](https://capacitorjs.com/docs/apis/system-bars)

## 3. 模块边界与挂载位置

| 文件 | 计划修改 | 保留的契约 |
| --- | --- | --- |
| `client/src/css/style.css` | 视觉变量、导航材质、卡片、原生 range 外观、断点与材质降级 | 原有布局类、状态色、导航选中位置与焦点可见性 |
| `client/src/css/ai.css` | 静态输入边框、快捷按钮与小屏布局 | 原输入框、消息区、错误与恢复提示 |
| `client/src/js/ui.js` | 装饰类、range 构建与提交校验、手势取消、外观同步、材质开关与 AI 事件委托 | 视图模型边界、原生键盘操作、局部更新和设备控制数据字段 |
| `client/src/js/device-capabilities.js` | 在 normalizeCapability 中保留原始范围是否合法的标记 | 原能力 ID、命令、参数、状态字段和非 range 能力行为 |
| `client/src/js/range-contract.js`（新增） | 共享原始/归一化能力的有限范围与步长校验 | 纯模块；不读取 DOM，不提交命令，不静默修复显式非法定义 |
| `client/src/js/ai/ai-view.js` | 挂载稳定的快捷提问栏与输入区装饰 | `ai-content`、`ai-messages`、`ai-question` 和现有按钮动作 |
| `client/src/js/ai/ai-quick-prompts.js`（新增） | 共享静态问题定义和填写草稿的可用性检查 | 纯模块，不读取 DOM，不调用 API |
| `client/src/main.js` | 增加同步填写草稿的 UI handler，连接真实 AI controller | 功能开关、站点/身份边界、发送、限流与请求恢复 |

沿用 ES Modules，不引入 UI 库或 Tailwind。原生模块和 CSS 仍有执行、布局与合成成本，性能以测量为准。

具体挂载点：

- `buildHeader()` 保留 `.app-header` 和 `data-region=header`，增加 `.app-header--glass`；内部使用 `.header-main-row` 和 `.header-context-ribbon`。保留 `.app-brand`、`.header-actions`，将站点选择移入第一行左侧，将现有天气与链路节点移入第二行。
- 保留 `open-site-switcher`、`open-connection-settings`、`sign-in`、`sign-out`、`open-weather`，以及 `weather-header`、`runtime-status` 更新区域。站点按钮提供含完整站名的可访问名称。不得复制同一个更新区域生成第二份数据节点。
- 小屏旧规则会隐藏 `.header-status` 和按钮文字；新顶栏规则需明确覆盖链路节点的显示，站点按钮不放入隐藏文字的右侧操作组。
- `buildMobileNav()` 保留 `.bottom-nav` 和已有四个入口，只增加 `.bottom-nav--glass`；保留选中背景与位置变换逻辑。
- `buildDeviceRow()` 保留 `.device-row`、`open-device`、设备身份与状态字段，增加 `.device-row--card`；列表增加 `.device-list--cards`。卡片本身继续是详情入口，不嵌套按钮。
- `buildRangeControl()` 保留 `.range-row`、`.range-input`、`.range-value`、`data-field=capability-range`、`data-range-key` 和 `capabilityActionData()`。滑块外观只增加 `.range-input--fluid`。

## 4. 基础材质、降级与卡片示例

以下 CSS 是合并到现有样式中的增量。将新规则放在对应组件旧规则之后，并检查断点的选择器优先级。设备、控制与告警内容使用稳定底色。

```css
:root {
  --safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
  --safe-right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px));
  --safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
  --safe-left: var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
  --glass-solid: #ffffff;
  --glass-navigation: rgba(255, 255, 255, 0.90);
  --glass-filter: blur(12px) saturate(115%);
  --glass-line: rgba(21, 33, 39, 0.14);
  --glass-shadow: 0 4px 16px rgba(21, 33, 39, 0.06);
  --radius-card: 18px;
}

/* 默认即可读；不支持滤镜的浏览器保持此背景。 */
.app-header--glass,
.bottom-nav--glass {
  background: var(--glass-solid);
  border-color: var(--glass-line);
  box-shadow: var(--glass-shadow);
}

.app-header.app-header--glass {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right))
    10px calc(12px + var(--safe-left));
  position: sticky;
  top: 0;
  z-index: 20; /* 低于现有 toast 的 50；需再核对覆盖层。 */
}

.header-main-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.app-header--glass .app-brand { min-width: 0; }
.app-header--glass .site-picker-trigger {
  min-width: 0;
  min-height: 48px;
  max-width: 100%;
}
.site-picker-trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-header--glass .header-actions { margin-left: 0; flex-wrap: wrap; }
.app-header--glass .header-actions .button { min-width: 48px; min-height: 48px; }
.header-context-ribbon {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  color: var(--ink-muted);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.app-header--glass .header-context-ribbon .header-status {
  display: inline-flex;
  background: var(--surface-muted);
  /* 作为导航材质内部的平面覆盖，不再次加 backdrop-filter。 */
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .app-header--glass,
  .bottom-nav--glass {
    background: var(--glass-navigation);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
  }
}

/* reduced 控制动画；solid 独立控制材质。 */
#app[data-material='solid'] .app-header--glass,
#app[data-material='solid'] .bottom-nav--glass {
  background: var(--glass-solid);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none;
}
@media (prefers-contrast: more), (forced-colors: active) {
  .app-header--glass,
  .bottom-nav--glass {
    background: Canvas;
    color: CanvasText;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  }
}

.device-list--cards {
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  border-top: 0;
}
.device-row--card {
  min-height: 96px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
}
@media (min-width: 768px) {
  .device-list--cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

`#app[data-material=solid]` 是新增的材质降级契约。实施时在 App 根节点设置，低性能模式、用户关闭透明效果时采用 solid，退出降级后恢复默认。不能只定义 CSS 而没有状态入口；也不能把 `prefers-reduced-motion` 自动等同于关闭透明效果。支持滤镜但实测滚动性能不足的设备同样可以切换 solid。

第一阶段在现有连接设置页面增加“界面显示”组，提供“自动”和“实色”两个至少 48px 的按钮。`ui.js` 根节点事件委托处理新增 `set-display-material` 动作，只接受 `data-material-mode=auto/solid`，设置 App 根节点的 `dataset.material` 并更新按钮选中与 `aria-pressed`。当前会话默认 auto，导航切换保留根节点上的选择；本阶段不增加自动弱机识别或持久化设置。系统高对比模式仍优先于 auto。材质选择独立于动画策略，不因换材质改变业务状态。

模糊半径和阴影是原型初值。先测低配 PDA 的滚动、输入与控制响应，再调整强度；不对卡片列表批量增加滤镜、额外合成层或常驻 `will-change`。

## 5. 原生滑块的外观增强与命令状态

### 5.1 原生控件和业务契约

移除 v1.0 的独立 `createFluidSlider()` 方案。继续由设备能力提供 min/max/step，使用原生 range；不注册实例级 window 指针监听器。

| 情况 | 页面表现 | 允许的操作 |
| --- | --- | --- |
| 设备状态已同步，可控制 | 显示设备上报值与可调范围 | input 更新本地预览；有效 change 走现有命令提交 |
| 正在拖动 | 显示拟设值；不会称为已执行 | 实时刷新保留活动控件，避免覆盖当前手势 |
| 命令 PENDING / SENT | 目标值标为待确认，沿用 amber 语义，控件禁用 | 等待回执，不因动画或超时自动重发 |
| ACK / 新上报到达 | 根据现有命令与设备状态模型显示结果 | 不把视觉填充当作物理执行的证明 |
| 失败 / 回执查询停止 | 显示现有失败或结果仍待核实说明 | 重试沿用明确的现有动作，不自动提交 |
| 缓存只读 / BLE 断开 / 能力不可用 | 沿用现有控制限制与原因 | 不以新外观绕过只读限制 |
| pointercancel / 多指 / 切换站点设备 / 页面销毁 | 撤销未完成的操作意图，恢复当前有效值 | 不提交旧上下文命令 |

v1.1 复测已经确认：现有 rangeInteraction 在第二指介入后仍可能提交，因此本版把独立的 rangeGuard 列为必做项。rangeInteraction 继续负责拖动期间的局部更新；rangeGuard 负责开始时的设备、能力、范围、上下文和视图快照及提交校验，不能用前者的清空代替后者的校验。

取消时先废弃该次意图，再移除旧 input 并按当前模型重建。旧节点从此不能提交，即使随后收到 change；新节点仍可通过键盘或辅助技术表达新的操作。只有取消或失效时才替换节点，普通拖动与实时刷新继续保留活动控件。取消记录不依赖任意毫秒延迟，不添加每个滑块的全局监听器。

原始能力校验与归一化能力校验共用第 5.3 节的契约。未声明范围仍沿用 0/100/1 默认值；显式非法数字、倒置/相等范围和非正步长必须保留错误标记。未上报有效数值时显示原因并禁用。不能仅把外观填充设为 0%，也不能把非法元数据过滤后重新当作默认能力开放。

### 5.2 CSS 示例

保留输入与 output 相邻，避免破坏现有 `target.parentElement.querySelector('output')` 更新方式。

```css
.range-input--fluid {
  --range-fill: 0%;
  --range-accent: var(--teal);
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  padding: 0;
  background: transparent;
}
.range-input--fluid:disabled { --range-accent: var(--amber); opacity: 1; }
.range-input--fluid::-webkit-slider-runnable-track {
  height: 12px;
  border-radius: 999px;
  background: linear-gradient(to right,
    var(--range-accent) 0%, var(--range-accent) var(--range-fill),
    var(--surface-strong) var(--range-fill), var(--surface-strong) 100%);
}
.range-input--fluid::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 28px;
  height: 28px;
  margin-top: -8px;
  border: 2px solid var(--range-accent);
  border-radius: 50%;
  background: var(--surface);
}
.range-input--fluid::-moz-range-track {
  height: 12px;
  border-radius: 999px;
  background: var(--surface-strong);
}
.range-input--fluid::-moz-range-progress {
  height: 12px;
  border-radius: 999px;
  background: var(--range-accent);
}
.range-input--fluid::-moz-range-thumb {
  width: 24px;
  height: 24px;
  border: 2px solid var(--range-accent);
  border-radius: 50%;
  background: var(--surface);
}
.range-validation-message {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--ink-muted);
  font-size: 14px;
  overflow-wrap: anywhere;
}
/* 渐变可能被系统移除，轨道必须另有可见的实线边界。 */
@media (prefers-contrast: more), (forced-colors: active) {
  .range-input--fluid::-webkit-slider-runnable-track {
    box-sizing: border-box;
    background: Canvas;
    border: 1px solid CanvasText;
  }
  .range-input--fluid::-webkit-slider-thumb {
    background: ButtonFace;
    border-color: ButtonText;
  }
  .range-input--fluid:disabled::-webkit-slider-thumb { border-color: GrayText; }
  .range-input--fluid::-moz-range-track {
    box-sizing: border-box;
    background: Canvas;
    border: 1px solid CanvasText;
  }
  .range-input--fluid::-moz-range-progress { background: Highlight; }
  .range-input--fluid::-moz-range-thumb {
    background: ButtonFace;
    border-color: ButtonText;
  }
  .range-input--fluid:disabled::-moz-range-thumb { border-color: GrayText; }
  .range-input--fluid:focus-visible { outline: 2px solid Highlight; outline-offset: 3px; }
  .range-validation-message { color: CanvasText; }
}
```

保留现有焦点轮廓。渐变仅表达预览/目标比例，待确认文字与已上报值仍由详情中的现有状态区域提供。

### 5.3 范围契约：`range-contract.js`

以下共享函数由能力归一化与 UI 同时导入。缺失值使用原默认范围；显式非法数字保留 rangeDefinitionInvalid，避免缓存、归一化或后续默认值掩盖错误。

```javascript
function rangeNumber(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  if (typeof value === 'string' && !value.trim()) return NaN;
  return Number(value);
}

export function rangeSpec(capability = {}) {
  if (capability.rangeDefinitionInvalid === true) return null;
  const min = rangeNumber(capability.min, 0);
  const max = rangeNumber(capability.max, 100);
  const step = rangeNumber(capability.step, 1);
  return [min, max, step].every(Number.isFinite) && max > min && step > 0
    ? { min, max, step } : null;
}

export function normalizeRangeDefinition(source, schema = {}) {
  const first = (...values) => values.find(value => value != null);
  const spec = rangeSpec({
    min: first(source.min, source.minimum, schema.min, schema.minimum),
    max: first(source.max, source.maximum, schema.max, schema.maximum),
    step: first(source.step, schema.step),
    rangeDefinitionInvalid: source.rangeDefinitionInvalid
  });
  return spec
    ? { ...spec, rangeDefinitionInvalid: false }
    : { min: 0, max: 100, step: 1, rangeDefinitionInvalid: true };
}
```

在 `device-capabilities.js` 导入 normalizeRangeDefinition。在 normalizeCapability 的返回对象末尾、原 min/max/step 之后增加 `...(controlType === 'range' ? normalizeRangeDefinition(source, schema) : {})`。使用该函数现有的 source 和已解析 schema，兼容 minimum/maximum、schema/valueSchema/constraints 和命令参数范围。非 range 能力保留原行为。错误标记必须跟随视图模型及缓存，收到新的合法能力定义后重新归一化才能解除。

### 5.4 原生数值和显示：`ui.js`

导入 rangeSpec。以下函数复用原文件的 element、deviceKey、capabilityValue 和 capabilityActionData；buildRangeControl 改为返回 buildValidatedRangeControl(this, device, capability, disabled)。不再对 capability-range 使用旧 clampRangeValue 二次取整。原生 input 在 min/max/step 设定后归一化 value，output、读屏和提交统一读取该实际值。

```javascript
function isCapabilityRange(target) {
  return target instanceof HTMLInputElement && target.type === 'range'
    && target.dataset.field === 'capability-range';
}

function syncRangeAppearance(input) {
  const spec = rangeSpec({ min: input.min, max: input.max, step: input.step });
  const value = input.valueAsNumber;
  const valid = input.dataset.rangeInvalid !== 'true' && spec
    && Number.isFinite(value) && !input.validity.stepMismatch;
  const ratio = valid ? Math.min(1, Math.max(0, (value - spec.min) / (spec.max - spec.min))) : 0;
  input.style.setProperty('--range-fill', String(ratio * 100) + '%');
  const output = input.parentElement?.querySelector('output');
  if (!valid) {
    input.removeAttribute('aria-valuetext');
    if (output) output.textContent = '—';
    return;
  }
  // 用原生 value，不另行取整或截断小数。
  input.setAttribute('aria-valuetext', input.value
    + (input.dataset.rangePending === 'true' ? '，目标待确认' : ''));
  if (output) output.textContent = input.value;
}

function buildValidatedRangeControl(ui, device, capability, disabled) {
  const spec = rangeSpec(capability);
  const key = 'capability:' + capability.id + ':' + deviceKey(device);
  const reported = capabilityValue(capability, disabled ? device.desiredState : null,
    device.reportedState ?? device.state);
  const raw = disabled ? ui.local.commandValues[key] ?? reported : reported;
  const hasValue = raw != null && raw !== ''
    && ['number', 'string'].includes(typeof raw) && Number.isFinite(Number(raw));
  const valid = Boolean(spec && hasValue);
  const row = element('div', 'control-row');
  const heading = element('div', 'control-row__heading');
  const copy = element('div');
  copy.append(element('h4', '', { text: String(capability.label) }),
    element('p', '', { text: spec ? '范围：' + spec.min + ' 至 ' + spec.max : '范围未验证' }));
  heading.append(copy); row.append(heading);
  const rangeRow = element('div', 'range-row');
  const limits = spec ?? { min: 0, max: 100, step: 1 };
  const input = element('input', 'range-input range-input--fluid', {
    type: 'range', min: String(limits.min), max: String(limits.max), step: String(limits.step),
    value: String(valid ? Number(raw) : limits.min),
    disabled: disabled || !valid, hidden: !valid,
    data: { ...capabilityActionData(device, capability), field: 'capability-range',
      rangeKey: key, rangeInvalid: !valid, rangePending: disabled && valid },
    ariaLabel: String(capability.label)
  });
  rangeRow.append(input, element('output',
    'range-value' + (disabled && valid ? ' range-value--pending' : ''),
    { text: valid ? input.value : '—' }));
  if (!valid) {
    input.setAttribute('aria-invalid', 'true');
    rangeRow.append(element('p', 'range-validation-message', {
      text: spec ? '尚未上报有效数值，暂不可调。' : '能力范围或步长无效，暂不可调。'
    }));
  }
  row.append(rangeRow); syncRangeAppearance(input);
  return row;
}
```

如果设备上报值不恰好落在步长上，控件显示最接近的有效可选值，原状态面板继续保留真实上报值；不回写 reportedState 或伪造 ACK。无效范围或未上报数值时，隐藏不可用的轨道、显示“—”及明确原因；设备真实状态仍保留在原面板。

### 5.5 手势与提交门禁：`ui.js`

以下代码复用现有 root 事件委托与 document 的 pointerup/pointercancel。取消时废弃旧 input，后续迟到事件不能再沿旧节点提交。正常键盘或辅助技术 change 不要求伪造 pointerdown，但仍重读当前模型、范围、禁用、身份与命令状态。同步检查只控制用户意图，不替代现有 main.js/adapter 的路由、鉴权和幂等保护。

```javascript
function rangeSnapshot(ui, target) {
  if (ui.destroyed || !isCapabilityRange(target) || !target.isConnected
    || !ui.root.contains(target) || target.disabled || target.hidden
    || target.getAttribute('aria-disabled') === 'true' || target.dataset.rangeInvalid === 'true'
    || ui.local.screen !== 'detail') return null;
  const device = ui.getActiveDevice();
  if (!device || deviceKey(device) !== target.dataset.deviceId) return null;
  const state = deviceScreenState(device, ui.model.runtime);
  const capability = state.controls.find(item => String(item.id) === target.dataset.capabilityId);
  const spec = rangeSpec(capability);
  if (!state.showControls || !capability || capability.controlType !== 'range' || !spec
    || ui.isCommandPending(deviceKey(device)) || ui.isBusy('command:' + capability.id)) return null;
  const expected = capabilityActionData(device, capability);
  for (const key of ['deviceId', 'capabilityId', 'commandType', 'parameterKey', 'stateKey', 'parametersJson']) {
    if (String(expected[key] ?? '') !== String(target.dataset[key] ?? '')) return null;
  }
  if (Number(target.min) !== spec.min || Number(target.max) !== spec.max
    || Number(target.step) !== spec.step) return null;
  return { scope: ui.contextKey(), view: ui.viewKey(),
    signature: JSON.stringify([expected, spec]) };
}

function createRangeGuard(ui) {
  let intent = null;
  let disposed = false;
  const retired = new WeakSet();
  const same = (left, right) => Boolean(left && right
    && left.scope === right.scope && left.view === right.view && left.signature === right.signature);

  function cancel(reason, { restore = true } = {}) {
    const old = intent;
    intent = null; // 必须先废弃，重建时不能递归认领旧意图。
    if (!old) return;
    retired.add(old.target);
    ui.rangeInteraction = null;
    ui.deferredControlPatch = false;
    delete ui.local.commandValues[old.target.dataset.rangeKey];
    const focused = document.activeElement === old.target;
    const key = old.target.dataset.rangeKey;
    const device = ui.local.screen === 'detail' ? ui.getActiveDevice() : null;
    if (focused && !disposed && old.scope === ui.contextKey() && old.view === ui.viewKey()) {
      // 父级随后重建时仍可恢复焦点；待确认期间沿用原等待恢复机制。
      ui.pendingFocusIntent = { ...ui.captureRenderState(), busyAction: null,
        waitForCommand: Boolean(device && ui.isCommandPending(deviceKey(device))),
        deviceId: device ? deviceKey(device) : null };
    }
    old.target.remove();
    if (restore && !ui.destroyed && device && ui.root.isConnected) {
      ui.patchDeviceControls(device);
      const next = [...ui.root.querySelectorAll('[data-field=capability-range]')]
        .find(input => input.dataset.rangeKey === key);
      if (next) syncRangeAppearance(next);
      if (focused && next && !next.disabled && old.scope === ui.contextKey()
        && old.view === ui.viewKey()) next.focus({ preventScroll: true });
    }
    ui.metrics?.increment('rangeIntentCancelledCount');
  }

  return {
    begin(event) {
      if (disposed) return;
      if ((event.pointerType === 'touch' || event.pointerType === 'pen') && event.isPrimary === false) {
        cancel('multi-pointer'); return;
      }
      if (!isCapabilityRange(event.target)) return;
      if (intent && !intent.released) cancel('replaced-intent');
      const current = rangeSnapshot(ui, event.target);
      intent = current && !retired.has(event.target)
        ? { ...current, target: event.target, pointerId: event.pointerId,
          startValue: event.target.value, released: false } : null;
    },
    finish(event) {
      if (!intent || intent.pointerId !== event.pointerId) return;
      if (event.type === 'pointercancel') cancel('pointercancel');
      else intent.released = true; // 保留快照，兼容 change 在 pointerup 前或后。
    },
    check(options) {
      if (intent && !same(intent, rangeSnapshot(ui, intent.target))) cancel('state-changed', options);
    },
    preview(target) {
      if (disposed || retired.has(target) || !rangeSnapshot(ui, target)) return false;
      if (intent && (intent.target !== target || !same(intent, rangeSnapshot(ui, target)))) {
        cancel('invalid-preview'); return false;
      }
      return true;
    },
    commit(target) {
      const current = rangeSnapshot(ui, target);
      if (disposed || retired.has(target) || !current) {
        if (intent?.target === target) cancel('invalid-submit');
        return null;
      }
      if (intent && (intent.target !== target || !same(intent, current))) {
        cancel('context-changed'); return null;
      }
      const value = target.valueAsNumber;
      if (!Number.isFinite(value) || !target.validity.valid) return null;
      const unchanged = intent?.startValue === target.value;
      intent = null;
      ui.rangeInteraction = null;
      if (unchanged) return null;
      return value;
    },
    cancel,
    dispose() { disposed = true; cancel('destroy', { restore: false }); }
  };
}

function handleRangeInput(ui, event) {
  const target = event.target;
  if (!isCapabilityRange(target)) return false;
  if (!ui.rangeGuard.preview(target)) return true;
  ui.local.commandValues[target.dataset.rangeKey] = target.valueAsNumber;
  syncRangeAppearance(target);
  return true;
}

function handleRangeChange(ui, event) {
  const target = event.target;
  if (!isCapabilityRange(target)) return false;
  const value = ui.rangeGuard.commit(target);
  if (value !== null) {
    ui.local.commandValues[target.dataset.rangeKey] = value;
    syncRangeAppearance(target);
    ui.sendCapabilityCommand(target, value, 'command:' + target.dataset.capabilityId);
  }
  return true;
}
```

具体接入顺序如下，不能只在测例中加包装而漏掉 App 的入口：

| 挂载点 | 必须加入的调用 |
| --- | --- |
| constructor 的 rangeInteraction 初始化后 | `this.rangeGuard = createRangeGuard(this)`，在首次 render 与监听器工作前初始化 |
| onPointerDown 的原多指判断之前 | `this.rangeGuard.begin(event)`；原 rangeInteraction 与 pull-refresh 分支保留 |
| onPointerUp 的开头 | `this.rangeGuard.finish(event)`；原正常释放逻辑保留 |
| onInput 的目标/root 校验之后 | `if (handleRangeInput(this, event)) return;`；替代旧 capability-range 分支，其他输入保留 |
| onChange 的目标/root 校验之后 | `if (handleRangeChange(this, event)) return;`；禁止回落到旧 capability-range 无校验提交 |
| renderFull 和 updateModel 赋新 model 后、syncContext 前 | `this.rangeGuard?.check({ restore: false })`；整页与局部更新都要覆盖，旧上下文先废弃，随后正常重建视图 |
| applyNavigation 改路由之前 | `this.rangeGuard?.cancel('navigation', { restore: false })` |
| patchDeviceControls 找到 controls 后、延迟更新判断之前 | `this.rangeGuard?.check({ restore: false })`，范围/能力/只读失效时不得继续延迟 |
| reconcile 完成后 | `this.rangeGuard?.check()`；对 root 中实际连接的 capability-range 调用 syncRangeAppearance，处理焦点保留值 |
| destroy 的开头 | `this.rangeGuard?.dispose()`；随后按原机制移除监听器与计时器 |

取消不产生 sendCommand，不通过动画或计时器重发。普通设备上报更新若能力、范围、上下文与控制许可未变，拖动继续；PENDING/SENT、缓存只读、BLE 断开、能力/范围或设备变化须立即使旧意图失效。取消后重建的节点不能继承旧意图，恢复焦点只发生在同一上下文与视图且新节点可用时。

## 6. AI 输入区与快捷提问接入

### 6.1 共享问题定义

第一阶段提供通用解释，不承诺读取实时告警、天气或最近失败命令，也不硬编码某台现场设备。新增 `client/src/js/ai/ai-quick-prompts.js`：

```javascript
export const AI_QUICK_PROMPTS = Object.freeze([
  Object.freeze({ id: 'receipt-help', label: '回执说明',
    prompt: '解释指令待确认、超时与执行失败的区别。' }),
  Object.freeze({ id: 'bluetooth-help', label: '蓝牙排查',
    prompt: '说明蓝牙连接断开后重新连接的排查步骤。' }),
  Object.freeze({ id: 'condensation-help', label: '结露常识',
    prompt: '解释结露风险的一般形成原因与巡检注意事项。' })
]);

export function resolveAiQuickPrompt(state, id) {
  if (!state?.enabled || state.busy || state.loading || state.pending) return null;
  const item = AI_QUICK_PROMPTS.find(value => value.id === id);
  const limit = Number(state.limits?.maxQuestionChars);
  if (!item || !Number.isInteger(limit) || limit < 1 || item.prompt.length > limit) return null;
  return item;
}
```

冷却期间可以填写草稿，实际发送继续受 `aiCanSend()` 约束。快捷问题只使用共享定义中的稳定 ID，不接受从 DOM 传入任意提示词作为预设。

### 6.2 视图挂载：`ai-view.js`

以下示例使用文件已有的 node、button、field，并导入共享定义：

```javascript
import { AI_QUICK_PROMPTS, resolveAiQuickPrompt } from './ai-quick-prompts.js';

function buildCrystalComposer(state) {
  const composer = node('div', 'ai-composer ai-composer--crystal');
  composer.classList.toggle('ai-composer--busy', Boolean(state.busy));
  const chips = node('div', 'ai-quick-chips');
  chips.dataset.region = 'ai-quick-prompts';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', '快捷提问，仅填写草稿');
  for (const item of AI_QUICK_PROMPTS) {
    const chip = button(item.label, 'ai-quick-prompt', {
      id: item.id, disabled: !resolveAiQuickPrompt(state, item.id)
    });
    chip.classList.add('ai-chip');
    chips.append(chip);
  }
  composer.append(chips, field('问题', 'ai-question', state.draft, state.limits.maxQuestionChars),
    button(state.busy ? '等待回答…' : '发送', 'ai-send', {
      primary: true, disabled: !aiCanSend(state)
    }));
  return composer;
}
```

在 `buildAiView()` 聊天页原创建 composer 的位置调用 `buildCrystalComposer(state)`；保留禁用功能、历史与性格页面的原分支。busy 时保留快捷栏并禁用按钮，避免布局跳动。现有消息滚动位置、请求恢复和错误提示继续保留。

### 6.3 控制器桥接：`main.js`

导入 `resolveAiQuickPrompt`，增加同步 handler：

```javascript
function prefillAiQuickPrompt({ id }) {
  const item = resolveAiQuickPrompt(ai.getState(), id);
  if (!item) return null;
  ai.setDraft(item.prompt);
  return item.prompt;
}
```

在 `createClientUi()` 的 handlers 中加入 `aiQuickPrompt: prefillAiQuickPrompt`。此 handler 同步重读真实控制器状态，更新 draft 并返回被接受的文本；不发送请求。不要改为返回 Promise。

### 6.4 根节点事件委托：`ui.js`

新增以下纯点击处理函数，不在每个快捷按钮上注册闭包：

```javascript
function handleAiQuickPromptClick(ui, action, target) {
  if (action !== 'ai-quick-prompt') return false;
  const input = ui.root.querySelector('[data-field=ai-question]');
  if (!(input instanceof HTMLTextAreaElement) || input.disabled) return true;
  const text = ui.handlers.aiQuickPrompt?.({ id: target.dataset.aiId });
  if (typeof text !== 'string') return true;
  const current = ui.root.querySelector('[data-field=ai-question]');
  if (current instanceof HTMLTextAreaElement) {
    current.value = text;
    current.focus({ preventScroll: true });
  }
  return true;
}
```

在 `onClick()` 现有 target/disabled 校验及 `event.preventDefault()` 之后、通用 `action.startsWith('ai-')` 分支之前，加入 `if (handleAiQuickPromptClick(this, action, target)) return;`。

控制器已更新 draft，因此不再人为派发第二次 input 事件。对实际 DOM 输入框同步 value，保证即使协调器保留当前聚焦节点，输入显示、字符计数和状态仍一致。后续普通输入继续走原 aiInput handler；异步问题发送与恢复仍走原 aiAction。

### 6.5 输入区 CSS

使用普通边框与多背景渐变，不依赖 mask-composite、3D、工具类或无限循环。

```css
.ai-quick-chips {
  display: flex;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
  padding: 4px 0 8px;
  scrollbar-width: thin;
}
.ai-chip {
  flex: 0 0 auto;
  min-height: 48px;
  padding: 8px 14px;
  font-size: 14px;
  white-space: nowrap;
}
.ai-composer--crystal .ai-field {
  padding: 12px;
  border: 2px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}
.ai-composer--crystal .ai-field:focus-within {
  border-color: transparent;
  background: linear-gradient(var(--surface), var(--surface)) padding-box,
    linear-gradient(120deg, #1f6f78, #2563a8, #8657b7) border-box;
}
.ai-composer--busy .ai-field { border-color: var(--blue); }
@media (prefers-contrast: more), (forced-colors: active) {
  .ai-composer--crystal .ai-field,
  .ai-composer--crystal .ai-field:focus-within {
    border-color: CanvasText;
    background: Canvas;
  }
}
```

保留 textarea 焦点轮廓。忙碌状态仍有明确文字，渐变与颜色仅为辅助。高对比/强制颜色模式中恢复实线边框，不单靠渐变标识焦点。

## 7. 动效、性能与交互约束

沿用 `motion-policy.js`、`ui.applyMotionPolicy()` 和根节点 `data-motion`。项目已有减少动效、后台及显式 degraded 的全局覆盖；本方案的装饰保持在 App 根节点下，以便复用该机制。

第一阶段不新增常驻发光循环。保留现有短时反馈，不重置开关或导航用于编码最终状态的 transform。材质开关与动画开关独立：低性能配置可以同时启用 `setMotionDegraded(true)` 和 `data-material=solid`，但必须明确各自的设置入口与恢复行为。

性能验收采用改造前后相同设备、相同数据和相同操作的对比：长设备列表滚动、连续拖动、AI 输入、页面切换、后台恢复。记录帧时间、长任务与内存；出现持续卡顿时降低或关闭导航滤镜，不将 CSS/GPU 当作天然低功耗保证。

## 8. 实施顺序与验收门禁

### 8.1 实施顺序

1. 固定源码版本及测试基线，记录未提交改动、依赖版本与已知失败。
2. 增加默认可读的视觉变量、导航材质及 solid 降级入口，再调整顶栏布局和现有节点挂载。
3. 为设备列表增加卡片样式，保留详情入口与全部状态说明。
4. 先合并范围契约与归一化标记，再接入原生数值构建、rangeGuard、整页/局部更新入口和强制颜色样式；重新验证取消、待确认、焦点与实时刷新。
5. 增加 AI 共享预设、视图、同步控制器 handler 与根节点事件委托。
6. 执行浏览器回归与 Android/PDA 验收，依据实测调整材质参数，再更新发布证据。

### 8.2 验收矩阵

| 验收项 | 必须满足 |
| --- | --- |
| 入口与布局 | 站点、连接、登录/退出、天气及四个主导航可达；320/390/414/768/820/1024px 无横向溢出 |
| 原生窗口 | 横屏、分屏/折叠变化、键盘开关与四方向安全区正确；无重复 padding |
| 可访问性 | 键盘与 TalkBack 可操作；200% 字体仍可用；触控尺寸与对比度实测达到目标 |
| 滑块数值 | 负数/小数步长/不整除上限统一原生数值；倒置、相等、非有限范围及非正步长保留错误标记、显示原因、禁用且不提交 |
| 命令状态 | input 不发命令；有效提交保持既有幂等行为；PENDING/SENT 禁用；成功、失败与结果未知分别呈现 |
| 取消与局部更新 | 多指、pointercancel、迟到 change、只读/范围/站点/设备变化和销毁不误发；普通刷新保留拖动；取消后键盘可用，ACK 后正确恢复焦点 |
| AI 草稿 | 重复 patch、busy 结束、冷却、禁用和站点切换后正确；快捷点击只填草稿；一次发送不重复提交 |
| 材质与动效 | 无滤镜支持、solid、高对比、减少动效和后台均可验证；强制颜色中轨道、滑块、焦点、禁用状态和文字均可见 |
| 性能 | 同设备对比滚动、输入、控制与内存；不达目标的设备提供可用的 solid 降级 |

基础命令：

```powershell
npm --prefix client test
npm --prefix client run build
npm --prefix client run test:e2e -- e2e/mobile-client.spec.js e2e/ai-workspace.spec.js e2e/motion-render-integrity.spec.js e2e/motion-interruptions.spec.js e2e/refresh-stability.spec.js e2e/bottom-navigation-motion.spec.js
```

命令是未来实施后的验收步骤，不代表本次已运行或通过。测试数量随代码变化，以实际退出码、通过/失败/跳过及对应提交为准。明确记录预期跳过原因；基线和改造后在同一环境比较，目标范围应全部通过。

现有审核中的构建与测试结果仅是历史工作树快照；启动模块在审核期间更新，尚不能据此声明当前基线全绿。实施前重新确定基线，既有问题单独记录，不能用其掩盖本方案新增回归。真机验证另存设备型号、系统/WebView 版本、模式、操作和结果，不以桌面模拟器代替硬件证据。

## 9. v1.0 审核问题的文档修订对应关系

| 审核问题 | 本版调整 | 关闭条件 |
| --- | --- | --- |
| 自定义滑块绕开能力与状态 | 改为原生 range 外观增强，保留业务字段与命令链路 | 代码实施及命令状态验收 |
| 指针取消与监听器泄漏 | 根节点委托、独立意图快照、取消时废弃旧节点、覆盖整页及局部更新、沿用待确认焦点恢复 | App 多指/取消/上下文/销毁回归 |
| AI 闭包引用失效输入节点 | 稳定 ID、共享模块、同步 controller handler 与根节点事件委托 | 草稿、焦点与重复 patch 验收 |
| 类名替换、工具类与缺失挂载 | 列出真实构建器、保留字段及完整文件范围，使用本地组件 CSS | DOM 契约与入口回归 |
| 扫码、延迟与 AI 能力承诺 | 从第一阶段页面中移除未接入能力，列为独立功能工作 | 后续功能各自完成接口与验收 |
| 小字、小屏与安全区不足 | 增加触控/字体/对比度目标、具体断点与补偿责任 | 浏览器及 Android/PDA 实测 |
| 滤镜降级与性能未实现 | 默认实色、@supports 增强、独立 solid 模式与性能对比 | 降级入口及性能证据 |
| 固定 197 项及零开销保证 | 改为提交级实际测试与性能结果，区分文档/实施/验收 | 固定基线、完整回归与真机证据 |

本版解决的是设计文档中的方案缺口。完成代码、回归与原生验收后，才能把对应项标记为实施完成。

## 10. v1.2 完善项与本次复测结果

2026-10-02 完成方案修订及针对性测试。详细过程、命令和证据见[复测报告](E:/CC_testP/iot-manager/docs/CLIENT-APPLE-GLASS-V1.2-RETEST-2026-10-02.md)。本次使用本地 Vite 和 Chromium 151.0.7922.34，把本文示例临时接入生产 UI、能力归一化、AI 视图和控制器；命令使用内存回调，源码文件未合并这些示例。

| v1.1 复审项 | v1.2 修订 | 本次结果 |
| --- | --- | --- |
| P1 多指取消仍提交 | 独立意图快照；取消时移除旧 input 并重建；当前模型与上下文再校验；保留键盘及 ACK 后焦点恢复 | 多指、原生取消、迟到 change、上下文/只读/范围变化均未提交；正常拖动一次提交、普通刷新保留活动节点 |
| P2 无效范围不禁用、数值不同 | 原始范围错误标记随能力归一化保留；非法定义或未知数值禁用；input/output/读屏/参数统一实际原生数值 | 6 类非法定义不提交；负数小数步长、不整除上限及微小步长一致 |
| P2 强制颜色轨道消失 | 系统颜色、实线轨道边界、焦点轮廓及禁用样式 | 规则检查与截图复核通过，轨道、滑块及焦点可见 |

| 测试范围 | 实际结果 |
| --- | --- |
| 方案示例与隔离原型 | 27 项通过，0 失败；其中包含 7 段 JS / 3 段 CSS 解析和页面运行错误检查 |
| 现有能力、命令状态、任务、动效及 AI 控制器单元回归 | 33 项通过，0 失败，0 跳过，退出码 0 |
| 完整 App 全量回归、顶栏/卡片全断点、TalkBack、PDA/WebView 实测与性能 | 尚未完成；待 App 实施后按第 8 节验收 |

本轮结论：三项复审问题在方案与隔离原型层面通过验证，可进入 App 实施。生产源码中的原行为仍存在，不能把此次结果记为 App 修复完成或发布验收通过。
