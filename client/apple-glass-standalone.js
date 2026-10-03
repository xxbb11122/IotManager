/**
 * ============================================================================
 * Apple & Muse 极致晶体毛玻璃与高对比工业标准全套组件库 (合规单文件完整版)
 * File: client/apple-glass-standalone.js
 *
 * 严格遵循规范文档：
 * docs/APP-DEVELOPMENT-FRAMEWORK-AND-DATA-SUMMARY-2026-10-02.md
 * docs/CLIENT-APPLE-GLASS-STANDALONE-DEEP-REVIEW-2026-10-02.md (F01~F16 整改)
 *
 * 视觉与交互升级特性：
 * 1. 【极致 Apple 晶体质感】：基于 GitHub 最新 Liquid Glass / visionOS 规范，高透多层高斯模糊 (blur 28px saturate 190% contrast 102%)、双层精密镜面边缘包边高光 (inset 0 1.2px 1.5px)、立体弥散环境晕光；
 * 2. 【一条只看一个设备 (单设备单行 Apple 横向卡片)】：严格遵循 Apple Home / iOS Settings 优雅单行规范，左侧晶体图标徽章与客观事实列，右侧状态胶囊与触控开关，杜绝拉伸空旷；
 * 3. 【AI 对话框沉底固定】：对话流在上方自然滚动，Apple Intelligence 极光输入框吸底固定 (position: sticky/fixed)，不随消息上滚；
 * 4. 【F01~F16 合规契约】：100% 杜绝 innerHTML 插值、原生 Range 取消守卫、区分 Reported 事实与 Desired 目标、IME Composing Enter 防误发、Solid 实色模式降级。
 *
 * 隔离说明：
 * 本文件保持完全独立，不修改现有生产代码 (client/src/ 与 backend/ 零侵入)。
 * ============================================================================
 */

/* ============================================================================
 * 一、 完整独立 CSS 样式表（Apple 晶体质感 + 单行单设备看板 + 沉底固定输入框）
 * ============================================================================ */
