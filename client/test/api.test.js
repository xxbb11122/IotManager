import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiClient, ApiError, resolveClientConfig } from '../src/js/api.js';

test('client configuration normalizes API and WebSocket endpoints', () => {
  const config = resolveClientConfig({
    apiBaseUrl: 'https://iot.example.test/api/',
    wsUrl: 'wss://iot.example.test/ws/devices/'
  });

  assert.equal(config.apiBaseUrl, 'https://iot.example.test/api/v1');
  assert.equal(config.wsUrl, 'wss://iot.example.test/ws/devices');
});

test('client configuration treats a bare backend origin as the API root', () => {
  const config = resolveClientConfig({
    apiBaseUrl: 'http://localhost:8080',
    wsUrl: 'ws://localhost:8080/ws'
  });

  assert.equal(config.apiBaseUrl, 'http://localhost:8080/api/v1');
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

  assert.equal(requests[0].url, 'https://iot.example.test/api/v1/discovery/lan?siteCode=demo+site');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    siteCode: 'demo-site',
    spacePath: '/operations/field',
    displayName: 'Pump A'
  });
  assert.equal(requests[2].url, 'https://iot.example.test/api/v1/devices/7/commands');
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    type: 'set_power',
    idempotencyKey: 'client-1',
    parameters: { on: true }
  });
});

test('site context API is versioned and uses the authenticated platform path', async () => {
  let requestedUrl;
  const api = new ApiClient({
    baseUrl: 'https://iot.example.test/api',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await api.listSites();
  assert.equal(requestedUrl, 'https://iot.example.test/api/v1/sites');
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

test('API client attaches an optional bearer token without changing caller headers', async () => {
  let request;
  const api = new ApiClient({
    baseUrl: 'https://iot.example.test/api',
    accessToken: 'access-token-1',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  await api.listDevices({}, { headers: { 'x-request-id': 'req-1' } });

  assert.equal(request.init.headers.authorization, 'Bearer access-token-1');
  assert.equal(request.init.headers['x-request-id'], 'req-1');
});

test('API client awaits an asynchronous token provider and retries one 401 after refresh', async () => {
  const requests = [];
  let refreshed = false;
  const api = new ApiClient({
    baseUrl: 'https://iot.example.test/api',
    accessTokenProvider: async () => refreshed ? 'rotated-token' : 'expired-token',
    onUnauthorized: async () => {
      refreshed = true;
      return true;
    },
    fetchImpl: async (_url, init) => {
      requests.push(init.headers.authorization);
      const accepted = init.headers.authorization === 'Bearer rotated-token';
      return new Response(accepted ? '[]' : JSON.stringify({ message: 'expired' }), {
        status: accepted ? 200 : 401,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  await api.listDevices();
  assert.deepEqual(requests, ['Bearer expired-token', 'Bearer rotated-token']);
});

test('API client exposes Retry-After on a throttled weather refresh', async () => {
  const api = new ApiClient({
    baseUrl: 'https://iot.example.test/api',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'cooldown' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '17' }
    })
  });

  await assert.rejects(
    () => api.refreshSiteWeather('demo-site'),
    (error) => error instanceof ApiError && error.status === 429 && error.retryAfterSeconds === 17
  );
});

test('weather API client keeps the site scope and forecast limits explicit', async () => {
  const requests = [];
  const api = new ApiClient({
    baseUrl: 'https://iot.example.test/api',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ status: 'FRESH' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  await api.getSiteWeather('demo site');
  await api.getSiteWeatherForecast('demo site', { hours: 24, days: 7 });
  await api.getSiteWeatherSettings('demo site');
  await api.updateSiteWeatherLocation('demo site', {
    latitude: 22.5431, longitude: 114.0579, accuracyM: 18, timezone: 'Asia/Shanghai', source: 'MOBILE_GPS'
  });
  await api.refreshSiteWeather('demo site');

  assert.equal(requests[0].url, 'https://iot.example.test/api/v1/sites/demo%20site/weather');
  assert.equal(requests[1].url, 'https://iot.example.test/api/v1/sites/demo%20site/weather/forecast?hours=24&days=7');
  assert.equal(requests[2].url, 'https://iot.example.test/api/v1/sites/demo%20site/weather-settings');
  assert.equal(requests[3].url, 'https://iot.example.test/api/v1/sites/demo%20site/weather/location');
  assert.equal(requests[3].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[3].init.body), {
    latitude: 22.5431, longitude: 114.0579, accuracyM: 18, timezone: 'Asia/Shanghai', source: 'MOBILE_GPS'
  });
  assert.equal(requests[4].url, 'https://iot.example.test/api/v1/sites/demo%20site/weather/refresh');
  assert.equal(requests[4].init.method, 'POST');
});
