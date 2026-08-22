import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { CacheRepository } from '../src/js/platform/cache-repository.js';

test('platform snapshots are partitioned by endpoint and organization', async () => {
  const cache = new CacheRepository({ databaseName: `iot-test-${Date.now()}` });
  await cache.replacePlatformDevices({ endpointId: 'site', organizationCode: 'org-a', devices: [{ id: 1 }] });
  const snapshot = await cache.getPlatformSnapshot({ endpointId: 'site', organizationCode: 'org-a' });
  assert.deepEqual(snapshot.devices, [{ id: 1 }]);
  assert.equal(typeof snapshot.cachedAt, 'number');
  assert.deepEqual(await cache.listPlatformDevices({ endpointId: 'cloud', organizationCode: 'org-a' }), []);
});

test('local BLE bindings use install and plugin identities without becoming platform devices', async () => {
  const cache = new CacheRepository({ databaseName: `iot-test-${Date.now()}-ble` });
  const binding = await cache.putLocalBinding({ appInstallId: 'install-1', pluginDeviceId: 'ble-1', displayName: 'Switch' });
  assert.equal(binding.key, 'install-1:ble-1');
  assert.equal(binding.localOnly, true);
  assert.equal(binding.organizationCode, undefined);
  await cache.addLocalActivity({ id: 'event-1', bindingKey: binding.key, eventType: 'command_unconfirmed' });
  assert.deepEqual((await cache.listLocalActivity(binding.key)).map((event) => event.id), ['event-1']);
});

test('clearing a platform scope removes server data but preserves other scopes and local bindings', async () => {
  const cache = new CacheRepository({ databaseName: `iot-test-${Date.now()}-signout` });
  const orgA = { endpointId: 'site', organizationCode: 'org-a', siteCode: 'site-a' };
  const orgB = { endpointId: 'site', organizationCode: 'org-b', siteCode: 'site-b' };
  await cache.replacePlatformDevices({ ...orgA, devices: [{ id: 1 }] });
  await cache.putPlatformWeather(orgA, { status: 'FRESH' });
  await cache.replacePlatformDevices({ ...orgB, devices: [{ id: 2 }] });
  await cache.putPlatformWeather(orgB, { status: 'FRESH' });
  await cache.putLocalBinding({ appInstallId: 'install-1', pluginDeviceId: 'ble-1' });

  await cache.clearPlatformScope(orgA);

  assert.deepEqual((await cache.getPlatformSnapshot(orgA)).devices, []);
  assert.equal(await cache.getPlatformWeather(orgA), null);
  assert.deepEqual((await cache.getPlatformSnapshot(orgB)).devices, [{ id: 2 }]);
  assert.deepEqual((await cache.getPlatformWeather(orgB)).weather, { status: 'FRESH' });
  assert.equal((await cache.listLocalBindings()).length, 1);
});

test('forgetting a local BLE binding removes its local activity trail', async () => {
  const cache = new CacheRepository({ databaseName: `iot-test-${Date.now()}-forget` });
  const binding = await cache.putLocalBinding({ appInstallId: 'install-1', pluginDeviceId: 'ble-1', displayName: 'Switch' });
  await cache.addLocalActivity({ id: 'event-1', bindingKey: binding.key, eventType: 'command_acknowledged' });

  assert.equal(await cache.removeLocalBinding('install-1', 'ble-1'), true);
  assert.equal((await cache.listLocalBindings()).length, 0);
  assert.deepEqual(await cache.listLocalActivity(binding.key), []);
});
