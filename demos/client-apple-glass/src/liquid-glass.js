import 'simple-liquid-glass/web-component';
import { addGlassSurface } from './glass-surfaces.js';
import './css/liquid.css';
import './css/device-detail.css';
import './css/weather.css';

// Navigation is persistent; screen materials participate in keyed patches.
// Controls and command/AI state remain owned by the existing UI.
export function createLiquidGlassDemo(root) {
  const comparison = document.getElementById('material-preview');
  const sample = document.getElementById('liquid-material-sample');
  const forcedColors = matchMedia('(forced-colors: active)');
  const highContrast = matchMedia('(prefers-contrast: more)');
  const desktop = matchMedia('(min-width: 820px)');
  const navigation = new Map();
  let choice = 'liquid';
  let destroyed = false;

  // Static demo tools use the same material as dynamically rendered screens.
  for (const node of document.querySelectorAll('.demo-strip button, #demo-panel, #material-preview, '
    + '.demo-panel-metrics, .demo-panel-actions button, #close-demo-panel, #close-material-preview, '
    + '.material-options button, #material-preview-return')) {
    node.classList.add(node.matches('button') ? 'glass-control' : 'glass-shell');
    addGlassSurface(node);
  }

  function attribute(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  function property(node, name, value) {
    if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
  }
  function text(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }
  function createLens(nav) {
    const lens = document.createElement('liquid-glass');
    lens.className = 'liquid-nav-lens';
    lens.setAttribute('aria-hidden', 'true');
    lens.setAttribute('inert', '');
    for (const [name, value] of Object.entries({
      radius: '16', frost: '0.16', blur: '0.3', saturation: '115',
      lens: 'rim', scale: '60', 'lens-strength': '0.7',
      'border-color': 'rgba(255,255,255,0.9)', 'effect-mode': 'off'
    })) lens.setAttribute(name, value);
    nav.prepend(lens);
    navigation.set(nav, lens);
    return lens;
  }
  function currentMode() {
    if (root.dataset.material === 'solid' || forcedColors.matches || highContrast.matches) return 'solid';
    return choice;
  }
  function sync() {
    if (destroyed) return;
    const mode = currentMode();
    attribute(root, 'data-glass', mode);
    attribute(document.documentElement, 'data-glass', mode);
    const surfaceEffect = document.hidden || mode === 'solid' ? 'off' : mode === 'frosted' ? 'blur' : 'auto';
    for (const lens of document.querySelectorAll('.liquid-surface-layer')) {
      const dialog = lens.closest('dialog');
      attribute(lens, 'effect-mode', dialog && !dialog.open ? 'off' : surfaceEffect);
    }
    for (const nav of root.querySelectorAll('.bottom-nav, .primary-nav')) {
      const lens = navigation.get(nav) ?? createLens(nav);
      const mobile = nav.classList.contains('bottom-nav');
      const active = nav.querySelector('[aria-current="page"]');
      const visible = (mobile ? !desktop.matches : desktop.matches) && Boolean(active);
      attribute(lens, 'data-active', String(visible));
      attribute(lens, 'effect-mode', mode === 'liquid' && visible && !document.hidden ? 'auto' : 'off');
      if (!mobile && active && desktop.matches) {
        property(lens, '--lens-x', `${active.offsetLeft}px`);
        property(lens, '--lens-y', `${active.offsetTop}px`);
        property(lens, '--lens-width', `${active.offsetWidth}px`);
        property(lens, '--lens-height', `${active.offsetHeight}px`);
      }
    }
    for (const button of document.querySelectorAll('[data-glass-choice]')) {
      attribute(button, 'aria-pressed', String(button.dataset.glassChoice === mode));
    }
    text(document.getElementById('glass-mode-label'), {
      liquid: '轻毛玻璃 + 液态玻璃', frosted: '轻毛玻璃 · 原版', solid: '实色 · 清晰显示'
    }[mode]);
    // WebGL captures only the small static sample, never live device data.
    // Hide/off releases the renderer; reduced motion retains a static material.
    attribute(sample, 'effect-mode', !comparison.open || document.hidden || mode === 'solid'
      ? 'off' : mode === 'frosted' ? 'blur' : 'auto');
    attribute(comparison, 'data-glass', mode);
    showStrategy();
  }
  function showStrategy() {
    if (!comparison.open) return;
    const strategy = sample.dataset.glassStrategy;
    text(document.getElementById('material-renderer'), {
      webgl: '折射已启用', svg: '折射已启用', pending: '正在准备玻璃材质…',
      blur: '当前为轻毛玻璃效果', off: '当前为实色显示'
    }[strategy] ?? '正在准备玻璃材质…');
  }
  function select(event) {
    const button = event.target.closest('[data-glass-choice]');
    if (!button) return;
    const requested = button.dataset.glassChoice;
    if (requested !== 'solid') choice = requested;
    root.dataset.material = requested === 'solid' ? 'solid' : 'auto';
    // Keep the existing display settings in sync with the comparison controls.
    root.dispatchEvent(new CustomEvent('glass-material-change'));
    sync();
  }
  function open() { comparison.showModal(); sync(); }
  function close() { comparison.close(); }
  function reset() { choice = 'liquid'; sync(); }
  function resize() { sync(); }

  const observer = new MutationObserver(sync);
  observer.observe(root, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'aria-current', 'data-material'] });
  observer.observe(document.getElementById('demo-panel'), { attributes: true, attributeFilter: ['open'] });
  const rendererObserver = new MutationObserver(showStrategy);
  rendererObserver.observe(sample, { attributes: true, attributeFilter: ['data-glass-strategy'] });
  document.getElementById('open-material-preview').addEventListener('click', open);
  document.getElementById('close-material-preview').addEventListener('click', close);
  document.getElementById('material-preview-return').addEventListener('click', close);
  comparison.addEventListener('close', sync);
  comparison.addEventListener('click', select);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', sync);
  for (const media of [forcedColors, highContrast, desktop]) media.addEventListener('change', sync);
  sync();

  return {
    reset,
    destroy() {
      destroyed = true;
      observer.disconnect(); rendererObserver.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', sync);
      for (const media of [forcedColors, highContrast, desktop]) media.removeEventListener('change', sync);
      document.getElementById('open-material-preview').removeEventListener('click', open);
      document.getElementById('close-material-preview').removeEventListener('click', close);
      document.getElementById('material-preview-return').removeEventListener('click', close);
      comparison.removeEventListener('close', sync); comparison.removeEventListener('click', select);
      sample.setAttribute('effect-mode', 'off');
      for (const lens of document.querySelectorAll('.liquid-surface-layer')) lens.setAttribute('effect-mode', 'off');
      for (const lens of navigation.values()) lens.remove();
      navigation.clear();
    }
  };
}
