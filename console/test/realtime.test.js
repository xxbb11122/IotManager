import assert from 'node:assert/strict';
import test from 'node:test';

import { createRealtimeService, RECONNECT_STABLE_WINDOW_MS } from '../src/js/realtime.js';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function fakeScheduler() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cancelled = true; },
    active(delay) { return timers.filter((timer) => !timer.cancelled && timer.delay === delay); }
  };
}

test('console realtime retry grows after unstable reconnects and resets after stability', () => {
  FakeWebSocket.instances = [];
  const scheduler = fakeScheduler();
  const realtime = createRealtimeService({
    webSocketFactory: (url) => new FakeWebSocket(url),
    scheduler,
    random: () => 0.5,
    locationProvider: () => ({ protocol: 'http:', host: 'console.test' })
  });
  realtime.setSiteCode('site-a');
  realtime.connect();
  FakeWebSocket.instances[0].open();
  FakeWebSocket.instances[0].close();
  scheduler.active(3_000)[0].callback();
  FakeWebSocket.instances[1].open();
  FakeWebSocket.instances[1].close();
  assert.equal(scheduler.active(6_000).length, 1);

  scheduler.active(6_000)[0].callback();
  FakeWebSocket.instances[2].open();
  scheduler.active(RECONNECT_STABLE_WINDOW_MS).at(-1).callback();
  FakeWebSocket.instances[2].close();
  assert.equal(scheduler.active(3_000).length >= 1, true);
});
