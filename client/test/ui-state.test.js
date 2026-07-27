import assert from 'node:assert/strict';
import test from 'node:test';

import { deviceScreenState } from '../src/js/ui.js';

test('unknown BLE profile has metadata but no command controls', () => {
  const screen = deviceScreenState({
    connection: { transport: 'BLE_DIRECT', profileId: null },
    capabilities: []
  });

  assert.equal(screen.showControls, false);
  assert.match(screen.notice, /暂无可用控制能力/);
});

test('stale platform state disables controls without hiding capabilities', () => {
  const screen = deviceScreenState({
    connections: [{ transport: 'LAN_AGENT', profileId: 'lan-agent-v1' }],
    capabilities: [{ id: 'power', writable: true }]
  }, { accessRoute: 'CLOUD_API', stale: true });
  assert.equal(screen.showControls, false);
  assert.equal(screen.controls.length, 1);
  assert.match(screen.notice, /缓存|同步/);
});
