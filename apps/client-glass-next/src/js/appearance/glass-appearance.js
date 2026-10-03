import { ensureGlassComponent } from './glass-surfaces.js';

export function createGlassAppearance(root) {
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView;
  const forcedColors = windowObject.matchMedia('(forced-colors: active)');
  const highContrast = windowObject.matchMedia('(prefers-contrast: more)');
  const desktop = windowObject.matchMedia('(min-width: 820px)');
  const navigation = new Map();
  let choice = 'liquid';
  let destroyed = false;
  let frame = null;

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
    return lens;
  }
  function mode() {
    return root.dataset.material === 'solid' || forcedColors.matches || highContrast.matches ? 'solid' : choice;
  }
  function sync() {
    if (destroyed) return;
    const current = mode();
    attribute(root, 'data-glass', current);
    const effect = documentObject.hidden || current === 'solid' ? 'off' : current === 'frosted' ? 'blur' : 'auto';
    for (const lens of root.querySelectorAll('.liquid-surface-layer')) attribute(lens, 'effect-mode', effect);
    for (const [nav, lens] of navigation) {
      if (!root.contains(nav)) { lens.remove(); navigation.delete(nav); }
    }
    for (const nav of root.querySelectorAll('.bottom-nav, .primary-nav')) {
      const lens = navigation.get(nav) ?? createLens(nav);
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
  const observer = new windowObject.MutationObserver(schedule);
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
    choice: () => root.dataset.material === 'solid' ? 'solid' : choice,
    select(requested) {
      if (!['liquid', 'frosted', 'solid'].includes(requested)) return;
      if (requested !== 'solid') choice = requested;
      root.dataset.material = requested === 'solid' ? 'solid' : 'auto';
      sync();
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
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
