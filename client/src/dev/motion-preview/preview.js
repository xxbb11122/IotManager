import { MOTION_SCENARIOS, scenarioById } from './scenarios.js';

const root = document.getElementById('motion-preview');
root.innerHTML = `<header class="preview-heading"><p class="preview-kicker">IOT MANAGER · DEVELOPMENT ONLY</p><h1>全 App 动效场景工作台</h1><p>42 个场景 · 9 个真实 ClientUi 页面 · 仅合成演示数据</p><p class="preview-safety">没有真实网络、WebSocket、蓝牙、定位或登录操作。平台动画与 PDA 实测不在本预览的通过结论中。</p></header>
<section class="preview-controls" aria-label="合成场景控制">
<label>场景<select id="preview-scene"></select></label>
<label>状态变体<select id="preview-variant"></select></label>
<label>动效策略<select id="preview-motion"><option value="normal">正常（遵循系统设置）</option><option value="reduce">减少动态效果</option></select></label>
<label>合成任务结果<select id="preview-outcome"><option value="success">成功 / ACK</option><option value="failed">明确失败</option><option value="unconfirmed">命令结果未知</option><option value="partial">非命令部分成功</option></select></label>
<label>合成延迟<select id="preview-delay"><option value="0">0 ms</option><option value="800" selected>800 ms</option><option value="3000">3 秒</option><option value="10000">10 秒（打断测试）</option></select></label>
<label>视口预设<select id="preview-viewport"><option value="390">手机 · 390</option><option value="320">窄屏 · 320</option><option value="768">横屏布局 · 768</option><option value="1280">桌面 · 1280</option></select></label>
<div class="preview-buttons"><button id="preview-run" type="button">重放主要交互</button><button id="preview-reset" type="button">重置当前场景</button></div></section>
<section class="preview-notes" aria-live="polite"><h2 id="preview-title"></h2><p id="preview-expectation"></p><p id="preview-boundary"></p><output id="preview-status">正在初始化合成 UI…</output></section>
<div class="preview-stage"><iframe id="preview-app" title="IoT Manager 合成 App 场景" src="/__motion/frame/" width="390" height="860" allow="geolocation 'none'; camera 'none'; microphone 'none'"></iframe></div>
<details class="preview-ledger"><summary>场景登记表与验证边界（42 项）</summary><ul id="preview-manifest"></ul><p>编号齐全只证明场景登记可访问。每个变体、交叉场景与真实平台验收仍须按开发验收工作表逐项留证。</p></details>`;

const get = (id) => document.getElementById(`preview-${id}`);
const frame = get('app');
const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
MOTION_SCENARIOS.forEach((scene) => {
  get('scene').append(option(scene.id, `${scene.id} · ${scene.title}`));
  const row = document.createElement('li');
  row.dataset.scenarioId = scene.id;
  row.textContent = `${scene.id} ${scene.title} — ${scene.screen} / ${scene.variants.join(', ')} — ${scene.boundary}`;
  get('manifest').append(row);
});

const api = () => frame.contentWindow?.__motionFixture;
function report(result) {
  const snapshot = api()?.snapshot();
  if (!snapshot) return;
  const message = result?.message ? `${result.message} ` : '';
  get('status').textContent = `${message}当前 ${snapshot.current.id}/${snapshot.current.variant}；合成意图 ${snapshot.simulator.calls.length} 次；待完成定时器 ${snapshot.simulator.pendingTimers}；被阻止外部操作 ${snapshot.blockedAttempts.length} 次。`;
}
function configure(next = {}) {
  const result = api()?.configure({ delayMs: Number(get('delay').value), outcome: get('outcome').value, motion: get('motion').value, ...next });
  report(result);
  return result;
}
function select(id, variant) {
  const scene = scenarioById(id);
  get('scene').value = scene.id;
  get('variant').replaceChildren(...scene.variants.map((value) => option(value, value)));
  get('variant').value = variant && scene.variants.includes(variant) ? variant : scene.variants[0];
  get('title').textContent = `${scene.id} · ${scene.title}`;
  get('expectation').textContent = scene.expectation;
  get('boundary').textContent = scene.boundary;
  const result = api()?.select(scene.id, get('variant').value);
  configure();
  report(result);
  return result;
}
get('scene').addEventListener('change', () => select(get('scene').value));
get('variant').addEventListener('change', () => select(get('scene').value, get('variant').value));
['motion', 'outcome', 'delay'].forEach((key) => get(key).addEventListener('change', () => configure()));
get('viewport').addEventListener('change', () => { frame.width = get('viewport').value; });
get('run').addEventListener('click', () => report(api()?.run()));
get('reset').addEventListener('click', () => report(api()?.reset()));
frame.addEventListener('load', () => { select(get('scene').value || 'G01', get('variant').value || undefined); });
window.addEventListener('message', (event) => {
  if (event.origin === window.location.origin && event.source === frame.contentWindow && event.data?.type === 'iot-motion-preview-update') report();
  if (event.origin === window.location.origin && event.source === frame.contentWindow && event.data?.type === 'iot-motion-preview-ready') {
    select('G01', 'ready');
    document.documentElement.dataset.previewReady = 'true';
  }
});
window.__motionPreview = { select, configure, run: () => { const result = api()?.run(); report(result); return result; }, reset: () => { const result = api()?.reset(); report(result); return result; }, snapshot: () => api()?.snapshot(), manifest: MOTION_SCENARIOS };
select('G01', 'ready');
