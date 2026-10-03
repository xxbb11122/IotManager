import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConnectionRoute } from '../src/js/platform/connection-resolver.js';

test('routes local bindings only through a connected BLE adapter', () => {
  assert.equal(resolveConnectionRoute({ device: { localOnly: true }, bleConnected: true }).accessRoute, 'BLE_LOCAL');
  assert.throws(() => resolveConnectionRoute({ device: { localOnly: true }, bleConnected: false }), /reconnect/i);
});

test('keeps endpoint access route separate from device transport', () => {
  const route = resolveConnectionRoute({
    device: { connections: [{ transport: 'LAN_AGENT' }] },
    endpointProfile: { accessRoute: 'CLOUD_API' }
  });
  assert.deepEqual(route, { accessRoute: 'CLOUD_API', deviceTransport: 'LAN_AGENT' });
});
