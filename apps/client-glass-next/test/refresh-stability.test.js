import test from 'node:test';
import assert from 'node:assert/strict';
import { valueEqual } from '../src/js/value-equality.js';
import { createClientStore } from '../src/js/store.js';
import { createSnapshotRefreshGate } from '../src/js/snapshot-refresh-gate.js';
import { createRenderCoordinator } from '../src/js/render-coordinator.js';
import { createRenderMetrics } from '../src/js/render-metrics.js';

function clock() {
  let time = 0;
  const timers = new Set();
  return {
    now: () => time,
    setTimeout(callback, delay) { const task = { at: time + delay, callback }; timers.add(task); return task; },
    clearTimeout(task) { timers.delete(task); },
    advance(to) {
      while (true) {
        const next = [...timers].sort((a, b) => a.at - b.at)[0];
        if (!next || next.at > to) break;
        timers.delete(next); time = next.at; next.callback();
      }
      time = to;
    }
  };
}

test('JSON equality ignores object key order, but not array order, type or absent fields', () => {
  assert.equal(valueEqual({ a: [{ x: 2, y: 3 }], b: null }, { b: null, a: [{ y: 3, x: 2 }] }), true);
  for (const [a, b] of [[[], {}], [[1, 2], [2, 1]], [{ x: undefined }, {}], [null, {}], [1, '1']]) {
    assert.equal(valueEqual(a, b), false);
  }
});

test('repeated normalized device/weather/forecast/command data does not publish or replace the snapshot', () => {
  const store = createClientStore({ devices: [{ id: 'a', reportedState: { on: false } }] });
  store.setWeather({ current: { temperatureC: 23, humidity: 50 } });
  store.setWeatherForecast({ hourly: [] });
  const receipt = { commandId: 'c', deviceId: 'a', status: 'SENT', type: 'set_power', parameters: { on: true } };
  store.upsertCommand(receipt);
  const initial = store.getState();
  let publications = 0;
  store.subscribe(() => publications++);
  for (let i = 0; i < 20; i++) {
    store.upsertDevice({ id: 'a', reportedState: { on: false } });
    store.setWeather({ current: { humidity: 50, temperatureC: 23 } });
    store.setWeatherForecast({ hourly: [] });
    store.upsertCommand({ ...receipt });
  }
  assert.equal(publications, 0);
  assert.equal(store.getState(), initial);
  assert.equal(store.diagnostics().suppressedPublications, 80);
  store.upsertCommand({ ...receipt, status: 'ACKNOWLEDGED', reportedState: { on: true } });
  assert.equal(publications, 1);
  assert.equal(store.selectDevice('a').reportedState.on, true);
});

test('only measurement-only telemetry is eligible for the slower presentation budget', () => {
  const store = createClientStore({ devices: [{ id: 'a', temperature: 20, reportedState: { on: false } }] });
  const metadata = [];
  store.subscribe((_state, meta) => metadata.push(meta));
  for (const patch of [{ temperature: 21 }, { reportedState: { on: true } }, { status: 'OFFLINE' }, { newAuthorityFlag: false }]) {
    store.applyRealtimeEvent({ type: 'telemetry_update', version: 1, payload: { id: 'a', ...patch } });
  }
  assert.deepEqual(metadata.map(m => m.presentation), ['telemetry', undefined, undefined, undefined]);
  store.applyRealtimeEvent({ type: 'device_update', version: 1, payload: { id: 'a', temperature: 22, cpuUsage: 15, uptimeSeconds: 120 } });
  assert.equal(metadata.at(-1).presentation, 'telemetry');
  store.applyRealtimeEvent({ type: 'device_update', version: 1, payload: { id: 'a', reportedState: { on: false } } });
  assert.equal(metadata.at(-1).presentation, undefined);
});

test('failed attempts cool down, explicit retry is permitted, and one scope shares its in-flight read', async () => {
  const time = clock();
  const metrics = createRenderMetrics();
  const gate = createSnapshotRefreshGate({ now: time.now, metrics });
  let calls = 0;
  const failed = () => { calls++; throw new Error('offline'); };
  await assert.rejects(gate.run('a', failed), /offline/);
  assert.equal(await gate.run('a', failed, { automatic: true }), null);
  time.advance(119999);
  assert.equal(await gate.run('a', failed, { automatic: true }), null);
  time.advance(120000);
  await assert.rejects(gate.run('a', failed, { automatic: true }), /offline/);
  let resolve;
  const read = gate.run('a', () => { calls++; return new Promise(done => { resolve = done; }); });
  const joined = gate.run('a', failed, { automatic: true });
  assert.equal(read, joined);
  resolve('snapshot');
  assert.equal(await joined, 'snapshot');
  assert.equal(calls, 3);
  assert.equal(metrics.snapshot().snapshotCooldownCount, 2);
  assert.equal(metrics.snapshot().snapshotJoinedCount, 1);
});

