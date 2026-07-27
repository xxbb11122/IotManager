import './css/style.css';

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { resolveClientConfig } from './js/api.js';
import { createLocalBleDevice, decorateLanDevice, mergePlatformAndLocalDevices } from './js/client-flow.js';
import { isTerminalCommandStatus } from './js/command-state.js';
import { BleAdapter } from './js/adapters/ble-adapter.js';
import { NativeBleAdapter } from './js/adapters/native-ble-adapter.js';
import { attachAppLifecycle } from './js/platform/app-lifecycle.js';
import { CacheRepository } from './js/platform/cache-repository.js';
import { createCommandDispatcher } from './js/platform/command-dispatcher.js';
import { createPlatformAdapter } from './js/platform/platform-adapter-factory.js';
import { ACCESS_ROUTES, RuntimeConfigRepository } from './js/platform/runtime-config.js';
import { store } from './js/store.js';
import { createClientUi } from './js/ui.js';

const DEMO_CONTEXT = Object.freeze({
  organizationName: '演示组织',
  organizationCode: 'demo-org',
  siteName: '演示站点',
  siteCode: 'demo-site',
  spaceName: '现场空间',
  spacePath: '/operations/field'
});

const DEMO_PLATFORM_CAPABILITIES = Object.freeze({
  controls: Object.freeze([
    Object.freeze({ id: 'power', commandType: 'set_power', writable: true }),
    Object.freeze({ id: 'level', commandType: 'set_level', writable: true }),
    Object.freeze({ id: 'mode', commandType: 'set_mode', writable: true })
  ])
});

const nativeRuntime = Capacitor.isNativePlatform();
const runtimeConfigRepository = new RuntimeConfigRepository();
const cacheRepository = new CacheRepository();
let platformSession = null;
let platform = null;
let endpointProfile = null;
let ble = nativeRuntime ? new NativeBleAdapter() : new BleAdapter();
let platformUnsubscribers = [];
let lifecycleHandle = null;
let appInstallId = null;
let resyncPromise = null;

let clientState = {
  context: DEMO_CONTEXT,
  endpointProfile: null,
  lanCandidates: [],
  ble: {
    availability: ble.availability().available,
    reason: ble.availability().reason ?? null,
    candidate: null,
    connection: null,
    errorCode: null,
    native: nativeRuntime
  },
  loading: {},
  error: null
};

const ui = createClientUi(document.getElementById('app'), {
  setTab: () => {},
  openAddDevice: () => setClientState({ error: null }),
  chooseAddPath: () => setClientState({ error: null }),
  requestBle,
  connectBle,
  discoverLan,
  selectLanCandidate: () => {},
  claimLan,
  openDevice,
  sendCommand,
  retryCommand,
  reconnectRealtime,
  switchEndpoint: activateEndpoint,
  openBleAppSettings: () => ble.openAppSettings?.(),
  openBluetoothSettings: () => ble.openBluetoothSettings?.(),
  dismissError: () => setClientState({ error: null })
});

store.subscribe(() => render(), { emitCurrent: true });

const unsubscribeBle = ble.subscribe((event) => {
  if (event.type !== 'connection_update') {
    store.applyRealtimeEvent(event);
    return;
  }

  const rawConnection = event.payload ?? {};
  const pluginDeviceId = rawConnection.deviceId ?? rawConnection.id ?? clientState.ble.candidate?.deviceId ?? clientState.ble.candidate?.id;
  const connection = { ...rawConnection, deviceId: pluginDeviceId };
  setClientState({ ble: { connection, errorCode: null } });
  store.setActiveConnection(connection);

  const existing = store.selectDevice(pluginDeviceId);
  const candidate = clientState.ble.candidate ?? existing ?? { deviceId: pluginDeviceId, name: connection.name };
  if (pluginDeviceId) {
    const device = createLocalBleDevice(candidate, connection, clientState.context);
    store.upsertDevice(device);
    void persistBleBinding(device, connection);
  }
});

