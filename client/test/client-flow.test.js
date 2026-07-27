import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decorateLanDevice,
  createLocalBleDevice,
  mergePlatformAndLocalDevices,
  capabilityControls
} from '../src/js/client-flow.js';

test('unknown BLE connection becomes a browser-local read-only device', () => {
  const device = createLocalBleDevice(
    { id: 'ble-browser-id', name: 'Warehouse tag' },
    {
      id: 'ble-browser-id',
      transport: 'BLE_DIRECT',
      profileId: null,
      status: 'CONNECTED',
      capabilities: { known: false, controls: [], readOnly: ['generic_information'] }
    },
    { organizationCode: 'demo-org', siteCode: 'demo-site', spacePath: '/operations/field' }
  );

  assert.equal(device.id, 'ble:ble-browser-id');
  assert.equal(device.deviceId, 'ble-browser-id');
  assert.equal(device.localOnly, true);
  assert.deepEqual(device.capabilities, []);
  assert.equal(device.connections[0].identityScope, 'browser_local');
  assert.equal(device.organizationCode, undefined);
  assert.deepEqual(device.pendingOrganizationContext, {
    organizationCode: 'demo-org',
    siteCode: 'demo-site',
    spacePath: '/operations/field'
  });
});

test('platform refresh keeps browser-local BLE sessions while replacing platform devices', () => {
  const local = createLocalBleDevice(
    { id: 'ble-1', name: 'Local BLE' },
    { id: 'ble-1', transport: 'BLE_DIRECT', status: 'CONNECTED', capabilities: { controls: [] } },
    {}
  );

  const merged = mergePlatformAndLocalDevices(
    [{ id: 7, deviceId: 'LAN-7', name: 'LAN relay' }],
    [{ id: 6, deviceId: 'OLD', name: 'Old platform device' }, local]
  );

  assert.deepEqual(merged.map((device) => device.id), [7, 'ble:ble-1']);
});

test('capability controls accept adapter capability envelopes', () => {
  assert.deepEqual(
    capabilityControls({ controls: [{ id: 'power', commandType: 'set_power' }] }),
    [{ id: 'power', commandType: 'set_power' }]
  );
});

test('LAN device snapshots keep adapter controls after a REST resynchronization', () => {
  const refreshed = decorateLanDevice({
    id: 7,
    deviceId: 'LAN-7',
    connections: [{ transport: 'LAN_AGENT', profileId: 'lan-agent-v1', status: 'CONNECTED' }]
  }, {
    controls: [{ id: 'power', commandType: 'set_power' }]
  });

  assert.deepEqual(refreshed.capabilities, [{ id: 'power', commandType: 'set_power' }]);
  assert.deepEqual(refreshed.connections[0].capabilities, [{ id: 'power', commandType: 'set_power' }]);
});
