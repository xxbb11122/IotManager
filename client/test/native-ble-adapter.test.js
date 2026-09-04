import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeBleAdapter } from '../src/js/adapters/native-ble-adapter.js';
import { crc8 } from '../src/js/adapters/ble-profile-registry.js';

test('native BLE scans, connects, and confirms matching reference switch responses', async () => {
  const calls = [];
  let onNotification;
  const plugin = {
    async initialize() { calls.push('initialize'); },
    async isEnabled() { return true; },
    async requestLEScan(_options, callback) { callback({ device: { deviceId: 'ble-1', name: 'Switch' }, rssi: -48 }); },
    async stopLEScan() { calls.push('stop'); },
    async connect(id) { calls.push(['connect', id]); },
    async getServices() { return [{ uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e' }]; },
    async getConnectedDevices() { return [{ deviceId: 'ble-1', name: 'Switch' }]; },
    async startNotifications(_id, _service, _characteristic, callback) { calls.push('subscribe'); onNotification = callback; },
    async stopNotifications() { calls.push('stop'); },
    async write(id, _service, _characteristic, value) {
      calls.push(['write', id]);
      const command = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const response = new Uint8Array([0x5a, 1, 1, 0, ...command.slice(4, 8), 1, 0]);
      response[9] = crc8(response.subarray(0, 9));
      onNotification(new DataView(response.buffer));
    },
    async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin });
  const candidates = [];
  await adapter.scan((candidate) => candidates.push(candidate));
  await adapter.stopScan();
  await adapter.connect(candidates[0]);
  assert.equal(await adapter.verifyConnection(), true);
  const command = await adapter.sendCommand({ commandId: 'ble-command-1', type: 'set_power', parameters: { on: true } });
  assert.equal(command.status, 'ACKNOWLEDGED');
  assert.deepEqual(command.reportedState, { power: true });
});

test('native BLE exposes permission and disabled-Bluetooth failures', async () => {
  const adapter = new NativeBleAdapter({
    bleClient: {
      async initialize() { throw new Error('permission denied'); },
      async isEnabled() { return false; }
    }
  });
  await assert.rejects(() => adapter.scan(() => {}), /permission denied/);

  const disabled = new NativeBleAdapter({
    bleClient: { async initialize() {}, async isEnabled() { return false; } }
  });
  await assert.rejects(() => disabled.scan(() => {}), /disabled/);
});

test('profile read-back is the only source of acknowledged reported state', async () => {
  const registry = {
    matchDiscoveredServices: () => ({ id: 'confirmed' }),
    getCapabilities: () => ({ known: true, controls: [{ id: 'power' }] }),
    encodeCommand: () => ({
      serviceUuid: 'service', characteristicUuid: 'write', value: new Uint8Array([1]),
      confirmation: { type: 'read', serviceUuid: 'service', characteristicUuid: 'state', decode: (value) => ({ power: value.getUint8(0) === 1 }) }
    })
  };
  const plugin = {
    async connect() {}, async getServices() { return [{ uuid: 'service' }]; }, async write() {},
    async read() { return new DataView(new Uint8Array([1]).buffer); }, async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin, registry });
  await adapter.connect({ deviceId: 'ble-2', name: 'Confirmed switch' });
  const result = await adapter.sendCommand({ commandId: 'c2', type: 'set_power', parameters: { on: true } });
  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.deepEqual(result.reportedState, { power: true });
});

test('notification confirmation subscribes before write and times out as unconfirmed', async () => {
  let stopped = false;
  const calls = [];
  const registry = {
    matchDiscoveredServices: () => ({ id: 'notify' }), getCapabilities: () => ({ known: true, controls: [] }),
    encodeCommand: () => ({
      serviceUuid: 'service', characteristicUuid: 'write', value: new Uint8Array([1]),
      confirmation: { type: 'notification', serviceUuid: 'service', characteristicUuid: 'notify', decode: () => ({ power: true }) }
    })
  };
  const plugin = {
    async connect() {}, async getServices() { return [{ uuid: 'service' }]; }, async write() { calls.push('write'); },
    async startNotifications() { calls.push('subscribe'); }, async stopNotifications() { stopped = true; }, async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin, registry, confirmationTimeoutMs: 1 });
  await adapter.connect({ deviceId: 'ble-3' });
  const result = await adapter.sendCommand({ commandId: 'c3', type: 'set_power', parameters: { on: true } });
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.confirmationTimedOut, true);
  assert.deepEqual(calls, ['subscribe', 'write']);
  assert.equal(stopped, true);
});

test('native BLE scan keeps a stable de-duplicated candidate list', async () => {
  let onResult;
  const plugin = {
    async initialize() {}, async isEnabled() { return true; },
    async requestLEScan(_options, callback) { onResult = callback; },
    async stopLEScan() {}, async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin });
  const snapshots = [];
  await adapter.scan((_candidate, candidates) => snapshots.push(candidates));
  onResult({ device: { deviceId: 'ble-1', name: 'First name' }, rssi: -75 });
  const firstSeenAt = adapter.getCandidates()[0].firstSeenAt;
  onResult({ device: { deviceId: 'ble-1', name: 'Updated name' }, rssi: -42 });
  onResult({ device: { deviceId: 'ble-2', name: 'Second device' }, rssi: -50 });

  assert.equal(adapter.getCandidates().length, 2);
  assert.equal(adapter.getCandidates()[0].deviceId, 'ble-1');
  assert.equal(adapter.getCandidates()[0].name, 'Updated name');
  assert.equal(adapter.getCandidates()[0].rssi, -42);
  assert.equal(adapter.getCandidates()[0].firstSeenAt, firstSeenAt);
  assert.equal(snapshots.at(-1).length, 2);
});

test('native BLE turns an unexpected plugin disconnect into one disconnected connection update', async () => {
  let onDisconnect = null;
  const disconnectCalls = [];
  const plugin = {
    async connect(deviceId, callback) {
      assert.equal(deviceId, 'ble-drop');
      onDisconnect = callback;
    },
    async getServices() { return []; },
    async disconnect(deviceId) { disconnectCalls.push(deviceId); }
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin });
  const statuses = [];
  adapter.subscribe((event) => {
    if (event.type === 'connection_update') statuses.push(event.payload.status);
  });

  await adapter.connect({ deviceId: 'ble-drop', name: 'Drop test' });
  onDisconnect();
  await adapter.disconnect();

  assert.deepEqual(statuses, ['CONNECTED', 'DISCONNECTED']);
  assert.deepEqual(disconnectCalls, ['ble-drop']);
  assert.equal(adapter.connection.status, 'DISCONNECTED');
});

test('native BLE verifyConnection detects a GATT link that disappeared while the app was backgrounded', async () => {
  const plugin = {
    async connect() {},
    async getServices() { return []; },
    async getConnectedDevices() { return []; }
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin });

  await adapter.connect({ deviceId: 'ble-background-drop' });

  assert.equal(await adapter.verifyConnection(), false);
  assert.equal(adapter.connection.status, 'DISCONNECTED');
});
