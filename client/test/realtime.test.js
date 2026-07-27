import assert from 'node:assert/strict';
import test from 'node:test';

import { RealtimeClient, normalizeRealtimeEvent } from '../src/js/realtime.js';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(data) {
    this.onmessage?.({ data });
  }

  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

test('event normalizer accepts only the supported backend event envelope', () => {
  assert.deepEqual(
    normalizeRealtimeEvent('{"type":"command_update","payload":{"commandId":"command-1"},"timestamp":1,"version":1}'),
    { type: 'command_update', payload: { commandId: 'command-1' }, timestamp: 1, version: 1 }
  );
  assert.equal(normalizeRealtimeEvent('{"type":"command_update","version":2}'), null);
  assert.equal(normalizeRealtimeEvent('pong'), null);
});

test('realtime client notifies valid events and reconnects after an unexpected close', () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const scheduler = {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cancelled = true;
    }
  };
  const events = [];
  const states = [];
  const realtime = new RealtimeClient({
    url: 'ws://iot.example.test/ws/devices',
    webSocketFactory: (url) => new FakeWebSocket(url),
    scheduler,
    reconnectBaseDelayMs: 20,
    reconnectMaxDelayMs: 100,
    jitter: () => 0
  });
  realtime.subscribe((event) => events.push(event));
  realtime.subscribeStatus((health) => states.push(health.state));

  realtime.connect();
  const firstSocket = FakeWebSocket.instances[0];
  firstSocket.open();
  firstSocket.receive(JSON.stringify({ type: 'command_update', payload: { commandId: 'command-1' }, timestamp: 1, version: 1 }));
  firstSocket.receive(JSON.stringify({ type: 'command_update', payload: {}, timestamp: 2, version: 2 }));
  firstSocket.close(1006);

  assert.equal(events.length, 1);
  assert.equal(events[0].payload.commandId, 'command-1');
  assert.equal(states.at(-1), 'reconnecting');
  assert.equal(scheduled[0].delay, 20);

  scheduled[0].callback();
  assert.equal(FakeWebSocket.instances.length, 2);

  realtime.disconnect();
  assert.equal(realtime.getHealth().state, 'disconnected');
});