export const APPLE_GLASS_CSS = `
/* ── 1. 核心工业级视觉变量与晶体光效 ── */
:root {
  --canvas-bg: #f2f5f8;
  --surface-card: rgba(255, 255, 255, 0.88);
  --surface-subtle: rgba(248, 250, 252, 0.75);
  --text-main: #0f172a;
  --text-muted: #475569;
  --text-tertiary: #64748b;
  --border-card: rgba(255, 255, 255, 0.85);
  --border-specular: 1px solid rgba(255, 255, 255, 0.95);

  /* Apple / Muse 晶体多层轻毛玻璃 (含镜面边缘高光) */
  --nav-glass-bg: linear-gradient(135deg, rgba(255, 255, 255, 0.86) 0%, rgba(255, 255, 255, 0.70) 100%);
  --nav-glass-blur: blur(28px) saturate(190%) contrast(102%);
  --nav-glass-border: 1px solid rgba(255, 255, 255, 0.82);

  /* 兼容与映射别名 */
  --glass-surface: var(--surface-card);
  --glass-blur: var(--nav-glass-blur);
  --glass-border-specular: var(--border-specular);

  /* 苹果语义高饱和点睛色 (对比度 >= 4.5:1) */
  --apple-blue: #0066cc;
  --apple-green: #1a8238;
  --apple-amber: #b45309;
  --apple-red: #d32f2f;

  /* 触控靶心与弹簧过渡 */
  --touch-target: 48px;
  --apple-spring: cubic-bezier(0.32, 0.72, 0, 1);
  --radius-card: 20px;
  --radius-pill: 9999px;

  /* 安全区 */
  --safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
  --safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
  --safe-left: var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
  --safe-right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px));
}

/* ── 2. 实色模式 (Solid Mode) 降级支持 (F11) ── */
.glass-theme-solid {
  --nav-glass-bg: #ffffff !important;
  --nav-glass-blur: none !important;
  --nav-glass-border: 1px solid #cbd5e1 !important;
  --surface-card: #ffffff !important;
}

/* ── 3. 减少动效模式 (Reduced Motion) ── */
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* ── 4. 全机型自适应轻毛玻璃顶栏 (Universal Header) ── */
.universal-app-header {
  padding-top: calc(8px + var(--safe-top));
  padding-bottom: 8px;
  padding-left: calc(14px + var(--safe-left));
  padding-right: calc(14px + var(--safe-right));
  background: var(--nav-glass-bg);
  backdrop-filter: var(--nav-glass-blur);
  -webkit-backdrop-filter: var(--nav-glass-blur);
  border-bottom: var(--nav-glass-border);
  box-shadow: 0 4px 24px rgba(15, 23, 42, 0.04),
              inset 0 1px 1.5px rgba(255, 255, 255, 0.95),
              inset 0 -1px 0 rgba(0, 0, 0, 0.03);
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.universal-header-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
}

.site-picker-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.8);
  padding: 4px 10px;
  border-radius: 12px;
  text-align: left;
  min-height: var(--touch-target);
  min-width: var(--touch-target);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 0.9);
  transition: all 0.2s var(--apple-spring);
}
.site-picker-trigger:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateY(-1px);
}

.link-status-capsule {
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--apple-green);
  background: rgba(240, 253, 244, 0.85);
  border: 1px solid rgba(187, 247, 208, 0.9);
  box-shadow: 0 2px 6px rgba(26, 130, 56, 0.08);
}

.header-scan-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text-main);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04), inset 0 1px 1px rgba(255, 255, 255, 1);
  transition: all 0.2s var(--apple-spring);
}
.header-scan-btn:hover {
  transform: scale(1.05);
  background: #ffffff;
}

.header-context-ribbon {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.025);
  font-size: 11px;
  font-weight: 550;
  color: var(--text-muted);
}

/* ── 5. 一条一个设备：Apple 质感单行横向卡片 (Horizontal Single-Device Card) ── */
.device-tile-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.90) 0%, rgba(255, 255, 255, 0.72) 100%);
  backdrop-filter: blur(28px) saturate(190%) contrast(102%);
  -webkit-backdrop-filter: blur(28px) saturate(190%) contrast(102%);
  border: 1px solid rgba(255, 255, 255, 0.88);
  border-radius: 18px;
  box-shadow: 0 4px 18px -2px rgba(15, 23, 42, 0.06),
              inset 0 1.2px 1.5px 0 rgba(255, 255, 255, 1),
              inset 0 -1px 1px 0 rgba(0, 0, 0, 0.02);
  padding: 12px 16px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  position: relative;
  transition: transform 0.2s var(--apple-spring), box-shadow 0.2s var(--apple-spring), background 0.2s ease;
  min-height: 72px;
  cursor: pointer;
}
.device-tile-card:hover {
  transform: translateY(-1.5px);
  box-shadow: 0 8px 24px -4px rgba(15, 23, 42, 0.10),
              inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 1);
  border-color: rgba(255, 255, 255, 0.98);
}
.device-tile-card:active {
  transform: scale(0.985);
}

.device-card-left-group {
  display: flex;
  align-items: center;
  gap: 13px;
  flex: 1;
  min-width: 0;
}

.device-touch-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.device-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04), inset 0 1px 1px rgba(255, 255, 255, 1);
}

.device-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.device-card-title {
  font-size: 14.5px;
  font-weight: 650;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.01em;
}

.device-card-subtitle {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.device-card-right-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: 12px;
}

.device-card-chevron {
  font-size: 18px;
  color: #94a3b8;
  font-weight: 600;
  line-height: 1;
  transition: transform 0.2s ease, color 0.2s ease;
}
.device-tile-card:hover .device-card-chevron {
  transform: translateX(2px);
  color: var(--apple-blue);
}

.device-interactive-switch {
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: #cbd5e1;
  border: 0;
  cursor: pointer;
  position: relative;
  transition: background-color 0.25s var(--apple-spring), box-shadow 0.25s ease;
  padding: 2px;
  min-width: var(--touch-target);
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
}
.device-interactive-switch.active {
  background: var(--apple-green);
  box-shadow: 0 2px 10px rgba(26, 130, 56, 0.35);
}

.device-interactive-switch-thumb {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.22);
  transition: transform 0.25s var(--apple-spring);
  display: block;
}
.device-interactive-switch.active .device-interactive-switch-thumb {
  transform: translateX(18px);
}

/* 状态药丸胶囊 */
.status-pill {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
}
.status-pill.online {
  background: rgba(220, 252, 231, 0.9);
  color: var(--apple-green);
}
.status-pill.offline {
  background: rgba(241, 245, 249, 0.9);
  color: var(--text-tertiary);
}
.status-pill.pending {
  background: rgba(254, 243, 199, 0.95);
  color: var(--apple-amber);
}

/* 过滤药丸选择条 (Apple 轻毛玻璃触控胶囊) */
.filter-pill {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-muted);
  min-height: 32px;
  white-space: nowrap;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 1);
  transition: all 0.2s var(--apple-spring);
}
.filter-pill:hover {
  background: #ffffff;
  color: var(--text-main);
}
.filter-pill.active {
  background: var(--apple-blue);
  border-color: var(--apple-blue);
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(0, 102, 204, 0.35);
}

/* ── 6. 响应式布局：一条只看一个设备 (Single-Device Per Row) ── */
.device-grid-frame {
  container-type: inline-size;
  width: 100%;
}

.device-grid-container {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

@container (min-width: 612px) {
  .device-grid-container {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
@media (min-width: 612px) {
  .device-grid-container {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}

/* ── 7. 原生流体滑块群组 (Native Range Fluid Slider) ── */
.range-slider-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(248, 250, 252, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.9);
  padding: 14px;
  border-radius: 16px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.02), 0 2px 8px rgba(0, 0, 0, 0.03);
}

.range-slider-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
}

.range-slider-readout {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  font-weight: 700;
  color: var(--apple-blue);
}

.native-range-input {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 48px;
  background: transparent;
  cursor: pointer;
  margin: 0;
  touch-action: none;
}
.native-range-input:focus {
  outline: none;
}
.native-range-input::-webkit-slider-runnable-track {
  height: 12px;
  background: rgba(226, 232, 240, 0.9);
  border-radius: 6px;
}
.native-range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(0, 0, 0, 0.08);
  margin-top: -8px;
}
.native-range-input:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--apple-blue);
  outline-offset: 2px;
}

.range-ack-ribbon {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  border-top: 1px dashed rgba(203, 213, 225, 0.8);
  padding-top: 6px;
  margin-top: 2px;
}

/* ── 8. 悬浮轻毛玻璃底栏 (Floating Bottom Nav) ── */
.universal-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  padding-bottom: calc(8px + var(--safe-bottom));
  padding-top: 6px;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.universal-bottom-nav-inner {
  pointer-events: auto;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.88) 0%, rgba(255, 255, 255, 0.70) 100%);
  backdrop-filter: blur(32px) saturate(210%);
  -webkit-backdrop-filter: blur(32px) saturate(210%);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 48px -4px rgba(15, 23, 42, 0.16),
              inset 0 1.5px 1px 0 rgba(255, 255, 255, 1),
              inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04);
  border-radius: var(--radius-pill);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  max-width: 400px;
  width: calc(100% - 24px);
  justify-content: space-around;
}

.nav-tab-btn {
  background: transparent;
  border: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  min-width: var(--touch-target);
  min-height: var(--touch-target);
  padding: 4px 10px;
  border-radius: 12px;
  transition: all 0.2s ease;
}
.nav-tab-btn.active {
  color: var(--apple-blue);
  background: rgba(0, 102, 204, 0.08);
}

/* ── 9. Apple Intelligence 对话气泡与沉底固定输入区 ── */
.ai-bubble-user {
  align-self: flex-end;
  background: linear-gradient(135deg, #007aff 0%, #0066cc 100%);
  color: #ffffff;
  padding: 10px 14px;
  border-radius: 18px 18px 4px 18px;
  max-width: 82%;
  font-size: 13.5px;
  line-height: 1.45;
  box-shadow: 0 4px 14px rgba(0, 102, 204, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.3);
}

.ai-bubble-agent {
  align-self: flex-start;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.80) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--text-main);
  border: 1px solid rgba(255, 255, 255, 0.9);
  padding: 12px 14px;
  border-radius: 18px 18px 18px 4px;
  max-width: 88%;
  font-size: 13.5px;
  line-height: 1.5;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05), inset 0 1px 1px rgba(255, 255, 255, 1);
}

/* AI 输入区沉到底部并固定 (确保高出悬浮底栏，防重叠遮挡) */
.ai-composer-container {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 35;
  padding: 8px 14px calc(74px + var(--safe-bottom)) 14px;
  background: linear-gradient(180deg, rgba(242, 245, 248, 0) 0%, rgba(242, 245, 248, 0.88) 20%, rgba(242, 245, 248, 0.98) 100%);
  backdrop-filter: blur(28px) saturate(190%);
  -webkit-backdrop-filter: blur(28px) saturate(190%);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-composer-wrapper {
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 22px;
  padding: 6px 8px 6px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06), inset 0 1px 1.5px rgba(255, 255, 255, 1);
  transition: all 0.25s var(--apple-spring);
}
.ai-composer-wrapper:focus-within {
  border-color: rgba(0, 102, 204, 0.5);
  box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.25), 0 8px 24px rgba(0, 102, 204, 0.12);
  background: #ffffff;
}

.ai-chip-pill {
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: var(--radius-pill);
  padding: 5px 12px;
  font-size: 11.5px;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  min-height: 32px;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 0.9);
  transition: all 0.2s var(--apple-spring);
}
.ai-chip-pill:hover {
  border-color: var(--apple-blue);
  color: var(--apple-blue);
  background: #ffffff;
  transform: translateY(-1px);
}

/* 兼容类 */
.crystal-glass {
  background: var(--nav-glass-bg);
  backdrop-filter: var(--nav-glass-blur);
  -webkit-backdrop-filter: var(--nav-glass-blur);
  border: var(--nav-glass-border);
}
.glass-slider-well {
  background: var(--surface-subtle);
  border-radius: var(--radius-pill);
}
.liquid-fill {
  background: var(--apple-blue);
  border-radius: var(--radius-pill);
}
.crystal-siri {
  background: radial-gradient(circle, rgba(0, 102, 204, 0.15) 0%, rgba(255, 255, 255, 0) 70%);
}
`;


