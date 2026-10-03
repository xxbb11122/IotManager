import './css/style.css';
import './css/ai.css';
import './css/glass.css';
import './css/demo.css';
import { createClientUi } from './framework/ui.js';
import { createAiController } from './framework/ai/ai-controller.js';
import { resolveAiQuickPrompt } from './framework/ai/ai-quick-prompts.js';
import { createDemoStore } from './demo-store.js';
import { createMockAi } from './mock-ai.js';
import { createLiquidGlassDemo } from './liquid-glass.js';

const store = createDemoStore();
const recoveryData = new Map();
const recovery = {
  async get(key) { return structuredClone(recoveryData.get(key) ?? null); },
  async put(key, value) { recoveryData.set(key, structuredClone(value)); },
  async remove(key) { recoveryData.delete(key); },
  async clear() { recoveryData.clear(); }
};
let ui;
let liquidDemo;
const mockAi = createMockAi({ getModel: store.getModel, note: store.noteAi });
const ai = createAiController({
  contextProvider: () => {
    const model = store.getModel();
    return { api: mockAi.api, siteId: model.context.siteId, endpoint: model.endpointProfile,
      organization: model.context.organizationCode, auth: model.auth };
  },
  recovery,
  onChange(state) {
    if (state.notice === '站点知识库暂未启用；设备状态仅作只读解释。')
      state.notice = '本地模拟助手 · 回答使用固定规则与模拟快照，不执行设备命令。';
    store.setAi(state);
  }
});
function aiQuickPrompt({ id }) {
  const item = resolveAiQuickPrompt(ai.getState(), id);
  if (!item) return null;
  ai.setDraft(item.prompt);
  return item.prompt;
}
async function aiAction({ action, id }) {
  switch (action) {
    case 'ai-send': return ai.send();
    case 'ai-new': return ai.newConversation();
    case 'ai-cancel': return ai.cancelWait();
    case 'ai-recover': return ai.recover();
    case 'ai-retry': return ai.retry();
    case 'ai-reload': return ai.reload();
    case 'ai-history-more': return ai.loadHistory(true);
    case 'ai-messages-more': return ai.loadMessages(true);
    case 'ai-select': await ai.selectConversation(id); ui.navigate('ai'); ui.render(store.getModel()); return;
    case 'ai-delete': return ai.deleteConversation(id);
    case 'ai-persona-save': return ai.savePersona();
    case 'ai-persona-activate': return ai.activatePersona(Number(id));
    case 'ai-copy': {
      const row = ai.getState().messages.find(value => value.id === id);
      if (row) { await navigator.clipboard.writeText(row.content); ui.notify('模拟回答已复制', 'success'); }
      return;
    }
  }
}
ui = createClientUi(document.getElementById('app'), {
  openDevice: ({ deviceId }) => store.setActiveDevice(deviceId),
  sendCommand: payload => store.sendCommand(payload),
  retryCommand: ({ commandId }) => {
    const command = store.getModel().commandsById[commandId];
    if (command?.status === 'FAILED') return store.sendCommand(command);
  },
  switchSite: async payload => {
    await store.switchSite(payload);
    ui.navigate('devices', { kind: 'replace' }); ui.render(store.getModel());
    await ai.syncContext();
  },
  pullRefresh: () => store.refresh(),
  reconnectRealtime: () => store.reconnect(),
  discoverLan: () => store.discoverLan(),
  claimLan: payload => store.claimLan(payload),
  requestBle: () => store.requestBle(),
  connectBle: () => store.connectBle(),
  disconnectBle: payload => store.disconnectBle(payload),
  forgetBle: payload => store.forgetBle(payload),
  setDemoRoute: ({ route }) => store.setRoute(route),
  signIn: async () => { store.setAuthenticated(true); await ai.syncContext(); },
  signOut: async () => { store.setAuthenticated(false); await ai.syncContext(); },
  aiQuickPrompt,
  aiInput: ({ field, value }) => {
    if (field === 'ai-question') ai.setDraft(value);
    else if (field === 'ai-persona-name') ai.setPersonaDraft('name', value);
    else if (field === 'ai-persona-instructions') ai.setPersonaDraft('instructions', value);
  },
  aiAction,
  screenChanged: screen => { void ai.setScreen(screen); },
  openWeather: () => store.refresh(),
  refreshWeather: () => store.refresh(),
  updateWeatherFromDeviceLocation: () => store.updateWeatherLocation({ latitude: 31.2, longitude: 121.4, timezone: 'Asia/Shanghai', locationSource: 'DEMO' }),
  updateWeatherFromManualLocation: payload => store.updateWeatherLocation(payload)
});
const panel = document.getElementById('demo-panel');
function renderPanel() {
  const { stats, events, settings } = store.getDiagnostics();
  document.getElementById('demo-command-count').textContent = stats.commandSubmits;
  document.getElementById('demo-ai-count').textContent = stats.aiSends;
  document.getElementById('demo-ai-query-count').textContent = stats.aiQueries;
  document.getElementById('demo-scenario').value = settings.scenario;
  const log = document.getElementById('demo-events');
  log.replaceChildren(...events.slice(0, 12).map(row => {
    const item = document.createElement('p');
    const time = document.createElement('time'); time.dateTime = row.timestamp;
    time.textContent = new Date(row.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    const text = document.createElement('span'); text.textContent = row.message;
    item.append(time, text); return item;
  }));
}
store.subscribe((model, hint) => {
  if (hint === 'ai') { if (!ui.patchAi(model)) ui.render(model); }
  else if (hint !== 'panel') ui.render(model);
  renderPanel();
});
function closePanel() { panel.close(); }
document.getElementById('open-demo-panel').addEventListener('click', () => { renderPanel(); panel.showModal(); });
document.getElementById('close-demo-panel').addEventListener('click', closePanel);
document.getElementById('demo-return').addEventListener('click', closePanel);
panel.addEventListener('click', event => { if (event.target === panel) { const box = panel.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closePanel(); } });
document.getElementById('demo-scenario').addEventListener('change', event => store.setScenario(event.target.value));
document.getElementById('demo-outcome').addEventListener('change', event => store.setOutcome(event.target.value));
document.getElementById('demo-delay').addEventListener('change', event => store.setDelay(event.target.value));
document.getElementById('demo-ai-mode').addEventListener('change', event => mockAi.setMode(event.target.value));
document.getElementById('demo-text-scale').addEventListener('change', event => { document.documentElement.style.fontSize = event.target.value + '%'; });
document.getElementById('demo-safe-area').addEventListener('change', event => {
  for (const [edge, value] of Object.entries({ top: 24, bottom: 20, left: 12, right: 12 })) {
    if (event.target.value === '1') document.documentElement.style.setProperty('--safe-area-inset-' + edge, value + 'px');
    else document.documentElement.style.removeProperty('--safe-area-inset-' + edge);
  }
});
async function resetDemo() {
  ai.reset(); mockAi.reset(); recoveryData.clear(); store.reset(); store.setDelay(1200);
  document.getElementById('demo-outcome').value = 'ack'; document.getElementById('demo-delay').value = '1200';
  document.getElementById('demo-ai-mode').value = 'reply'; document.getElementById('demo-text-scale').value = '100';
  document.getElementById('demo-safe-area').value = '0'; document.documentElement.style.fontSize = '';
  for (const edge of ['top', 'bottom', 'left', 'right']) document.documentElement.style.removeProperty('--safe-area-inset-' + edge);
  ui.root.dataset.material = 'auto'; ui.setMotionDegraded(false); ui.navigate('devices', { kind: 'replace' }); ui.render(store.getModel());
  liquidDemo.reset();
  await ai.syncContext(); renderPanel();
}
document.getElementById('demo-reset').addEventListener('click', () => { void resetDemo(); });
document.getElementById('demo-export').addEventListener('click', () => {
  const result = { demoVersion: '1.2.0', exportedAt: new Date().toISOString(),
    ...store.getDiagnostics(), aiMode: mockAi.getMode(), material: ui.root.dataset.material, glass: ui.root.dataset.glass,
    viewport: { width: innerWidth, height: innerHeight }, textScale: document.documentElement.style.fontSize || '100%' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'glass-demo-test-record.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => ai.setForeground(!document.hidden));
window.addEventListener('pagehide', () => { liquidDemo.destroy(); ai.destroy(); ui.destroy(); store.destroy(); }, { once: true });
// Explicit test entry only; the normal page exposes no controller globals.
if (new URLSearchParams(location.search).has('test')) {
  globalThis.__glassDemo = Object.freeze({ store, ai, ui, mockAi, reset: resetDemo });
}
ui.render(store.getModel()); renderPanel(); void ai.syncContext();
liquidDemo = createLiquidGlassDemo(ui.root);
ui.root.addEventListener('glass-material-change', () => ui.render(store.getModel()));
