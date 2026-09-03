import './css/style.css';
import Chart from 'chart.js/auto';
import { api, esc, configureApiAuthentication } from './js/api.js';
import { realtime } from './js/realtime.js';
import { createRenderMetrics } from './js/render-metrics.js';
import { BrowserOidcSession, resolveBrowserOidcConfig } from '../../shared/browser-oidc.js';

const state = {
  devices: [],
  groups: [],
  batches: [],
  selectedGroup: null,
  selectedBatch: null,
  selectedBatchCommands: [],
  chart: null,
  weather: null,
  weatherSettings: null,
  alerts: [],
  sites: [],
  siteCode: 'demo-site',
  siteName: '演示站点'
};

const SITE_STORAGE_KEY = 'iot-manager.console.site.v1';
const REALTIME_DEBOUNCE_MS = 300;
const REALTIME_REFRESH_MIN_INTERVAL_MS = 1_000;
const metrics = createRenderMetrics();
let realtimeRefreshTimer = null;
let realtimeRefreshInFlight = false;
let realtimeRefreshQueued = false;
let lastRealtimeRefreshAt = 0;
let hiddenRealtimeRefreshDirty = false;

const browserAuth = new BrowserOidcSession({
  config: resolveBrowserOidcConfig(),
  onStateChange: (authState) => {
    updateAuthenticationUi(authState);
    if (authState.configured && !authState.authenticated) realtime.disconnect();
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
  realtime.setAccessTokenProvider(() => browserAuth.getAccessToken());
  // Keep the explicit login action available on a signed-out HTTPS console;
  // automatic redirects would make logout immediately reauthenticate.
  const authState = await browserAuth.initialize({ redirectIfUnauthenticated: false });
  updateAuthenticationUi(authState);
  return authState.authenticated;
}

function toast(message, isError = false) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.className = `toast ${isError ? 'error' : ''}`;
  requestAnimationFrame(() => element.classList.add('show'));
  window.setTimeout(() => element.classList.remove('show'), 3000);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

function badge(status) {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  const style = normalized === 'ONLINE' || normalized === 'ACKNOWLEDGED' || normalized === 'SUCCEEDED'
    ? 'badge-online'
    : normalized === 'WARNING' || normalized === 'PARTIALLY_SUCCEEDED' || normalized === 'UNCONFIRMED'
      ? 'badge-warning'
      : normalized === 'OFFLINE' || normalized === 'FAILED' || normalized === 'REJECTED'
        ? 'badge-offline'
        : 'badge-maintenance';
  return `<span class="badge ${style}">${esc(normalized)}</span>`;
}

function environmentBadge(indicator) {
  const level = String(indicator?.level || 'UNAVAILABLE').toUpperCase();
  const style = level === 'SUITABLE' ? 'badge-online' : level === 'OBSERVE' ? 'badge-warning' : level === 'RISK' ? 'badge-offline' : 'badge-maintenance';
  return `<span class="badge ${style}" title="${esc(indicator?.reason || '')}">${esc(indicator?.label || '待评估')}</span>`;
}

function weatherValue(value, unit) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const number = Number(value);
  return `${Number.isInteger(number) ? number : number.toFixed(1)}${unit}`;
}

function renderWeather() {
  const current = document.getElementById('weather-current');
  const weather = state.weather;
  if (!weather?.current) {
    const message = weather?.status === 'PENDING'
      ? '天气坐标已配置，等待首次成功同步'
      : weather?.status === 'UNAVAILABLE'
        ? '当前站点尚未配置天气坐标或天气已停用'
        : '尚无天气快照';
    current.innerHTML = `<div class="empty">${esc(message)}</div>`;
    return;
  }
  const value = weather.current;
  const indicators = weather.indicators || {};
  current.innerHTML = `
    <div class="weather-current"><div class="weather-current__hero"><span>${esc(value.conditionText || '未知')}</span><strong>${weatherValue(value.temperatureC, '°C')}</strong><small>体感 ${weatherValue(value.apparentTemperatureC, '°C')} · 更新于 ${esc(formatDate(weather.fetchedAt))}</small></div>
    <div class="weather-current__metrics"><span>湿度 <strong>${weatherValue(value.relativeHumidityPct, '%')}</strong></span><span>气压 <strong>${weatherValue(value.surfacePressureHpa, ' hPa')}</strong></span><span>海拔 <strong>${weatherValue(value.elevationM, ' m')}</strong></span></div>
    <div class="weather-current__indicators">${[['温度', indicators.temperature], ['湿度', indicators.humidity], ['气压', indicators.pressure], ['ESD', indicators.esdRisk], ['结露', indicators.condensationRisk]].map(([name, indicator]) => `<div><span>${name}</span>${environmentBadge(indicator)}<small>${esc(indicator?.reason || '')}</small></div>`).join('')}</div></div>`;
}

function populateWeatherSettings(settings) {
  state.weatherSettings = settings;
  document.getElementById('weather-enabled').value = String(settings?.enabled ?? true);
  document.getElementById('weather-latitude').value = settings?.latitude ?? '';
  document.getElementById('weather-longitude').value = settings?.longitude ?? '';
  document.getElementById('weather-timezone').value = settings?.timezone ?? '';
  document.getElementById('weather-elevation').value = settings?.manualElevationM ?? '';
  document.getElementById('weather-condensation-device').value = settings?.condensationTemperatureDeviceId ?? '';
  document.getElementById('weather-condensation-field').value = settings?.condensationTemperatureField ?? '';
}

async function loadWeather() {
  const [weather, settings] = await Promise.all([
    api(`/api/sites/${encodeURIComponent(state.siteCode)}/weather`),
    api(`/api/sites/${encodeURIComponent(state.siteCode)}/weather-settings`)
  ]);
  state.weather = weather;
  populateWeatherSettings(settings);
  renderWeather();
}

function selectedDeviceIds() {
  return [...document.querySelectorAll('.device-select:checked')].map((element) => Number(element.value));
}

function updateSiteUi() {
  const selector = document.getElementById('site-selector');
  if (selector) selector.value = state.siteCode;
  const label = document.getElementById('site-label');
  if (label) label.textContent = state.siteName || state.siteCode;
}

async function selectSite(site, { reload = true } = {}) {
  if (!site?.siteCode) return;
  state.siteCode = String(site.siteCode);
  state.siteName = String(site.siteName || site.siteCode);
  state.selectedGroup = null;
  state.selectedBatch = null;
  state.selectedBatchCommands = [];
  state.weather = null;
  state.weatherSettings = null;
  realtime.setSiteCode(state.siteCode);
  try { localStorage.setItem(SITE_STORAGE_KEY, state.siteCode); } catch { /* browser persistence is optional */ }
  updateSiteUi();
  if (!reload) return;

  realtime.disconnect();
  try {
    await Promise.all([loadDashboard(), loadGroups()]);
    const page = activePage();
    if (!['dashboard', 'groups'].includes(page)) await refreshCurrentPage();
  } finally {
    realtime.connect();
  }
}

async function loadSites() {
  const selector = document.getElementById('site-selector');
  try {
    const sites = await api('/api/v1/sites');
    if (!Array.isArray(sites) || sites.length === 0) throw new Error('No accessible sites');
    state.sites = sites;
    let savedCode = null;
    try { savedCode = localStorage.getItem(SITE_STORAGE_KEY); } catch { /* browser persistence is optional */ }
    const selected = sites.find((site) => String(site.siteCode) === String(savedCode))
      || sites.find((site) => String(site.siteCode) === state.siteCode)
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
    realtime.setSiteCode(state.siteCode);
    updateSiteUi();
    if (selector) selector.disabled = true;
    console.warn('Unable to load authorized sites:', error);
  }
}

async function loadDashboard() {
  const [stats, batches] = await Promise.all([
    api(`/api/devices/stats?siteCode=${encodeURIComponent(state.siteCode)}`),
    api(`/api/command-batches?siteCode=${encodeURIComponent(state.siteCode)}`)
  ]);
  state.batches = batches;
  document.getElementById('d-total').textContent = stats.total ?? 0;
  document.getElementById('d-online').textContent = stats.online ?? 0;
  document.getElementById('d-warning').textContent = stats.warning ?? 0;
  document.getElementById('d-offline').textContent = stats.offline ?? 0;
  renderTypeChart(stats.typeBreakdown || {});
  renderDashboardBatches();
}

function renderTypeChart(breakdown) {
  const canvas = document.getElementById('chart-types');
  const labels = Object.keys(breakdown);
  const values = Object.values(breakdown);
  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = values;
    state.chart.update('none');
    return;
  }
  state.chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: ['#3699FF', '#0FE87B', '#F5A623', '#F64E60', '#8950FC'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#7E8299', font: { size: 11 } } } } }
  });
}