/* ============================================================================
 * 样式注入辅助函数（单例防重）
 * ============================================================================ */
export function injectAppleGlassStyles(doc = globalThis.document) {
  if (!doc) return null;
  const styleId = 'apple-glass-standalone-stylesheet';
  let el = doc.getElementById(styleId) || doc.getElementById('apple-glass-compliant-stylesheet');
  if (!el) {
    el = doc.createElement('style');
    el.id = styleId;
    el.textContent = APPLE_GLASS_CSS;
    if (doc.head && typeof doc.head.append === 'function') {
      doc.head.append(el);
    }
  }
  return el;
}

function getDoc(doc) {
  return doc || globalThis.document;
}

/**
 * 安全 DOM 元素构造工具（防 XSS 统一入口）
 */
function createEl(doc, tag, className = '', styles = {}, text = null) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (styles && typeof styles === 'object') {
    Object.assign(el.style, styles);
  }
  if (text !== null && text !== undefined) {
    el.textContent = String(text);
  }
  return el;
}


/* ============================================================================
 * 二、 组件 1：全机型自适应通用轻毛玻璃顶栏 (Universal Header)
 * ============================================================================ */
export function createUniversalHeader({
  siteName = 'Site A - 智能物联实验馆',
  siteSub = '',
  siteCode = 'SITE-ALPHA',
  linkStatus = 'BLE 12ms',
  weatherSummary = '室外 24.5°C · 湿度 52% (模拟参考)',
  onlineCount = 4,
  totalCount = 6,
  onSiteClick = null,
  onScanClick = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const header = createEl(doc, 'header', 'universal-app-header');

  const mainRow = createEl(doc, 'div', 'universal-header-main-row');

  // 站点切换按钮（严格使用 textContent，防 XSS 注入）
  const siteBtn = createEl(doc, 'button', 'site-picker-trigger');
  siteBtn.type = 'button';

  const siteIcon = createEl(doc, 'div', '', {
    width: '32px', height: '32px', borderRadius: '10px',
    background: '#e0f2fe', color: '#0066cc', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px'
  }, '🏛️');

  const siteTextWrap = createEl(doc, 'div');
  const siteTitle = createEl(doc, 'div', '', {
    fontSize: '13.5px', fontWeight: '700', color: 'var(--text-main)', letterSpacing: '-0.01em'
  }, siteName);

  const subText = siteSub || `${siteCode} · ${onlineCount}/${totalCount} 在线`;
  const siteSubEl = createEl(doc, 'div', '', {
    fontSize: '10px', color: 'var(--text-muted)'
  }, subText);

  siteTextWrap.append(siteTitle, siteSubEl);
  siteBtn.append(siteIcon, siteTextWrap);
  if (typeof onSiteClick === 'function') siteBtn.addEventListener('click', onSiteClick);

  // 右侧通信与扫码控制
  const controls = createEl(doc, 'div', '', { display: 'flex', alignItems: 'center', gap: '8px' });
  const capsule = createEl(doc, 'div', 'link-status-capsule');
  const dot = createEl(doc, 'span', '', {
    width: '7px', height: '7px', borderRadius: '50%', background: 'var(--apple-green)'
  });
  const capsuleText = createEl(doc, 'span', '', {}, linkStatus);
  capsule.append(dot, capsuleText);

  const scanBtn = createEl(doc, 'button', 'header-scan-btn', {}, '📷');
  scanBtn.title = '扫描添加设备';
  if (typeof onScanClick === 'function') scanBtn.addEventListener('click', onScanClick);

  controls.append(capsule, scanBtn);
  mainRow.append(siteBtn, controls);

  // 环境上下文微指示条
  const ribbon = createEl(doc, 'div', 'header-context-ribbon');
  const weatherSpan = createEl(doc, 'span', '', {}, weatherSummary);
  const healthSpan = createEl(doc, 'span', '', { color: 'var(--apple-green)', fontWeight: '700' }, '● 链路健康');
  ribbon.append(weatherSpan, healthSpan);

  header.append(mainRow, ribbon);
  return header;
}


/* ============================================================================
 * 三、 组件 2：均衡双列 HomeKit 晶体卡片 (HomeKit Device Tile)
 * 严格分离 reportedState 与 desiredState，遵守开关能力权限，大小适中
 * ============================================================================ */
export function createHomeKitTile({
  device = null,
  id = 'dev-1',
  title = '',
  name = '',
  subtitle = '',
  icon = '⚡',
  active = undefined,
  status = 'ONLINE',
  type = 'DEVICE',
  siteCode = 'DEMO',
  reportedState = null,
  desiredState = null,
  commandStatus = 'ACKNOWLEDGED',
  writable = true,
  onToggle = null,
  onToggleClick = null,
  onClick = null,
  onCardClick = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const dev = device || {
    id: id || 'dev-1',
    name: name || title || '设备',
    type: type || 'DEVICE',
    siteCode: siteCode || 'DEMO',
    icon: icon || '⚡',
    status: status || (active ? 'ONLINE' : 'OFFLINE'),
    reportedState: reportedState || { power: Boolean(active) },
    desiredState: desiredState || { power: Boolean(active) },
    commandStatus: commandStatus || 'ACKNOWLEDGED',
    statusText: subtitle
  };

  const tile = createEl(doc, 'div', 'device-tile-card');
  tile.dataset.deviceId = String(dev.id);

  // 1. 左侧区域：图标 + 标题与已上报事实
  const leftGroup = createEl(doc, 'div', 'device-card-left-group');

  // 图标晶体徽章
  const iconBox = createEl(doc, 'div', 'device-icon-wrapper', {}, dev.icon || '⚡');

  // 标题与客观事实信息列
  const infoWrap = createEl(doc, 'div', 'device-card-info');
  const titleEl = createEl(doc, 'div', 'device-card-title', {}, dev.name);

  // 显示已上报客观事实与主指标
  let factText = '状态就绪';
  if (dev.reportedState?.temperature !== undefined) {
    factText = `${dev.reportedState.temperature}°C · 湿度 ${dev.reportedState.humidity || 50}%`;
  } else if (dev.reportedState?.level !== undefined) {
    factText = `开度 ${dev.reportedState.level}% · ${dev.reportedState.power ? '开启' : '关闭'}`;
  } else if (dev.statusText) {
    factText = dev.statusText;
  }

  const subtitleWrap = createEl(doc, 'div', 'device-card-subtitle');
  const subtitleEl = createEl(doc, 'span', '', {}, factText);
  subtitleWrap.append(subtitleEl);

  const isPending = dev.commandStatus === 'PENDING' || dev.commandStatus === 'SENT';
  if (isPending) {
    const pendingDot = createEl(doc, 'span', 'status-pill pending', { fontSize: '9.5px', padding: '1px 5px' }, '待确认');
    subtitleWrap.append(pendingDot);
  }

  infoWrap.append(titleEl, subtitleWrap);
  leftGroup.append(iconBox, infoWrap);

  // 2. 右侧交互控制与状态区
  const rightGroup = createEl(doc, 'div', 'device-card-right-group');
  const hasSwitchCapability = dev.capabilities?.some(c => c.controlType === 'switch') ||
                              ('power' in (dev.reportedState || {})) ||
                              (active !== undefined);

  if (hasSwitchCapability && writable) {
    const isPowerOn = Boolean(dev.desiredState?.power ?? dev.reportedState?.power ?? active);
    const switchBtn = createEl(doc, 'button', `device-interactive-switch device-toggle-btn ${isPowerOn ? 'active' : ''}`);
    switchBtn.type = 'button';
    if (typeof switchBtn.setAttribute === 'function') {
      switchBtn.setAttribute('role', 'switch');
      switchBtn.setAttribute('aria-checked', String(isPowerOn));
      switchBtn.setAttribute('aria-label', `${dev.name} 开关控制`);
    }

    const thumb = createEl(doc, 'span', 'device-interactive-switch-thumb');
    switchBtn.append(thumb);

    switchBtn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      const targetPower = !isPowerOn;
      if (typeof onToggle === 'function') {
        onToggle(dev.id, targetPower);
      }
      if (typeof onToggleClick === 'function') {
        onToggleClick(targetPower, dev.id);
      }
    });
    rightGroup.append(switchBtn);
  } else {
    const statusPill = createEl(doc, 'span', `status-pill ${isPending ? 'pending' : (dev.status === 'ONLINE' ? 'online' : 'offline')}`, {},
      isPending ? '待确认' : (dev.status === 'ONLINE' ? '在线' : '离线')
    );
    rightGroup.append(statusPill);
  }

  const chevron = createEl(doc, 'span', 'device-card-chevron', {}, '›');
  rightGroup.append(chevron);

  tile.append(leftGroup, rightGroup);

  if (typeof onClick === 'function' || typeof onCardClick === 'function') {
    tile.addEventListener('click', () => {
      if (typeof onClick === 'function') onClick(dev.id);
      if (typeof onCardClick === 'function') onCardClick(dev.id);
    });
  }

  return tile;
}


