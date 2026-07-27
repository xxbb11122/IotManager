import assert from 'node:assert/strict';
import test from 'node:test';
import { attachAppLifecycle } from '../src/js/platform/app-lifecycle.js';

test('background stops scanning and foreground resynchronizes before controls resume', async () => {
  let listener;
  const calls = [];
  const handle = await attachAppLifecycle({
    appPlugin: { async addListener(_name, callback) { listener = callback; return { remove: async () => calls.push('remove') }; } },
    onBackground: async () => calls.push('background'),
    onForeground: async () => { calls.push('foreground'); }
  });
  await listener({ isActive: false });
  await listener({ isActive: true });
  await handle.remove();
  assert.deepEqual(calls, ['background', 'foreground', 'remove']);
});