const dispatchCommand = createCommandDispatcher({
  getPlatform: () => platform,
  getEndpointProfile: () => endpointProfile,
  getBleAdapter: () => ble,
  getBleConnected: () => clientState.ble.connection?.status === 'CONNECTED',
  isPlatformStale: () => store.getState().runtime.stale,
  onCommand: (command) => {
    store.upsertCommand(command);
    if (command.accessRoute === 'BLE_LOCAL' && isTerminalCommandStatus(command.status)) {
      const pluginDeviceId = clientState.ble.connection?.deviceId;
      if (pluginDeviceId && appInstallId) {
        void persistLocalCommandActivity(`${appInstallId}:${pluginDeviceId}`, command);
      }
    }
  }
});

function viewModel() {
  return { ...store.getState(), ...clientState, endpointProfile };
}

function render() {
  ui.render(viewModel());
}

function setClientState(patch = {}) {
  clientState = {
    ...clientState,
    ...patch,
    context: { ...clientState.context, ...(patch.context ?? {}) },
    loading: { ...clientState.loading, ...(patch.loading ?? {}) },
    ble: { ...clientState.ble, ...(patch.ble ?? {}) }
  };
  render();
}

function setLoading(key, value) {
  setClientState({ loading: { [key]: value } });
}

function describeError(error) {
  if (error?.message === 'Failed to fetch') return '平台连接失败，请在连接设置中检查 API 地址。';
  return error?.message || '操作未完成，请检查服务连接后重试。';
}

function isBlePickerCancellation(error) {
  return error?.name === 'NotFoundError' || error?.name === 'AbortError';
}

function platformCacheScope() {
  return {
    endpointId: endpointProfile?.id,
    organizationCode: endpointProfile?.organizationCode ?? clientState.context.organizationCode
  };
}

function bindPlatformEvents(adapter) {
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  platformUnsubscribers = [
    adapter.subscribe((event) => store.applyRealtimeEvent(event)),
    adapter.subscribeStatus((health) => {
      store.setConnectionHealth(health);
      if (health.state === 'connected') void resyncAfterRealtimeConnect();
    }, { emitCurrent: true })
  ];
}

async function activateEndpoint(profile) {
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  platformUnsubscribers = [];
  platform?.disconnect();
  endpointProfile = await runtimeConfigRepository.save(profile);
  platformSession = createPlatformAdapter({ endpointProfile });
  platform = platformSession.adapter;
  clientState = { ...clientState, endpointProfile };
  bindPlatformEvents(platform);
  store.setRuntimeContext({
    accessRoute: endpointProfile.accessRoute,
    endpointId: endpointProfile.id,
    stale: true,
    lastSyncedAt: null
  });
  await refreshDevices();
  platform.connect();
  render();
  return endpointProfile;
}

async function refreshDevices({ refreshActiveActivity = true } = {}) {
  const scope = platformCacheScope();
  try {
    if (!platform) throw new Error('Platform endpoint is unavailable');
    const devices = await platform.listDevices();
    const decorated = devices.map((device) => decorateLanDevice(device, DEMO_PLATFORM_CAPABILITIES));
    const merged = mergePlatformAndLocalDevices(decorated, store.getState().devices);
    store.setDevices(merged);
    await cacheRepository.replacePlatformDevices({ ...scope, devices: decorated });
    store.setRuntimeContext({ stale: false, lastSyncedAt: Date.now() });
    setClientState({ error: null });

    const active = store.selectActiveDevice();
    if (refreshActiveActivity && active && !active.localOnly) await loadActivity(active);
    return merged;
  } catch (error) {
    const snapshot = await cacheRepository.getPlatformSnapshot(scope);
    const merged = mergePlatformAndLocalDevices(snapshot.devices, store.getState().devices);
    store.setDevices(merged);
    store.setRuntimeContext({ stale: true, lastSyncedAt: snapshot.cachedAt });
    setClientState({ error: snapshot.devices.length ? null : describeError(error) });
    return merged;
  }
}

async function loadActivity(device) {
  if (!device || device.localOnly || device.id === null || device.id === undefined || !platform) return [];
  const activity = await platform.listActivity(device.id);
  activity.forEach((entry) => store.addActivity(device.id, entry));
  return activity;
}

async function resyncAfterRealtimeConnect() {
  if (resyncPromise) return resyncPromise;
  resyncPromise = refreshDevices({ refreshActiveActivity: true }).finally(() => {
    resyncPromise = null;
  });
  return resyncPromise;
}

