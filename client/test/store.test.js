import assert from 'node:assert/strict';
import test from 'node:test';

import { createClientStore } from '../src/js/store.js';

function seededStore() {
  return createClientStore({
    devices: [{
      id: 7,
      publicId: 'device-7',
      deviceId: 'lan-field-01',
      name: 'Field sensor',
      reportedState: { power: false },
      desiredState: { power: false },
      connections: []
    }]
  });
}

test('store publishes a new immutable snapshot without changing the prior snapshot', () => {
  const store = seededStore();
  const before = store.getState();
  const notifications = [];
  const unsubscribe = store.subscribe((next) => notifications.push(next));

  store.upsertDevice({ id: 7, name: 'Renamed field sensor', status: 'ONLINE' });
  const after = store.getState();
  unsubscribe();

  assert.equal(before.devices[0].name, 'Field sensor');
  assert.equal(after.devices[0].name, 'Renamed field sensor');
  assert.notStrictEqual(before, after);
  assert.notStrictEqual(before.devices[0], after.devices[0]);
  assert.equal(notifications.length, 1);
  assert.throws(() => after.devices.push({ id: 8 }), TypeError);
});

test('realtime reducer bridges backend device identifiers across connection, command, activity, alert, and telemetry events', () => {
  const store = seededStore();

  store.applyRealtimeEvent({
    type: 'connection_update',
    version: 1,
    timestamp: 1,
    payload: {
      deviceId: 'lan-field-01',
      transport: 'LAN_AGENT',
      profileId: 'lan-agent-v1',
      externalId: 'lan-demo-sensor-01',
      status: 'CONNECTED',
      metadata: { ipAddress: '192.168.10.21' }
    }
  });
  store.applyRealtimeEvent({
    type: 'command_update',
    version: 1,
    timestamp: 2,
    payload: {
      commandId: 'command-1',
      deviceId: 7,
      type: 'set_power',
      status: 'ACKNOWLEDGED',
      reportedState: { power: true }
    }
  });
  store.applyRealtimeEvent({
    type: 'activity_update',
    version: 1,
    timestamp: 3,
    payload: { id: 9, deviceId: 'lan-field-01', eventType: 'command_acknowledged' }
  });
  store.applyRealtimeEvent({
    type: 'alert_update',
    version: 1,
    timestamp: 4,
    payload: { id: 4, devicePublicId: 'device-7', level: 'WARNING', resolved: false }
  });
  store.applyRealtimeEvent({
    type: 'telemetry_update',
    version: 1,
    timestamp: 5,
    payload: [{ deviceId: 'lan-field-01', temperature: 23.5, signalStrength: -47 }]
  });
  store.applyRealtimeEvent({
    type: 'device_updates',
    version: 1,
    timestamp: 6,
    payload: [{ id: 7, name: 'must not replace the singular device state' }]
  });

  const next = store.getState();
  const device = next.devices[0];

  assert.equal(device.connections[0].status, 'CONNECTED');
  assert.deepEqual(device.reportedState, { power: true });
  assert.equal(next.commandsById['command-1'].status, 'ACKNOWLEDGED');
  assert.equal(next.activitiesByDeviceId['7'][0].eventType, 'command_acknowledged');
  assert.equal(next.alertsByDeviceId['7'][0].level, 'WARNING');
  assert.equal(device.temperature, 23.5);
  assert.equal(device.name, 'Field sensor');
});

test('store ignores unsupported realtime protocol versions', () => {
  const store = seededStore();
  const before = store.getState();

  const accepted = store.applyRealtimeEvent({
    type: 'device_update',
    version: 2,
    timestamp: 1,
    payload: { id: 7, name: 'unexpected version' }
  });

  assert.equal(accepted, false);
  assert.strictEqual(store.getState(), before);
});

test('store applies an early command event when its device later arrives from REST', () => {
  const store = createClientStore();

  store.applyRealtimeEvent({
    type: 'command_update',
    version: 1,
    timestamp: 1,
    payload: {
      commandId: 'command-early',
      deviceId: 7,
      status: 'ACKNOWLEDGED',
      reportedState: { power: true }
    }
  });
  store.setDevices([{
    id: 7,
    deviceId: 'lan-field-01',
    desiredState: { power: false },
    reportedState: { power: false },
    connections: []
  }]);

  assert.deepEqual(store.getState().devices[0].reportedState, { power: true });
  assert.equal(store.getState().devices[0].commandStatus, 'ACKNOWLEDGED');
});

test('store rekeys early activity and alert events when their device later arrives from REST', () => {
  const store = createClientStore();

  store.applyRealtimeEvent({
    type: 'activity_update',
    version: 1,
    timestamp: 1,
    payload: { id: 9, deviceId: 'lan-field-01', eventType: 'device_claimed' }
  });
  store.applyRealtimeEvent({
    type: 'alert_update',
    version: 1,
    timestamp: 2,
    payload: { id: 4, deviceId: 'lan-field-01', level: 'WARNING', resolved: false }
  });
  store.setDevices([{ id: 7, deviceId: 'lan-field-01', connections: [] }]);

  const next = store.getState();
  assert.equal(next.activitiesByDeviceId['7'][0].eventType, 'device_claimed');
  assert.equal(next.alertsByDeviceId['7'][0].level, 'WARNING');
  assert.equal(next.activitiesByDeviceId['lan-field-01'], undefined);
  assert.equal(next.alertsByDeviceId['lan-field-01'], undefined);
});