function renderDashboardBatches() {
  const container = document.getElementById('dashboard-batches');
  if (!state.batches.length) {
    container.innerHTML = '<div class="empty">暂无批量命令</div>';
    return;
  }
  container.innerHTML = state.batches.slice(0, 5).map((batch) => `
    <div class="compact-row"><div><strong>${esc(batch.type)}</strong><div class="muted">${esc(batch.batchId)} · ${formatDate(batch.requestedAt)}</div></div><div>${badge(batch.status)}</div></div>
  `).join('');
}

function batchSummary(batch) {
  return [
    `${batch.acknowledgedCount || 0} 已确认`,
    `${batch.failedCount || 0} 未确认或失败`,
    `${batch.rejectedCount || 0} 已拒绝`,
    `${batch.pendingCount || 0} 等待中`,
    `${batch.sentCount || 0} 已发送`
  ];
}

function commandOutcome(command) {
  if (command.error) return command.error;
  if (command.failureCode) return command.failureCode;
  if (command.result?.reason) return command.result.reason;
  if (command.result?.applied) return '设备已确认状态';
  return '-';
}

function retryableCommands() {
  return state.selectedBatchCommands.filter((command) => ['FAILED', 'UNCONFIRMED', 'REJECTED'].includes(String(command.status).toUpperCase()));
}

