const STAMP = '2026-09-27T04:00:00.000Z';
const controls = [
  { id: 'relay_a', label: '电源', valueType: 'boolean', stateKey: 'relay_a', commandType: 'set_relay_a' },
  { id: 'level', label: '强度', inputType: 'range', stateKey: 'level', commandType: 'set_level', min: 0, max: 100, step: 1 },
  { id: 'mode', label: '运行模式', inputType: 'select', stateKey: 'mode', commandType: 'set_mode', options: [{ value: 'auto', label: '自动' }, { value: 'manual', label: '手动' }] },
  { id: 'identify', label: '识别设备', inputType: 'action', commandType: 'identify' }
];

export function syntheticDevice(id = 'preview-d1', extra = {}) {
  return {
    id, deviceId: id, displayName: id === 'preview-d1' ? '合成工位照明' : '合成通风设备',
    siteCode: 'preview-site-a', spacePath: '/synthetic/workshop', online: true,
    connections: [{ transport: 'LAN_AGENT', profileId: 'preview-relay', status: 'CONNECTED' }],
    capabilities: { profileId: 'preview-relay', controls },
    desiredState: { relay_a: false, level: 35, mode: 'auto' },
    reportedState: { relay_a: false, level: 35, mode: 'auto' },
    ...extra
  };
}

