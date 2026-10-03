import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionPolicy } from '../src/js/motion-policy.js';

function fakeTarget(properties = {}) {
  const handlers = new Map();
  return {
    ...properties,
    addEventListener(type, callback) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(callback);
    },
    removeEventListener(type, callback) { handlers.get(type)?.delete(callback); },
    emit(type) { for (const callback of handlers.get(type) ?? []) callback(); },
    count(type) { return handlers.get(type)?.size ?? 0; }
  };
}

test('motion policy responds to live preference and hidden changes, without duplicate notifications', () => {
  const media = fakeTarget({ matches: false });
  const document = fakeTarget({ hidden: false });
  const policy = createMotionPolicy({ windowObject: { matchMedia: () => media }, documentObject: document });
  const states = [];
  policy.subscribe(state => states.push(state), { immediate: true });
  assert.equal(states[0].animate, true);
  media.matches = true;
  media.emit('change');
  assert.equal(states.at(-1).animate, false);
  assert.equal(states.at(-1).reduced, true);
  media.emit('change');
  assert.equal(states.length, 2);
  media.matches = false;
  media.emit('change');
  document.hidden = true;
  document.emit('visibilitychange');
  assert.equal(states.at(-1).hidden, true);
  assert.equal(states.at(-1).animate, false);
  policy.destroy();
});

test('degradation is reversible and destroy removes all listeners/subscribers', () => {
  const media = fakeTarget({ matches: false });
  const document = fakeTarget({ hidden: false });
  const policy = createMotionPolicy({ windowObject: { matchMedia: () => media }, documentObject: document });
  let changes = 0;
  const unsubscribe = policy.subscribe(() => changes++);
  policy.setDegraded(true);
  assert.equal(policy.snapshot().degraded, true);
  assert.equal(policy.snapshot().animate, false);
  policy.setDegraded(false);
  assert.equal(policy.snapshot().animate, true);
  assert.equal(changes, 2);
  unsubscribe();
  policy.setDegraded(true);
  assert.equal(changes, 2);
  policy.destroy();
  policy.destroy();
  assert.equal(media.count('change'), 0);
  assert.equal(document.count('visibilitychange'), 0);
  policy.subscribe(() => changes++, { immediate: true });
  policy.setDegraded(false);
  assert.equal(changes, 2);
});

test('policy supports older MediaQueryList listeners and non-browser unit environments', () => {
  let listener;
  const media = { matches: true, addListener(fn) { listener = fn; }, removeListener(fn) { if (listener === fn) listener = null; } };
  const policy = createMotionPolicy({ windowObject: { matchMedia: () => media }, documentObject: null });
  assert.equal(policy.snapshot().animate, false);
  assert.equal(typeof listener, 'function');
  policy.destroy();
  assert.equal(listener, null);
  const headless = createMotionPolicy({ windowObject: null, documentObject: null });
  assert.equal(headless.snapshot().animate, true);
  headless.destroy();
});