function renderBatchDetail() {
  const title = document.getElementById('batch-detail-title');
  const copy = document.getElementById('batch-detail-copy');
  const actions = document.getElementById('batch-detail-actions');
  const content = document.getElementById('batch-detail-content');
  const batch = state.selectedBatch;
  if (!batch) {
    title.textContent = '选择一个批次';
    copy.textContent = '可查看每台设备的命令回执和失败原因。';
    actions.innerHTML = '';
    content.innerHTML = '';
    return;
  }
  const retryable = retryableCommands();
  title.textContent = `批次详情：${batch.type}`;
  copy.textContent = `${batch.batchId} · ${formatDate(batch.requestedAt)}`;
  actions.innerHTML = retryable.length
    ? `<button class="btn btn-ghost btn-sm" id="retry-batch-failed">重试 ${retryable.length} 台失败设备</button>`
    : '';
  const meta = batchSummary(batch).map((item) => `<span>${esc(item)}</span>`).join('');
  const rows = state.selectedBatchCommands.map((command) => `<tr>
    <td>${esc(command.deviceId)}</td>
    <td>${esc(command.type)}</td>
    <td>${badge(command.status)}</td>
    <td>${esc(commandOutcome(command))}</td>
    <td>${formatDate(command.completedAt || command.sentAt || command.requestedAt)}</td>
  </tr>`).join('');
  content.innerHTML = `<div class="detail-meta">${meta}</div>${rows
    ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>设备 ID</th><th>命令</th><th>状态</th><th>结果</th><th>最后更新</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="detail-empty">批次尚未生成子命令。</div>'}`;
}

async function selectBatch(batchId) {
  const batch = state.batches.find((item) => item.batchId === batchId);
  if (!batch) return;
  state.selectedBatch = batch;
  state.selectedBatchCommands = [];
  renderBatchDetail();
  try {
    state.selectedBatchCommands = await api(`/api/command-batches/${encodeURIComponent(batchId)}/commands`);
    renderBatchDetail();
  } catch (error) {
    state.selectedBatchCommands = [];
    renderBatchDetail();
    toast(`批次详情加载失败：${error.message}`, true);
  }
}

function deviceRow(device) {
  const connection = device.connections?.[0];
  const profile = `${device.profileId || 'legacy-generic-v1'} v${device.profileVersion || 1}`;
  return `<tr data-device-id="${esc(device.deviceId ?? device.publicId ?? device.id)}">
    <td><input class="device-select" type="checkbox" value="${device.id}" aria-label="选择 ${esc(device.name)}"></td>
    <td><strong>${esc(device.name)}</strong><div class="mono">${esc(device.deviceId)}</div></td>
    <td>${esc(profile)}</td>
    <td>${esc(connection?.transport || device.protocol || '-')}</td>
    <td>${badge(device.status)}</td>
    <td>${esc(device.location || '-')}</td>
    <td class="row-actions"><button class="btn btn-ghost btn-sm edit-device" data-id="${device.id}">编辑</button><button class="btn btn-danger btn-sm archive-device" data-id="${device.id}">归档</button></td>
  </tr>`;
}

function renderDeviceRows() {
  const body = document.getElementById('dev-table-body');
  if (!body) return;
  body.innerHTML = state.devices.length
    ? state.devices.map(deviceRow).join('')
    : '<tr><td colspan="7" class="empty">没有匹配的设备</td></tr>';
}

function deviceReference(device = {}) {
  const reference = device.deviceId ?? device.devicePublicId ?? device.publicId ?? device.id ?? device.deviceDbId;
  return reference === null || reference === undefined ? '' : String(reference);
}

function matchesDeviceSearch(device) {
  const query = document.getElementById('dev-search')?.value.trim().toLowerCase() ?? '';
  if (!query) return true;
  return [device.name, device.deviceId, device.publicId]
    .filter((value) => value != null)
    .some((value) => String(value).toLowerCase().includes(query));
}

