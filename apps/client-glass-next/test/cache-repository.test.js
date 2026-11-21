import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';

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

test('same numeric device IDs are isolated by site, server URL and authorization partition', async () => {
  const cache = new CacheRepository({ databaseName: `iot-test-${Date.now()}-partitions` });
  const base = { endpointId: 'site', organizationCode: 'org', siteCode: 'a', apiBaseUrl: 'https://one.invalid', authPartition: 'session-a' };
  const scopes = [base, { ...base, siteCode: 'b' }, { ...base, apiBaseUrl: 'https://two.invalid' }, { ...base, authPartition: 'session-b' }];
  for (const [index, scope] of scopes.entries()) {
    await cache.replacePlatformDevices(scope, [{ id: 1, label: index }]);
    await cache.putPlatformWeather(scope, { label: index });
  }
  for (const [index, scope] of scopes.entries()) {
    assert.equal((await cache.listPlatformDevices(scope))[0].label, index);
    assert.equal((await cache.getPlatformWeather(scope)).weather.label, index);
  }
  await cache.replacePlatformDevices(base, []);
  assert.deepEqual(await cache.listPlatformDevices(base), []);
  assert.equal((await cache.listPlatformDevices(scopes[1]))[0].label, 1);
  await cache.clearPlatformScope(base);
  for (const scope of scopes) {
    assert.deepEqual(await cache.listPlatformDevices(scope), []);
    assert.equal(await cache.getPlatformWeather(scope), null);
  }
});

test('ambiguous delimiter strings cannot collide and unscoped legacy cache is not imported into a site', async () => {
  const cache = new CacheRepository({ databaseName: `iot-test-${Date.now()}-legacy` });
  await cache.replacePlatformDevices({ endpointId: 'a:b', organizationCode: 'c' }, [{ id: 1 }]);
  assert.deepEqual(await cache.listPlatformDevices({ endpointId: 'a', organizationCode: 'b:c' }), []);
  assert.deepEqual(await cache.listPlatformDevices({ endpointId: 'a:b', organizationCode: 'c', siteCode: 'new-site' }), []);
  const db = await cache.db();
  await db.put('platformDevices', { key: 'old:org:1', scopeKey: 'old:org', device: { id: 1 }, cachedAt: 1 });
  assert.deepEqual(await cache.listPlatformDevices({ endpointId: 'old', organizationCode: 'org', siteCode: 'a' }), []);
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

test('local activity cursor pagination is newest first, scoped, and has no duplicate boundary', async () => {
  const cache = new CacheRepository({ databaseName: `iot-page-${Date.now()}` });
  for (let i = 0; i < 7; i++) await cache.addLocalActivity({ id: `event-${i}`, bindingKey: 'install:a', occurredAt: `2026-10-18T00:00:0${Math.floor(i/2)}.000Z` });
  await cache.addLocalActivity({ id: 'other', bindingKey: 'install:b' });
  const first = await cache.listLocalActivityPage('install:a', { limit: 3 });
  const second = await cache.listLocalActivityPage('install:a', { limit: 3, before: first.nextCursor });
  const last = await cache.listLocalActivityPage('install:a', { limit: 3, before: second.nextCursor });
  assert.deepEqual([...first.items,...second.items,...last.items].map(row=>row.id), ['event-6','event-5','event-4','event-3','event-2','event-1','event-0']);
  assert.equal(last.nextCursor, null);
  await assert.rejects(cache.listLocalActivityPage('install:a', { limit: 0 }), /limit/);
});

test('version 2 local history migrates into the paged index without dropping untimed events', async () => {
  const name = `iot-migration-${Date.now()}`;
  const old = await openDB(name, 2, { upgrade(db) {
    const devices=db.createObjectStore('platformDevices',{keyPath:'key'});devices.createIndex('scopeKey','scopeKey');
    db.createObjectStore('localBindings',{keyPath:'key'});db.createObjectStore('platformWeather',{keyPath:'key'});
    const events=db.createObjectStore('localActivity',{keyPath:'id'});events.createIndex('bindingKey','bindingKey');
  } });
  await old.put('localActivity', { id: 'legacy', bindingKey: 'a' }); old.close();
  const cache = new CacheRepository({ databaseName: name });
  const page = await cache.listLocalActivityPage('a');
  assert.equal(page.items[0].id, 'legacy'); assert.equal(page.items[0].occurredAt, '1970-01-01T00:00:00.000Z');
});
