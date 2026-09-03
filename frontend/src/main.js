import './css/style.css';
import { api, configureApiAuthentication } from './js/api.js';
import { wsService } from './js/websocket.js';
import { renderDevices, renderAlerts, renderStats, applyFilter, patchDevice } from './js/device-list.js';
import { loadCharts } from './js/charts.js';
import { createRenderMetrics } from './js/render-metrics.js';
import { BrowserOidcSession, resolveBrowserOidcConfig } from '../../shared/browser-oidc.js';

/* ── State ── */
let devices = [];
let currentFilter = 'all';
let currentTypeFilter = null;
let searchQuery = '';
let alertRefreshTimer = null;
let weather = null;
let weatherForecast = null;
let weatherLoadError = false;
let initialLoadComplete = false;
let reconcilePromise = null;
let lastReconcileAt = 0;
let lastFallbackAt = 0;
let hiddenRealtimeDirty = false;
let hiddenReconcilePending = false;
const LONG_DISCONNECT_MS = 10_000;
const RECONCILE_MIN_INTERVAL_MS = 30_000;
const FALLBACK_MIN_INTERVAL_MS = 30_000;
const metrics = createRenderMetrics();
let currentSite = {
  siteCode: 'demo-site',
  siteName: '演示站点',
  organizationCode: 'demo-org',
  organizationName: '演示组织'
};
const SITE_STORAGE_KEY = 'iot-manager.console-site.v1';

const browserAuth = new BrowserOidcSession({
  config: resolveBrowserOidcConfig(),
  onStateChange: (authState) => {
    updateAuthenticationUi(authState);
    if (authState.configured && !authState.authenticated) wsService.disconnect();
  }
});

function updateAuthenticationUi(authState = browserAuth.getState()) {
  const button = document.getElementById('auth-action');
  if (!button) return;
  button.hidden = !authState.configured;
  button.textContent = authState.authenticated ? '退出登录' : '登录';
  button.disabled = false;
}

async function initializeAuthentication() {
  if (!browserAuth.isConfigured()) {
    updateAuthenticationUi(browserAuth.getState());
    return true;
  }
  configureApiAuthentication({
    tokenProvider: () => browserAuth.getAccessToken(),
    onUnauthorized: () => browserAuth.tryRefresh()
  });
  wsService.setAccessTokenProvider(() => browserAuth.getAccessToken());
  // An HTTPS deployment has OIDC configured, but the dashboard deliberately
  // keeps a visible, user-initiated login action. This also leaves a stable
  // signed-out state after logout instead of immediately redirecting again.
  const authState = await browserAuth.initialize({ redirectIfUnauthenticated: false });
  updateAuthenticationUi(authState);
  return authState.authenticated;
}

/* ── Clock ── */
function updateClock() {
  if (document.visibilityState === 'hidden') return;
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}

