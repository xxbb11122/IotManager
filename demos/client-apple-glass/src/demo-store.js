import { transitionCommand } from './framework/command-state.js';
import { resolveDeviceCapabilities } from './framework/device-capabilities.js';
import { rangeSpec } from './framework/range-contract.js';

const clone = value => structuredClone(value);
const timestamp = () => new Date().toISOString();
export const DEMO_SITES = Object.freeze([
  { id: 'demo-a', siteCode: 'demo-a', name: '南区 · 装配车间', siteName: '南区 · 装配车间' },
  { id: 'demo-b', siteCode: 'demo-b', name: '北区 · 实验空间', siteName: '北区 · 实验空间' }
]);
const controls = () => [
  { id: 'power', label: '电源', inputType: 'toggle', stateKey: 'power', commandType: 'set_power', parameterKey: 'on' },
  { id: 'level', label: '照明强度', inputType: 'range', stateKey: 'level', commandType: 'set_level', parameterKey: 'level', min: 0, max: 100, step: 1 },
  { id: 'mode', label: '工作模式', inputType: 'select', stateKey: 'mode', commandType: 'set_mode', parameterKey: 'mode',
    options: [{ value: 'manual', label: '手动' }, { value: 'auto', label: '自动' }, { value: 'eco', label: '节能' }] }
];
export function demoLamp(siteCode, suffix = 'light-01', name = '装配工位照明') {
  const id = `${siteCode}-${suffix}`;
  return { id, deviceId: id, displayName: name, deviceType: 'light', model: 'GL-100 · 演示', manufacturer: 'Glass Lab',
    siteCode, spacePath: '/workshop/assembly', capabilities: { profileId: 'demo-light-v1', known: true, controls: controls() },
    connections: [{ deviceId: id, transport: 'LAN_AGENT', status: 'CONNECTED', profileId: 'demo-light-v1', endpoint: '模拟 LAN · 内存服务', lastSeenAt: timestamp() }],
    reportedState: { power: true, level: siteCode === 'demo-a' ? 42 : 68, mode: 'manual' },
    desiredState: { power: true, level: siteCode === 'demo-a' ? 42 : 68, mode: 'manual' } };
}
function fixtures(siteCode) {
  const lamp = demoLamp(siteCode, 'light-01', siteCode === 'demo-a' ? '装配工位照明' : '实验台照明');
  const sensor = { id: `${siteCode}-sensor-01`, deviceId: `${siteCode}-sensor-01`, displayName: '环境监测终端', deviceType: 'sensor',
    siteCode, spacePath: '/workshop/environment', model: 'GS-20 · 演示', capabilities: { profileId: 'demo-sensor-v1', known: true, controls: [] },
    connections: [{ transport: 'LAN_AGENT', status: 'CONNECTED', profileId: 'demo-sensor-v1', endpoint: '模拟 LAN · 内存服务', lastSeenAt: timestamp() }],
    reportedState: { temperature: 24.6, humidity: 58, battery: 91 }, desiredState: {} };
  const ble = demoLamp(siteCode, 'ble-01', '便携巡检照明');
  ble.localOnly = true; ble.deviceType = 'light'; ble.reportedState.level = 28; ble.desiredState.level = 28;
  ble.connections[0] = { deviceId: ble.id, transport: 'BLE_DIRECT', status: 'CONNECTED', profileId: 'demo-light-v1', endpoint: '模拟 BLE · 不访问硬件', lastSeenAt: timestamp() };
  const gateway = { id: `${siteCode}-gateway-01`, deviceId: `${siteCode}-gateway-01`, displayName: '边缘网关', deviceType: 'gateway',
    siteCode, spacePath: '/workshop/network', capabilities: { known: true, profileId: 'demo-gateway-v1', controls: [] },
    connections: [{ transport: 'LAN_AGENT', status: 'DISCONNECTED', profileId: 'demo-gateway-v1', endpoint: '模拟 LAN · 离线样例' }],
    reportedState: { online: false }, desiredState: {} };
  return { devices: [lamp, sensor, ble, gateway], commands: {}, candidates: [], activities: [
    { id: `${siteCode}-initial`, eventType: 'DEVICE_CONNECTED', deviceId: lamp.id, title: '演示站点已就绪', description: '使用本地模拟数据，可从照明设备开始测试控制与回执。', timestamp: timestamp() }
  ] };
}
export function createDemoStore({ commandDelay = 1200, timer = globalThis } = {}) {
  let sites, siteCode, scenario, outcome, route, auth, activeDeviceId, revision, serial, ai, snapshotAt, weatherLocation;
  const listeners = new Set(), jobs = new Set();
  let stats, events;
  function log(message, type = 'info') {
    events.unshift({ id: `event-${++serial}`, type, message, timestamp: timestamp(), siteCode });
    events = events.slice(0, 80);
  }
  function emit(hint = 'full') { for (const listener of listeners) listener(getModel(), hint); }
  function stopPending(reason) {
    for (const job of jobs) {
      timer.clearTimeout(job.timer);
      const command = sites[job.siteCode]?.commands[job.commandId];
      if (command) {
        command.status = 'UNCONFIRMED'; command.error = reason; command.updatedAt = timestamp();
        const data = sites[job.siteCode], index = data.devices.findIndex(device => device.id === command.deviceId);
        if (index >= 0) data.devices[index] = transitionCommand(data.devices[index], command);
      }
      job.resolve(command ? clone(command) : undefined);
    }
    jobs.clear();
  }
  function reset({ notify = true } = {}) {
    stopPending('演示已重置');
    sites = Object.fromEntries(DEMO_SITES.map(site => [site.siteCode, fixtures(site.siteCode)]));
    siteCode = 'demo-a'; scenario = 'normal'; outcome = 'ack'; route = 'SITE_API';
    auth = { configured: true, authenticated: true, status: 'authenticated', cachePartition: 'demo-user' };
    activeDeviceId = null; revision = (revision ?? 0) + 1; serial = 0; ai = undefined; snapshotAt = timestamp();
    weatherLocation = { timezone: 'Asia/Shanghai', latitude: 31.2, longitude: 121.4, locationSource: 'DEMO', locationUpdatedAt: snapshotAt };
    stats = { commandSubmits: 0, aiSends: 0, aiQueries: 0 }; events = [];
    log('独立演示已就绪；所有控制与回答均为模拟。');
    if (notify) emit();
  }
  function getModel() {
    const data = sites[siteCode], site = DEMO_SITES.find(value => value.siteCode === siteCode);
    const devices = clone(data.devices);
    for (const device of devices) {
      if (scenario === 'offline') device.connections.forEach(connection => { connection.status = 'DISCONNECTED'; });
      if (!auth.authenticated) device.capabilities.controls.forEach(control => { control.writable = false; });
      if (device.capabilities.controls.some(control => control.id === 'level')) {
        if (scenario === 'invalid') Object.assign(device.capabilities.controls.find(control => control.id === 'level'), { min: 20, max: 10 });
        if (scenario === 'unknown-value') delete device.reportedState.level;
        if (scenario === 'unknown') {
          device.localOnly = true;
          device.connections[0] = { ...device.connections[0], transport: 'BLE_DIRECT', profileId: null, status: 'CONNECTED' };
          device.capabilities = { known: false, controls: [] };
        }
      }
    }
    return { context: { organizationName: 'Glass Lab 演示园区', organizationCode: 'glass-lab', siteId: site.id, siteCode, siteName: site.siteName,
      spaceName: '装配与巡检空间', spacePath: '/workshop/assembly' }, sites: clone(DEMO_SITES), devices,
      activeDeviceId, auth: clone(auth), ai: clone(ai), startup: { phase: 'ready' },
      runtime: { accessRoute: route, stale: ['cache', 'offline'].includes(scenario) || !auth.authenticated, sessionRevision: revision, lastSyncedAt: snapshotAt },
      endpointProfile: { id: 'demo-memory', apiBaseUrl: '/__demo_memory', wsUrl: '', oidcIssuerUrl: '', oidcClientId: '' },
      connectionHealth: { status: scenario === 'offline' ? 'DISCONNECTED' : 'CONNECTED', stale: scenario === 'cache' },
      weather: { status: 'FRESH', updatedAt: snapshotAt, fetchedAt: snapshotAt, source: '本地合成天气样例', locationLabel: '演示园区 · 室外参考',
        current: { temperatureC: 24.6, relativeHumidityPct: 58, surfacePressureHpa: 1012, apparentTemperatureC: 24.1, windSpeedMps: 2.4,
          conditionText: '多云 · 模拟', iconKey: 'partly_cloudy', elevationM: 12 },
        indicators: { temperature: { level: 'SUITABLE', label: '舒适' }, humidity: { level: 'SUITABLE', label: '适宜' }, pressure: { level: 'SUITABLE', label: '平稳' },
          esdRisk: { level: 'OBSERVE', label: '室外参考', reason: '模拟样例，不代表现场 ESD 检测。' },
          condensationRisk: { level: 'OBSERVE', label: '室外参考', reason: '需结合设备表面温度判断，室外天气仅供参考。' } } },
      weatherSettings: { locationName: '演示园区', ...weatherLocation },
      commandsById: clone(data.commands), activities: clone(data.activities), lanCandidates: clone(data.candidates),
      ble: { native: false, available: true, candidate: data.bleCandidate ?? null,
        connection: data.devices.find(device => device.id === data.bleCandidate?.id)?.connections[0] ?? null },
      notices: [], resources: { devices: { phase: 'ready' }, sites: { phase: 'ready' }, activity: { phase: 'ready' } },
      commandObservation: {}, loading: {} };
  }
  function activity(type, deviceId, title, description, data = sites[siteCode]) {
    data.activities.unshift({ id: `activity-${++serial}`, eventType: type, deviceId, title, description, timestamp: timestamp() });
    data.activities = data.activities.slice(0, 80);
  }
  function validateCommand(payload) {
    const model = getModel(), device = model.devices.find(row => row.id === payload.deviceId);
    if (!auth.authenticated) throw new Error('请先模拟登录。');
    if (['cache', 'offline', 'unknown'].includes(scenario)) throw new Error('当前场景为只读，命令未提交。');
    if (!device || device.connections[0]?.status !== 'CONNECTED') throw new Error('设备不可控制。');
    if (Object.values(sites[siteCode].commands).some(command => command.deviceId === device.id && ['PENDING', 'SENT'].includes(command.status)))
      throw new Error('设备仍在等待回执，不能重复提交。');
    const capability = resolveDeviceCapabilities(device, device.connections[0]).controls.find(row => row.commandType === payload.type && row.writable && row.enabled);
    if (!capability) throw new Error('当前能力不支持此命令。');
    const value = payload.parameters?.[capability.parameterKey];
    if (capability.controlType === 'range') {
      const spec = rangeSpec(capability), reported = device.reportedState[capability.stateKey];
      if (!spec || reported == null || !Number.isFinite(Number(reported)) || !Number.isFinite(value) || value < spec.min || value > spec.max
        || Math.abs((value - spec.min) / spec.step - Math.round((value - spec.min) / spec.step)) > 1e-7)
        throw new Error('范围或上报状态无效，命令未提交。');
    }
    if (capability.controlType === 'toggle' && typeof value !== 'boolean') throw new Error('开关值无效。');
    if (capability.controlType === 'select' && !capability.options.some(option => option.value === value)) throw new Error('模式值无效。');
    return { device, desiredState: { ...device.reportedState, [capability.stateKey]: value } };
  }
  function sendCommand(payload) {
    const { desiredState } = validateCommand(payload);
    const targetSite = siteCode, data = sites[targetSite], id = `demo-command-${++serial}`;
    const result = outcome; // Capture at submission: changing the test selector cannot rewrite an accepted command.
    const command = { commandId: id, id, deviceId: payload.deviceId, type: payload.type, parameters: clone(payload.parameters),
      desiredState, status: 'PENDING', createdAt: timestamp(), updatedAt: timestamp() };
    data.commands[id] = command; stats.commandSubmits++;
    const updateDevice = () => {
      const index = data.devices.findIndex(device => device.id === command.deviceId);
      if (index >= 0) data.devices[index] = transitionCommand(data.devices[index], command);
    };
    updateDevice(); activity('COMMAND_CREATED', command.deviceId, '模拟命令已提交', `${payload.type} · 目标 ${JSON.stringify(payload.parameters)}`, data);
    log(`提交 ${id} · ${payload.type} · 等待模拟回执`); emit('command');
    return new Promise(resolve => {
      const job = { siteCode: targetSite, commandId: id, resolve, timer: null }; jobs.add(job);
      job.timer = timer.setTimeout(() => {
        command.status = 'SENT'; command.sentAt = timestamp(); command.updatedAt = timestamp(); updateDevice();
        if (targetSite === siteCode) emit('command');
        job.timer = timer.setTimeout(() => {
          jobs.delete(job);
          command.status = result === 'ack' ? 'ACKNOWLEDGED' : result === 'failed' ? 'FAILED' : 'UNCONFIRMED';
          command.updatedAt = timestamp();
          if (result === 'ack') { command.reportedState = clone(desiredState); command.acknowledgedAt = timestamp(); }
          else command.error = result === 'failed' ? '模拟设备拒绝执行；已上报状态保持不变。' : '模拟等待结束，执行结果尚未确认；不会自动重发。';
          updateDevice();
          activity(result === 'ack' ? 'COMMAND_ACKNOWLEDGED' : result === 'failed' ? 'COMMAND_FAILED' : 'COMMAND_UNCONFIRMED', command.deviceId,
            result === 'ack' ? '模拟回执已确认' : result === 'failed' ? '模拟执行失败' : '模拟结果未确认', command.error ?? '已上报状态已按模拟设备回执更新。', data);
          log(`${id} · ${command.status}`, result === 'ack' ? 'success' : 'warning');
          if (targetSite === siteCode) emit('command');
          resolve(clone(command));
        }, commandDelay);
      }, 100);
    });
  }
  reset({ notify: false });
  return {
    getModel, sendCommand,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setAi(value) { ai = value; emit('ai'); },
    setActiveDevice(id) { activeDeviceId = id; },
    async switchSite({ siteCode: next }) {
      if (!DEMO_SITES.some(site => site.siteCode === next)) throw new Error('不存在该演示站点。');
      stopPending('站点已切换，本地等待已结束；结果未确认。');
      siteCode = next; activeDeviceId = null; scenario = 'normal'; revision++; ai = undefined;
      log('切换到 ' + DEMO_SITES.find(site => site.siteCode === next).siteName); emit('context');
    },
    setScenario(value) {
      if (!['normal', 'cache', 'offline', 'unknown', 'invalid', 'unknown-value'].includes(value)) return;
      stopPending('场景已切换，旧等待结果未确认。'); scenario = value; revision++;
      log('设备场景 → ' + value); emit('context');
    },
    getSettings: () => ({ scenario, outcome, commandDelay, siteCode }),
    setOutcome(value) { if (['ack', 'failed', 'unconfirmed'].includes(value)) { outcome = value; emit('panel'); } },
    setDelay(value) { if (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 6000) commandDelay = Number(value); },
    setRoute(value) { if (['SITE_API', 'CLOUD_API'].includes(value)) { stopPending('模拟链路已切换。'); route = value; revision++; log('模拟链路 → ' + value); emit('context'); } },
    setAuthenticated(value) {
      stopPending('模拟身份状态已切换。'); auth.authenticated = Boolean(value); auth.status = value ? 'authenticated' : 'signed_out'; revision++;
      log(value ? '模拟账号已登录' : '模拟账号已退出'); emit('context');
    },
    async refresh() { snapshotAt = timestamp(); log('刷新本地设备与天气快照'); emit('full'); return { presentation: { status: 'updated', message: '模拟快照已刷新' } }; },
    async updateWeatherLocation({ latitude, longitude, timezone = 'Asia/Shanghai', locationSource = 'MANUAL' }) {
      const lat = Number(latitude), lon = Number(longitude);
      if (latitude == null || longitude == null || String(latitude).trim() === '' || String(longitude).trim() === ''
        || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('模拟坐标无效。');
      try { new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }); } catch { throw new Error('模拟时区无效。'); }
      snapshotAt = timestamp(); weatherLocation = { latitude: lat, longitude: lon, timezone, locationSource, locationUpdatedAt: snapshotAt };
      log('模拟天气位置已更新；天气数值仍为固定样例。'); emit('full');
      return { presentation: { status: 'updated', message: '模拟位置已保存' } };
    },
    async reconnect() { scenario = 'normal'; log('模拟连接已恢复'); emit('context'); },
    async discoverLan() {
      sites[siteCode].candidates = [demoLamp(siteCode, 'new-light-01', '新增工位照明')]
        .filter(candidate => !sites[siteCode].devices.some(device => device.id === candidate.id));
      log('模拟发现完成'); emit();
    },
    async claimLan(payload) {
      const data = sites[siteCode], candidate = data.candidates.find(row => row.id === payload.candidateId);
      if (!candidate || payload.siteCode !== siteCode || !payload.displayName?.trim() || !payload.spacePath?.startsWith('/')) throw new Error('请核对演示站点、名称和空间路径。');
      const device = { ...candidate, displayName: payload.displayName.trim(), spacePath: payload.spacePath };
      data.devices.push(device); data.candidates = data.candidates.filter(row => row.id !== candidate.id);
      activity('DEVICE_CLAIMED', device.id, '演示设备已认领', device.displayName); log('认领 ' + device.displayName); emit();
      return { device: clone(device), presentation: { status: 'updated', message: '演示设备已认领' } };
    },
    async requestBle() {
      let device = sites[siteCode].devices.find(device => device.id.endsWith('ble-01'));
      if (!device) {
        device = demoLamp(siteCode, 'ble-01', '便携巡检照明'); device.localOnly = true;
        device.connections[0] = { ...device.connections[0], transport: 'BLE_DIRECT', status: 'DISCONNECTED', endpoint: '模拟 BLE · 不访问硬件' };
        sites[siteCode].devices.push(device);
      }
      sites[siteCode].bleCandidate = clone(device);
      log('已列出演示蓝牙设备'); emit();
    },
    async connectBle() {
      const device = sites[siteCode].devices.find(row => row.id.endsWith('ble-01'));
      device.connections[0].status = 'CONNECTED'; sites[siteCode].bleCandidate = clone(device);
      activity('DEVICE_CONNECTED', device.id, '模拟蓝牙已连接', '可打开设备详情测试控制。'); log('模拟蓝牙已连接'); emit();
    },
    async disconnectBle({ deviceId }) {
      stopPending('模拟蓝牙已断开。');
      const device = sites[siteCode].devices.find(row => row.id === deviceId);
      if (device) { device.connections[0].status = 'DISCONNECTED'; activity('DEVICE_DISCONNECTED', device.id, '模拟蓝牙已断开', '重新连接后才可控制。'); }
      log('模拟蓝牙已断开'); emit();
    },
    async forgetBle({ deviceId }) {
      sites[siteCode].devices = sites[siteCode].devices.filter(device => device.id !== deviceId); sites[siteCode].bleCandidate = null; log('已移出演示蓝牙设备'); emit();
    },
    noteAi(kind, message) { if (kind === 'send') stats.aiSends++; if (kind === 'query') stats.aiQueries++; log(message); emit('panel'); },
    getDiagnostics: () => clone({ settings: { scenario, outcome, commandDelay, siteCode }, stats, events, commands: sites[siteCode].commands }),
    reset,
    destroy() { stopPending('演示已关闭'); listeners.clear(); }
  };
}
