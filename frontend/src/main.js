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
let weather = null;
let weatherForecast = null;
let weatherLoadError = false;
const SITE_CODE = 'demo-site';

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
  await loadWeather();
  await loadAlerts();
}

async function loadWeather() {
  try {
    const [weatherData, forecastData] = await Promise.all([
      api(`/api/sites/${SITE_CODE}/weather`),
      api(`/api/sites/${SITE_CODE}/weather/forecast?hours=24&days=7`)
    ]);
    weather = weatherData;
    weatherForecast = forecastData;
    weatherLoadError = false;
  } catch (error) {
    // Weather is supplementary information. A provider/API outage must never blank the device console.
    console.warn('加载天气失败:', error);
    weather = null;
    weatherForecast = null;
    weatherLoadError = true;
  }
  renderWeather();
}

function environmentTone(indicator) {
  return ({ SUITABLE: 'green', OBSERVE: 'amber', RISK: 'red' })[String(indicator?.level || '').toUpperCase()] || 'neutral';
}

function weatherNumber(value, unit) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const numeric = Number(value);
  return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(1)}${unit}`;
}

function weatherDate(value, daily = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return daily
    ? date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function weatherStatus(status) {
  return ({ FRESH: '天气已更新', STALE: '天气数据待更新', EXPIRED: '天气数据已过期', PENDING: '天气已配置，等待首次同步', UNAVAILABLE: '天气未配置' })[status] || '天气加载中';
}

function renderWeather() {
  const panel = document.getElementById('weather-panel');
  if (!panel) return;
  const current = weather?.current;
  if (!current) {
    panel.className = 'weather-panel weather-panel--unavailable';
    document.getElementById('weather-condition').textContent = weatherLoadError ? '天气服务暂不可用' : weatherStatus(weather?.status);
    document.getElementById('weather-temperature').textContent = '--';
    document.getElementById('weather-updated').textContent = weatherLoadError
      ? '天气接口暂时不可用，设备状态和控制不受影响。'
      : weather?.status === 'PENDING'
        ? '站点已配置，等待首次成功同步天气数据。'
        : '尚未为该站点配置天气数据，设备状态不受影响。';
    document.getElementById('weather-indicators').innerHTML = '';
    return;
  }
  panel.className = `weather-panel weather-panel--${String(weather?.status || '').toLowerCase()}`;
  document.getElementById('weather-condition').textContent = current.conditionText || '未知天气';
  document.getElementById('weather-temperature').textContent = weatherNumber(current.temperatureC, '°C');
  document.getElementById('weather-updated').textContent = `${weatherStatus(weather?.status)} · ${weather?.fetchedAt ? new Date(weather.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '等待更新'}`;
  const metric = (id, value, indicator) => {
    const element = document.getElementById(id);
    element.className = `weather-top-metric weather-top-metric--${environmentTone(indicator)}`;
    element.querySelector('strong').textContent = value;
  };
  metric('weather-humidity', weatherNumber(current.relativeHumidityPct, '%'), weather?.indicators?.humidity);
  metric('weather-pressure', weatherNumber(current.surfacePressureHpa, ' hPa'), weather?.indicators?.pressure);
  document.getElementById('weather-elevation').querySelector('strong').textContent = weatherNumber(current.elevationM, ' m');
  const indicators = [
    ['温度', weather?.indicators?.temperature], ['湿度', weather?.indicators?.humidity],
    ['气压', weather?.indicators?.pressure], ['ESD', weather?.indicators?.esdRisk], ['结露', weather?.indicators?.condensationRisk]
  ];
  document.getElementById('weather-indicators').innerHTML = indicators.map(([label, indicator]) => `
    <div class="weather-indicator weather-indicator--${environmentTone(indicator)}"><span>${label}</span><strong>${indicator?.label || '待评估'}</strong><small>${indicator?.reason || '暂无数据'}</small></div>
  `).join('');
  document.getElementById('weather-hourly').innerHTML = (weatherForecast?.hourly || []).map((point) => `
    <div class="weather-hour"><span>${weatherDate(point.forecastAt)}</span><strong>${weatherNumber(point.temperatureC, '°')}</strong><small>${point.conditionText || '未知'} · ${point.precipitationProbabilityPct ?? '--'}%</small></div>
  `).join('') || '<span class="muted">预报数据将在下一次天气刷新后可用</span>';
  document.getElementById('weather-daily').innerHTML = (weatherForecast?.daily || []).map((point) => `
    <div class="weather-day"><span>${weatherDate(point.forecastAt, true)}</span><span>${point.conditionText || '未知'}</span><strong>${weatherNumber(point.temperatureMaxC, '°')} / ${weatherNumber(point.temperatureMinC, '°')}</strong></div>
  `).join('') || '<span class="muted">预报数据将在下一次天气刷新后可用</span>';
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
wsService.on('weather_update', (payload) => {
  if (payload?.siteCode !== SITE_CODE) return;
  weather = payload;
  weatherLoadError = false;
  renderWeather();
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
