# 移动端（Client）轻量微质感与操作体验提升开发方案

> **文档状态**：待审核（Pending Approval）  
> **编制日期**：2026-10-01  
> **责任范围**：`client/src/css/style.css`、`client/src/css/ai.css`、`client/src/js/ai/ai-view.js`  
> **基线状态**：基于当前提交已通过的 197 项 Client 自动化测试（`0 fail / 0 skip`）  
> **设计依据**：结合工业工况人体工学、WCAG 2.1 AA 阳光可读性规范及项目既有 `motion-policy.js`

---

## 1. 方案目标与核心原则

在**不重构现有业务逻辑、不改动底层状态机、不引入任何第三方依赖包**的前提下，针对移动巡检人员在现场戴手套、强光反光、单手操作等真实工况，对界面中的按钮、卡片、状态指示与 AI 交互进行精准的“现代微质感提升”：

1. **契约 100% 稳定**：核心类名（`.button`、`.button--primary`、`.button--danger`、`.icon-button`）保持不变，保证现有 DOM 生成与单元测试完全兼容；
2. **防亚像素文字模糊**：弃用容易在低分屏工业 PDA 上引发文字发虚的 `transform: scale(0.98)`，改用物理下沉 `translateY(1.5px)` 与阴影收敛；
3. **动效安全与功耗防御**：呼吸动画严格受控于 `prefers-reduced-motion: no-preference`，在减弱动效及 App 后台时静止，杜绝无效重绘耗电；
4. **AI 胶囊安全流转**：快捷提问胶囊仅通过标准 `input` 事件向输入框赋值，严格接受字符上限（2000字）与 `aiCanSend` 发送拦截器管控。

---

## 2. 开发技术栈与组织分工

### 2.1 技术栈选型
* **核心框架**：原生 ES Modules（Vanilla JavaScript），沿用现有零运行时依赖架构；
* **样式技术**：现代 CSS 原生变量（Custom Properties）+ GPU 硬件加速图层（`transform`、`box-shadow`）；
* **构建与测试**：Vite 5 构建工具链、Node.js 内置 test runner（197 项单元测试）。

### 2.2 模块职责与变更边界

