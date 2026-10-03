import { createClientUi } from '../../js/ui.js';
import { createPreviewFixture } from './fixtures.js';
import { MOTION_SCENARIOS, scenarioById } from './scenarios.js';
import { createPreviewSimulator } from './simulator.js';

// Defense in depth: even an accidental future import cannot silently use a real transport.
const blockedAttempts = [];
const blocked = (name) => (...args) => {
  blockedAttempts.push({ name, at: Date.now() });
  throw new Error(`合成预览禁止 ${name}；不会访问真实服务或设备。`);
};
window.fetch = blocked('fetch');
window.WebSocket = blocked('WebSocket');
window.EventSource = blocked('EventSource');
window.XMLHttpRequest = blocked('XMLHttpRequest');
if (navigator.bluetooth) {
  try { navigator.bluetooth.requestDevice = blocked('Bluetooth'); } catch { /* Permissions-Policy also denies access. */ }
}
if (navigator.geolocation) {
  try { navigator.geolocation.getCurrentPosition = blocked('Geolocation'); navigator.geolocation.watchPosition = blocked('Geolocation'); } catch { /* Permissions-Policy also denies access. */ }
}

let current = { id: 'G01', variant: 'ready' };
let configuration = { delayMs: 800, outcome: 'success', motion: 'normal' };
let model;
let ui;
let simulator;
let disposed = false;

function applyMotion() {
  document.documentElement.dataset.previewMotion = configuration.motion;
  ui?.setMotionDegraded(configuration.motion === 'reduce');
}

function mount(id, variant) {
  const scenario = scenarioById(id);
  const selectedVariant = variant ?? scenario.variants[0];
  const fixture = createPreviewFixture(scenario, selectedVariant);
  simulator?.dispose();
  ui?.destroy();
  const oldRoot = document.getElementById('app');
  const root = document.createElement('div');
  root.id = 'app';
  oldRoot.replaceWith(root); // Late callbacks can never render into the new scenario's DOM root.
  model = fixture.model;
  current = { id: scenario.id, variant: selectedVariant };
  simulator = createPreviewSimulator({
    getModel: () => model,
    updateModel: (next) => { model = next; ui.render(model); },
    notify: (message) => ui.notify(message),
    onChange: () => window.parent.postMessage({ type: 'iot-motion-preview-update' }, window.location.origin),
    options: configuration
  });
  ui = createClientUi(root, simulator.handlers);
  ui.render(model);
  Object.assign(ui.local.endpointDraft, { accessRoute: model.runtime.accessRoute, ...model.endpointProfile });
  ui.navigate(scenario.screen, {
    kind: ['devices', 'activity', 'add'].includes(scenario.screen) ? 'peer' : 'push',
    entityId: scenario.screen === 'detail' ? model.activeDeviceId : null
  });
  ui.render(model);
  if (fixture.local.selectedCandidateId) {
    root.querySelector('[data-action="select-candidate"]')?.click();
  }
  if (fixture.local.endpointDraft) {
    const mode = root.querySelector(`[data-action="choose-endpoint-route"][data-route="${fixture.local.endpointDraft.accessRoute}"]`);
    mode?.click();
    // Field values belong to the preview draft, not an API or persisted endpoint profile.
    Object.assign(ui.local.endpointDraft, fixture.local.endpointDraft);
    ui.render(model);
  }
  applyMotion();
  window.scrollTo(0, 0);
  document.documentElement.dataset.scenario = scenario.id;
  document.documentElement.dataset.variant = selectedVariant;
  return snapshot();
}

const replayActions = {
  G03: 'sign-in', G04: 'sign-out', G07: 'select-site', G08: 'reconnect-realtime', G09: 'open-app-settings', G10: 'sign-in',
  P03: 'open-weather', P04: 'command-capability-toggle', P05: 'disconnect-ble', P07: 'choose-add-path',
  P08: 'request-ble', P09: 'connect-ble', P10: 'discover-lan', P11: 'claim-lan', P12: 'select-site',
  P13: 'choose-endpoint-route', P14: 'test-endpoint', P15: 'refresh-weather', P16: 'update-weather-location',
  P17: 'save-manual-weather-location', P18: 'refresh-weather', P19: 'pull-refresh',
  C01: 'test-endpoint', C02: 'command-capability-toggle', C03: 'save-manual-weather-location', C07: 'cancel-claim',
  C08: 'choose-endpoint-route', C10: 'refresh-weather', C11: 'command-capability-toggle'
};

function run() {
  if (current.id === 'C06') { ui.notify('合成提示：操作结果保留在场景状态中。'); return { replayed: true, synthetic: true }; }
  if (current.id === 'G05') {
    ui.navigate(ui.local.screen === 'devices' ? 'activity' : 'devices', { kind: 'peer' });
    ui.render(model);
    return { replayed: true, synthetic: true };
  }
  const action = replayActions[current.id];
  const button = [...document.querySelectorAll(`#app [data-action="${action}"]`)]
    .find((item) => !item.disabled && item.getAttribute('aria-disabled') !== 'true');
  if (button) { button.click(); return { replayed: true, action, synthetic: true }; }
  return { replayed: false, synthetic: true, message: '此变体是静态/平台交接状态；可切换变体或直接操作 App。' };
}

function snapshot() {
  return { current: { ...current }, configuration: { ...configuration }, screen: ui?.local.screen,
    sceneCount: MOTION_SCENARIOS.length, model: structuredClone(model),
    simulator: simulator?.snapshot(), blockedAttempts: [...blockedAttempts], disposed };
}

window.__motionFixture = {
  select: mount,
  reset: () => mount(current.id, current.variant),
  configure(next = {}) {
    configuration = { ...configuration, ...next, motion: next.motion === 'reduce' ? 'reduce' : next.motion === 'normal' ? 'normal' : configuration.motion };
    simulator.configure(configuration);
    configuration = { ...configuration, ...simulator.snapshot().configuration };
    applyMotion();
    return snapshot();
  },
  run,
  snapshot,
  // Tests may dispatch realistic input events or inspect state; no arbitrary real adapter injection.
  manifest: MOTION_SCENARIOS
};
window.addEventListener('pagehide', () => { disposed = true; simulator?.dispose(); ui?.destroy(); });
mount('G01', 'ready');
window.parent.postMessage({ type: 'iot-motion-preview-ready' }, window.location.origin);
