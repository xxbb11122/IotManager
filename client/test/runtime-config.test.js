import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCESS_ROUTES,
  repairLegacyNativeEndpoint,
  RuntimeConfigRepository,
  normalizeEndpointProfile
} from '../src/js/platform/runtime-config.js';

function fakePreferences() {
  const values = new Map();
  return {
    async get({ key }) { return { value: values.get(key) ?? null }; },
    async set({ key, value }) { values.set(key, value); }
  };
}

test('startup reads strip legacy tokens without migration writes', async () => {
  let writes = 0;
  const repository = new RuntimeConfigRepository({ preferences: {
    get: async () => ({ value: JSON.stringify({ id: 'a', accessRoute: 'SITE_API', apiBaseUrl: 'https://a.invalid',
      wsUrl: 'wss://a.invalid', accessToken: 'legacy-token' }) }),
    set: async () => { writes++; }
  } });
  assert.equal((await repository.load({ migrate: false })).accessToken, null);
  assert.equal(writes, 0);
  await repository.load();
  assert.equal(writes, 1);
});

test('an older pure read cannot migrate over a newer manual endpoint save', async () => {
  let resolveRead, saved;
  const read = new Promise(resolve => { resolveRead = resolve; });
  const repository = new RuntimeConfigRepository({ preferences: {
    get: () => read, set: async ({ value }) => { saved = JSON.parse(value); }
  } });
  const pending = repository.load({ migrate: false });
  await repository.save({ id: 'new', accessRoute: 'SITE_API', apiBaseUrl: 'https://new.invalid', wsUrl: 'wss://new.invalid' });
  resolveRead({ value: JSON.stringify({ id: 'old', accessRoute: 'SITE_API', apiBaseUrl: 'https://old.invalid',
    wsUrl: 'wss://old.invalid', accessToken: 'legacy' }) });
  assert.equal((await pending).accessToken, null);
  assert.equal(saved.id, 'new');
});

test('endpoint writes are ordered and a rejected write does not prevent the next save', async () => {
  const calls = []; let rejectFirst;
  const repository = new RuntimeConfigRepository({ preferences: { set: async ({ value }) => {
    calls.push(JSON.parse(value).id);
    if (calls.length === 1) await new Promise((_, reject) => { rejectFirst = reject; });
  } } });
  const profile = id => ({ id, accessRoute: 'SITE_API', apiBaseUrl: 'https://a.invalid', wsUrl: 'wss://a.invalid' });
  const first = repository.save(profile('first'));
  const rejection = assert.rejects(first, /storage denied/);
  const second = repository.save(profile('second'));
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['first']);
  rejectFirst(new Error('storage denied'));
  await rejection;
  assert.equal((await second).id, 'second');
  assert.deepEqual(calls, ['first', 'second']);
});

test('normalizes a site endpoint into immutable API and WebSocket URLs', () => {
  const profile = normalizeEndpointProfile({
    id: 'factory-a',
    accessRoute: ACCESS_ROUTES.SITE_API,
    apiBaseUrl: 'http://10.0.0.8:8080',
    wsUrl: 'ws://10.0.0.8:8080/ws'
  });
  assert.equal(profile.apiBaseUrl, 'http://10.0.0.8:8080/api/v1');
  assert.equal(profile.wsUrl, 'ws://10.0.0.8:8080/ws/devices');
  assert.equal(profile.accessToken, null);
  assert.equal(Object.isFrozen(profile), true);
});

test('endpoint profile accepts an optional in-memory access token for development compatibility', () => {
  const profile = normalizeEndpointProfile({
    id: 'secure-site',
    accessRoute: ACCESS_ROUTES.SITE_API,
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices',
    accessToken: '  short-lived-token  '
  });
  assert.equal(profile.accessToken, 'short-lived-token');
});

test('persists and reloads the active endpoint profile', async () => {
  const preferences = fakePreferences();
  const repository = new RuntimeConfigRepository({ preferences });
  await repository.save({
    id: 'cloud',
    accessRoute: ACCESS_ROUTES.CLOUD_API,
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices'
  });
  assert.equal((await repository.load()).id, 'cloud');
});

test('endpoint persistence strips legacy bearer tokens while retaining public OIDC settings', async () => {
  const preferences = fakePreferences();
  const repository = new RuntimeConfigRepository({ preferences });
  await repository.save({
    id: 'cloud',
    accessRoute: ACCESS_ROUTES.CLOUD_API,
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices',
    accessToken: 'do-not-persist',
    oidcIssuerUrl: 'https://iot.example.test/auth/realms/iot-manager',
    oidcClientId: 'iot-mobile',
    oidcRedirectUri: 'com.iot.manager.client://oauth/callback'
  });
  const raw = await preferences.get({ key: 'iot-manager.active-endpoint.v1' });
  assert.equal(JSON.parse(raw.value).accessToken, undefined);
  const loaded = await repository.load();
  assert.equal(loaded.accessToken, null);
  assert.equal(loaded.oidcClientId, 'iot-mobile');
});

test('repairs only legacy native development endpoints after an app upgrade', () => {
  const repaired = repairLegacyNativeEndpoint({
    id: 'site',
    accessRoute: ACCESS_ROUTES.SITE_API,
    apiBaseUrl: 'http://10.0.2.2:8080/api',
    wsUrl: 'ws://10.0.2.2:8080/ws/devices'
  }, {
    apiBaseUrl: 'http://192.168.1.100:8080/api',
    wsUrl: 'ws://192.168.1.100:8080/ws/devices'
  });
  assert.equal(repaired.apiBaseUrl, 'http://192.168.1.100:8080/api');
  assert.equal(repaired.wsUrl, 'ws://192.168.1.100:8080/ws/devices');

  const untouched = repairLegacyNativeEndpoint({
    id: 'remote',
    accessRoute: ACCESS_ROUTES.CLOUD_API,
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices'
  }, {
    apiBaseUrl: 'http://192.168.1.100:8080/api',
    wsUrl: 'ws://192.168.1.100:8080/ws/devices'
  });
  assert.equal(untouched.apiBaseUrl, 'https://iot.example.test/api');
});
