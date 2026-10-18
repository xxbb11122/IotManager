import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CacheRepository } from '../src/js/platform/cache-repository.js';
import { openCompatibleCache } from '../src/js/platform/cache-schema.js';
import { patchLegacyCache } from '../scripts/rollback-cache-patch.mjs';

// Frozen source: 0c0ed0393f880d6483ce72632bdaa8980a3a4afe,
// apps/client-glass-next/src/js/platform/cache-repository.js (Glass.5).
const source = readFileSync(new URL('./fixtures/legacy-cache-v2.source.txt', import.meta.url), 'utf8');
const oldModule = source.replace("from 'idb'", `from ${JSON.stringify(import.meta.resolve('idb'))}`);
const { CacheRepository: UnpatchedOldCache } = await import(`data:text/javascript;base64,${Buffer.from(oldModule).toString('base64')}`);
const patched = patchLegacyCache(source, new URL('../src/js/platform/cache-schema.js', import.meta.url).href);
const { CacheRepository: CompatibleOldCache } = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
const name = () => `cache-rollback-${crypto.randomUUID()}`;

test('real v2 -> v3 -> patched v2 -> v3 preserves bindings, partitions and indexed activity', async () => {
  const databaseName = name(), old = new UnpatchedOldCache({ databaseName });
  const binding = await old.putLocalBinding({ appInstallId:'install', pluginDeviceId:'ble', displayName:'Switch' });
  const scope = { endpointId:'site', organizationCode:'org', authPartition:'user-a' };
  await old.replacePlatformDevices(scope, [{id:1}]);
  await old.addLocalActivity({id:'old', bindingKey:binding.key, occurredAt:'2026-10-18T00:00:00.000Z'});
  (await old.db()).close();
  const current = new CacheRepository({databaseName});
  assert.deepEqual((await current.listLocalActivityPage(binding.key)).items.map(row=>row.id), ['old']);
  await current.addLocalActivity({id:'new', bindingKey:binding.key, occurredAt:'2026-10-18T01:00:00.000Z'});
  (await current.db()).close();
  await assert.rejects(new UnpatchedOldCache({databaseName}).db(), {name:'VersionError'});
  const rollback = new CompatibleOldCache({databaseName});
  assert.equal((await rollback.db()).version, 3);
  assert.deepEqual((await rollback.listLocalBindings()).map(row=>row.key), [binding.key]);
  assert.deepEqual((await rollback.listLocalActivity(binding.key)).map(row=>row.id).sort(), ['new','old']);
  assert.deepEqual(await rollback.listPlatformDevices(scope), [{id:1}]);
  assert.deepEqual(await rollback.listPlatformDevices({...scope,authPartition:'user-b'}), []);
  await rollback.addLocalActivity({id:'rollback',bindingKey:binding.key,occurredAt:'2026-10-18T02:00:00.000Z'});
  (await rollback.db()).close();
  const resumed = new CacheRepository({databaseName});
  assert.deepEqual((await resumed.listLocalActivityPage(binding.key)).items.map(row=>row.id), ['rollback','new','old']);
  assert.equal((await resumed.db()).version,3);
  (await resumed.db()).close();
});

test('unknown schema is refused without changing data or version', async () => {
  const databaseName=name(), future=await openDB(databaseName,4,{upgrade(db){db.createObjectStore('future');}});
  await future.put('future','preserve','key'); future.close();
  await assert.rejects(openCompatibleCache(databaseName,2),/Unsupported cache schema/);
  const unchanged=await openDB(databaseName);
  assert.equal(unchanged.version,4); assert.equal(await unchanged.get('future','key'),'preserve'); unchanged.close();
});

test('malformed known schema is rejected and not deleted', async () => {
  const databaseName=name(), broken=await openDB(databaseName,3,{upgrade(db){db.createObjectStore('preserve');}});
  await broken.put('preserve',42,'key'); broken.close();
  await assert.rejects(openCompatibleCache(databaseName,2),/Missing cache store/);
  const unchanged=await openDB(databaseName); assert.equal(await unchanged.get('preserve','key'),42); unchanged.close();
});

test('versionchange closes the compatible reader instead of blocking a future upgrade', async () => {
  const databaseName=name(), current=new CacheRepository({databaseName}); await current.db();
  const upgraded=await openDB(databaseName,4); assert.equal(upgraded.version,4); upgraded.close();
});

test('backport refuses unreviewed cache variants and invalid requested versions', async () => {
  assert.throws(()=>patchLegacyCache(source.replace('this.databaseName, 2','this.databaseName, 1')),/reviewed v2/);
  assert.throws(()=>patchLegacyCache(patched),/reviewed v2/);
  await assert.rejects(openCompatibleCache(name(),4),/Unsupported requested/);
});
