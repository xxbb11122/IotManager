import assert from 'node:assert/strict';
import test from 'node:test';

import { assertConnectionAdapter } from '../src/js/adapters/connection-adapter.js';
import { LanMockAdapter } from '../src/js/adapters/lan-mock-adapter.js';

test('LAN adapter uses discovery, claim, and command APIs behind the connection contract', async () => {
  const calls = [];
  let realtimeListener = null;
  const api = {
    async listLanCandidates(siteCode) {
      calls.push(['discover', siteCode]);
      return [{ candidateId: 'lan-demo-sensor-01', profileId: 'lan-agent-v1' }];
    },
    async claimLanCandidate(candidateId, claim) {
      calls.push(['claim', candidateId, claim]);
      return { id: 7, deviceId: 'lan-field-01', name: claim.displayName, connections: [] };
    },
    async submitCommand(deviceId, command) {
      calls.push(['command', deviceId, command]);
      return { commandId: 'command-1', deviceId, status: 'PENDING' };
    },
    async listActivity(deviceId) {
      calls.push(['activity', deviceId]);
      return [];
    }
  };
  const realtime = {
    subscribe(listener) {
      realtimeListener = listener;
      return () => {
        realtimeListener = null;
      };
    }
  };
  const adapter = new LanMockAdapter({
    api,
    realtime,
    idempotencyKeyFactory: () => 'generated-key'
  });
  const events = [];
  const unsubscribe = adapter.subscribe((event) => events.push(event));

  assertConnectionAdapter(adapter);
  assert.equal(adapter.availability().available, true);
  const candidates = await adapter.requestCandidate({ siteCode: 'demo-site' });
  const claimed = await adapter.connect(candidates[0], {
    siteCode: 'demo-site',
    spacePath: '/operations/field',
    displayName: 'Pump A'
  });
  const command = await adapter.sendCommand({
    deviceId: claimed.id,
    type: 'set_power',
    parameters: { on: true }
  });
  realtimeListener({ type: 'command_update', version: 1, timestamp: 1, payload: command });

  assert.deepEqual(calls[0], ['discover', 'demo-site']);
  assert.deepEqual(calls[1], ['claim', 'lan-demo-sensor-01', {
    siteCode: 'demo-site',
    spacePath: '/operations/field',
    displayName: 'Pump A'
  }]);
  assert.deepEqual(calls[2], ['command', 7, {
    type: 'set_power',
    parameters: { on: true },
    idempotencyKey: 'generated-key'
  }]);
  assert.equal(events[0].type, 'command_update');
  assert.deepEqual(adapter.getCapabilities().controls.map((control) => control.commandType), [
    'set_power',
    'set_level',
    'set_mode'
  ]);

  unsubscribe();
  adapter.disconnect();
  assert.equal(realtimeListener, null);
});
