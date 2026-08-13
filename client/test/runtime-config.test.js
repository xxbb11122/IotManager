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

test('normalizes a site endpoint into immutable API and WebSocket URLs', () => {
  const profile = normalizeEndpointProfile({
    id: 'factory-a',
    accessRoute: ACCESS_ROUTES.SITE_API,
    apiBaseUrl: 'http://10.0.0.8:8080',
    wsUrl: 'ws://10.0.0.8:8080/ws'
  });
  assert.equal(profile.apiBaseUrl, 'http://10.0.0.8:8080/api');
  assert.equal(profile.wsUrl, 'ws://10.0.0.8:8080/ws/devices');
  assert.equal(Object.isFrozen(profile), true);
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
