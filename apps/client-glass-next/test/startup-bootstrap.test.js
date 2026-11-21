import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { boundedStartupRead, readStartupSnapshot, createStartupPrefetch } from '../src/js/platform/startup-bootstrap.js';
import { createStartupTrace, startupFeatures, STARTUP_POLICY } from '../src/js/platform/startup-policy.js';

function clock() {
  let time = 0, id = 0;
  const tasks = new Map();
  const scheduler = { setTimeout(fn, delay) { tasks.set(++id, { at: time + delay, fn }); return id; }, clearTimeout(key) { tasks.delete(key); } };
  return { scheduler, tasks, now: () => time,
    async advance(ms) {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      const end = time + ms;
      while (true) {
        const next = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!next) break;
        tasks.delete(next[0]); time = next[1].at; next[1].fn();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      time = end;
      for (let i = 0; i < 20; i++) await Promise.resolve();
    }
  };
}

test('independent snapshot reads start concurrently and a hanging optional read is bounded', async () => {
  const c = clock(), started = []; let late;
  const pending = readStartupSnapshot({
    endpoint: () => { started.push('endpoint'); return { id: 'a' }; },
    bindings: () => { started.push('bindings'); return new Promise(resolve => { late = resolve; }); },
    selectedSite: () => { started.push('site'); return null; }
  }, { scheduler: c.scheduler, timeoutMs: 100 });
  await c.advance(0); assert.deepEqual(started, ['endpoint', 'bindings', 'site']);
  await c.advance(100); const snapshot = await pending;
  assert.equal(snapshot.endpoint.value.id, 'a'); assert.equal(snapshot.bindings.status, 'timeout');
  late(['late-binding']); await c.advance(0);
  assert.equal(snapshot.bindings.status, 'timeout'); assert.equal(c.tasks.size, 0);
});

test('read rejection and cancellation settle independently without losing failure identity', async () => {
  const c = clock(), controller = new AbortController();
  const refused = new Error('forbidden'); refused.status = 403;
  const result = await boundedStartupRead(() => Promise.reject(refused), { scheduler: c.scheduler });
  assert.equal(result.error.status, 403);
  const pending = boundedStartupRead(() => new Promise(() => {}), { scheduler: c.scheduler, signal: controller.signal });
  controller.abort(); assert.equal((await pending).status, 'cancelled'); assert.equal(c.tasks.size, 0);
});

test('prefetch is single-flight, buffered until taken, and cancellation discards late results', async () => {
  const c = clock(), prefetch = createStartupPrefetch({ scheduler: c.scheduler });
  let calls = 0, resolve;
  const first = prefetch.start('a', () => { calls++; return new Promise(done => { resolve = done; }); });
  assert.equal(prefetch.start('a', () => { calls++; }), first);
  await c.advance(0); assert.equal(calls, 1);
  const take = prefetch.take('a'); prefetch.cancel(); resolve([{ id: 1 }]);
  assert.equal((await take).status, 'cancelled');
  assert.equal(prefetch.take('a'), null);
  const next = prefetch.start('b', async () => [{ id: 2 }]); await next;
  assert.equal((await prefetch.take('b')).value[0].id, 2);
});

test('a speculative timeout aborts its fetch and cannot be reused as fresh data', async () => {
  const c = clock(), prefetch = createStartupPrefetch({ scheduler: c.scheduler }); let signal;
  const request = prefetch.start('a', value => { signal = value; return new Promise(() => {}); });
  await c.advance(STARTUP_POLICY.prefetchMs);
  assert.equal((await request).status, 'timeout'); assert.equal(signal.aborted, true);
  assert.equal((await prefetch.take('a')).status, 'timeout');
});

test('speculative features default off and timing logs have a bounded privacy boundary', () => {
  assert.deepEqual(startupFeatures(), { motion: true, depth: false, blur: false, prefetch: false });
  assert.equal(startupFeatures({ VITE_STARTUP_PREFETCH: 'true' }).prefetch, true);
  const trace = createStartupTrace({ now: () => 5, limit: 2 });
  trace.record('one', { token: 'secret', url: 'private', count: 2 }); trace.record('two'); trace.record('three');
  assert.deepEqual(trace.snapshot().map(row => row.event), ['two', 'three']);
  assert.equal(JSON.stringify(trace.snapshot()).includes('secret'), false);
  const copy = trace.snapshot(); copy[0].event = 'changed'; assert.equal(trace.snapshot()[0].event, 'two');
});

test('native and Web timing budgets and brand assets stay aligned', async () => {
  const native = await readFile(new URL('../android/app/src/main/java/com/iot/manager/glassnext/StartupPolicy.java', import.meta.url), 'utf8');
  for (const [name, value] of Object.entries({ MIN_HOLD_MS: STARTUP_POLICY.nativeHoldMs, EXIT_MS: STARTUP_POLICY.nativeExitMs,
    EXIT_DEADLINE_MS: STARTUP_POLICY.nativeExitDeadlineMs, TIMEOUT_MS: STARTUP_POLICY.nativeTimeoutMs, RESCUE_MS: STARTUP_POLICY.nativeRescueMs })) {
    assert.match(native, new RegExp(`${name} = ${value}\\b`));
  }
  const input = await readFile(new URL('../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png', import.meta.url));
  const web = await readFile(new URL('../public/assets/startup-icon.png', import.meta.url));
  assert.equal(createHash('sha256').update(input).digest('hex'), createHash('sha256').update(web).digest('hex'));
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp(`transition: opacity ${STARTUP_POLICY.webExitMs}ms`));
});
