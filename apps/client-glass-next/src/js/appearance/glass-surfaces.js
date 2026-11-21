let definition;
export function ensureGlassComponent() {
  if (!definition) definition = import('simple-liquid-glass/web-component');
  return definition;
}

// AI uses one CSS workspace surface. Its fields, messages and history rows
// retain semantic backgrounds without stacking independent optical filters.
const panels = new Set(['surface', 'detail-layout', 'mode-grid', 'weather-overview',
  'device-row', 'context-row', 'path-choice', 'candidate-row']);
const controls = new Set(['button', 'icon-button', 'mode-button', 'switch-button', 'segment']);
const nonSurfaceHosts = new Set(['input', 'select', 'textarea', 'img', 'br', 'hr',
  'area', 'base', 'col', 'embed', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const detailSections = new Set(['device-connection', 'device-state', 'device-controls',
  'device-command', 'device-activity', 'device-metadata']);

export function glassEffect(documentObject = document) {
  const mode = documentObject.getElementById('app')?.dataset.glass ?? 'liquid';
  return documentObject.hidden || mode === 'solid' ? 'off' : mode === 'frosted' ? 'blur' : 'auto';
}

// Put the optical material below the real content. It participates in the
// existing keyed patches, so data refreshes reuse the surface and its filter.
export function addGlassSurface(node) {
  if (nonSurfaceHosts.has(node.localName)
    || [...node.children].some(child => child.dataset.region === 'glass-optics')) return node;
  const classes = [...node.classList];
  const panel = classes.some(name => panels.has(name));
  const control = classes.some(name => controls.has(name));
  // Detail sections share one optical sheet rather than nesting more cards.
  if ((!panel && !control) || node.dataset.region === 'device-list-surface'
    || detailSections.has(node.dataset.region)) return node;
  node.classList.add('glass-panel', control ? 'glass-panel--control' : 'glass-panel--surface');
  const lens = node.ownerDocument.createElement('liquid-glass');
  lens.className = 'liquid-surface-layer';
  lens.dataset.region = 'glass-optics';
  lens.setAttribute('aria-hidden', 'true');
  lens.setAttribute('inert', '');
  for (const [name, value] of Object.entries({
    radius: control ? '12' : '18', frost: '0.035', blur: '0', saturation: '110',
    lens: 'rim', scale: control ? '24' : '42', 'lens-strength': '0.6',
    'border-color': 'rgba(255,255,255,0.94)', 'effect-mode': glassEffect(node.ownerDocument)
  })) lens.setAttribute(name, value);
  node.append(lens);
  return node;
}
