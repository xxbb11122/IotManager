import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedStartupRead, readStartupSnapshot, STARTUP_READ_TIMEOUT_MS } from '../src/js/platform/startup-bootstrap.js';

function clock() {
  let id = 0;
  const tasks = new Map();
  const scheduler = { setTimeout(fn, delay) { tasks.set(++id, { fn, delay }); return id; }, clearTimeout(key) { tasks.delete(key); } };
  return { scheduler, tasks, async expire() {
    await new Promise(setImmediate);
    for (const [key, task] of [...tasks]) { tasks.delete(key); task.fn(); }
    await new Promise(setImmediate);
  } };
}

test('startup reads remain concurrent and a permanent pending read cannot exceed the local budget', async () => {
  const c = clock(), calls = []; let late;
  const pending = readStartupSnapshot({
    endpoint: () => { calls.push('endpoint'); return { id: 'a' }; },
    bindings: () => { calls.push('bindings'); return new Promise(resolve => { late = resolve; }); }
  }, { scheduler: c.scheduler });
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['endpoint', 'bindings']);
  assert.equal([...c.tasks.values()][0].delay, 1800);
  assert.equal(STARTUP_READ_TIMEOUT_MS, 1800);
  await c.expire();
  const result = await pending;
  assert.equal(result.endpoint.value.id, 'a');
  assert.equal(result.bindings.status, 'timeout');
  late(['late']); await new Promise(setImmediate);
  assert.equal(result.bindings.status, 'timeout');
  assert.equal(c.tasks.size, 0);
});

test('rejection and abort preserve their outcomes and release deadline timers', async () => {
  const c = clock(), controller = new AbortController();
  const rejected = await boundedStartupRead(() => { throw new Error('storage refused'); }, { scheduler: c.scheduler });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.error.message, 'storage refused');
  const pending = boundedStartupRead(() => new Promise(() => {}), { scheduler: c.scheduler, signal: controller.signal });
  controller.abort();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(c.tasks.size, 0);
});

test('an already cancelled read never starts its underlying storage operation', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  assert.equal((await boundedStartupRead(() => { calls++; }, { signal: controller.signal })).status, 'cancelled');
  assert.equal(calls, 0);
});
