import assert from 'node:assert/strict';
import test from 'node:test';

import { createRenderCoordinator } from '../src/js/render-coordinator.js';
import { CHANGE_DOMAIN } from '../src/js/store.js';
import { createRenderMetrics } from '../src/js/render-metrics.js';

function fakeScheduler() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cancelled = true;
    }
  };
}

test('coordinator coalesces a telemetry burst into one device patch without a full render', () => {
  const scheduler = fakeScheduler();
  const metrics = createRenderMetrics();
  const fullRenders = [];
  const patches = [];
  const coordinator = createRenderCoordinator({
    scheduler,
    metrics,
    fullRender: (snapshot, reason) => fullRenders.push({ snapshot, reason }),
    patchDevices: (references, snapshot) => patches.push({ references, snapshot }) || true
  });

  for (let index = 0; index < 100; index += 1) {
    coordinator.enqueue({ sequence: index }, {
      origin: 'realtime',
      domains: [CHANGE_DOMAIN.DEVICES],
      entityRefs: ['device-001'],
      structural: false,
      reason: 'telemetry_update'
    });
  }
  coordinator.flush();

  assert.equal(fullRenders.length, 0);
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].references, ['device-001']);
  assert.equal(patches[0].snapshot.sequence, 99);
  assert.equal(metrics.snapshot().devicePatchCount, 1);
  assert.equal(metrics.snapshot().maxPatchBatchSize, 1);
});

test('structural or unknown metadata uses one safe full-render fallback', () => {
  const scheduler = fakeScheduler();
  const fullRenders = [];
  const patches = [];
  const coordinator = createRenderCoordinator({
    scheduler,
    fullRender: (snapshot, reason) => fullRenders.push({ snapshot, reason }),
    patchDevices: () => patches.push('device') || true
  });

  coordinator.enqueue({ version: 1 }, {
    domains: [CHANGE_DOMAIN.DEVICES],
    entityRefs: ['device-001'],
    structural: false
  });
  coordinator.enqueue({ version: 2 }, { structural: true, reason: 'site_switch' });
  coordinator.flush();

  assert.equal(fullRenders.length, 1);
  assert.equal(fullRenders[0].snapshot.version, 2);
  assert.equal(fullRenders[0].reason, 'site_switch');
  assert.deepEqual(patches, []);
});

test('hidden documents retain dirty changes and flush them once when visible', () => {
  const scheduler = fakeScheduler();
  const calls = [];
  const coordinator = createRenderCoordinator({
    scheduler,
    fullRender: () => calls.push('full'),
    patchWeather: () => calls.push('weather') || true
  });

  coordinator.setVisibility(false);
  coordinator.enqueue({ weather: { temperature: 24 } }, {
    domains: [CHANGE_DOMAIN.WEATHER],
    structural: false
  });
  coordinator.flush();
  assert.deepEqual(calls, []);

  coordinator.setVisibility(true);
  coordinator.flush();
  assert.deepEqual(calls, ['weather']);
});

test('one missing patch target falls back to one full render for the batch', () => {
  const scheduler = fakeScheduler();
  const fullRenders = [];
  const coordinator = createRenderCoordinator({
    scheduler,
    fullRender: (snapshot, reason) => fullRenders.push({ snapshot, reason }),
    patchWeather: () => false
  });

  coordinator.enqueue({ weather: { temperature: 24 } }, {
    domains: [CHANGE_DOMAIN.WEATHER],
    structural: false
  });
  coordinator.flush();

  assert.equal(fullRenders.length, 1);
  assert.equal(fullRenders[0].reason, 'patch_target_missing');
});
