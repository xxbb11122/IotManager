import './css/style.css';
import { api } from './js/api.js';
import { wsService } from './js/websocket.js';
import { renderDevices, renderAlerts, renderStats, applyFilter } from './js/device-list.js';
import { loadCharts } from './js/charts.js';

/* ── State ── */
let devices = [];
let currentFilter = 'all';
let currentTypeFilter = null;
let searchQuery = '';

/* ── Clock ── */
function updateClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}

/* ── Load all data ── */
async function loadAll() {
  try {
    const [deviceList, statsData] = await Promise.all([
      api('/api/devices'),
      api('/api/devices/stats')
    ]);
    devices = deviceList;
    renderStats(statsData);
    renderFiltered();
    loadCharts(deviceList);
  } catch (e) {
    console.error('加载设备失败:', e);
    const tbody = document.getElementById('device-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9"><div class="empty">加载失败 — 请确认后端已启动 (http://localhost:8080)</div></td></tr>';
  }
  try {
    const alerts = await api('/api/alerts/active');
    renderAlerts(alerts);
  } catch (e) { /* ignore */ }
}

function renderFiltered() {
  const filtered = applyFilter(devices, currentFilter, currentTypeFilter, searchQuery);
  renderDevices(filtered);
}

/* ── WebSocket ── */
wsService.on('device_update', (payload) => {
  const idx = devices.findIndex(d => d.deviceId === payload.deviceId);
  if (idx >= 0) Object.assign(devices[idx], payload);
  else devices.push(payload);
  renderFiltered();
  loadCharts(devices);
  loadAll(); // refresh stats & alerts
});

wsService.on('device_updates', (updates) => {
  updates.forEach(upd => {
    const idx = devices.findIndex(d => d.deviceId === upd.deviceId);
    if (idx >= 0) Object.assign(devices[idx], upd);
  });
  renderFiltered();
  loadCharts(devices);
  loadAll();
});

wsService.on('connected', loadAll);

/* ── Sidebar ── */
document.querySelectorAll('.sidebar-item[data-filter]').forEach(el => {
  el.addEventListener('click', () => {
    currentFilter = el.dataset.filter;
    currentTypeFilter = null;
    document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    renderFiltered();
  });
});
document.querySelectorAll('.sidebar-item[data-filter-type]').forEach(el => {
  el.addEventListener('click', () => {
    currentTypeFilter = el.dataset.filterType;
    currentFilter = 'all';
    document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    renderFiltered();
  });
});

/* ── Search ── */
document.getElementById('device-search')?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderFiltered();
});

/* ── Resolve alert (delegated) ── */
document.getElementById('alerts-container')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-resolve');
  if (!btn) return;
  const id = btn.dataset.id;
  try {
    await api('/api/alerts/' + id + '/resolve', { method: 'PUT' });
    loadAll();
  } catch (err) {
    console.error('解决告警失败', err);
  }
});

/* ── Refresh alerts when custom event fires ── */
window.addEventListener('refresh-alerts', async () => {
  try {
    const alerts = await api('/api/alerts/active');
    renderAlerts(alerts);
  } catch (e) { /* ignore */ }
});

/* ── Init ── */
updateClock();
setInterval(updateClock, 1000);
wsService.connect();
setInterval(loadAll, 30000); // fallback
