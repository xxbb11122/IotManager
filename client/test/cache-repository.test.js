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
