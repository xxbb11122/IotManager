import assert from 'node:assert/strict';
import test from 'node:test';

import { BleProfileRegistry } from '../src/js/adapters/ble-profile-registry.js';

test('unknown BLE profiles expose generic read-only information without controls', () => {
  const registry = new BleProfileRegistry();
  const capabilities = registry.getCapabilities(null);

  assert.equal(capabilities.known, false);
  assert.deepEqual(capabilities.controls, []);
  assert.deepEqual(capabilities.readOnly, ['generic_information', 'battery_level']);
});

test('known profile maps a power command to its declared GATT characteristic', () => {
  const registry = new BleProfileRegistry();
  const operation = registry.encodeCommand('iot-demo-switch-v1', {
    type: 'set_power',
    parameters: { on: true }
  });

  assert.equal(operation.serviceUuid, '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
  assert.equal(operation.characteristicUuid, '6e400002-b5a3-f393-e0a9-e50e24dcca9e');
  assert.deepEqual(Array.from(operation.value), [1]);
  assert.equal(operation.withResponse, true);
});

test('registry matches a profile only when its service UUID is discovered', () => {
  const registry = new BleProfileRegistry();

  assert.equal(
    registry.matchDiscoveredServices(['6e400001-b5a3-f393-e0a9-e50e24dcca9e'])?.id,
    'iot-demo-switch-v1'
  );
  assert.equal(registry.matchDiscoveredServices(['battery_service']), null);
});
