import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceState, beginResource, resolveResource, rejectResource, createRuntimeTaskRegistry, parseWeatherCoordinates, refreshPresentation } from '../src/js/runtime-resource-state.js';

test('resource states separate initial loading, empty, cached refresh, and failure', () => {
  assert.equal(beginResource(resourceState()).phase, 'loading');
  assert.equal(resolveResource().phase, 'empty');
  const cached = resolveResource({ hasData: true, source: 'cache', updatedAt: 1 });
  assert.equal(cached.freshness, 'stale');
  assert.deepEqual(beginResource(cached, true), { ...cached, refreshing: true });
  assert.equal(rejectResource(cached, new Error('offline'), true).phase, 'ready');
  assert.equal(rejectResource(resourceState(), 'offline').phase, 'error');
  assert.equal(rejectResource(cached, 'offline', true).refreshing, false);
});

test('newer requests and context changes invalidate results and finally handlers', () => {
  let scope = 'endpoint-a/site-a/session-1';
  const tasks = createRuntimeTaskRegistry(() => scope);
  const older = tasks.begin('devices');
  const unrelated = tasks.begin('weather');
  const latest = tasks.begin('devices');
  assert.equal(tasks.current(older), false);
  assert.equal(tasks.current(unrelated), true);
  assert.equal(tasks.current(latest), true);
  scope = 'endpoint-b/site-a/session-1';
  assert.equal(tasks.current(latest), false);
  scope = 'endpoint-a/site-a/session-1';
  tasks.invalidate();
  assert.equal(tasks.current(latest), false);
});

test('coordinates reject empty/null/boolean input without rejecting valid zero', () => {
  for (const value of ['', ' ', null, undefined, false, true, 'Infinity', 'wrong']) {
    assert.throws(() => parseWeatherCoordinates({ latitude: value, longitude: 0 }));
    assert.throws(() => parseWeatherCoordinates({ latitude: 0, longitude: value }));
  }
  assert.deepEqual(parseWeatherCoordinates({ latitude: '0', longitude: ' 0 ' }), { latitude: 0, longitude: 0 });
  assert.throws(() => parseWeatherCoordinates({ latitude: 91, longitude: 0 }));
});

test('refresh outcome never reports cached or partially failed data as all updated', () => {
  const fresh = resolveResource({ hasData: true });
  const cached = resolveResource({ hasData: true, source: 'cache' });
  assert.equal(refreshPresentation([fresh, fresh]).status, 'updated');
  assert.equal(refreshPresentation([fresh, cached]).status, 'partial');
  assert.equal(refreshPresentation([cached, rejectResource(resourceState(), 'offline')]).status, 'cached');
});
