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
  assert.equal(result.realtimeOk, null);
  assert.match(result.message, /实时连接未测试/);
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

test('probe forwards a bearer token to REST and the restricted WebSocket handshake', async () => {
  let requestOptions;
  let socketUrl;
  let socketProtocols;
  const result = await probeEndpoint({
    accessRoute: 'CLOUD_API',
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices',
    siteCode: 'site-a',
    accessToken: 'probe-token',
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    verifyWebSocket: true,
    webSocketFactory: class {
      constructor(url, protocols) {
        socketUrl = url;
        socketProtocols = protocols;
        queueMicrotask(() => this.onopen?.());
      }
      close() {}
    }
  });
  assert.equal(result.ok, true);
  assert.equal(requestOptions.headers.authorization, 'Bearer probe-token');
  assert.deepEqual(socketProtocols, ['iot-v1', 'iot-bearer.probe-token']);
  assert.equal(new URL(socketUrl).searchParams.get('siteCode'), 'site-a');
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
  assert.equal(result.partial, true);
  assert.equal(result.restOk, true);
  assert.equal(result.realtimeOk, false);
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

test('a protected endpoint without identity configuration requests setup instead of reporting a network failure', async () => {
  const result = await probeEndpoint({ accessRoute: 'SITE_API', apiBaseUrl: 'https://iot.example.test/api/v1',
    wsUrl: 'wss://iot.example.test/ws/devices', fetchImpl: fakeFetch(401, {}) });
  assert.equal(result.ok, false); assert.equal(result.authRequired, true); assert.equal(result.restOk, false);
  assert.match(result.message, /需要登录/);
});

test('a protected endpoint with valid discovery is login-ready without claiming REST or realtime success', async () => {
  const calls = [];
  const issuer = 'https://iot.example.test/auth/realms/iot-manager';
  const result = await probeEndpoint({ accessRoute: 'SITE_API', apiBaseUrl: 'https://iot.example.test/api/v1',
    wsUrl: 'wss://iot.example.test/ws/devices', oidcIssuerUrl: issuer, oidcClientId: 'iot-mobile',
    oidcRedirectUri: 'com.iot.manager.client://oauth/callback', verifyWebSocket: true,
    webSocketFactory: class { constructor() { throw new Error('Unauthenticated realtime must not be claimed'); } },
    fetchImpl: async (url, options) => {
      calls.push({ url, headers: options.headers });
      return new Response(JSON.stringify(url.endsWith('/openid-configuration') ? { issuer } : {}),
        { status: url.endsWith('/openid-configuration') ? 200 : 401 });
    } });
  assert.equal(result.ok, true); assert.equal(result.loginRequired, true);
  assert.equal(result.restOk, false); assert.equal(result.realtimeOk, null);
  assert.equal(calls.length, 2); assert.equal(calls[1].headers.authorization, undefined);
});

test('identity discovery with the wrong issuer cannot mark a connection login-ready', async () => {
  const result = await probeEndpoint({ accessRoute: 'SITE_API', apiBaseUrl: 'https://iot.example.test/api/v1',
    wsUrl: 'wss://iot.example.test/ws/devices', oidcIssuerUrl: 'https://iot.example.test/auth/realms/iot-manager',
    oidcClientId: 'iot-mobile', oidcRedirectUri: 'com.iot.manager.client://oauth/callback',
    fetchImpl: async (url) => new Response(JSON.stringify({ issuer: 'https://other.example.test' }),
      { status: url.endsWith('/openid-configuration') ? 200 : 401 }) });
  assert.equal(result.ok, false); assert.match(result.message, /登录服务验证失败/);
});

test('connection probe times out even when the native HTTP transport ignores AbortSignal', { timeout: 1000 }, async () => {
  const result = await probeEndpoint({ accessRoute: 'SITE_API', apiBaseUrl: 'https://iot.example.test/api/v1',
    wsUrl: 'wss://iot.example.test/ws/devices', timeoutMs: 20, fetchImpl: () => new Promise(() => {}) });
  assert.equal(result.ok, false); assert.match(result.message, /连接超时/);
});
