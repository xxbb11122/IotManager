import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebSocketService, RECONNECT_STABLE_WINDOW_MS } from '../src/js/websocket.js';

class FakeWebSocket {
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
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

  message(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
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
    clearTimeout(timer) {
      timer.cancelled = true;
    },
    active(delay) {
      return timers.filter((timer) => !timer.cancelled && (delay === undefined || timer.delay === delay));
    }
  };
}

test('monitoring WebSocket uses jittered exponential retry and resets only after a stable window', () => {
  FakeWebSocket.instances = [];
  const scheduler = fakeScheduler();
  let now = 1_000;
  const service = createWebSocketService({
    webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols),
    scheduler,
    random: () => 0.5,
    now: () => now,
    locationProvider: () => ({ protocol: 'http:', host: 'iot.test' })
  });
  service.setSiteCode('site-a');
  service.connect();
  const first = FakeWebSocket.instances[0];
  assert.equal(first.url, 'ws://iot.test/ws/devices?siteCode=site-a');
  first.open();
  first.close();

  const firstRetry = scheduler.active(3_000)[0];
  assert.ok(firstRetry);
  firstRetry.callback();
  const second = FakeWebSocket.instances[1];
  second.open();
  second.close();

  const secondRetry = scheduler.active(6_000)[0];
  assert.ok(secondRetry);
  secondRetry.callback();
  const third = FakeWebSocket.instances[2];
  third.open();
  const stableTimer = scheduler.active(RECONNECT_STABLE_WINDOW_MS).at(-1);
  assert.ok(stableTimer);
  stableTimer.callback();
  now += RECONNECT_STABLE_WINDOW_MS;
  third.close();

  assert.ok(scheduler.active(3_000).length >= 1);
});

test('monitoring WebSocket reports reconnect duration without requesting REST itself', () => {
  FakeWebSocket.instances = [];
  const scheduler = fakeScheduler();
  let now = 1_000;
  const connected = [];
  const service = createWebSocketService({
    webSocketFactory: (url) => new FakeWebSocket(url),
    scheduler,
    random: () => 0.5,
    now: () => now,
    locationProvider: () => ({ protocol: 'https:', host: 'iot.test' })
  });
  service.on('connected', (metadata) => connected.push(metadata));
  service.connect();
  FakeWebSocket.instances[0].open();
  now += 500;
  FakeWebSocket.instances[0].close();
  now += 3_000;
  scheduler.active(3_000)[0].callback();
  FakeWebSocket.instances[1].open();

  assert.equal(connected[0].reconnected, false);
  assert.equal(connected[1].reconnected, true);
  assert.equal(connected[1].disconnectedForMs, 3_000);
});
