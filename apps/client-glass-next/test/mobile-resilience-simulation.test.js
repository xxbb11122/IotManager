import assert from 'node:assert/strict';
import test from 'node:test';

import { probeEndpoint } from '../src/js/platform/endpoint-probe.js';
import { RealtimeClient } from '../src/js/realtime.js';
import { createRenderCoordinator } from '../src/js/render-coordinator.js';
import { CHANGE_DOMAIN } from '../src/js/store.js';

class SimulatedSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    SimulatedSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

function controlledTimeouts() {
  const timers = [];
  return {
    timers,
    scheduler: {
      setTimeout(callback, delay) {
        const timer = { callback, delay, pending: true };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) { timer.pending = false; }
    },
    fire(timer) {
      assert.equal(timer.pending, true);
      timer.pending = false;
      timer.callback();
    },
    pendingCount() { return timers.filter((timer) => timer.pending).length; }
  };
}

test('weak-network endpoint probing aborts at its configured deadline', async () => {
  let receivedSignal = null;
  const result = await probeEndpoint({
    accessRoute: 'CLOUD_API',
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices',
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }
  });

  assert.equal(receivedSignal.aborted, true);
  assert.equal(result.ok, false);
});

test('200 offline reconnect cycles stay single-timer, cap jittered backoff, and reset after recovery', () => {
  SimulatedSocket.instances = [];
  const clock = controlledTimeouts();
  const realtime = new RealtimeClient({
    url: 'ws://iot.example.test/ws/devices',
    webSocketFactory: (url) => new SimulatedSocket(url),
    scheduler: clock.scheduler,
    reconnectBaseDelayMs: 10,
    reconnectMaxDelayMs: 50,
    jitter: () => 0.5
  });

  realtime.connect();
  for (let attempt = 1; attempt <= 200; attempt += 1) {
    const socket = SimulatedSocket.instances.at(-1);
    socket.drop();
    socket.drop();

    assert.equal(clock.pendingCount(), 1);
    const timer = clock.timers.at(-1);
    const exponential = Math.min(50, 10 * (2 ** (attempt - 1)));
    assert.equal(timer.delay, Math.min(50, Math.round(exponential * 1.5)));
    clock.fire(timer);
  }

  SimulatedSocket.instances.at(-1).open();
  assert.equal(realtime.getHealth().state, 'connected');
  assert.equal(realtime.getHealth().stale, false);
  assert.equal(realtime.getHealth().reconnectAttempt, 0);

  SimulatedSocket.instances.at(-1).drop();
  SimulatedSocket.instances.at(-1).drop();
  assert.equal(clock.pendingCount(), 1);
  assert.equal(clock.timers.at(-1).delay, 15);
  realtime.disconnect();
  assert.equal(clock.pendingCount(), 0);
});

test('10,000 recovery updates share one UI refresh timer and one patch per dirty region', () => {
  const clock = controlledTimeouts();
  const calls = { devices: 0, weather: 0, runtime: 0, full: 0 };
  let latestSequence = null;
  const coordinator = createRenderCoordinator({
    scheduler: clock.scheduler,
    fullRender: () => { calls.full += 1; },
    patchDevices: (_references, snapshot) => { calls.devices += 1; latestSequence = snapshot.sequence; },
    patchWeather: () => { calls.weather += 1; },
    patchRuntime: () => { calls.runtime += 1; }
  });

  for (let sequence = 0; sequence < 10_000; sequence += 1) {
    coordinator.enqueue({ sequence }, {
      origin: 'realtime',
      domains: [CHANGE_DOMAIN.DEVICES, CHANGE_DOMAIN.WEATHER, CHANGE_DOMAIN.RUNTIME],
      entityRefs: [`device-${sequence % 25}`],
      structural: false,
      reason: 'weak_network_recovery'
    });
  }

  assert.equal(clock.pendingCount(), 1);
  clock.fire(clock.timers[0]);
  assert.deepEqual(calls, { devices: 1, weather: 1, runtime: 1, full: 0 });
  assert.equal(latestSequence, 9_999);
  assert.equal(clock.pendingCount(), 0);
});