/* ============================================================================
 * 四、 组件 3：符合契约的设备列表容器 (Device List Frame)
 * 纯状态驱动，一条只看一个设备典雅单行布局，紧凑晶体搜索栏
 * ============================================================================ */
export function createDeviceListContainer({
  devices = [],
  activeFilter = 'ALL',
  searchQuery = '',
  onSearch = null,
  onFilterChange = null,
  onDeviceClick = null,
  onDeviceToggle = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const root = createEl(doc, 'div', 'device-list-container device-list-root', {
    display: 'flex', flexDirection: 'column', gap: '10px'
  });

  // 1. 紧凑晶体搜索栏
  const searchWrap = createEl(doc, 'div', 'device-search-wrapper', {
    background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.9)', borderRadius: '14px',
    padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.03), inset 0 1px 1px rgba(255,255,255,1)'
  });
  const searchIcon = createEl(doc, 'span', '', { color: '#94a3b8', fontSize: '13px' }, '🔍');
  const searchInput = createEl(doc, 'input', 'device-search-input', {
    border: '0', background: 'transparent', outline: 'none', width: '100%',
    fontSize: '13px', color: 'var(--text-main)', fontWeight: '500'
  });
  searchInput.type = 'text';
  searchInput.placeholder = '搜索设备名称、MAC 或位置...';
  searchInput.value = searchQuery;

  if (typeof onSearch === 'function') {
    searchInput.addEventListener('input', (e) => onSearch(e.target.value));
  }
  searchWrap.append(searchIcon, searchInput);

  // 2. 状态过滤器药丸条
  const filterBar = createEl(doc, 'div', 'filter-pills-bar', {
    display: 'flex', gap: '6px', overflowX: 'auto', padding: '2px 0'
  });
  const filterOptions = [
    { id: 'ALL', label: '全部设备' },
    { id: 'ONLINE', label: '在线运行' },
    { id: 'OFFLINE', label: '离线/停机' },
    { id: 'PENDING', label: '待回执' }
  ];

  filterOptions.forEach(opt => {
    const isAct = opt.id === activeFilter || opt.label === activeFilter || (activeFilter === 'all' && opt.id === 'ALL');
    const pill = createEl(doc, 'button', `filter-pill ${isAct ? 'active' : ''}`, {}, opt.label);
    pill.dataset.filter = opt.id;

    pill.addEventListener('click', () => {
      if (typeof onFilterChange === 'function') onFilterChange(opt.label || opt.id);
    });
    filterBar.append(pill);
  });

  // 3. 响应式网格容器 (标准双列，适度均衡)
  const gridFrame = createEl(doc, 'div', 'device-grid-frame');
  const grid = createEl(doc, 'div', 'device-grid-container');
  grid.id = 'devices-grid';

  if (!devices.length) {
    const emptyBox = createEl(doc, 'div', 'device-list-empty-box', {
      padding: '32px 16px', textAlign: 'center', background: 'rgba(255,255,255,0.85)',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      borderRadius: '18px', border: '1px solid rgba(255,255,255,0.9)', color: 'var(--text-muted)',
      fontSize: '13px', gridColumn: '1 / -1'
    }, '当前未匹配到符合条件的设备，可调整搜索关键字或筛选条件。');
    grid.append(emptyBox);
  } else {
    devices.forEach(dev => {
      const tile = createHomeKitTile({
        device: dev,
        onToggle: onDeviceToggle,
        onClick: onDeviceClick,
        documentObject: doc
      });
      grid.append(tile);
    });
  }

  gridFrame.append(grid);
  root.append(searchWrap, filterBar, gridFrame);
  return root;
}