/* ── Load all data ── */
async function loadAll({ includeWeather = true } = {}) {
  try {
    const [deviceList, statsData] = await Promise.all([
      api(`/api/devices?siteCode=${encodeURIComponent(currentSite.siteCode)}`),
      api(`/api/devices/stats?siteCode=${encodeURIComponent(currentSite.siteCode)}`)
    ]);
    devices = deviceList;
    renderStats(statsData);
    renderFiltered();
    loadCharts(deviceList, { recordTrend: true, force: true });
  } catch (e) {
    console.error('加载设备失败:', e);
    const tbody = document.getElementById('device-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9"><div class="empty">加载失败 — 请确认后端已启动 (http://localhost:8080)</div></td></tr>';
  }
  // Weather has its own server-side refresh cadence and WebSocket update.
  // Device fallback reconciliation runs much more often when realtime is
  // disconnected, so it must not turn into a weather polling loop.
  if (includeWeather) await loadWeather();
  await loadAlerts();
}

async function loadWeather() {
  try {
    const [weatherData, forecastData] = await Promise.all([
      api(`/api/sites/${encodeURIComponent(currentSite.siteCode)}/weather`),
      api(`/api/sites/${encodeURIComponent(currentSite.siteCode)}/weather/forecast?hours=24&days=7`)
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
  if (loadAlerts.inFlight) return loadAlerts.inFlight;
  loadAlerts.inFlight = (async () => {
  try {
    const alerts = await api(`/api/alerts/active?siteCode=${encodeURIComponent(currentSite.siteCode)}`);
    renderAlerts(alerts);
  } catch (e) { /* An alert refresh must not replace a healthy device view. */ }
  finally { loadAlerts.inFlight = null; }
  })();
  return loadAlerts.inFlight;
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
    if (update.siteCode && String(update.siteCode) !== String(currentSite.siteCode)) continue;
    const index = devices.findIndex((device) => device.deviceId === update.deviceId);
    const merged = index >= 0 ? { ...devices[index], ...update } : update;
    if (index >= 0) devices[index] = merged;
    else devices.unshift(merged);
    changed.push(merged);
  }
  if (!changed.length) return;
  if (document.visibilityState === 'hidden') {
    hiddenRealtimeDirty = true;
    return;
  }
  const visible = applyFilter(devices, currentFilter, currentTypeFilter, searchQuery);
  for (const device of changed) {
    patchDevice(device, visible.some((item) => item.deviceId === device.deviceId));
    metrics.increment('devicePatchCount');
  }
  renderStats(localStats());
  loadCharts(devices);
  metrics.increment('chartPatchCount');
}

function removeRealtimeDevice(payload) {
  if (!payload?.deviceId) return;
  if (payload.siteCode && String(payload.siteCode) !== String(currentSite.siteCode)) return;
  const index = devices.findIndex((device) => device.deviceId === payload.deviceId);
  if (index < 0) return;
  const [removed] = devices.splice(index, 1);
  if (document.visibilityState === 'hidden') {
    hiddenRealtimeDirty = true;
    return;
  }
  patchDevice(removed, false);
  metrics.increment('devicePatchCount');
  renderStats(localStats());
  loadCharts(devices);
  metrics.increment('chartPatchCount');
}

function scheduleAlertRefresh() {
  if (document.visibilityState === 'hidden') {
    hiddenRealtimeDirty = true;
    return;
  }
  if (alertRefreshTimer) window.clearTimeout(alertRefreshTimer);
  alertRefreshTimer = window.setTimeout(() => {
    alertRefreshTimer = null;
    void loadAlerts().then(() => metrics.increment('alertPatchCount'));
  }, 250);
}

async function reconcileFromRest({ includeWeather = false, reason = 'fallback' } = {}) {
  const now = Date.now();
  if (reconcilePromise || now - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) return reconcilePromise;
  lastReconcileAt = now;
  metrics.increment('restReconcileCount');
  reconcilePromise = loadAll({ includeWeather })
    .catch((error) => console.warn(`实时${reason}对账失败:`, error))
    .finally(() => { reconcilePromise = null; });
  return reconcilePromise;
}

function flushVisibleRealtime() {
  if (!hiddenRealtimeDirty) return;
  hiddenRealtimeDirty = false;
  renderStats(localStats());
  renderFiltered();
  loadCharts(devices, { force: true });
  renderWeather();
  scheduleAlertRefresh();
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
  if (payload?.siteCode !== currentSite.siteCode) return;
  weather = payload;
  weatherLoadError = false;
  if (document.visibilityState === 'hidden') {
    hiddenRealtimeDirty = true;
    return;
  }
  renderWeather();
  metrics.increment('weatherPatchCount');
});

wsService.on('connected', (connection = {}) => {
  metrics.increment('wsConnectCount');
  if (connection.reconnected) metrics.increment('wsReconnectCount');
  if (!initialLoadComplete || !connection.reconnected || connection.disconnectedForMs < LONG_DISCONNECT_MS) return;
  if (document.visibilityState === 'hidden') {
    hiddenReconcilePending = true;
    return;
  }
  void reconcileFromRest({ includeWeather: false, reason: 'long_disconnect' });
});

wsService.on('disconnected', () => {
  metrics.increment('wsDisconnectCount');
  if (document.visibilityState === 'hidden') hiddenReconcilePending = true;
});

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

function updateSiteUi() {
  const selector = document.getElementById('site-selector');
  if (selector) selector.value = currentSite.siteCode;
  const label = document.getElementById('site-label');
  if (label) label.textContent = currentSite.siteName || currentSite.siteCode;
}

async function selectSite(site, { reload = true } = {}) {
  if (!site?.siteCode) return;
  currentSite = {
    siteCode: String(site.siteCode),
    siteName: String(site.siteName || site.siteCode),
    organizationCode: site.organizationCode || currentSite.organizationCode,
    organizationName: site.organizationName || currentSite.organizationName
  };
  try {
    localStorage.setItem(SITE_STORAGE_KEY, JSON.stringify({ siteCode: currentSite.siteCode }));
  } catch { /* optional browser persistence */ }
  wsService.setSiteCode(currentSite.siteCode);
  updateSiteUi();
  if (!reload) return;
  devices = [];
  weather = null;
  weatherForecast = null;
  weatherLoadError = false;
  renderStats(localStats());
  renderFiltered();
  renderWeather();
  renderAlerts([]);
  wsService.disconnect();
  await loadAll({ includeWeather: true });
  wsService.connect();
}

async function loadSites() {
  const selector = document.getElementById('site-selector');
  try {
    const sites = await api('/api/v1/sites');
    if (!Array.isArray(sites) || sites.length === 0) throw new Error('No accessible sites');
    let savedCode = null;
    try { savedCode = JSON.parse(localStorage.getItem(SITE_STORAGE_KEY) || 'null')?.siteCode; } catch { /* ignore */ }
    const selected = sites.find((site) => String(site.siteCode) === String(savedCode))
      || sites.find((site) => String(site.siteCode) === String(currentSite.siteCode))
      || sites[0];
    if (selector) {
      selector.replaceChildren(...sites.map((site) => {
        const option = document.createElement('option');
        option.value = site.siteCode;
        option.textContent = `${site.organizationName || site.organizationCode || ''} / ${site.siteName || site.siteCode}`;
        return option;
      }));
      selector.disabled = false;
    }
    await selectSite(selected, { reload: false });
  } catch (error) {
    if (selector) selector.disabled = false;
    wsService.setSiteCode(currentSite.siteCode);
    updateSiteUi();
    console.warn('站点列表加载失败:', error);
  }
}

document.getElementById('site-selector')?.addEventListener('change', async (event) => {
  const siteCode = event.target.value;
  try {
    const option = event.target.selectedOptions?.[0];
    await selectSite({ siteCode, siteName: option?.textContent?.split(' / ').pop() || siteCode });
  } catch (error) {
    console.error('切换站点失败:', error);
    updateSiteUi();
  }
});

document.getElementById('auth-action')?.addEventListener('click', async () => {
  const authState = browserAuth.getState();
  if (!authState.configured) return;
  const button = document.getElementById('auth-action');
  if (button) button.disabled = true;
  try {
    if (authState.authenticated) await browserAuth.logout();
    else await browserAuth.beginLogin();
  } catch (error) {
    if (button) button.disabled = false;
    console.error('OIDC authentication action failed:', error);
  }
});

/* ── Init ── */
updateClock();
setInterval(updateClock, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return;
  flushVisibleRealtime();
  if (hiddenReconcilePending) {
    hiddenReconcilePending = false;
    void reconcileFromRest({ includeWeather: false, reason: 'visibility_resume' });
  }
});
if (import.meta.env.DEV) {
  globalThis.__iotMonitoringUiMetrics = () => metrics.snapshot();
}
void (async () => {
  if (!await initializeAuthentication()) return;
  await loadSites();
  await loadAll({ includeWeather: true });
  initialLoadComplete = true;
  wsService.connect();
})();
setInterval(() => {
  // Reconcile from REST only while realtime is unavailable; connected clients
  // already receive committed device, command, and alert events.
  if (wsService.isConnected()) return;
  if (document.visibilityState === 'hidden') {
    hiddenReconcilePending = true;
    return;
  }
  const now = Date.now();
  if (now - lastFallbackAt < FALLBACK_MIN_INTERVAL_MS) return;
  lastFallbackAt = now;
  void reconcileFromRest({ includeWeather: false, reason: 'fallback' });
}, 30000);
