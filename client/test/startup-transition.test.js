import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARTUP_EXIT_MS,
  STARTUP_VISUAL_TARGET_MS,
  createStartupTransition,
  startupHoldMs
} from '../src/js/platform/startup-transition.js';

test('browser pacing uses the longer static hold and a bounded fade', () => {
  assert.equal(STARTUP_VISUAL_TARGET_MS, 700);
  assert.equal(STARTUP_EXIT_MS, 280);
  assert.equal(startupHoldMs(0), 700);
  assert.equal(startupHoldMs(350), 350);
  assert.equal(startupHoldMs(800), 0);
});

function fixture({ nativeVisual = null, reduced = false, initialTime = 0, firstFrameAt = 0 } = {}) {
  let current = initialTime;
  let nextId = 0;
  const tasks = new Map();
  const classes = new Set();
  const overlay = new EventTarget();
  overlay.hidden = false;
  overlay.removed = false;
  overlay.classList = {
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
    contains: (name) => classes.has(name)
  };
  overlay.remove = () => { overlay.removed = true; };
  const appRoot = {
    inert: true,
    hidden: true,
    querySelector: () => ({}),
    setAttribute: (name) => { if (name === 'aria-hidden') appRoot.hidden = true; },
    removeAttribute: (name) => { if (name === 'aria-hidden') appRoot.hidden = false; }
  };
  const document = { hidden: false };
  const watchdog = {
    stopped: false,
    failed: false,
    stop() { this.stopped = true; },
    fail() { this.failed = true; }
  };
  const schedule = (callback, delay) => {
    const id = ++nextId;
    tasks.set(id, { at: current + delay, callback });
    return id;
  };
  const view = {
    document,
    performance: { now: () => current },
    __iotStartupFirstFrameAt: firstFrameAt,
    __iotStartupWatchdog: watchdog,
    requestAnimationFrame: (callback) => schedule(() => callback(current), 16),
    cancelAnimationFrame: (id) => tasks.delete(id),
    setTimeout: schedule,
    clearTimeout: (id) => tasks.delete(id),
    matchMedia: () => ({ matches: reduced })
  };
  async function advance(milliseconds) {
    const target = current + milliseconds;
    while (true) {
      const due = [...tasks.entries()].filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      tasks.delete(due[0]);
      current = due[1].at;
      due[1].callback();
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    }
    current = target;
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  }
  return {
    overlay, appRoot, classes, watchdog, advance,
    startup: createStartupTransition({ overlay, appRoot, view, nativeVisual })
  };
}

function nativeVisual({ phase = 'COVERING', remainingWebRescueMs = 4000, accepted = true } = {}) {
  let onExit = null;
  const calls = [];
  return {
    calls,
    addExitListener: async (listener) => {
      onExit = listener;
      return { remove: () => { onExit = null; } };
    },
    getLaunchState: async () => ({ phase, launchId: 7, remainingWebRescueMs }),
    prepareReveal: async (options) => { calls.push(options); return { accepted }; },
    complete: (launchId = 7) => onExit?.({ launchId })
  };
}

test('browser keeps the shell inert until its fade completes', async () => {
  const testbed = fixture();
  const done = testbed.startup.markUiReady();
  await testbed.advance(699);
  assert.equal(testbed.classes.has('startup-overlay--leaving'), false);
  assert.equal(testbed.appRoot.inert, true);
  await testbed.advance(1);
  assert.equal(testbed.classes.has('startup-overlay--leaving'), true);
  const event = new Event('transitionend');
  Object.defineProperty(event, 'propertyName', { value: 'opacity' });
  testbed.overlay.dispatchEvent(event);
  assert.equal(await done, true);
  assert.equal(testbed.overlay.removed, true);
  assert.equal(testbed.appRoot.inert, false);
  assert.equal(testbed.watchdog.stopped, true);
});