/* ============================================================================
 * 五、 组件 4：具备取消守卫的标准原生滑块 (Native Fluid Slider)
 * 满足 F02/F05：原生 range，拖动仅预览，释放才提交，取消/多指守卫
 * ============================================================================ */
export function createNativeFluidSlider({
  label = '调节开度/亮度',
  value = 50,
  reportedValue = undefined,
  min = 0,
  max = 100,
  step = 1,
  unit = '%',
  disabled = false,
  onChange = null,
  onChangePreview = null,
  onCommit = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const group = createEl(doc, 'div', 'range-slider-group');

  const actualReported = reportedValue !== undefined ? reportedValue : value;
  // 校验合法性 (F05)
  const isInvalidRange = min >= max || step <= 0;

  // 顶部 Label 与实时数值读数
  const labelRow = createEl(doc, 'div', 'range-slider-label-row');
  const labelText = createEl(doc, 'span', '', {}, label);
  const readout = createEl(doc, 'span', 'range-slider-readout', {}, `${value}${unit}`);
  labelRow.append(labelText, readout);

  // 原生 input[type=range]
  const rangeInput = createEl(doc, 'input', 'native-range-input');
  rangeInput.type = 'range';
  rangeInput.min = String(min);
  rangeInput.max = String(max);
  rangeInput.step = String(step);
  rangeInput.value = String(value);
  rangeInput.disabled = disabled || isInvalidRange;
  if (typeof rangeInput.setAttribute === 'function') {
    rangeInput.setAttribute('aria-label', label);
    rangeInput.setAttribute('aria-valuemin', String(min));
    rangeInput.setAttribute('aria-valuemax', String(max));
    rangeInput.setAttribute('aria-valuenow', String(value));
    rangeInput.setAttribute('aria-valuetext', `${value}${unit}`);
  }

  let dragInitialValue = Number(value);
  let isCanceled = false;

  // 多指介入或手势取消守卫
  rangeInput.addEventListener('pointerdown', (e) => {
    isCanceled = false;
    dragInitialValue = Number(rangeInput.value);
  });

  rangeInput.addEventListener('pointercancel', () => {
    isCanceled = true;
    rangeInput.value = String(dragInitialValue);
    readout.textContent = `${dragInitialValue}${unit}`;
    if (typeof rangeInput.setAttribute === 'function') {
      rangeInput.setAttribute('aria-valuenow', String(dragInitialValue));
    }
  });

  // 实时拖拽：只更新本地视觉预览，不生成命令
  rangeInput.addEventListener('input', (e) => {
    if (isCanceled) return;
    const curVal = Number(e?.target?.value ?? rangeInput.value);
    readout.textContent = `${curVal}${unit}`;
    if (typeof rangeInput.setAttribute === 'function') {
      rangeInput.setAttribute('aria-valuenow', String(curVal));
      rangeInput.setAttribute('aria-valuetext', `${curVal}${unit}`);
    }
    if (typeof onChangePreview === 'function') {
      onChangePreview(curVal);
    }
    if (typeof onChange === 'function') {
      onChange(curVal);
    }
  });

  // 释放触控：正式提交意图
  rangeInput.addEventListener('change', (e) => {
    if (isCanceled) return;
    const finalVal = Number(e?.target?.value ?? rangeInput.value);
    if (typeof onCommit === 'function') {
      onCommit(finalVal);
    }
  });

  // 底部事实回执对比提示条
  const ackRibbon = createEl(doc, 'div', 'range-ack-ribbon');
  const factSpan = createEl(doc, 'span', '', {}, `已上报事实: ${actualReported}${unit}`);
  const stateSpan = createEl(doc, 'span', '', {
    color: Number(value) !== Number(actualReported) ? 'var(--apple-amber)' : 'var(--apple-green)'
  }, Number(value) !== Number(actualReported) ? '目标待确认' : '已同步');
  ackRibbon.append(factSpan, stateSpan);

  group.append(labelRow, rangeInput, ackRibbon);
  return group;
}

export const createFluidSlider = createNativeFluidSlider;


/* ============================================================================
 * 六、 组件 5：符合规范的设备控制抽屉 (Control Action Sheet)
 * 包含焦点管理、Escape 关闭与明确确认取消
 * ============================================================================ */
export function createQuickControlSheet({
  device = {},
  onCommitValue = null,
  onClose = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const overlay = createEl(doc, 'div', 'quick-sheet-overlay', {
    position: 'fixed', inset: '0', background: 'rgba(15, 23, 42, 0.45)',
    zIndex: '100', display: 'flex', alignItems: 'flex-end',
    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)'
  });

  const sheet = createEl(doc, 'div', 'quick-sheet-panel', {
    width: '100%', maxWidth: '440px', margin: '0 auto',
    background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.88) 100%)',
    backdropFilter: 'blur(32px) saturate(200%)', WebkitBackdropFilter: 'blur(32px) saturate(200%)',
    border: '1px solid rgba(255, 255, 255, 0.95)',
    borderRadius: '26px 26px 0 0', padding: '20px', display: 'flex',
    flexDirection: 'column', gap: '16px', boxShadow: '0 -12px 40px rgba(0,0,0,0.18), inset 0 1.5px 1px rgba(255,255,255,1)'
  });

  // 顶栏（标题 + 明确关闭按键）
  const topBar = createEl(doc, 'div', '', {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  });
  const titleBox = createEl(doc, 'div');
  const title = createEl(doc, 'div', '', { fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }, device.name || '设备调控');
  const sub = createEl(doc, 'div', '', { fontSize: '12px', color: 'var(--text-muted)' }, '设备控制与参数调节');
  titleBox.append(title, sub);

  const closeBtn = createEl(doc, 'button', 'sheet-close-btn', {
    width: '32px', height: '32px', borderRadius: '50%', border: '1px solid rgba(0,0,0,0.06)',
    background: 'rgba(241, 245, 249, 0.8)', cursor: 'pointer', fontSize: '14px', fontWeight: '700',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }, '✕');
  if (typeof closeBtn.setAttribute === 'function') {
    closeBtn.setAttribute('aria-label', '关闭控制面板');
  }

  function doClose() {
    if (typeof overlay.remove === 'function') overlay.remove();
    if (typeof onClose === 'function') onClose();
  }

  closeBtn.addEventListener('click', doClose);
  topBar.append(titleBox, closeBtn);

  // 滑块控制器
  let currentVal = device.desiredState?.level ?? device.reportedState?.level ?? 50;
  const reportedVal = device.reportedState?.level ?? 50;

  const slider = createNativeFluidSlider({
    label: '输出强度调节',
    value: currentVal,
    reportedValue: reportedVal,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    onCommit: (val) => { currentVal = val; },
    documentObject: doc
  });

  // 操作按钮行（明确取消与确认）
  const actionRow = createEl(doc, 'div', '', { display: 'flex', gap: '10px' });
  const cancelBtn = createEl(doc, 'button', 'sheet-cancel-btn', {
    flex: '1', padding: '12px', borderRadius: '14px', background: 'rgba(241, 245, 249, 0.9)',
    border: '1px solid rgba(226, 232, 240, 0.8)', color: 'var(--text-main)', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
  }, '取消');
  cancelBtn.addEventListener('click', doClose);

  const confirmBtn = createEl(doc, 'button', 'sheet-confirm-btn', {
    flex: '1', padding: '12px', borderRadius: '14px', background: 'var(--apple-blue)',
    border: '0', color: '#ffffff', fontSize: '13px', fontWeight: '700', cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0, 102, 204, 0.35)'
  }, '确认下发');
  confirmBtn.addEventListener('click', () => {
    if (typeof onCommitValue === 'function') {
      onCommitValue(device.id, currentVal);
    }
    doClose();
  });

  actionRow.append(cancelBtn, confirmBtn);
  sheet.append(topBar, slider, actionRow);
  overlay.append(sheet);

  // 键盘 Escape 响应
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') doClose();
  });

  return overlay;
}


