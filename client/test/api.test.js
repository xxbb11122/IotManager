import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiClient, resolveClientConfig } from '../src/js/api.js';

test('client configuration normalizes API and WebSocket endpoints', () => {
  const config = resolveClientConfig({
    apiBaseUrl: 'https://iot.example.test/api/',
    wsUrl: 'wss://iot.example.test/ws/devices/'
  });

  assert.equal(config.apiBaseUrl, 'https://iot.example.test/api');
  assert.equal(config.wsUrl, 'wss://iot.example.test/ws/devices');
});

test('client configuration treats a bare backend origin as the API root', () => {
  const config = resolveClientConfig({
    apiBaseUrl: 'http://localhost:8080',
    wsUrl: 'ws://localhost:8080/ws'
  });

  assert.equal(config.apiBaseUrl, 'http://localhost:8080/api');
  assert.equal(config.wsUrl, 'ws://localhost:8080/ws/devices');
});

test('LAN API client uses the backend field names and encodes site scope', async () => {
  const requests = [];
  const api = new ApiClient({
    baseUrl: 'https://iot.example.test/api',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ commandId: 'command-1', status: 'PENDING' }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  await api.listLanCandidates('demo site');
  await api.claimLanCandidate('lan-demo-sensor-01', {
    siteCode: 'demo-site',
    spacePath: '/operations/field',
    displayName: 'Pump A'
  });
  await api.submitCommand(7, {
    type: 'set_power',
    idempotencyKey: 'client-1',
    parameters: { on: true }
  });

  assert.equal(requests[0].url, 'https://iot.example.test/api/discovery/lan?siteCode=demo+site');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    siteCode: 'demo-site',
    spacePath: '/operations/field',
    displayName: 'Pump A'
  });
  assert.equal(requests[2].url, 'https://iot.example.test/api/devices/7/commands');
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    type: 'set_power',
    idempotencyKey: 'client-1',
    parameters: { on: true }
  });
});

test('default browser fetch keeps the global receiver', async () => {
  const originalFetch = globalThis.fetch;
  let receivedThis = null;
  globalThis.fetch = function fetchWithWindowReceiver() {
    receivedThis = this;
    return Promise.resolve(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
  };

  try {
    const api = new ApiClient({ baseUrl: 'https://iot.example.test/api' });
    await api.listDevices();
    assert.equal(receivedThis, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