function patchRealtimeDevice(payload, { render = true } = {}) {
  const reference = deviceReference(payload);
  if (!reference) return false;
  const index = state.devices.findIndex((device) => deviceReference(device) === reference
    || String(device.id) === String(payload.deviceDbId ?? payload.id ?? ''));
  const existing = index >= 0 ? state.devices[index] : null;
  const device = {
    ...(existing ?? {}),
    ...payload,
    id: payload.id ?? payload.deviceDbId ?? existing?.id,
    deviceId: payload.deviceId ?? existing?.deviceId,
    connections: payload.connections ?? existing?.connections ?? []
  };
  if (index >= 0) state.devices[index] = device;
  else state.devices.unshift(device);
  if (!render) return true;

  const body = document.getElementById('dev-table-body');
  if (!body) return false;
  const row = [...body.querySelectorAll('tr[data-device-id]')]
    .find((candidate) => candidate.dataset.deviceId === deviceReference(device));
  if (!matchesDeviceSearch(device)) {
    row?.remove();
  } else if (row) {
    row.outerHTML = deviceRow(device);
  } else {
    const empty = body.querySelector('.empty');
    if (empty) body.replaceChildren();
    body.insertAdjacentHTML('afterbegin', deviceRow(device));
  }
  metrics.increment('devicePatchCount');
  return true;
}

function removeRealtimeDevice(payload, { render = true } = {}) {
  const reference = deviceReference(payload);
  if (!reference) return false;
  const index = state.devices.findIndex((device) => deviceReference(device) === reference
    || String(device.id) === String(payload.deviceDbId ?? payload.id ?? ''));
  if (index < 0) return true;
  const [device] = state.devices.splice(index, 1);
  if (!render) return true;
  const body = document.getElementById('dev-table-body');
  const row = body && [...body.querySelectorAll('tr[data-device-id]')]
    .find((candidate) => candidate.dataset.deviceId === deviceReference(device));
  row?.remove();
  if (body && body.querySelectorAll('tr[data-device-id]').length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="empty">没有匹配的设备</td></tr>';
  }
  metrics.increment('devicePatchCount');
  return true;
}

async function loadDevices() {
  const query = document.getElementById('dev-search').value.trim();
  const params = new URLSearchParams({ siteCode: state.siteCode });
  if (query) params.set('search', query);
  state.devices = await api(`/api/devices?${params}`);
  renderDeviceRows();
}

function resetDeviceForm() {
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = '登记设备';
  document.getElementById('device-form').reset();
}

async function editDevice(id) {
  const device = await api(`/api/devices/${id}`);
  document.getElementById('edit-id').value = device.id;
  document.getElementById('form-title').textContent = `编辑设备：${device.name}`;
  document.getElementById('f-name').value = device.name || '';
  document.getElementById('f-type').value = device.type || 'ACTUATOR';
  document.getElementById('f-protocol').value = device.protocol || 'API';
  document.getElementById('f-location').value = device.location || '';
  document.getElementById('f-firmware').value = device.firmwareVersion || '';
  document.getElementById('f-status').value = device.status || 'OFFLINE';
  navigate('devices');
}

async function archiveDevice(id) {
  if (!window.confirm('归档后设备将从默认列表隐藏，但历史与审计会保留。继续吗？')) return;
  await api(`/api/devices/${id}`, { method: 'DELETE' });
  toast('设备已归档');
  await loadDevices();
}

async function loadGroups() {
  state.groups = await api(`/api/device-groups?siteCode=${encodeURIComponent(state.siteCode)}`);
  renderGroups();
  const selector = document.getElementById('batch-group');
  selector.innerHTML = '<option value="">选择设备组</option>' + state.groups.map((group) => `<option value="${esc(group.groupId)}">${esc(group.name)} (${group.memberCount})</option>`).join('');
}

function renderGroups() {
  const list = document.getElementById('group-list');
  if (!state.groups.length) {
    list.innerHTML = '<div class="empty">暂无设备组</div>';
    return;
  }
  list.innerHTML = state.groups.map((group) => `<div class="compact-row"><div><strong>${esc(group.name)}</strong><div class="muted">${group.memberCount} 台设备，${group.onlineCount} 台在线</div></div><button class="btn btn-ghost btn-sm select-group" data-id="${esc(group.groupId)}">管理成员</button></div>`).join('');
}

function selectGroup(groupId) {
  state.selectedGroup = state.groups.find((group) => group.groupId === groupId) || null;
  const title = document.getElementById('group-detail-title');
  const copy = document.getElementById('group-detail-copy');
  title.textContent = state.selectedGroup ? state.selectedGroup.name : '选择一个设备组';
  copy.textContent = state.selectedGroup
    ? `当前 ${state.selectedGroup.memberCount} 台设备，版本 ${state.selectedGroup.version}。输入设备数据库 ID 后保存。`
    : '选择设备组后可按设备 ID 更新成员。';
}

