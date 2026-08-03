import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandDispatcher } from '../src/js/platform/command-dispatcher.js';

test('an in-flight command remains on its original endpoint after a profile switch', async () => {
  let completeFirst;
  const calls = { site: 0, cloud: 0 };
  const site = { sendCommand: () => { calls.site += 1; return new Promise((resolve) => { completeFirst = resolve; }); } };
  const cloud = { async sendCommand() { calls.cloud += 1; return {}; } };
  let platform = site;
  let profile = { accessRoute: 'SITE_API' };
  const events = [];
  const dispatch = createCommandDispatcher({
    getPlatform: () => platform,
    getEndpointProfile: () => profile,
    getBleConnected: () => false,
    isPlatformStale: () => false,
    idFactory: () => 'command-1',
    onCommand: (command) => events.push(command)
  });
  const pending = dispatch({ device: { id: 7, connections: [{ transport: 'LAN_AGENT' }] }, type: 'set_power', parameters: { on: true } });
  platform = cloud;
  profile = { accessRoute: 'CLOUD_API' };
  completeFirst({ commandId: 'command-1', status: 'PENDING' });
  const result = await pending;
  assert.equal(result.accessRoute, 'SITE_API');
  assert.deepEqual(calls, { site: 1, cloud: 0 });
  assert.deepEqual(events.map((command) => command.status), ['PENDING']);
});
