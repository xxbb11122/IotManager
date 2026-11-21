import { ensureGlassComponent } from './glass-surfaces.js';

const modes = new Set(['liquid', 'frosted', 'solid']);
const materialKey = 'iot-manager.glass.material.v1';

function storedMode(windowObject) {
  try {
    const saved = windowObject.localStorage.getItem(materialKey);
    if (modes.has(saved)) return saved;
  } catch { /* Appearance still works when the WebView disallows storage. */ }
  return 'liquid';
}

export function createGlassAppearance(root) {
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView;
  const forcedColors = windowObject.matchMedia('(forced-colors: active)');
  const highContrast = windowObject.matchMedia('(prefers-contrast: more)');
  const desktop = windowObject.matchMedia('(min-width: 820px)');
  const navigation = new Map();
  let choice = modes.has(root.dataset.material) ? root.dataset.material : storedMode(windowObject);
  root.dataset.material = choice;
  let destroyed = false;
  let frame = null;
  const resizeObserver = typeof windowObject.ResizeObserver === 'function'
    ? new windowObject.ResizeObserver(() => schedule()) : null;

  function attribute(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  function property(node, name, value) {
    if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
  }
  function createLens(nav) {
    const lens = documentObject.createElement('liquid-glass');
    lens.className = 'liquid-nav-lens';
    lens.setAttribute('aria-hidden', 'true');
    lens.setAttribute('inert', '');
    for (const [name, value] of Object.entries({radius: '16', frost: '0.16', blur: '0.3', saturation: '115',
      lens: 'rim', scale: '60', 'lens-strength': '0.7', 'border-color': 'rgba(255,255,255,0.9)', 'effect-mode': 'off'})) {
      lens.setAttribute(name, value);
    }
    nav.prepend(lens);
    navigation.set(nav, lens);
    resizeObserver?.observe(nav);
    return lens;
  }
  const chosenMode = () => modes.has(root.dataset.material) ? root.dataset.material : choice;
  const mode = () => forcedColors.matches || highContrast.matches ? 'solid' : chosenMode();
  function sync() {
    if (destroyed) return;
    const current = mode();
    attribute(root, 'data-glass', current);
    const effect = documentObject.hidden || current === 'solid' ? 'off' : current === 'frosted' ? 'blur' : 'auto';
    for (const lens of root.querySelectorAll('.liquid-surface-layer')) attribute(lens, 'effect-mode', effect);
    for (const [nav, lens] of navigation) {
      if (!root.contains(nav)) { resizeObserver?.unobserve(nav); lens.remove(); navigation.delete(nav); }
    }
    for (const nav of root.querySelectorAll('.bottom-nav, .primary-nav')) {
      const savedLens = navigation.get(nav);
      const lens = savedLens?.parentElement === nav ? savedLens : createLens(nav);
      const mobile = nav.classList.contains('bottom-nav');
      const active = nav.querySelector('[aria-current="page"]');
      const visible = (mobile ? !desktop.matches : desktop.matches) && Boolean(active);
      attribute(lens, 'data-active', String(visible));
      attribute(lens, 'effect-mode', current === 'liquid' && visible && !documentObject.hidden ? 'auto' : 'off');
      if (!mobile && active && desktop.matches) {
        for (const [name, value] of Object.entries({'--lens-x': active.offsetLeft, '--lens-y': active.offsetTop,
          '--lens-width': active.offsetWidth, '--lens-height': active.offsetHeight})) property(lens, name, `${value}px`);
      }
    }
  }
  function schedule() {
    if (destroyed || frame !== null) return;
    frame = windowObject.requestAnimationFrame(() => { frame = null; sync(); });
  }
  const opticalSelector = '.bottom-nav, .primary-nav, .liquid-surface-layer';
  const touchesMaterial = records => records.some(record => {
    if (record.type === 'attributes') {
      return record.target === root && record.attributeName === 'data-material'
        || record.target.matches('.bottom-nav, .primary-nav, .nav-button, .desktop-nav-button');
    }
    return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
      && (node.matches(opticalSelector) || node.querySelector(opticalSelector)));
  });
  const observer = new windowObject.MutationObserver(records => { if (touchesMaterial(records)) schedule(); });
  observer.observe(root, {subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'aria-current', 'data-material']});
  windowObject.addEventListener('resize', schedule);
  documentObject.addEventListener('visibilitychange', sync);
  const media = [forcedColors, highContrast, desktop];
  for (const query of media) {
    if (query.addEventListener) query.addEventListener('change', sync);
    else query.addListener(sync);
  }
  ensureGlassComponent().then(() => { if (!destroyed) sync(); }).catch(() => {
    // The CSS material remains readable when an optional optical chunk fails.
    if (!destroyed) root.dataset.glassOptics = 'unavailable';
  });
  sync();
  return {
    choice: chosenMode,
    select(requested) {
      if (!modes.has(requested)) return;
      choice = requested;
      attribute(root, 'data-material', choice);
      try { windowObject.localStorage.setItem(materialKey, choice); } catch { /* Keep the current choice in memory. */ }
      sync();
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      resizeObserver?.disconnect();
      if (frame !== null) windowObject.cancelAnimationFrame(frame);
      windowObject.removeEventListener('resize', schedule);
      documentObject.removeEventListener('visibilitychange', sync);
      for (const query of media) {
        if (query.removeEventListener) query.removeEventListener('change', sync);
        else query.removeListener(sync);
      }
      for (const lens of root.querySelectorAll('.liquid-surface-layer')) attribute(lens, 'effect-mode', 'off');
      for (const lens of navigation.values()) lens.remove();
      navigation.clear();
    }
  };
}