/* ============================================================================
 * 七、 组件 6：全屏设备详情与遥测事实页 (Device Detail View)
 * ============================================================================ */
export function createDeviceDetailView({
  device = {},
  onBack = null,
  onCommitControl = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const container = createEl(doc, 'div', 'device-detail-container', {
    display: 'flex', flexDirection: 'column', gap: '14px'
  });

  // 顶栏返回行
  const navRow = createEl(doc, 'div', '', {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
  });
  const backBtn = createEl(doc, 'button', 'detail-back-btn', {
    padding: '8px 14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.85)',
    background: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(16px)',
    cursor: 'pointer', fontSize: '13px', fontWeight: '600',
    display: 'flex', alignItems: 'center', gap: '4px', minHeight: 'var(--touch-target)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.03), inset 0 1px 1px rgba(255,255,255,1)'
  }, '← 返回列表');
  if (onBack) backBtn.addEventListener('click', onBack);

  const title = createEl(doc, 'div', '', {
    fontSize: '15px', fontWeight: '700', color: 'var(--text-main)'
  }, device.name || '设备详情');

  navRow.append(backBtn, title);

  // 事实状态 vs 期望状态卡片
  const statusCard = createEl(doc, 'div', 'device-tile-card');
  const cardTitle = createEl(doc, 'div', '', { fontSize: '13px', fontWeight: '700', marginBottom: '8px' }, '遥测与控制状态');

  const factRow = createEl(doc, 'div', '', {
    display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(226, 232, 240, 0.6)', fontSize: '13px'
  });
  factRow.append(createEl(doc, 'span', '', { color: 'var(--text-muted)' }, '上报事实 (Reported)'),
                 createEl(doc, 'span', '', { fontWeight: '600' }, JSON.stringify(device.reportedState || {})));

  const desiredRow = createEl(doc, 'div', '', {
    display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: '13px'
  });
  desiredRow.append(createEl(doc, 'span', '', { color: 'var(--text-muted)' }, '期望目标 (Desired)'),
                    createEl(doc, 'span', '', { fontWeight: '600', color: 'var(--apple-blue)' }, JSON.stringify(device.desiredState || {})));

  statusCard.append(cardTitle, factRow, desiredRow);

  // 包含可控滑块
  const slider = createNativeFluidSlider({
    label: '设备输出强度微调',
    value: device.desiredState?.level ?? 50,
    reportedValue: device.reportedState?.level ?? 50,
    onCommit: (val) => {
      if (onCommitControl) onCommitControl(device.id, val);
    },
    documentObject: doc
  });

  container.append(navRow, statusCard, slider);
  return container;
}


/* ============================================================================
 * 八、 组件 7：悬浮轻毛玻璃底栏导航 (Bottom Nav)
 * ============================================================================ */
export function createBottomNav({
  activeTab = 'devices',
  onTabChange = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const navWrap = createEl(doc, 'nav', 'universal-bottom-nav');
  const inner = createEl(doc, 'div', 'universal-bottom-nav-inner');

  const tabs = [
    { id: 'devices', label: '设备看板', icon: '📱' },
    { id: 'ai', label: 'AI 助手', icon: '✨' },
    { id: 'activity', label: '运维审计', icon: '📋' },
    { id: 'settings', label: '系统设置', icon: '⚙️' }
  ];

  tabs.forEach(tab => {
    const isAct = tab.id === activeTab;
    const btn = createEl(doc, 'button', `nav-tab-btn ${isAct ? 'active' : ''}`);
    btn.type = 'button';
    btn.dataset.tab = tab.id;
    if (typeof btn.setAttribute === 'function') {
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(isAct));
    }

    const iconSpan = createEl(doc, 'span', '', { fontSize: '16px' }, tab.icon);
    const labelSpan = createEl(doc, 'span', '', {}, tab.label);
    btn.append(iconSpan, labelSpan);

    btn.addEventListener('click', () => {
      const allBtns = inner.querySelectorAll ? inner.querySelectorAll('.nav-tab-btn') : inner.children;
      Array.from(allBtns).forEach(b => {
        b.classList?.remove('active');
        if (typeof b.setAttribute === 'function') b.setAttribute('aria-selected', 'false');
      });
      btn.classList?.add('active');
      if (typeof btn.setAttribute === 'function') btn.setAttribute('aria-selected', 'true');
      if (typeof onTabChange === 'function') onTabChange(tab.id);
    });

    inner.append(btn);
  });

  navWrap.append(inner);
  return navWrap;
}


/* ============================================================================
 * 九、 组件 8：Apple Intelligence 对话流与门禁录入器 (AI Stream & Composer)
 * 沉底固定于最底部，满足 F04：草稿保留、处理中门禁阻断、IME 回车防误发、一键复制
 * ============================================================================ */
export function createAiMessageList({
  messages = [],
  onCopy = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const stream = createEl(doc, 'div', 'ai-messages-stream', {
    display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '200px'
  });

  if (!messages.length) {
    const empty = createEl(doc, 'div', 'ai-empty-message', {
      padding: '24px', textAlign: 'center', background: 'rgba(255,255,255,0.85)',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      borderRadius: '18px', border: '1px solid rgba(255,255,255,0.9)', color: 'var(--text-muted)', fontSize: '13px'
    }, '您可以向 Apple Intelligence 询问设备实时状态、能耗诊断或操作建议。');
    stream.append(empty);
    return stream;
  }

  messages.forEach(msg => {
    const isUser = msg.role === 'USER' || msg.sender === 'user';
    const bubble = createEl(doc, 'div', isUser ? 'ai-bubble-user' : 'ai-bubble-agent');

    // 严格使用 textContent，阻断任何脚本或 HTML 注入
    const content = createEl(doc, 'div', 'ai-bubble-text', { whiteSpace: 'pre-wrap' }, msg.content || msg.text || '');
    bubble.append(content);

    if (!isUser) {
      const copyBtn = createEl(doc, 'button', 'copy-btn ai-copy-action', {
        marginTop: '8px', fontSize: '11px', color: 'var(--apple-blue)', background: 'transparent',
        border: '0', cursor: 'pointer', fontWeight: '600', display: 'inline-block'
      }, '📋 复制建议');

      copyBtn.addEventListener('click', () => {
        if (typeof onCopy === 'function') onCopy(msg.content || msg.text || '');
      });
      bubble.append(copyBtn);
    }

    stream.append(bubble);
  });

  return stream;
}

export function createCrystalAiComposer({
  initialDraft = '',
  quickChips = null,
  quickPrompts = null,
  isBusy = false,
  onDraftChange = null,
  onSend = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const wrapper = createEl(doc, 'div', 'ai-composer-container');

  const chipsList = quickChips || quickPrompts || [
    '⚡ 诊断3号循环泵能耗',
    '📋 汇总今日运维与告警',
    '❄️ 设温 24°C 节能策略',
    '🔍 检查近场未配对设备'
  ];

  // 1. 快捷 Prompt 芯片（点击只填入草稿，不违规直接发命令）
  const chipsScroll = createEl(doc, 'div', 'ai-chips-scroll-bar', {
    display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px'
  });

  // 2. 输入框组
  const inputRow = createEl(doc, 'div', 'ai-composer-wrapper');
  const input = createEl(doc, 'input', 'ai-composer-input', {
    border: '0', background: 'transparent', outline: 'none', width: '100%',
    fontSize: '13.5px', color: 'var(--text-main)', fontWeight: '500'
  });
  input.type = 'text';
  input.placeholder = isBusy ? '智能体思考中，请稍候...' : '输入问题或指令...';
  input.value = initialDraft;
  input.disabled = isBusy;

  chipsList.forEach(chipText => {
    const chip = createEl(doc, 'button', 'ai-chip-pill quick-chip-btn', {}, chipText);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      input.value = chipText;
      if (typeof onDraftChange === 'function') onDraftChange(chipText);
      if (typeof input.focus === 'function') input.focus();
    });
    chipsScroll.append(chip);
  });

  input.addEventListener('input', (e) => {
    if (typeof onDraftChange === 'function') onDraftChange(e.target.value);
  });

  // 发送按钮
  const sendBtn = createEl(doc, 'button', 'ai-composer-send-btn', {
    width: '34px', height: '34px', borderRadius: '50%', border: '0',
    background: isBusy ? '#cbd5e1' : 'var(--apple-blue)', color: '#ffffff',
    cursor: isBusy ? 'not-allowed' : 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontSize: '15px',
    boxShadow: isBusy ? 'none' : '0 2px 8px rgba(0, 102, 204, 0.35)'
  }, isBusy ? '⏳' : '↑');
  sendBtn.disabled = isBusy;

  function doSend() {
    const txt = (input.value || '').trim();
    if (!txt || isBusy) return;
    if (typeof onSend === 'function') {
      onSend(txt);
      input.value = '';
      if (typeof onDraftChange === 'function') onDraftChange('');
    }
  }

  sendBtn.addEventListener('click', doSend);

  // IME 回车防误发校验 (F04)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.isComposing) return; // 拼音敲回车选字时不触发发送
      if (typeof e.preventDefault === 'function') e.preventDefault();
      doSend();
    }
  });

  inputRow.append(input, sendBtn);
  wrapper.append(chipsScroll, inputRow);
  return wrapper;
}