test('reduced motion removes the browser cover after the local shell is ready', async () => {
  const testbed = fixture({ reduced: true });
  assert.equal(await testbed.startup.markUiReady(), true);
  assert.equal(testbed.overlay.removed, true);
  assert.equal(testbed.appRoot.inert, false);
});

test('native cover owns the exit and only its matching completion unlocks the shell', async () => {
  const bridge = nativeVisual();
  const testbed = fixture({ nativeVisual: bridge });
  const done = testbed.startup.markUiReady();
  await testbed.advance(0);
  assert.equal(testbed.overlay.hidden, true);
  assert.equal(testbed.overlay.removed, false);
  assert.equal(testbed.appRoot.inert, true);
  assert.deepEqual(bridge.calls, [{ launchId: 7, reducedMotion: false }]);
  bridge.complete(6);
  assert.equal(testbed.appRoot.inert, true);
  bridge.complete();
  assert.equal(await done, true);
  assert.equal(testbed.overlay.removed, true);
  assert.equal(testbed.appRoot.inert, false);
});

test('lost native completion restores a visible retry while keeping the home inert', async () => {
  const bridge = nativeVisual({ remainingWebRescueMs: 850 });
  const testbed = fixture({ nativeVisual: bridge });
  const done = testbed.startup.markUiReady();
  await testbed.advance(0);
  await testbed.advance(850);
  assert.equal(await done, false);
  assert.equal(testbed.overlay.hidden, false);
  assert.equal(testbed.overlay.removed, false);
  assert.equal(testbed.appRoot.inert, true);
  assert.equal(testbed.watchdog.failed, true);
  bridge.complete();
  assert.equal(testbed.appRoot.inert, true);
});

test('a bridge failure after the handoff begins keeps the Web fallback visible', async () => {
  const bridge = nativeVisual();
  bridge.prepareReveal = async () => { throw new Error('renderer failed'); };
  const testbed = fixture({ nativeVisual: bridge });
  const done = testbed.startup.markUiReady();
  await testbed.advance(0);
  assert.equal(await done, false);
  assert.equal(testbed.overlay.hidden, false);
  assert.equal(testbed.appRoot.inert, true);
  assert.equal(testbed.watchdog.failed, true);
  await testbed.advance(4000);
  assert.equal(testbed.overlay.removed, false);
});

test('a bridge failure before handoff waits for Android to release its cover', async () => {
  const bridge = nativeVisual();
  bridge.getLaunchState = async () => { throw new Error('plugin unavailable'); };
  const testbed = fixture({ nativeVisual: bridge });
  const done = testbed.startup.markUiReady();
  await testbed.advance(0);
  assert.equal(testbed.overlay.hidden, false);
  assert.equal(testbed.watchdog.failed, false);
  await testbed.advance(8999);
  assert.equal(testbed.overlay.removed, false);
  assert.equal(testbed.appRoot.inert, true);
  await testbed.advance(1 + 32 + 400);
  assert.equal(await done, true);
  assert.equal(testbed.appRoot.inert, false);
});

test('native handoff forwards reduced motion and still waits for completion', async () => {
  const bridge = nativeVisual();
  const testbed = fixture({ nativeVisual: bridge, reduced: true });
  const done = testbed.startup.markUiReady();
  await testbed.advance(0);
  assert.deepEqual(bridge.calls, [{ launchId: 7, reducedMotion: true }]);
  assert.equal(testbed.appRoot.inert, true);
  bridge.complete();
  assert.equal(await done, true);
});

test('native timeout to an intact Web fallback uses the Web-only exit', async () => {
  const bridge = nativeVisual({ phase: 'WEB_FALLBACK' });
  const testbed = fixture({ nativeVisual: bridge, initialTime: 3100 });
  const done = testbed.startup.markUiReady();
  await testbed.advance(0);
  await testbed.advance(32);
  assert.equal(testbed.classes.has('startup-overlay--leaving'), true);
  assert.equal(testbed.appRoot.inert, true);
  await testbed.advance(400);
  assert.equal(await done, true);
  assert.equal(testbed.appRoot.inert, false);
});
