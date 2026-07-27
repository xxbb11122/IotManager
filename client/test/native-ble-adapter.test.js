import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeBleAdapter } from '../src/js/adapters/native-ble-adapter.js';

test('native BLE scans, connects, and leaves write-only commands unconfirmed', async () => {
  const calls = [];
  const plugin = {
    async initialize() { calls.push('initialize'); },
    async isEnabled() { return true; },
    async requestLEScan(_options, callback) { callback({ device: { deviceId: 'ble-1', name: 'Switch' }, rssi: -48 }); },
    async stopLEScan() { calls.push('stop'); },
    async connect(id) { calls.push(['connect', id]); },
    async getServices() { return [{ uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e' }]; },
    async getConnectedDevices() { return [{ deviceId: 'ble-1', name: 'Switch' }]; },
    async write(id) { calls.push(['write', id]); },
    async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin });
  const candidates = [];
  await adapter.scan((candidate) => candidates.push(candidate));
  await adapter.stopScan();
  await adapter.connect(candidates[0]);
  assert.equal(await adapter.verifyConnection(), true);
  const command = await adapter.sendCommand({ commandId: 'ble-command-1', type: 'set_power', parameters: { on: true } });
  assert.equal(command.status, 'UNCONFIRMED');
  assert.deepEqual(command.reportedState, {});
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

test('notification timeout fails without changing reported state', async () => {
  let stopped = false;
  const registry = {
    matchDiscoveredServices: () => ({ id: 'notify' }), getCapabilities: () => ({ known: true, controls: [] }),
    encodeCommand: () => ({
      serviceUuid: 'service', characteristicUuid: 'write', value: new Uint8Array([1]),
      confirmation: { type: 'notification', serviceUuid: 'service', characteristicUuid: 'notify', decode: () => ({ power: true }) }
    })
  };
  const plugin = {
    async connect() {}, async getServices() { return [{ uuid: 'service' }]; }, async write() {},
    async startNotifications() {}, async stopNotifications() { stopped = true; }, async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin, registry, confirmationTimeoutMs: 1 });
  await adapter.connect({ deviceId: 'ble-3' });
  await assert.rejects(() => adapter.sendCommand({ commandId: 'c3', type: 'set_power', parameters: { on: true } }), /timed out/);
  assert.equal(stopped, true);
});
