import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARTUP_READY_HOLD_LIMIT_MS,
  STARTUP_VISUAL_TARGET_MS,
  createStartupTransition,
  startupHoldMs
} from '../src/js/platform/startup-transition.js';

test('startup pacing has a deterministic bounded ready hold', () => {
  assert.equal(STARTUP_VISUAL_TARGET_MS, 450);
  assert.equal(STARTUP_READY_HOLD_LIMIT_MS, 180);
  assert.equal(startupHoldMs(0, 0), 180);
  assert.equal(startupHoldMs(320, 0), 130);
  assert.equal(startupHoldMs(350, 100), 80);
  assert.equal(startupHoldMs(500, 0), 0);
  assert.equal(startupHoldMs(300, 180), 0);
});

function startupFixture({ initialTime = 0, firstFrameAt } = {}) {
  let current = initialTime;
  let nextId = 0;
  const tasks = new Map();
  const document = new EventTarget();
  document.hidden = false;
  const motionListeners = new Set();
  const motion = {
    matches: false,
    addEventListener: (_type, listener) => motionListeners.add(listener),
    removeEventListener: (_type, listener) => motionListeners.delete(listener)
  };
  const overlay = new EventTarget();
  const classes = new Set();
  overlay.classList = { add: (name) => classes.add(name), contains: (name) => classes.has(name) };
  overlay.removed = false;
  overlay.remove = () => { overlay.removed = true; };
  const appRoot = {
    inert: true,
    hidden: true,
    querySelector: () => ({}),
    removeAttribute: (name) => { if (name === 'aria-hidden') appRoot.hidden = false; }
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
    requestAnimationFrame: (callback) => schedule(() => callback(current), 16),
    cancelAnimationFrame: (id) => tasks.delete(id),
    setTimeout: schedule,
    clearTimeout: (id) => tasks.delete(id),
    matchMedia: () => motion,
    __iotStartupWatchdog: { stop: () => {} }
  };
  async function advance(milliseconds) {
    const target = current + milliseconds;
    while (true) {
      const due = [...tasks.entries()]
        .filter(([, task]) => task.at <= target)
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
  const startup = createStartupTransition({ overlay, appRoot, view });
  return {
    startup, overlay, appRoot, classes, advance,
    enableReducedMotion() {
      motion.matches = true;
      for (const listener of motionListeners) listener({ matches: true });
    }
  };
}

test('a fast shell stays shielded during the bounded hold and fade', async () => {
  const fixture = startupFixture();
  assert.equal(fixture.startup.markUiReady(), true);
  await fixture.advance(179);
  assert.equal(fixture.overlay.removed, false);
  assert.equal(fixture.appRoot.inert, true);
  await fixture.advance(1);
  assert.equal(fixture.classes.has('startup-overlay--leaving'), true);
  assert.equal(fixture.appRoot.inert, true);
  const end = new Event('transitionend');
  Object.defineProperty(end, 'propertyName', { value: 'opacity' });
  fixture.overlay.dispatchEvent(end);
  assert.equal(fixture.overlay.removed, true);
  assert.equal(fixture.appRoot.inert, false);
  assert.equal(fixture.appRoot.hidden, false);
});

test('a late main module uses the HTML first-frame anchor instead of adding a fresh 180ms', async () => {
  const fixture = startupFixture({ initialTime: 400, firstFrameAt: 16 });
  assert.equal(fixture.startup.markUiReady(), true);
  await fixture.advance(65);
  assert.equal(fixture.classes.has('startup-overlay--leaving'), false);
  await fixture.advance(1);
  assert.equal(fixture.classes.has('startup-overlay--leaving'), true);
  assert.equal(fixture.appRoot.inert, true);
});

test('reduced motion switched on mid-startup releases the shell immediately', async () => {
  const fixture = startupFixture();
  fixture.startup.markUiReady();
  await fixture.advance(40);
  fixture.enableReducedMotion();
  assert.equal(fixture.overlay.removed, true);
  assert.equal(fixture.appRoot.inert, false);
  await fixture.advance(500);
  assert.equal(fixture.classes.has('startup-overlay--leaving'), false);
});
