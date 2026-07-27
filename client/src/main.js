import './css/style.css';

import { ApiClient, createIdempotencyKey } from './js/api.js';
import {
  createLocalBleDevice,
  decorateLanDevice,
  mergePlatformAndLocalDevices
} from './js/client-flow.js';
import { isTerminalCommandStatus } from './js/command-state.js';
import { BleAdapter } from './js/adapters/ble-adapter.js';
import { LanMockAdapter } from './js/adapters/lan-mock-adapter.js';
import { RealtimeClient } from './js/realtime.js';
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

const api = new ApiClient();
const realtime = new RealtimeClient();
const lan = new LanMockAdapter({ api, realtime });
const ble = new BleAdapter();

let clientState = {
  context: DEMO_CONTEXT,
  lanCandidates: [],
  ble: {
    availability: ble.availability().available,
    reason: ble.availability().reason,
    candidate: null,
    connection: null
  },
  loading: {},
  error: null
};
let resyncPromise = null;

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
  dismissError: () => setClientState({ error: null })
});

store.subscribe(() => render(), { emitCurrent: true });

const unsubscribeRealtime = realtime.subscribe((event) => {
  store.applyRealtimeEvent(event);
});

const unsubscribeRealtimeHealth = realtime.subscribeStatus((health) => {
  store.setConnectionHealth(health);
  if (health.state === 'connected') {
    void resyncAfterRealtimeConnect();
  }
}, { emitCurrent: true });

const unsubscribeBle = ble.subscribe((event) => {
  if (event.type === 'connection_update') {
    const connection = event.payload;
    setClientState({ ble: { connection } });
    store.setActiveConnection(connection);
    if (clientState.ble.candidate) {
      store.upsertDevice(createLocalBleDevice(clientState.ble.candidate, connection, clientState.context));
    }
    return;
  }
  store.applyRealtimeEvent(event);
});

function viewModel() {
  return { ...store.getState(), ...clientState };
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
  return error?.message || '操作未完成，请检查服务连接后重试。';
}

function isBlePickerCancellation(error) {
  return error?.name === 'NotFoundError' || error?.name === 'AbortError';
}

function isLocalBleDevice(device) {
  return device?.localOnly === true || (device?.connections ?? []).some((connection) => (
    String(connection?.transport ?? '').toUpperCase().includes('BLE')
  ));
}

async function refreshDevices({ refreshActiveActivity = true } = {}) {
  const devices = await api.listDevices();
  const decorated = devices.map((device) => decorateLanDevice(device, lan.getCapabilities()));
  const merged = mergePlatformAndLocalDevices(decorated, store.getState().devices);
  store.setDevices(merged);

  const active = store.selectActiveDevice();
  if (refreshActiveActivity && active && !active.localOnly) {
    await loadActivity(active);
  }
  return merged;
}

async function loadActivity(device) {
  if (!device || device.localOnly || device.id === null || device.id === undefined) {
    return [];
  }
  const activity = await api.listActivity(device.id);
  activity.forEach((entry) => store.addActivity(device.id, entry));
  return activity;
}

async function resyncAfterRealtimeConnect() {
  if (resyncPromise) {
    return resyncPromise;
  }
  resyncPromise = refreshDevices({ refreshActiveActivity: true })
    .then(() => setClientState({ error: null }))
    .catch((error) => setClientState({ error: describeError(error) }))
    .finally(() => {
      resyncPromise = null;
    });
  return resyncPromise;
}

async function bootstrap() {
  setLoading('devices', true);
  try {
    await refreshDevices({ refreshActiveActivity: false });
    setClientState({ error: null });
  } catch (error) {
    setClientState({ error: describeError(error) });
  } finally {
    setLoading('devices', false);
  }
}

async function requestBle() {
  setClientState({ error: null });
  // Call requestCandidate before any await so the browser retains the click gesture.
  const picker = ble.requestCandidate();
  setLoading('blePicker', true);
  try {
    const candidate = await picker;
    setClientState({ ble: { candidate, connection: null } });
    return candidate;
  } catch (error) {
    if (isBlePickerCancellation(error)) {
      return null;
    }
    throw error;
  } finally {
    setLoading('blePicker', false);
  }
}

