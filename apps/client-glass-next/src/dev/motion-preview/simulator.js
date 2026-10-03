import { syntheticDevice } from './fixtures.js';

/** A closed synthetic boundary: no adapters, storage, transport or platform imports. */
export function createPreviewSimulator({ getModel, updateModel, notify, onChange = () => {}, options = {} }) {
  let disposed = false;
  let sequence = 0;
  let configuration = { delayMs: 800, outcome: 'success', ...options };
  const timers = new Map();
  const calls = [];
  const record = (name, payload = {}) => {
    calls.push({ sequence: ++sequence, name, payload: structuredClone(payload), synthetic: true });
    onChange();
  };
  const mutate = (callback) => {
    if (disposed) return;
    const model = structuredClone(getModel());
    callback(model);
    updateModel(model);
    onChange();
  };
  const delay = (duration) => new Promise((resolve, reject) => {
    if (disposed) return reject(new Error('合成场景已重置'));
    const timer = setTimeout(() => { timers.delete(timer); onChange(); resolve(); }, duration);
    timers.set(timer, reject);
    onChange();
  });
  const task = (name, apply = () => ({})) => async (payload = {}) => {
    record(name, payload);
    const { delayMs, outcome } = configuration;
    const scope = getModel().runtime.sessionRevision;
    await delay(delayMs);
    if (disposed || getModel().runtime.sessionRevision !== scope) return { status: 'superseded' };
    if (outcome === 'failed') throw new Error(`合成失败：${name} 未完成；没有发出真实请求。`);
    return apply(payload, outcome) ?? { status: 'updated' };
  };
  const immediate = (name, apply = () => undefined) => (payload = {}) => { record(name, payload); return apply(payload); };
  const handlers = {
    setTab: immediate('setTab'), openAddDevice: immediate('openAddDevice'), chooseAddPath: immediate('chooseAddPath'),
    selectLanCandidate: immediate('selectLanCandidate'), dismissError: immediate('dismissError', () => mutate((model) => { model.error = null; })),
    openDevice: immediate('openDevice', ({ deviceId }) => mutate((model) => { model.activeDeviceId = deviceId; })),
    openWeather: immediate('openWeather'),
    selectBleCandidate: immediate('selectBleCandidate', ({ candidateId }) => mutate((model) => {
      model.ble.selectedCandidateId = candidateId;
      model.ble.candidate = model.ble.candidates.find((candidate) => candidate.id === candidateId);
    })),
    openBleAppSettings: immediate('openBleAppSettings', () => notify('合成设置交接意图已记录；未打开系统设置。')),
    openBluetoothSettings: immediate('openBluetoothSettings', () => notify('合成蓝牙设置意图已记录；未打开系统设置。')),
    pullRefresh: task('pullRefresh', (_, outcome) => {
      mutate((model) => { model.runtime.stale = false; });
      return { status: outcome === 'partial' ? 'partial' : 'updated', message: outcome === 'partial' ? '合成部分更新；缓存写入失败。' : '合成数据已更新。' };
    }),
    refreshWeather: task('refreshWeather', (_, outcome) => {
      mutate((model) => { model.weather.fetchedAt = new Date().toISOString(); model.weather.status = 'FRESH'; });
      return { status: outcome === 'partial' ? 'partial' : 'updated' };
    }),
    requestBle: task('requestBle', () => mutate((model) => {
      model.ble.scanning = true;
      model.ble.candidates = [{ id: 'preview-scan-1', name: '合成扫描设备', profileId: 'preview-relay', rssi: -48 }];
      model.ble.candidate = model.ble.candidates[0];
    })),
    stopBleScan: task('stopBleScan', () => mutate((model) => { model.ble.scanning = false; model.loading.blePicker = false; })),
    connectBle: task('connectBle', () => mutate((model) => {
      model.ble.connection = { deviceId: model.ble.candidate.deviceId ?? model.ble.candidate.id,
        profileId: model.ble.candidate.profileId ?? null, status: 'CONNECTED', transport: 'BLE_DIRECT' };
    })),
    disconnectBle: task('disconnectBle', () => mutate((model) => {
      model.ble.connection.status = 'DISCONNECTED';
      model.devices.forEach((device) => device.connections.filter((connection) => connection.transport === 'BLE_DIRECT').forEach((connection) => { connection.status = 'DISCONNECTED'; }));
    })),
    forgetBle: task('forgetBle', ({ deviceId }) => mutate((model) => { model.devices = model.devices.filter((device) => device.id !== deviceId); })),
    discoverLan: task('discoverLan', () => mutate((model) => {
      model.lanCandidates = [{ id: 'preview-candidate-1', candidateId: 'preview-candidate-1', name: '合成候选灯具', displayName: '合成候选灯具', profileId: 'preview-relay' }];
      model.resources.lanDiscovery = { phase: 'ready', source: 'network' };
    })),
    claimLan: task('claimLan', ({ candidateId, displayName }, outcome) => {
      mutate((model) => {
        model.devices.push(syntheticDevice('preview-claimed', { displayName }));
        model.lanCandidates = model.lanCandidates.filter((candidate) => candidate.id !== candidateId);
        if (outcome === 'partial') model.notices = [{ id: 'preview-partial', tone: 'warning', message: '合成认领成功；活动读取失败，请勿重复认领。' }];
      });
      return { status: outcome === 'partial' ? 'partial' : 'updated' };
    }),
    switchSite: task('switchSite', ({ siteCode }) => mutate((model) => {
      const site = model.sites.find((item) => item.siteCode === siteCode);
      if (site) Object.assign(model.context, site);
      model.runtime.sessionRevision += 1;
      model.devices = model.devices.map((device) => ({ ...device, siteCode }));
    })),
    testEndpoint: task('testEndpoint', (_, outcome) => ({ ok: outcome !== 'partial', partial: outcome === 'partial', status: outcome === 'partial' ? 'partial' : 'updated', message: outcome === 'partial' ? '合成 REST 可用，WebSocket 不可用。未建立网络连接。' : '合成测试通过；尚未保存或切换。' })),
    switchEndpoint: task('switchEndpoint', (payload) => mutate((model) => {
      model.endpointProfile = { ...model.endpointProfile, ...payload };
      model.runtime.sessionRevision += 1;
    })),
    signIn: task('signIn', () => mutate((model) => { model.auth = { configured: true, authenticated: true, status: 'authenticated' }; })),
    signOut: task('signOut', () => mutate((model) => {
      model.auth = { configured: true, authenticated: false, status: 'unauthenticated' };
      model.devices = []; model.sites = []; model.activitiesByDeviceId = {}; model.weather = {};
      model.runtime.sessionRevision += 1;
    })),
    reconnectRealtime: task('reconnectRealtime', () => mutate((model) => { model.connectionHealth = { status: 'CONNECTED' }; model.runtime.stale = false; }))
  };
  const location = (name) => task(name, (payload, outcome) => {
    mutate((model) => {
      model.weatherSettings = { ...model.weatherSettings, latitude: Number(payload.latitude ?? 0), longitude: Number(payload.longitude ?? 0), timezone: payload.timezone || 'UTC', locationSource: 'MANUAL' };
      model.pendingWeatherLocation = null;
      if (outcome === 'partial') model.notices = [{ id: 'preview-location-partial', tone: 'warning', message: '合成位置保存成功；预报读取失败。' }];
    });
    return { status: outcome === 'partial' ? 'partial' : 'updated' };
  });
  handlers.updateWeatherFromDeviceLocation = location('updateWeatherFromDeviceLocation');
  handlers.updateWeatherFromManualLocation = location('updateWeatherFromManualLocation');
  handlers.retryPendingWeatherLocation = location('retryPendingWeatherLocation');
  handlers.sendCommand = async (payload) => {
    record('sendCommand', payload);
    const { delayMs, outcome } = configuration;
    const commandId = `preview-command-${sequence}`;
    const desiredState = payload.desiredState ?? {};
    mutate((model) => {
      model.commandsById[commandId] = { id: commandId, commandId, deviceId: payload.deviceId, type: payload.type, status: 'PENDING', createdAt: new Date().toISOString() };
      const device = model.devices.find((item) => item.id === payload.deviceId);
      if (device) Object.assign(device.desiredState, desiredState);
    });
    await delay(Math.floor(delayMs / 3));
    mutate((model) => { if (model.commandsById[commandId]) model.commandsById[commandId].status = 'SENT'; });
    await delay(Math.ceil(delayMs * 2 / 3));
    mutate((model) => {
      const command = model.commandsById[commandId];
      if (!command) return;
      const device = model.devices.find((item) => item.id === payload.deviceId);
      command.status = outcome === 'failed' ? 'FAILED' : outcome === 'unconfirmed' ? 'UNCONFIRMED' : 'ACKNOWLEDGED';
      if (command.status === 'ACKNOWLEDGED' && device) Object.assign(device.reportedState, desiredState);
      if (command.status === 'FAILED') command.error = '合成设备明确拒绝';
      if (device && ['FAILED', 'UNCONFIRMED'].includes(command.status)) device.desiredState = { ...device.reportedState };
    });
    return { commandId };
  };
  handlers.retryCommand = ({ deviceId }) => handlers.sendCommand({ deviceId, type: 'set_relay_a', desiredState: { relay_a: true } });
  return {
    handlers,
    configure(next) {
      const delayMs = Math.max(0, Math.min(10000, Number(next.delayMs ?? configuration.delayMs) || 0));
      const outcome = ['success', 'failed', 'unconfirmed', 'partial'].includes(next.outcome) ? next.outcome : configuration.outcome;
      configuration = { delayMs, outcome };
    },
    snapshot: () => ({ calls: structuredClone(calls), pendingTimers: timers.size, configuration: { ...configuration }, disposed }),
    dispose() {
      disposed = true;
      for (const [timer, reject] of timers) { clearTimeout(timer); reject(new Error('合成场景已重置，任务已取消。')); }
      timers.clear();
      onChange();
    }
  };
}
