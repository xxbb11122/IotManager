import assert from 'node:assert/strict';
import test from 'node:test';

import { friendlyEndpointError, probeEndpoint } from '../src/js/platform/endpoint-probe.js';

function fakeFetch(status, body) {
  return async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('probe reports success with a device count when the API responds', async () => {
  const result = await probeEndpoint({
    accessRoute: 'CLOUD_API',
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices',
    fetchImpl: fakeFetch(200, [{ id: 1 }, { id: 2 }])
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /已获取 2 台设备/);
});

test('probe verifies the realtime endpoint when requested', async () => {
  const result = await probeEndpoint({
    accessRoute: 'SITE_API',
    apiBaseUrl: 'http://192.168.1.100:8080/api',
    wsUrl: 'ws://192.168.1.100:8080/ws/devices',
    fetchImpl: fakeFetch(200, []),
    verifyWebSocket: true,
    webSocketFactory: class {
      constructor() { queueMicrotask(() => this.onopen?.()); }
      close() {}
    }
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /API 与实时连接正常/);
});

test('probe reports a readable realtime failure when the WebSocket cannot open', async () => {
  const result = await probeEndpoint({
    accessRoute: 'SITE_API',
    apiBaseUrl: 'http://192.168.1.100:8080/api',
    wsUrl: 'ws://192.168.1.100:8080/ws/devices',
    fetchImpl: fakeFetch(200, []),
    verifyWebSocket: true,
    webSocketFactory: class {
      constructor() { queueMicrotask(() => this.onerror?.()); }
      close() {}
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /实时连接失败/);
});

test('probe reports success with an empty inventory message', async () => {
  const result = await probeEndpoint({
    accessRoute: 'CLOUD_API',
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices',
    fetchImpl: fakeFetch(200, [])
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /当前没有设备/);
});

test('probe maps fetch failures to an operator-facing message', async () => {
  const result = await probeEndpoint({
    accessRoute: 'CLOUD_API',
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices',
    fetchImpl: async () => {
      throw new Error('Failed to fetch');
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /无法连接/);
});

test('probe rejects invalid WebSocket schemes with a Chinese validation message', async () => {
  const result = await probeEndpoint({
    accessRoute: 'CLOUD_API',
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'ftp://iot.example.test/ws/devices'
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /ws:\/\/ 或 wss:\/\//);
});

test('friendlyEndpointError maps known validation messages', () => {
  assert.match(friendlyEndpointError(new TypeError('Endpoint accessRoute must be SITE_API or CLOUD_API')), /请先选择/);
  assert.match(friendlyEndpointError(new TypeError('API URL must use HTTP or HTTPS')), /API 地址/);
  assert.match(friendlyEndpointError(new TypeError('WebSocket URL must use WS or WSS')), /WebSocket 地址/);
});
