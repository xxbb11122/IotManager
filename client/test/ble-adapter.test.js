import assert from 'node:assert/strict';
import test from 'node:test';

import { BleAdapter } from '../src/js/adapters/ble-adapter.js';

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
