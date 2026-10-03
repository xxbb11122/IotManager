import assert from 'node:assert/strict';
import test from 'node:test';

import { BleAdapter } from '../src/js/adapters/ble-adapter.js';
import { crc8 } from '../src/js/adapters/ble-profile-registry.js';

test('BLE adapter opens a real picker shell and keeps unknown profiles read-only', async () => {
  const handlers = new Map();
  let requestOptions = null;
  const server = {
    async getPrimaryServices() {
      return [{ uuid: 'battery_service' }];
    },
    async getPrimaryService() {
      throw new Error('service unavailable');
    }
  };
  const device = {
    id: 'browser-local-id',
    name: 'Unknown sensor',
    gatt: {
      connected: false,
      async connect() {
        this.connected = true;
        return server;
      },
      disconnect() {
        this.connected = false;
        handlers.get('gattserverdisconnected')?.();
      }
    },
    addEventListener(name, listener) {
      handlers.set(name, listener);
    }
  };
  const bluetooth = {
    async requestDevice(options) {
      requestOptions = options;
      return device;
    }
  };
  const adapter = new BleAdapter({ bluetooth });
  const events = [];
  adapter.subscribe((event) => events.push(event));

  assert.equal(adapter.availability().available, true);
  const candidate = await adapter.requestCandidate();
  const session = await adapter.connect(candidate);

  assert.equal(requestOptions.acceptAllDevices, true);
  assert.ok(requestOptions.optionalServices.includes('battery_service'));
  assert.equal(candidate.id, 'browser-local-id');
  assert.equal(session.status, 'CONNECTED');
  assert.equal(adapter.getCapabilities().known, false);
  assert.deepEqual(adapter.getCapabilities().controls, []);
  await assert.rejects(() => adapter.sendCommand({ type: 'set_power', parameters: { on: true } }));

  adapter.disconnect();
  assert.equal(events.at(-1).payload.status, 'DISCONNECTED');
});

test('browser BLE confirms a matching reference switch notification', async () => {
  let notificationListener = null;
  const notificationCharacteristic = {
    addEventListener(_name, listener) { notificationListener = listener; },
    removeEventListener() { notificationListener = null; },
    async startNotifications() {},
    async stopNotifications() {}
  };
  const characteristic = {
    async writeValueWithResponse(value) {
      const command = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const response = new Uint8Array([0x5a, 1, 1, 0, ...command.slice(4, 8), 1, 0]);
      response[9] = crc8(response.subarray(0, 9));
      notificationListener({ target: { value: new DataView(response.buffer) } });
    }
  };
  const server = {
    async getPrimaryServices() {
      return [{ uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e' }];
    },
      async getPrimaryService() {
        return {
          async getCharacteristic(uuid) { return uuid === '6e400003-b5a3-f393-e0a9-e50e24dcca9e' ? notificationCharacteristic : characteristic; }
        };
      }
  };
  const device = {
    id: 'known-switch',
    name: 'Known switch',
    gatt: {
      connected: false,
      async connect() {
        this.connected = true;
        return server;
      }
    },
    addEventListener() {}
  };
  const adapter = new BleAdapter({
    bluetooth: { async requestDevice() { return device; } }
  });

  await adapter.requestCandidate();
  await adapter.connect();
  const result = await adapter.sendCommand({ type: 'set_power', parameters: { on: true } });

  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.deepEqual(result.reportedState, { power: true });
});

test('browser BLE subscribes before write and treats notification timeout as unconfirmed', async () => {
  const calls = [];
  const notificationListeners = new Set();
  const notificationCharacteristic = {
    addEventListener(_name, listener) { notificationListeners.add(listener); },
    removeEventListener(_name, listener) { notificationListeners.delete(listener); },
    async startNotifications() { calls.push('subscribe'); },
    async stopNotifications() { calls.push('stop'); }
  };
  const writeCharacteristic = {
    async writeValueWithResponse() { calls.push('write'); }
  };
  const server = {
    async getPrimaryServices() { return [{ uuid: 'service' }]; },
    async getPrimaryService(uuid) {
      return {
        async getCharacteristic() {
          return uuid === 'notify-service' ? notificationCharacteristic : writeCharacteristic;
        }
      };
    }
  };
  const device = {
    id: 'notify-device',
    gatt: { async connect() { return server; } },
    addEventListener() {}
  };
  const registry = {
    optionalServiceUuids: () => ['service'],
    matchDiscoveredServices: () => ({ id: 'notify-profile' }),
    getCapabilities: () => ({ known: true, controls: [] }),
    encodeCommand: () => ({
      serviceUuid: 'service', characteristicUuid: 'write', value: new Uint8Array([1]),
      confirmation: {
        type: 'notification',
        serviceUuid: 'notify-service',
        characteristicUuid: 'notify',
        decode: () => ({ power: true })
      }
    })
  };
  const adapter = new BleAdapter({
    bluetooth: { async requestDevice() { return device; } },
    registry,
    confirmationTimeoutMs: 1
  });

  await adapter.requestCandidate();
  await adapter.connect();
  const result = await adapter.sendCommand({ commandId: 'notify-1', type: 'set_power' });

  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.confirmationTimedOut, true);
  assert.deepEqual(calls, ['subscribe', 'write', 'stop']);
  assert.equal(notificationListeners.size, 0);
});