| 模块文件 | 变更性质 | 核心职责 |
| :--- | :---: | :--- |
| [`client/src/css/style.css`](file:///E:/CC_testP/iot-manager/client/src/css/style.css) | 增强 | 扩展微质感变量（`--shadow-btn` 等）；升级主按钮、次级按钮、高危按钮微深度与按压反馈；为状态指示增加受控低频呼吸灯。 |
| [`client/src/css/ai.css`](file:///E:/CC_testP/iot-manager/client/src/css/ai.css) | 增强 | 新增 `.ai-quick-chips` 横滑工具栏与 `.ai-chip` 胶囊；优化输入框聚焦微光环与消息卡片浅层阴影。 |
| [`client/src/js/ai/ai-view.js`](file:///E:/CC_testP/iot-manager/client/src/js/ai/ai-view.js) | 增补 | 在 `buildAiView` 输入区构建快捷提问胶囊栏；挂载标准 `input` 分发事件，联动已有字符计数与状态同步。 |

---

## 3. 主要开发代码草案（供审核）

### 3.1 `client/src/css/style.css`（全局按钮与微质感增强）

```css
/* ── 1. 扩展设计微质感变量（挂载在 :root） ── */
:root {
  /* 基础微质感阴影 */
  --shadow-sm: 0 1px 2px rgba(15, 33, 39, 0.06);
  --shadow-btn-primary: 0 2px 4px rgba(20, 85, 93, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  --shadow-btn-primary-hover: 0 4px 8px rgba(20, 85, 93, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.32);
  --shadow-btn-active: inset 0 2px 4px rgba(0, 0, 0, 0.14);
  --shadow-card-elevated: 0 2px 6px rgba(21, 33, 39, 0.05), 0 1px 2px rgba(21, 33, 39, 0.08);
}

/* ── 2. 按钮核心手感升级（保持现有类名 100% 契约不变） ── */
.button {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 650;
  line-height: 1;
  text-decoration: none;
  box-shadow: var(--shadow-sm);
  transition: background-color var(--motion-feedback) var(--ease-enter),
              border-color var(--motion-feedback) var(--ease-enter),
              color var(--motion-feedback) var(--ease-enter),
              transform var(--motion-feedback) var(--ease-enter),
              box-shadow var(--motion-feedback) var(--ease-enter);
}

/* 统一扎实的 1.5px 纯位移 + 阴影收敛（杜绝 scale 导致的文字模糊） */
.button:active:not(:disabled):not([aria-disabled="true"]),
.icon-button:active:not(:disabled) {
  transform: translateY(1.5px);
  box-shadow: var(--shadow-btn-active);
}

/* 主操作按钮：细腻微渐变 + 顶部微高光 + 底部承托投影 */
.button--primary {
  color: #ffffff;
  background: linear-gradient(180deg, #247c87 0%, #1a636c 100%);
  border-color: #14555d;
  box-shadow: var(--shadow-btn-primary);
}

.button--primary:hover:not(:disabled):not([aria-disabled="true"]) {
  background: linear-gradient(180deg, #2a8e9b 0%, #1e717b 100%);
  border-color: #14555d;
  box-shadow: var(--shadow-btn-primary-hover);
}

/* 高危按钮：警示红微质感 */
.button--danger {
  color: var(--red);
  background: #ffffff;
  border-color: #f1b3b8;
  box-shadow: 0 1px 2px rgba(181, 58, 66, 0.08);
}
.button--danger:hover:not(:disabled) {
  background: var(--red-soft);
  border-color: var(--red);
}

/* ── 3. 状态呼吸光晕（受控于 Motion Policy，后台及减弱动效自动静止） ── */
@media (prefers-reduced-motion: no-preference) {
  .status-dot--online,
  .live-badge .ring {
    animation: gentle-pulse 3.2s ease-in-out infinite;
  }
}

@keyframes gentle-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(39, 118, 91, 0.4);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(39, 118, 91, 0);
  }
}
```

---

### 3.2 `client/src/css/ai.css`（快捷提问胶囊与输入区增强）

```css
/* AI 输入区快捷提问胶囊横向滑动栏 */
.ai-quick-chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 0 8px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.ai-quick-chips::-webkit-scrollbar {
  display: none;
}

.ai-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 550;
  color: var(--teal-strong, #14555d);
  background: var(--teal-soft, #d9eef0);
  border: 1px solid rgba(31, 111, 120, 0.18);
  cursor: pointer;
  transition: all 0.12s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.ai-chip:hover:not(:disabled) {
  background: #c7e6ea;
  border-color: var(--teal, #1f6f78);
  transform: translateY(-0.5px);
}
.ai-chip:active:not(:disabled) {
  transform: translateY(1px);
}

/* 提升输入框聚焦手感 */
.ai-input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #cad9cf;
  border-radius: 12px;
  background: #fff;
  color: #20382b;
  padding: 12px;
  font: inherit;
  resize: vertical;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.ai-input:focus {
  outline: none;
  border-color: var(--teal, #1f6f78);
  box-shadow: 0 0 0 3px rgba(31, 111, 120, 0.16);
}

/* 消息卡片浅层立体感 */
.ai-message {
  box-shadow: 0 1px 3px rgba(21, 33, 39, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.04);
}
.ai-message--assistant {
  background: #ffffff;
  border: 1px solid #e2ebed;
}
```

---

### 3.3 `client/src/js/ai/ai-view.js`（快捷胶囊构建与事件安全分发）

在 `buildAiView` 函数的输入组件（`composer`）构建逻辑中，新增胶囊构建函数：

```javascript
// 现场运维快捷预设词
const QUICK_PROMPTS = [
  '排查当前设备异常',
  '汇总今日活动与告警',
  '查看当前环境风险',
  '解释最近一次失败命令'
];

/**
 * 构建快捷提问胶囊栏
 * 点击仅触发文本填入与原生 input 事件，严格受制于 aiCanSend 与字符预算
 */
function buildQuickChips(parent, inputElement, state) {
  if (!state.enabled || state.busy) return;

  const bar = node('div', 'ai-quick-chips');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '快捷提问');

  for (const text of QUICK_PROMPTS) {
    const chip = node('button', 'ai-chip', text);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      inputElement.value = text;
      // 触发原生 input 事件，确保状态机内 state.draft 和字符计数同步更新
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.focus();
    });
    bar.append(chip);
  }
  parent.append(bar);
}
```

并在 `buildAiView` 的 `composer` 组装代码处接入：
```javascript
  const composer = node('div', 'ai-composer');
  const questionField = field('问题', 'ai-question', state.draft, state.limits.maxQuestionChars);
  const questionInput = questionField.querySelector('#ai-question');
  
  // 注入快捷提问胶囊
  buildQuickChips(composer, questionInput, state);
  
  composer.append(questionField,
    button(state.busy ? '等待回答…' : '发送', 'ai-send', { primary: true, disabled: !aiCanSend(state) }));
  root.append(composer);
```

---

## 4. 实施验证与验收准则（Gate Criteria）

代码实施后，必须满足以下三道验收门禁方可归档：

1. **自动化测试门禁**：
   * 运行 `npm --prefix client test`；
   * 必须 **197 项用例 100% 通过（`0 fail / 0 skip`）**。
2. **样式无回归门禁**：
   * 在移动端各典型分辨率（320px、375px、414px）下，快捷胶囊支持横向单指微滑动，整个视口无水平滚动条穿透；
   * 按钮在点击下沉时，文字抗锯齿清晰无毛边。
3. **性能与功耗门禁**：
   * 检查在系统开启“减弱动态效果”时，状态圆点呼吸灯能够立即停止动画，维持静态显示。