export function createPreviewFixture(scenario, variant = scenario.variants[0]) {
  if (!scenario.variants.includes(variant)) throw new Error(`Unsupported preview variant: ${scenario.id}/${variant}`);
  const candidates = [{ id: 'preview-candidate-1', candidateId: 'preview-candidate-1', displayName: '合成候选灯具', name: '合成候选灯具', profileId: 'preview-relay', address: 'synthetic-only', rssi: -48 }];
  const model = {
    context: { organizationName: '合成演示组织', organizationCode: 'preview-org', siteName: '合成站点 A', siteCode: 'preview-site-a', spaceName: '演示工位', spacePath: '/synthetic/workshop' },
    sites: [{ organizationName: '合成演示组织', siteName: '合成站点 A', siteCode: 'preview-site-a' }, { organizationName: '合成演示组织', siteName: '合成站点 B', siteCode: 'preview-site-b' }],
    devices: [syntheticDevice(), syntheticDevice('preview-d2')], activeDeviceId: 'preview-d1',
    runtime: { accessRoute: 'SITE_API', stale: false, endpointId: 'synthetic-endpoint', sessionRevision: 1 },
    connectionHealth: { status: 'CONNECTED' },
    auth: { configured: true, authenticated: true, status: 'authenticated' },
    endpointProfile: { apiBaseUrl: 'https://synthetic.invalid', wsUrl: 'wss://synthetic.invalid', accessRoute: 'SITE_API' },
    commandsById: {}, activitiesByDeviceId: { 'preview-d1': Array.from({ length: 6 }, (_, index) => ({ id: `preview-a${index}`, deviceId: 'preview-d1', eventType: 'DEVICE_CONNECTED', timestamp: new Date(Date.parse(STAMP) - index * 60000).toISOString(), message: `合成设备活动 ${index + 1}` })) },
    lanCandidates: candidates,
    ble: { native: true, availability: true, candidates, candidate: candidates[0], selectedCandidateId: candidates[0].id, scanning: false, connection: { deviceId: candidates[0].id, profileId: 'preview-relay', status: 'DISCONNECTED' } },
    loading: {}, resources: {}, startup: { phase: 'ready' }, notices: [], commandObservation: {},
    weather: { status: 'FRESH', fetchedAt: STAMP, current: { temperatureC: 25, apparentTemperatureC: 26, relativeHumidityPct: 61, surfacePressureHpa: 1008, windSpeedKmh: 8, elevationM: 35, conditionText: '合成晴间多云', iconKey: 'partly-cloudy' }, indicators: { temperature: { level: 'SUITABLE', label: '适宜' } } },
    weatherSettings: { latitude: 0, longitude: 0, timezone: 'UTC', locationSource: 'MANUAL', locationUpdatedAt: STAMP },
    weatherForecast: {
      hourly: Array.from({ length: 24 }, (_, index) => ({ forecastAt: new Date(Date.parse(STAMP) + index * 3600000).toISOString(), temperatureC: 22 + index % 7, conditionText: '合成多云', iconKey: 'cloudy', precipitationProbabilityPct: 20 })),
      daily: Array.from({ length: 7 }, (_, index) => ({ forecastAt: new Date(Date.parse(STAMP) + index * 86400000).toISOString(), temperatureMaxC: 28, temperatureMinC: 20, conditionText: '合成晴', iconKey: 'clear', precipitationProbabilityPct: 10 }))
    }, pendingWeatherLocation: null, error: null
  };
  const local = { screen: scenario.screen };
  const resource = scenario.screen === 'sites' ? 'sites' : scenario.screen === 'activity' ? 'activity' : scenario.screen === 'lan' ? 'lanDiscovery' : scenario.screen === 'weather' ? scenario.id === 'P18' ? 'weatherForecast' : 'weather' : 'devices';
  model.resources[resource] = { status: 'ready', phase: 'ready', source: 'network', freshness: 'fresh', updatedAt: STAMP };

  if (variant === 'loading') {
    model.resources[resource] = { status: 'loading', phase: 'loading', source: 'network' };
    if (scenario.screen === 'devices') model.devices = [];
    if (scenario.screen === 'sites') model.sites = [];
    if (scenario.screen === 'lan') model.loading.lanDiscovery = true;
    if (scenario.screen === 'ble') model.loading.bleConnect = true;
    if (scenario.screen === 'weather') model.loading.weatherForecast = true;
    if (['G03', 'G10'].includes(scenario.id)) model.auth.status = 'restoring';
    if (scenario.id === 'G01') model.startup.phase = 'loading';
  }
  if (variant === 'empty') {
    model.resources[resource] = { status: 'empty', phase: 'empty', source: 'network' };
    if (['devices', 'detail'].includes(scenario.screen)) model.devices = [];
    if (scenario.screen === 'sites') model.sites = [];
    if (scenario.screen === 'lan') model.lanCandidates = [];
    if (scenario.screen === 'ble') Object.assign(model.ble, { candidate: null, candidates: [] });
    if (scenario.screen === 'activity') model.activitiesByDeviceId = {};
    if (scenario.screen === 'weather') {
      model.weatherForecast = { hourly: [], daily: [] };
      if (scenario.id !== 'P18') model.weather = { status: 'UNAVAILABLE' };
    }
  }
  if (['cache', 'expired'].includes(variant)) {
    model.runtime.stale = true;
    model.connectionHealth = { status: 'DISCONNECTED' };
    model.resources[resource] = { status: 'ready', phase: 'ready', source: 'cache', freshness: 'stale' };
    model.weather.status = variant === 'expired' ? 'EXPIRED' : 'STALE';
  }
  if (variant === 'error') {
    model.error = '合成失败：请求未完成，请核对状态后重试。';
    model.resources[resource] = { status: 'error', phase: 'error', error: model.error };
    if (['G03', 'G10'].includes(scenario.id)) model.auth = { configured: true, authenticated: false, status: 'error', error: '合成认证校验失败' };
    if (scenario.screen === 'weather') model.weather.refreshError = '合成刷新失败，保留此前数据。';
    if (scenario.screen === 'ble') model.ble.error = model.error;
    if (scenario.id === 'G01') model.startup = { phase: 'error', error: '合成启动失败；仍可检查连接设置。' };
  }
  if (variant === 'partial') model.notices = [{ id: 'preview-partial', tone: 'warning', message: '合成部分成功：主体操作已完成，附加读取或缓存失败；请勿重复提交主体操作。' }];
  if (variant === 'signed-out') {
    model.auth = { configured: true, authenticated: false, status: 'unauthenticated' };
    model.devices = []; model.activitiesByDeviceId = {}; model.sites = []; model.weather = {};
  }
  if (variant === 'second-device') model.activeDeviceId = 'preview-d2';
  if (variant === 'remote') local.endpointDraft = { accessRoute: 'CLOUD_API', apiBaseUrl: 'https://synthetic.invalid', wsUrl: 'wss://synthetic.invalid', oidcIssuerUrl: 'https://issuer.synthetic.invalid', oidcClientId: 'preview-only', oidcRedirectUri: 'com.iot.manager.glassnext://oauth/callback' };
  if (variant === 'cooldown') model.weatherRefreshRetryAt = Date.now() + 45000;
  if (variant === 'pending-location') model.pendingWeatherLocation = { latitude: 0, longitude: 0, timezone: 'UTC', accuracy: 15 };
  if (variant === 'scanning') { model.ble.scanning = true; model.loading.blePicker = true; }
  if (['permission-denied', 'bluetooth-off'].includes(variant)) {
    model.ble.errorCode = variant === 'permission-denied' ? 'BLE_PERMISSION_DENIED' : 'BLE_DISABLED';
    model.error = variant === 'permission-denied' ? '合成蓝牙权限未授予。' : '合成蓝牙关闭状态。';
  }
  if (['ble-connected', 'ble-disconnected', 'unknown-profile'].includes(variant)) {
    model.devices[0].connections = [{ transport: 'BLE_DIRECT', profileId: 'preview-relay', status: variant === 'ble-disconnected' ? 'DISCONNECTED' : 'CONNECTED' }];
    model.devices[0].localOnly = true;
    model.runtime.accessRoute = 'BLE_LOCAL';
    model.ble.connection = { ...model.devices[0].connections[0], deviceId: model.ble.candidate.id };
    if (variant === 'unknown-profile') {
      model.devices[0].capabilities = { known: false, controls: [] };
      model.devices[0].connections[0].profileId = null;
      model.ble.connection.profileId = null;
      model.ble.candidate.profileId = null;
    }
  }
  if (['selected', 'partial'].includes(variant) && scenario.screen === 'lan' || scenario.id === 'P11' && ['loading', 'error'].includes(variant)) {
    local.selectedCandidateId = candidates[0].id;
    local.claim = { displayName: candidates[0].name, siteCode: model.context.siteCode, spacePath: model.context.spacePath };
  }
  if (['pending', 'sent', 'acknowledged', 'failed', 'unconfirmed'].includes(variant)) {
    const status = variant.toUpperCase();
    model.commandsById['preview-command'] = { id: 'preview-command', commandId: 'preview-command', deviceId: 'preview-d1', type: 'set_relay_a', status, createdAt: STAMP, error: status === 'FAILED' ? '合成设备明确拒绝' : null };
    model.devices[0].desiredState.relay_a = ['PENDING', 'SENT', 'ACKNOWLEDGED'].includes(status);
    model.devices[0].reportedState.relay_a = status === 'ACKNOWLEDGED';
  }
  return { model: structuredClone(model), local: structuredClone(local) };
}
