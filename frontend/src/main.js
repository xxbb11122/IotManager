import './css/style.css';
import { api } from './js/api.js';
import { wsService } from './js/websocket.js';
import { renderDevices, renderAlerts, renderStats, applyFilter, patchDevice } from './js/device-list.js';
import { loadCharts } from './js/charts.js';

/* ── State ── */
let devices = [];
let currentFilter = 'all';
let currentTypeFilter = null;
let searchQuery = '';
let alertRefreshTimer = null;

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
    loadCharts(deviceList, { recordTrend: true });
  } catch (e) {
    console.error('加载设备失败:', e);
    const tbody = document.getElementById('device-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9"><div class="empty">加载失败 — 请确认后端已启动 (http://localhost:8080)</div></td></tr>';
  }
  await loadAlerts();
}

async function loadAlerts() {
  try {
    const alerts = await api('/api/alerts/active');
    renderAlerts(alerts);
  } catch (e) { /* An alert refresh must not replace a healthy device view. */ }
}

function renderFiltered() {
  const filtered = applyFilter(devices, currentFilter, currentTypeFilter, searchQuery);
  renderDevices(filtered);
}

function localStats() {
  const stats = { total: devices.length, online: 0, offline: 0, warning: 0, typeBreakdown: {} };
  for (const device of devices) {
    const status = String(device.status || '').toUpperCase();
    if (status === 'ONLINE') stats.online += 1;
    if (status === 'OFFLINE') stats.offline += 1;
    if (status === 'WARNING') stats.warning += 1;
    const type = device.type || 'UNKNOWN';
    stats.typeBreakdown[type] = (stats.typeBreakdown[type] || 0) + 1;
  }
  return stats;
}

function mergeRealtimeDevices(updates) {
  const changed = [];
  for (const update of updates) {
    if (!update?.deviceId) continue;
    const index = devices.findIndex((device) => device.deviceId === update.deviceId);
    const merged = index >= 0 ? { ...devices[index], ...update } : update;
    if (index >= 0) devices[index] = merged;
    else devices.unshift(merged);
    changed.push(merged);
  }
  if (!changed.length) return;
  const visible = applyFilter(devices, currentFilter, currentTypeFilter, searchQuery);
  for (const device of changed) {
    patchDevice(device, visible.some((item) => item.deviceId === device.deviceId));
  }
  renderStats(localStats());
  loadCharts(devices);
}

function removeRealtimeDevice(payload) {
  if (!payload?.deviceId) return;
  const index = devices.findIndex((device) => device.deviceId === payload.deviceId);
  if (index < 0) return;
  const [removed] = devices.splice(index, 1);
  patchDevice(removed, false);
  renderStats(localStats());
  loadCharts(devices);
}

function scheduleAlertRefresh() {
  if (alertRefreshTimer) window.clearTimeout(alertRefreshTimer);
  alertRefreshTimer = window.setTimeout(() => {
    alertRefreshTimer = null;
    void loadAlerts();
  }, 250);
}

/* ── WebSocket ── */
wsService.on('device_update', (payload) => {
  mergeRealtimeDevices([payload]);
});

wsService.on('device_updates', (updates) => {
  mergeRealtimeDevices(updates || []);
});

wsService.on('device_archived', removeRealtimeDevice);

wsService.on('alert', scheduleAlertRefresh);
wsService.on('alert_update', scheduleAlertRefresh);

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
    await loadAlerts();
  } catch (err) {
    console.error('解决告警失败', err);
  }
});

/* ── Refresh alerts when custom event fires ── */
window.addEventListener('refresh-alerts', async () => {
  await loadAlerts();
});

/* ── Init ── */
updateClock();
setInterval(updateClock, 1000);
wsService.connect();
setInterval(() => {
  // Reconcile from REST only while realtime is unavailable; connected clients
  // already receive committed device, command, and alert events.
  if (!wsService.isConnected()) void loadAll();
}, 30000);