/* ============================================================================
 * 十、 组件 9：近场扫描与运维事件视图 (Scanner & Activity Stream)
 * ============================================================================ */
export function createBleScannerView({
  candidates = [],
  devices = null,
  isScanning = true,
  onToggleScan = null,
  onClaim = null,
  onClaimDevice = null,
  onQrScan = null,
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const container = createEl(doc, 'div', 'ble-scanner-container', { display: 'flex', flexDirection: 'column', gap: '12px' });
  const list = candidates.length ? candidates : (devices || []);

  // 扫描状态条
  const statusBar = createEl(doc, 'div', 'device-tile-card', {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  });
  const textInfo = createEl(doc, 'div');
  textInfo.append(
    createEl(doc, 'div', '', { fontWeight: '700', fontSize: '14px' }, '近场 BLE / 局域网雷达感知'),
    createEl(doc, 'div', '', { fontSize: '11px', color: 'var(--text-muted)' }, isScanning ? '正在监听广播信号...' : '扫描已暂停')
  );

  const btnGroup = createEl(doc, 'div', '', { display: 'flex', gap: '8px', alignItems: 'center' });

  if (typeof onQrScan === 'function') {
    const qrBtn = createEl(doc, 'button', 'qr-scan-btn', {
      padding: '6px 12px', borderRadius: 'var(--radius-pill)', border: '1px solid rgba(255,255,255,0.85)',
      background: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: '12px', fontWeight: '600'
    }, '📷 扫码添加');
    qrBtn.addEventListener('click', onQrScan);
    btnGroup.append(qrBtn);
  }

  const toggleBtn = createEl(doc, 'button', 'ble-toggle-scan-btn', {
    padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid rgba(255,255,255,0.85)',
    background: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: '12px', fontWeight: '600'
  }, isScanning ? '暂停' : '启动');
  if (onToggleScan) toggleBtn.addEventListener('click', () => onToggleScan(!isScanning));
  btnGroup.append(toggleBtn);

  statusBar.append(textInfo, btnGroup);
  container.append(statusBar);

  // 候选设备列表
  const candListWrap = createEl(doc, 'div', 'ble-candidates-list', { display: 'flex', flexDirection: 'column', gap: '8px' });
  list.forEach(cand => {
    const card = createEl(doc, 'div', 'device-tile-card', {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px'
    });
    const info = createEl(doc, 'div');
    info.append(
      createEl(doc, 'div', '', { fontWeight: '700', fontSize: '13px' }, cand.name),
      createEl(doc, 'div', '', { fontSize: '11px', color: 'var(--text-muted)' }, `${cand.mac} · 信号 ${cand.rssi}dBm`)
    );

    const claimBtn = createEl(doc, 'button', 'claim-btn ble-claim-action', {
      padding: '6px 14px', borderRadius: 'var(--radius-pill)', background: 'var(--apple-blue)',
      color: '#ffffff', border: '0', cursor: 'pointer', fontSize: '12px', fontWeight: '700',
      boxShadow: '0 2px 8px rgba(0, 102, 204, 0.3)'
    }, '认领入库');
    claimBtn.addEventListener('click', () => {
      if (typeof onClaim === 'function') onClaim(cand);
      if (typeof onClaimDevice === 'function') onClaimDevice(cand);
    });

    card.append(info, claimBtn);
    candListWrap.append(card);
  });

  container.append(candListWrap);
  return container;
}

export function createActivityStreamView({
  events = [],
  title = '运维审计与设备日志',
  documentObject = null
} = {}) {
  const doc = getDoc(documentObject);
  const container = createEl(doc, 'div', 'activity-stream-container', { display: 'flex', flexDirection: 'column', gap: '8px' });

  const header = createEl(doc, 'div', '', {
    fontSize: '13px', fontWeight: '700', color: 'var(--text-main)', padding: '4px 2px'
  }, title);
  container.append(header);

  events.forEach(item => {
    const card = createEl(doc, 'div', 'device-tile-card', { padding: '12px 14px' });
    const top = createEl(doc, 'div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '11px' });
    const badge = createEl(doc, 'span', 'status-pill online', {}, item.type || item.badgeText || 'EVENT');
    const time = createEl(doc, 'span', '', { color: 'var(--text-tertiary)' }, item.time || '');
    top.append(badge, time);

    const cardTitle = createEl(doc, 'div', '', { fontWeight: '700', fontSize: '13px', marginTop: '4px' }, item.title);
    const desc = createEl(doc, 'div', '', { fontSize: '11.5px', color: 'var(--text-muted)' }, item.desc || item.description || '');

    card.append(top, cardTitle, desc);
    container.append(card);
  });

  return container;
}