function parseIds(value) {
  return [...new Set(String(value || '').split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite))];
}

async function loadBatches() {
  state.batches = await api(`/api/command-batches?siteCode=${encodeURIComponent(state.siteCode)}`);
  const container = document.getElementById('batch-list');
  if (!state.batches.length) {
    container.innerHTML = '<div class="empty">暂无批量命令</div>';
    return;
  }
  container.innerHTML = state.batches.map((batch) => `<div class="compact-row"><div><strong>${esc(batch.type)}</strong><div class="muted">${esc(batch.batchId)} · ${batch.acknowledgedCount}/${batch.totalCount} 已确认 · ${formatDate(batch.requestedAt)}</div></div><div class="row-actions">${badge(batch.status)}<button class="btn btn-ghost btn-sm select-batch" data-id="${esc(batch.batchId)}">详情</button></div></div>`).join('');
  if (state.selectedBatch) {
    const current = state.batches.find((batch) => batch.batchId === state.selectedBatch.batchId);
    if (current) {
      state.selectedBatch = current;
      renderBatchDetail();
    } else {
      state.selectedBatch = null;
      state.selectedBatchCommands = [];
      renderBatchDetail();
    }
  }
}

function alertRow(alert) {
  return `<tr data-alert-id="${esc(alert.id)}">
    <td>${formatDate(alert.createdAt)}</td><td>${badge(alert.level)}</td><td>${esc(alert.deviceName || '-')}</td><td>${esc(alert.message)}</td><td>${badge(alert.status)}</td>
    <td>${alert.status !== 'RESOLVED' ? `<button class="btn btn-ghost btn-sm resolve-alert" data-id="${alert.id}">解决</button>` : ''}</td>
  </tr>`;
}

function alertMatchesCurrentFilter(alert) {
  const resolved = document.getElementById('alert-resolved')?.value;
  const query = document.getElementById('alert-query')?.value.trim().toLowerCase() ?? '';
  if (resolved && String(alert.status === 'RESOLVED') !== resolved) return false;
  if (!query) return true;
  return [alert.message, alert.deviceName, alert.level, alert.status]
    .filter((value) => value != null)
    .some((value) => String(value).toLowerCase().includes(query));
}

function patchRealtimeAlert(payload) {
  if (payload?.id === null || payload?.id === undefined) return false;
  const index = state.alerts.findIndex((alert) => String(alert.id) === String(payload.id));
  const alert = { ...(index >= 0 ? state.alerts[index] : {}), ...payload };
  if (index >= 0) state.alerts[index] = alert;
  else state.alerts.unshift(alert);
  const body = document.getElementById('alerts-list');
  if (!body) return false;
  const row = [...body.querySelectorAll('tr[data-alert-id]')]
    .find((candidate) => candidate.dataset.alertId === String(alert.id));
  if (!alertMatchesCurrentFilter(alert)) row?.remove();
  else if (row) row.outerHTML = alertRow(alert);
  else {
    const empty = body.querySelector('.empty');
    if (empty) body.replaceChildren();
    body.insertAdjacentHTML('afterbegin', alertRow(alert));
  }
  metrics.increment('alertPatchCount');
  return true;
}

async function loadAlerts() {
  const resolved = document.getElementById('alert-resolved').value;
  const query = document.getElementById('alert-query').value.trim();
  const params = new URLSearchParams({ page: '0', size: '50' });
  params.set('siteCode', state.siteCode);
  if (resolved) params.set('resolved', resolved);
  if (query) params.set('q', query);
  const result = await api(`/api/alerts/search?${params}`);
  state.alerts = result.items;
  const body = document.getElementById('alerts-list');
  body.innerHTML = result.items.length ? result.items.map(alertRow).join('') : '<tr><td colspan="6" class="empty">没有匹配的告警</td></tr>';
}

