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
