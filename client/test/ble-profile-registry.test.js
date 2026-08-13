import assert from 'node:assert/strict';
import test from 'node:test';

import { BleProfileRegistry, crc8 } from '../src/js/adapters/ble-profile-registry.js';

test('unknown BLE profiles expose generic read-only information without controls', () => {
  const registry = new BleProfileRegistry();
  const capabilities = registry.getCapabilities(null);

  assert.equal(capabilities.known, false);
  assert.deepEqual(capabilities.controls, []);
  assert.deepEqual(capabilities.readOnly, ['generic_information', 'battery_level']);
});

test('nRF52840 reference profile maps a power command to its declared GATT characteristic', () => {
  const registry = new BleProfileRegistry();
  const operation = registry.encodeCommand('nordic-nrf52840-switch-v1', {
    type: 'set_power',
    parameters: { on: true }
  });

  assert.equal(operation.serviceUuid, '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
  assert.equal(operation.characteristicUuid, '6e400002-b5a3-f393-e0a9-e50e24dcca9e');
  assert.equal(operation.value.length, 10);
  assert.equal(operation.value[0], 0xa5);
  assert.equal(operation.value[1], 1);
  assert.equal(operation.value[2], 1);
  assert.equal(operation.value[8], 1);
  assert.equal(operation.value[9], crc8(operation.value.subarray(0, 9)));
  assert.equal(operation.withResponse, true);
  assert.equal(operation.confirmation.type, 'notification');
  assert.equal(operation.confirmation.characteristicUuid, '6e400003-b5a3-f393-e0a9-e50e24dcca9e');
  const response = new Uint8Array([0x5a, 1, 1, 0, ...operation.value.slice(4, 8), 1, 0]);
  response[9] = crc8(response.subarray(0, 9));
  assert.deepEqual(operation.confirmation.decode(new DataView(response.buffer)), { power: true });
  const unrelated = new Uint8Array(response);
  unrelated[4] ^= 0xff;
  unrelated[9] = crc8(unrelated.subarray(0, 9));
  assert.equal(operation.confirmation.decode(new DataView(unrelated.buffer)), null);
});

test('registry matches a profile only when its service UUID is discovered', () => {
  const registry = new BleProfileRegistry();

  assert.equal(
    registry.matchDiscoveredServices(['6e400001-b5a3-f393-e0a9-e50e24dcca9e'])?.id,
    'nordic-nrf52840-switch-v1'
  );
  assert.equal(registry.matchDiscoveredServices(['battery_service']), null);
});

test('registry rejects an invalid confirmation contract', () => {
  const registry = new BleProfileRegistry([{
    id: 'invalid-confirmation',
    serviceUuids: ['service-1'],
    commands: {
      set_power: () => ({
        serviceUuid: 'service-1',
        characteristicUuid: 'characteristic-1',
        value: new Uint8Array([1]),
        confirmation: { type: 'guess' }
      })
    }
  }]);

  assert.throws(
    () => registry.encodeCommand('invalid-confirmation', { type: 'set_power' }),
    /invalid confirmation type/i
  );
});