async function loadAudit() {
  const params = new URLSearchParams({ page: '0', size: '50' });
  params.set('siteCode', state.siteCode);
  const status = document.getElementById('audit-status').value;
  const batchId = document.getElementById('audit-batch').value.trim();
  if (status) params.set('status', status);
  if (batchId) params.set('batchId', batchId);
  const result = await api(`/api/commands?${params}`);
  const body = document.getElementById('audit-list');
  body.innerHTML = result.items.length ? result.items.map((command) => `<tr>
    <td>${formatDate(command.requestedAt)}</td><td>${esc(command.deviceId)}</td><td>${esc(command.type)}</td><td class="mono">${esc(command.batchId || '-')}</td><td>${esc(command.source)}</td><td>${badge(command.status)}</td><td>${command.error ? esc(command.error) : command.result?.applied ? '已确认' : '-'}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="empty">没有匹配的命令</td></tr>';
}

async function refreshCurrentPage() {
  const active = document.querySelector('.page.active')?.id?.replace('page-', '') || 'dashboard';
  const loaders = { dashboard: loadDashboard, devices: loadDevices, groups: loadGroups, batches: loadBatches, alerts: loadAlerts, audit: loadAudit, weather: loadWeather };
  await loaders[active]();
}

function debounce(callback, delay = 250) {
  let timer = null;
  return (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      callback(...args);
    }, delay);
  };
}

function activePage() {
  return document.querySelector('.page.active')?.id?.replace('page-', '') || 'dashboard';
}

const pendingRealtimeTypes = new Set();
const realtimeRelevantTypes = {
  dashboard: ['device_update', 'device_updates', 'device_archived', 'command_batch_update', 'alert', 'alert_update'],
  devices: ['device_update', 'device_updates', 'device_archived', 'connection_update'],
  groups: ['device_group_update'],
  batches: ['command_batch_update', 'command_update'],
  alerts: ['alert', 'alert_update'],
  audit: ['command_update'],
  weather: ['weather_update']
};

function scheduleRealtimeRefresh(delay = REALTIME_DEBOUNCE_MS) {
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = null;
    flushRealtimeRefresh();
  }, Math.max(0, delay));
}

function flushRealtimeRefresh() {
  if (document.visibilityState === 'hidden') {
    if (pendingRealtimeTypes.size > 0) {
      hiddenRealtimeRefreshDirty = true;
      metrics.increment('deferredWhileHiddenCount');
    }
    return;
  }
  const page = activePage();
  const shouldRefresh = [...pendingRealtimeTypes].some((type) => realtimeRelevantTypes[page]?.includes(type));
  if (!shouldRefresh) {
    pendingRealtimeTypes.clear();
    return;
  }
  const now = Date.now();
  const remaining = REALTIME_REFRESH_MIN_INTERVAL_MS - (now - lastRealtimeRefreshAt);
  if (realtimeRefreshInFlight) {
    realtimeRefreshQueued = true;
    metrics.increment('coalescedRealtimeEventCount');
    return;
  }
  if (remaining > 0) {
    realtimeRefreshQueued = true;
    metrics.increment('coalescedRealtimeEventCount');
    scheduleRealtimeRefresh(remaining);
    return;
  }
  pendingRealtimeTypes.clear();
  realtimeRefreshQueued = false;
  realtimeRefreshInFlight = true;
  lastRealtimeRefreshAt = now;
  metrics.increment('restRefreshCount');
  refreshCurrentPage()
    .catch((error) => toast(`实时刷新失败：${error.message}`, true))
    .finally(() => {
      realtimeRefreshInFlight = false;
      if (realtimeRefreshQueued || pendingRealtimeTypes.size > 0) {
        realtimeRefreshQueued = false;
        scheduleRealtimeRefresh();
      }
    });
}

function refreshForRealtimeEvent(event) {
  const eventSiteCode = event?.payload?.siteCode || event?.siteCode;
  if (eventSiteCode && String(eventSiteCode) !== state.siteCode) return;
  const currentSitePayloads = Array.isArray(event?.payload)
    ? event.payload.filter((payload) => !payload?.siteCode || String(payload.siteCode) === state.siteCode)
    : [];
  if (document.visibilityState === 'hidden') {
    if (event?.type === 'device_update' && event?.payload) patchRealtimeDevice(event.payload, { render: false });
    if (event?.type === 'device_updates') {
      currentSitePayloads.forEach((payload) => patchRealtimeDevice(payload, { render: false }));
    }
    if (event?.type === 'connection_update' && event?.payload) patchRealtimeDevice(event.payload, { render: false });
    if (event?.type === 'device_archived' && event?.payload) removeRealtimeDevice(event.payload, { render: false });
    if (['alert', 'alert_update'].includes(event?.type) && event?.payload) {
      const index = state.alerts.findIndex((alert) => String(alert.id) === String(event.payload.id));
      if (index >= 0) state.alerts[index] = { ...state.alerts[index], ...event.payload };
      else state.alerts.unshift(event.payload);
    }
    if (event?.type === 'weather_update' && event?.payload) state.weather = event.payload;
    pendingRealtimeTypes.add(event.type);
    hiddenRealtimeRefreshDirty = true;
    metrics.increment('deferredWhileHiddenCount');
    return;
  }
  if (activePage() === 'devices' && event?.type === 'device_update' && event?.payload) {
    patchRealtimeDevice(event.payload);
    return;
  }
  if (activePage() === 'devices' && event?.type === 'device_updates') {
    currentSitePayloads.forEach((payload) => patchRealtimeDevice(payload));
    return;
  }
  if (activePage() === 'devices' && event?.type === 'connection_update' && event?.payload) {
    patchRealtimeDevice(event.payload);
    return;
  }
  if (activePage() === 'devices' && event?.type === 'device_archived' && event?.payload) {
    removeRealtimeDevice(event.payload);
    return;
  }
  if (activePage() === 'alerts' && ['alert', 'alert_update'].includes(event?.type) && event?.payload
    && patchRealtimeAlert(event.payload)) return;
  if (activePage() === 'weather' && event?.type === 'weather_update' && event?.payload) {
    state.weather = event.payload;
    renderWeather();
    metrics.increment('weatherPatchCount');
    return;
  }
  pendingRealtimeTypes.add(event.type);
  scheduleRealtimeRefresh();
}

async function navigate(page) {
  document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.page === page));
  document.querySelectorAll('.page').forEach((element) => element.classList.toggle('active', element.id === `page-${page}`));
  try {
    await refreshCurrentPage();
  } catch (error) {
    toast(`加载失败：${error.message}`, true);
  }
}

document.querySelectorAll('.nav-item').forEach((element) => element.addEventListener('click', () => navigate(element.dataset.page)));
document.getElementById('site-selector').addEventListener('change', async (event) => {
  const site = state.sites.find((candidate) => String(candidate.siteCode) === String(event.target.value));
  try {
    await selectSite(site || { siteCode: event.target.value }, { reload: true });
  } catch (error) {
    toast(`切换站点失败：${error.message}`, true);
    updateSiteUi();
  }
});
document.getElementById('auth-action').addEventListener('click', async () => {
  const authState = browserAuth.getState();
  if (!authState.configured) return;
  const button = document.getElementById('auth-action');
  button.disabled = true;
  try {
    if (authState.authenticated) await browserAuth.logout();
    else await browserAuth.beginLogin();
  } catch (error) {
    button.disabled = false;
    toast(`登录操作失败：${error.message}`, true);
  }
});
document.getElementById('refresh-all').addEventListener('click', () => refreshCurrentPage().catch((error) => toast(error.message, true)));
document.getElementById('load-devices').addEventListener('click', () => loadDevices().catch((error) => toast(error.message, true)));
document.getElementById('dev-search').addEventListener('input', debounce(() => loadDevices().catch(() => {})));
document.getElementById('btn-cancel').addEventListener('click', resetDeviceForm);

document.getElementById('dev-table-body').addEventListener('click', (event) => {
  const edit = event.target.closest('.edit-device');
  const archive = event.target.closest('.archive-device');
  if (edit) editDevice(edit.dataset.id).catch((error) => toast(error.message, true));
  if (archive) archiveDevice(archive.dataset.id).catch((error) => toast(error.message, true));
});

document.getElementById('device-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.getElementById('edit-id').value;
  const body = {
    name: document.getElementById('f-name').value,
    type: document.getElementById('f-type').value,
    protocol: document.getElementById('f-protocol').value,
    location: document.getElementById('f-location').value || null,
    firmwareVersion: document.getElementById('f-firmware').value || null,
    status: document.getElementById('f-status').value
  };
  try {
    const endpoint = id ? `/api/devices/${id}` : `/api/devices?siteCode=${encodeURIComponent(state.siteCode)}`;
    await api(endpoint, { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    toast(id ? '设备已更新' : '设备已登记');
    resetDeviceForm();
    await loadDevices();
  } catch (error) { toast(error.message, true); }
});

document.getElementById('group-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/device-groups', { method: 'POST', body: JSON.stringify({ siteCode: state.siteCode, name: document.getElementById('group-name').value, description: document.getElementById('group-description').value || null }) });
    event.target.reset();
    await loadGroups();
    toast('设备组已创建');
  } catch (error) { toast(error.message, true); }
});

document.getElementById('group-list').addEventListener('click', (event) => {
  const button = event.target.closest('.select-group');
  if (button) selectGroup(button.dataset.id);
});

document.getElementById('group-members-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedGroup) { toast('请先选择设备组', true); return; }
  try {
    const updated = await api(`/api/device-groups/${encodeURIComponent(state.selectedGroup.groupId)}/members`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: state.selectedGroup.version, addDeviceIds: parseIds(document.getElementById('group-add-members').value), removeDeviceIds: parseIds(document.getElementById('group-remove-members').value) })
    });
    await loadGroups();
    selectGroup(updated.groupId);
    event.target.reset();
    toast('设备组成员已更新');
  } catch (error) { toast(error.message, true); }
});

document.getElementById('batch-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const groupId = document.getElementById('batch-group').value || null;
    const deviceIds = parseIds(document.getElementById('batch-device-ids').value);
    const parameters = JSON.parse(document.getElementById('batch-parameters').value || '{}');
    if (!groupId && !deviceIds.length) throw new Error('请选择设备组或填写设备 ID');
    if (groupId && deviceIds.length) throw new Error('设备组和设备 ID 只能选择一个');
    const batch = await api('/api/command-batches', {
      method: 'POST',
      body: JSON.stringify({ siteCode: state.siteCode, target: { groupId, deviceIds }, type: document.getElementById('batch-type').value, parameters, idempotencyKey: crypto.randomUUID(), expiresInSeconds: Number(document.getElementById('batch-expiry').value || 300) })
    });
    await loadBatches();
    await selectBatch(batch.batchId);
    toast('批量命令已提交');
  } catch (error) { toast(error.message, true); }
});

document.getElementById('batch-list').addEventListener('click', (event) => {
  const button = event.target.closest('.select-batch');
  if (button) selectBatch(button.dataset.id);
});

document.getElementById('batch-detail-actions').addEventListener('click', async (event) => {
  if (!event.target.closest('#retry-batch-failed') || !state.selectedBatch) return;
  const commands = retryableCommands();
  if (!commands.length) return;
  const parameters = commands[0].parameters || {};
  try {
    const batch = await api('/api/command-batches', {
      method: 'POST',
      body: JSON.stringify({
        siteCode: state.siteCode,
        target: { deviceIds: commands.map((command) => command.deviceId) },
        type: state.selectedBatch.type,
        parameters,
        idempotencyKey: crypto.randomUUID(),
        expiresInSeconds: 300
      })
    });
    await loadBatches();
    await selectBatch(batch.batchId);
    toast(`已重新提交 ${commands.length} 台失败设备`);
  } catch (error) {
    toast(`重试失败：${error.message}`, true);
  }
});

document.getElementById('alert-resolved').addEventListener('change', () => loadAlerts().catch((error) => toast(error.message, true)));
document.getElementById('alert-query').addEventListener('input', debounce(() => loadAlerts().catch(() => {})));
document.getElementById('alerts-list').addEventListener('click', async (event) => {
  const button = event.target.closest('.resolve-alert');
  if (!button) return;
  try { await api(`/api/alerts/${button.dataset.id}/resolve`, { method: 'PUT' }); await loadAlerts(); toast('告警已解决'); } catch (error) { toast(error.message, true); }
});
document.getElementById('audit-status').addEventListener('change', () => loadAudit().catch((error) => toast(error.message, true)));
document.getElementById('audit-batch').addEventListener('input', debounce(() => loadAudit().catch(() => {})));
document.getElementById('weather-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const optionalNumber = (id) => {
    const value = document.getElementById(id).value.trim();
    return value === '' ? null : Number(value);
  };
  const body = {
    enabled: document.getElementById('weather-enabled').value === 'true',
    providerCode: 'OPEN_METEO',
    latitude: optionalNumber('weather-latitude'),
    longitude: optionalNumber('weather-longitude'),
    timezone: document.getElementById('weather-timezone').value.trim() || null,
    manualElevationM: optionalNumber('weather-elevation'),
    condensationTemperatureDeviceId: optionalNumber('weather-condensation-device'),
    condensationTemperatureField: document.getElementById('weather-condensation-field').value.trim() || null
  };
  try {
    const settings = await api(`/api/sites/${encodeURIComponent(state.siteCode)}/weather-settings`, { method: 'PUT', body: JSON.stringify(body) });
    populateWeatherSettings(settings);
    toast('天气配置已保存');
  } catch (error) { toast(`天气配置保存失败：${error.message}`, true); }
});
document.getElementById('refresh-weather').addEventListener('click', async () => {
  try {
    state.weather = await api(`/api/sites/${encodeURIComponent(state.siteCode)}/weather/refresh`, { method: 'POST' });
    renderWeather();
    toast('天气已刷新');
  } catch (error) { toast(`天气刷新失败：${error.message}`, true); }
});

function updateClock() {
  if (document.visibilityState === 'hidden') return;
  document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}
updateClock();
window.setInterval(updateClock, 1000);
realtime.on(refreshForRealtimeEvent);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' || !hiddenRealtimeRefreshDirty) return;
  hiddenRealtimeRefreshDirty = false;
  scheduleRealtimeRefresh(0);
});
if (import.meta.env.DEV) {
  globalThis.__iotConsoleUiMetrics = () => metrics.snapshot();
}
window.addEventListener('beforeunload', () => realtime.disconnect());
void (async () => {
  try {
    if (!await initializeAuthentication()) return;
    await loadSites();
    await Promise.all([loadDashboard(), loadGroups()]);
    realtime.connect();
  } catch (error) {
    toast(`初始化失败：${error.message}`, true);
  }
})();