async function loadAppInstallId(preferences = Preferences) {
  const key = 'iot-manager.app-install-id.v1';
  const existing = await preferences.get({ key });
  if (existing.value) return existing.value;
  const value = globalThis.crypto?.randomUUID?.() ?? `install-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await preferences.set({ key, value });
  return value;
}

async function restoreLocalBindings() {
  for (const binding of await cacheRepository.listLocalBindings()) {
    const device = {
      id: `ble:${binding.pluginDeviceId}`,
      deviceId: binding.pluginDeviceId,
      name: binding.displayName,
      localOnly: true,
      status: binding.lastConnectionState === 'CONNECTED' ? 'ONLINE' : 'OFFLINE',
      reportedState: binding.lastReportedState ?? {},
      desiredState: binding.lastReportedState ?? {},
      pendingOrganizationContext: binding.pendingOrganizationContext ?? {},
      connections: [{
        transport: 'BLE_DIRECT',
        status: binding.lastConnectionState ?? 'DISCONNECTED',
        profileId: binding.profileId ?? null
      }]
    };
    store.upsertDevice(device);
    for (const activity of await cacheRepository.listLocalActivity(binding.key)) {
      store.addActivity(device.id, activity);
    }
  }
}

async function persistBleBinding(device, connection) {
  if (!appInstallId || !connection.deviceId) return null;
  return cacheRepository.putLocalBinding({
    appInstallId,
    pluginDeviceId: connection.deviceId,
    profileId: connection.profileId,
    displayName: device.name,
    lastConnectionState: connection.status,
    lastReportedState: device.reportedState ?? {},
    pendingOrganizationContext: device.pendingOrganizationContext ?? {}
  });
}

async function persistLocalCommandActivity(bindingKey, command) {
  const activity = {
    id: `ble:${command.commandId}`,
    bindingKey,
    eventType: command.status === 'ACKNOWLEDGED' ? 'command_acknowledged' : command.status === 'FAILED' ? 'command_failed' : 'command_unconfirmed',
    detail: command.status,
    payload: command
  };
  const stored = await cacheRepository.addLocalActivity(activity);
  store.addActivity(command.deviceId, stored);
  return stored;
}

async function bootstrapRuntime() {
  appInstallId = await loadAppInstallId();
  await restoreLocalBindings();
  const saved = await runtimeConfigRepository.load();
  const defaults = nativeRuntime
    ? { apiBaseUrl: 'http://10.0.2.2:8080/api', wsUrl: 'ws://10.0.2.2:8080/ws/devices' }
    : resolveClientConfig();
  const profile = saved ?? {
    id: 'local-site',
    accessRoute: ACCESS_ROUTES.SITE_API,
    apiBaseUrl: defaults.apiBaseUrl,
    wsUrl: defaults.wsUrl,
    organizationCode: clientState.context.organizationCode
  };
  await activateEndpoint(profile);
  lifecycleHandle = await attachAppLifecycle({
    onBackground: async () => {
      await ble.stopScan?.();
      platform?.disconnect();
      store.setRuntimeContext({ stale: true });
    },
    onForeground: async () => {
      ble.availability();
      await ble.verifyConnection?.();
      await refreshDevices();
      platform?.connect();
    }
  });
}

async function requestBle() {
  setClientState({ error: null, ble: { errorCode: null } });
  if (nativeRuntime) {
    setLoading('blePicker', true);
    try {
      await ble.scan((candidate) => {
        setClientState({ ble: { candidate, connection: null, errorCode: null } });
      });
      return null;
    } catch (error) {
      setClientState({ ble: { errorCode: error.code ?? null } });
      throw error;
    } finally {
      setLoading('blePicker', false);
    }
  }

  const picker = ble.requestCandidate();
  setLoading('blePicker', true);
  try {
    const candidate = await picker;
    setClientState({ ble: { candidate, connection: null, errorCode: null } });
    return candidate;
  } catch (error) {
    if (isBlePickerCancellation(error)) return null;
    setClientState({ ble: { errorCode: error.code ?? null } });
    throw error;
  } finally {
    setLoading('blePicker', false);
  }
}

async function connectBle() {
  if (!clientState.ble.candidate) throw new Error('请先选择蓝牙设备。');
  setLoading('bleConnect', true);
  try {
    await ble.stopScan?.().catch?.(() => {});
    const connection = await ble.connect(clientState.ble.candidate);
    const normalized = {
      ...connection,
      deviceId: connection.deviceId ?? connection.id ?? clientState.ble.candidate.deviceId ?? clientState.ble.candidate.id,
      capabilities: ble.getCapabilities()
    };
    const device = createLocalBleDevice(clientState.ble.candidate, normalized, clientState.context);
    store.upsertDevice(device);
    store.setActiveConnection(normalized);
    store.setActiveDevice(device.id);
    setClientState({ ble: { connection: normalized, errorCode: null }, error: null });
    await persistBleBinding(device, normalized);
    ui.notify('蓝牙设备已连接。', 'success');
    return normalized;
  } catch (error) {
    setClientState({ ble: { errorCode: error.code ?? null } });
    throw error;
  } finally {
    setLoading('bleConnect', false);
  }
}

async function discoverLan({ siteCode } = {}) {
  const scopedSiteCode = siteCode || clientState.context.siteCode;
  setLoading('lanDiscovery', true);
  setClientState({ error: null });
  try {
    const candidates = await platform.discoverLan({ siteCode: scopedSiteCode });
    setClientState({ lanCandidates: candidates });
    return candidates;
  } finally {
    setLoading('lanDiscovery', false);
  }
}

async function claimLan({ candidateId, displayName, siteCode, spacePath }) {
  const candidate = clientState.lanCandidates.find((item) => String(item.candidateId) === String(candidateId));
  if (!candidate) throw new Error('该候选设备已不存在，请重新发现。');
  setLoading('lanClaim', true);
  try {
    const device = await platform.claimLan(candidate, { displayName, siteCode, spacePath });
    const decorated = decorateLanDevice(device, DEMO_PLATFORM_CAPABILITIES);
    store.upsertDevice(decorated);
    store.setActiveDevice(decorated.id);
    setClientState({
      lanCandidates: clientState.lanCandidates.filter((item) => item.candidateId !== candidate.candidateId),
      error: null
    });
    await loadActivity(decorated);
    ui.notify('局域网设备已认领。', 'success');
    return decorated;
  } finally {
    setLoading('lanClaim', false);
  }
}

async function openDevice({ deviceId }) {
  const device = store.selectDevice(deviceId);
  if (!device) throw new Error('未找到设备，请先刷新列表。');
  store.setActiveDevice(device.id);
  if (!device.localOnly) {
    try {
      await loadActivity(device);
    } catch (error) {
      setClientState({ error: describeError(error) });
    }
  }
  return device;
}

async function sendCommand({ deviceId, type, parameters }) {
  const device = store.selectDevice(deviceId);
  if (!device) throw new Error('未找到待控制设备。');
  const routedPlatform = platform;
  const command = await dispatchCommand({ device, type, parameters });
  if (command.accessRoute !== 'BLE_LOCAL' && !isTerminalCommandStatus(command.status)) {
    void pollCommand(command.commandId, routedPlatform);
  }
  return command;
}

async function retryCommand({ commandId, deviceId }) {
  const command = store.getState().commandsById[commandId];
  if (!command) throw new Error('未找到要重试的命令。');
  return sendCommand({
    deviceId: deviceId ?? command.deviceId,
    type: command.type,
    parameters: command.parameters ?? {}
  });
}

async function pollCommand(commandId, adapter, attempts = 24, delayMs = 500) {
  if (!adapter) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(delayMs);
    try {
      const command = await adapter.getCommand(commandId);
      store.upsertCommand(command);
      if (isTerminalCommandStatus(command.status)) return command;
    } catch {
      return null;
    }
  }
  return null;
}

function wait(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function reconnectRealtime() {
  platform?.connect();
  return resyncAfterRealtimeConnect();
}

window.addEventListener('beforeunload', () => {
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  unsubscribeBle();
  void lifecycleHandle?.remove?.();
  platform?.disconnect();
  void ble.disconnect?.();
});

void bootstrapRuntime().catch((error) => {
  setClientState({ error: describeError(error) });
});