test('scope switch and reset do not share cooldown/results with an old in-flight request', async () => {
  const gate = createSnapshotRefreshGate();
  let resolve;
  const old = gate.run('a', () => new Promise(done => { resolve = done; }));
  assert.equal(await gate.run('b', () => 'new', { automatic: true }), 'new');
  resolve('old');
  await old;
  assert.equal(await gate.run('b', () => 'must-not-run', { automatic: true }), null);
  gate.reset();
  assert.equal(await gate.run('b', () => 'reset', { automatic: true }), 'reset');
});

test('sustained telemetry is presented at most once per second, preserving the newest value', () => {
  const time = clock();
  const patches = [];
  const coordinator = createRenderCoordinator({ scheduler: time, now: time.now,
    fullRender: () => assert.fail('unexpected full render'),
    patchDevices: (_refs, snapshot) => { patches.push({ at: time.now(), sequence: snapshot.sequence }); }
  });
  for (let i = 0; i < 300; i++) {
    time.advance(i * 10);
    coordinator.enqueue({ sequence: i }, { domains: ['devices'], entityRefs: ['a'], presentation: 'telemetry' });
  }
  time.advance(4000);
  assert.equal(patches.length, 4);
  for (let i = 1; i < patches.length; i++) assert.ok(patches[i].at - patches[i - 1].at >= 1000);
  assert.equal(patches.at(-1).sequence, 299);
});

test('command and structure preempt delayed telemetry; batch options prevent repeated controls/forecast patches', () => {
  const time = clock();
  const calls = [];
  const coordinator = createRenderCoordinator({ scheduler: time, now: time.now,
    fullRender: () => calls.push(['full', time.now()]),
    patchDevices: () => calls.push(['devices', time.now()]),
    patchCommands: (_refs, _snapshot, options) => calls.push(['commands', options]),
    patchRuntime: (_snapshot, options) => calls.push(['runtime', options]),
    patchWeather: () => calls.push(['weather']), patchForecast: () => calls.push(['forecast'])
  });
  coordinator.enqueue({ n: 1 }, { domains: ['devices'], presentation: 'telemetry' });
  time.advance(150);
  coordinator.enqueue({ n: 2 }, { domains: ['devices'], presentation: 'telemetry' });
  time.advance(200);
  coordinator.enqueue({ n: 3 }, { domains: ['commands', 'connection', 'weather', 'weather-forecast'], entityRefs: ['a'] });
  time.advance(350);
  assert.equal(calls[1][1], 350);
  assert.equal(calls.find(call => call[0] === 'commands')[1].skipControls, true);
  assert.equal(calls.find(call => call[0] === 'runtime')[1].skipDetail, true);
  assert.equal(calls.filter(call => call[0] === 'weather').length, 1);
  assert.equal(calls.filter(call => call[0] === 'forecast').length, 0);
  coordinator.enqueue({ n: 4 }, { domains: ['devices'], presentation: 'telemetry' });
  coordinator.enqueue({ n: 5 }, { structural: true });
  time.advance(350);
  assert.deepEqual(calls.at(-1), ['full', 350]);
  coordinator.destroy();
});

test('screen-wide patches subsume overlapping regions but still update global headers', () => {
  const calls = [];
  const coordinator = createRenderCoordinator({ scheduler: clock(),
    fullRender: () => assert.fail('no fallback expected'),
    patchScreen: () => calls.push('screen'),
    patchDevices: () => assert.fail('duplicate device patch'),
    patchCommands: () => assert.fail('duplicate command patch'),
    patchForecast: () => assert.fail('duplicate forecast patch'),
    patchActivity: () => assert.fail('duplicate activity patch'),
    patchWeather: (_snapshot, options) => { assert.equal(options.headerOnly, true); calls.push('weather-header'); },
    patchRuntime: (_snapshot, options) => { assert.equal(options.headerOnly, true); calls.push('runtime-header'); }
  });
  coordinator.enqueue({ data: 'latest' }, { domains: ['screen', 'devices', 'commands', 'activity', 'weather', 'weather-forecast', 'runtime'] });
  coordinator.flush();
  assert.deepEqual(calls, ['screen', 'weather-header', 'runtime-header']);
  coordinator.destroy();
});
