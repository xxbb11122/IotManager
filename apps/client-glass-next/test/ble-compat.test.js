import assert from 'node:assert/strict';
import test from 'node:test';

import { createBleFacade } from '../src/js/ble.js';

test('legacy BLE facade forwards selected and connection lifecycle events from the adapter', async () => {
  const listeners = new Set();
  const adapter = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async requestCandidate() {
      return { id: 'ble-1', name: 'Sensor' };
    },
    async connect() {
      return { id: 'ble-1', status: 'CONNECTED' };
    },
    disconnect() {
      for (const listener of listeners) {
        listener({ type: 'connection_update', payload: { status: 'DISCONNECTED' } });
      }
    }
  };
  const facade = createBleFacade(adapter);
  const selected = [];
  const connected = [];
  const disconnected = [];
  facade.on('selected', (candidate) => selected.push(candidate));
  facade.on('connected', (connection) => connected.push(connection));
  facade.on('disconnected', (connection) => disconnected.push(connection));

  await facade.scan();
  await facade.connect();
  facade.disconnect();

  assert.equal(selected[0].id, 'ble-1');
  assert.equal(connected[0].status, 'CONNECTED');
  assert.equal(disconnected[0].status, 'DISCONNECTED');
});