async function connectBle() {
  if (!clientState.ble.candidate) {
    throw new Error('请先从浏览器选择蓝牙设备。');
  }
  setLoading('bleConnect', true);
  try {
    const connection = await ble.connect(clientState.ble.candidate);
    const device = createLocalBleDevice(clientState.ble.candidate, connection, clientState.context);
    store.upsertDevice(device);
    store.setActiveConnection(connection);
    store.setActiveDevice(device.id);
    setClientState({ ble: { connection }, error: null });
    ui.notify('蓝牙设备已连接。', 'success');
    return connection;
  } finally {
    setLoading('bleConnect', false);
  }
}

async function discoverLan({ siteCode } = {}) {
  const scopedSiteCode = siteCode || clientState.context.siteCode;
  setLoading('lanDiscovery', true);
  setClientState({ error: null });
  try {
    const candidates = await lan.requestCandidate({ siteCode: scopedSiteCode });
    setClientState({ lanCandidates: candidates });
    return candidates;
  } finally {
    setLoading('lanDiscovery', false);
  }
}

async function claimLan({ candidateId, displayName, siteCode, spacePath }) {
  const candidate = clientState.lanCandidates.find((item) => String(item.candidateId) === String(candidateId));
  if (!candidate) {
    throw new Error('该候选设备已不存在，请重新发现。');
  }

  setLoading('lanClaim', true);
  try {
    const device = await lan.connect(candidate, { displayName, siteCode, spacePath });
    const decorated = decorateLanDevice(device, lan.getCapabilities());
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
  if (!device) {
    throw new Error('未找到设备，请先刷新列表。');
  }
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
  if (!device) {
    throw new Error('未找到待控制设备。');
  }
  if (isLocalBleDevice(device)) {
    return sendBleCommand(device, type, parameters);
  }

  const command = await lan.sendCommand({ deviceId: device.id, type, parameters });
  store.upsertCommand(command);
  void pollCommand(command.commandId);
  return command;
}

async function sendBleCommand(device, type, parameters) {
  const command = {
    commandId: createIdempotencyKey('ble-command'),
    deviceId: device.deviceId,
    type,
    parameters,
    status: 'PENDING',
    requestedAt: new Date().toISOString()
  };
  store.upsertCommand(command);

  try {
    const acknowledged = await ble.sendCommand(command);
    store.applyRealtimeEvent({
      type: 'command_update',
      payload: acknowledged,
      timestamp: Date.now(),
      version: 1
    });
    store.addActivity(device.id, {
      id: `ble:${command.commandId}`,
      eventType: 'command_acknowledged',
      detail: 'Bluetooth GATT command acknowledged',
      occurredAt: new Date().toISOString()
    });
    return acknowledged;
  } catch (error) {
    store.upsertCommand({ ...command, status: 'FAILED', error: describeError(error) });
    throw error;
  }
}

async function retryCommand({ commandId, deviceId }) {
  const command = store.getState().commandsById[commandId];
  if (!command) {
    throw new Error('未找到要重试的命令。');
  }
  return sendCommand({
    deviceId: deviceId ?? command.deviceId,
    type: command.type,
    parameters: command.parameters ?? {}
  });
}

async function pollCommand(commandId, attempts = 24, delayMs = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(delayMs);
    try {
      const command = await api.getCommand(commandId);
      store.upsertCommand(command);
      if (isTerminalCommandStatus(command.status)) {
        return command;
      }
    } catch (error) {
      return null;
    }
  }
  return null;
}

function wait(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function reconnectRealtime() {
  realtime.connect();
  return resyncAfterRealtimeConnect();
}

window.addEventListener('beforeunload', () => {
  unsubscribeRealtime();
  unsubscribeRealtimeHealth();
  unsubscribeBle();
  realtime.disconnect();
  ble.disconnect();
});

void bootstrap().finally(() => realtime.connect());
