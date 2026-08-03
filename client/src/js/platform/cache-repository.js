import { openDB } from 'idb';

function scopeKey({ endpointId, organizationCode }) {
  if (!endpointId || !organizationCode) throw new TypeError('Platform cache requires endpoint and organization');
  return `${endpointId}:${organizationCode}`;
}

export class CacheRepository {
  constructor({ databaseName = 'iot-manager-client-v1' } = {}) {
    this.databaseName = databaseName;
    this.dbPromise = null;
  }

  db() {
    this.dbPromise ??= openDB(this.databaseName, 1, {
      upgrade(db) {
        const devices = db.createObjectStore('platformDevices', { keyPath: 'key' });
        devices.createIndex('scopeKey', 'scopeKey');
        db.createObjectStore('localBindings', { keyPath: 'key' });
        const activity = db.createObjectStore('localActivity', { keyPath: 'id' });
        activity.createIndex('bindingKey', 'bindingKey');
      }
    });
    return this.dbPromise;
  }

  async replacePlatformDevices(scope, devices = scope.devices ?? []) {
    const key = scopeKey(scope);
    const cachedAt = Date.now();
    const db = await this.db();
    const tx = db.transaction('platformDevices', 'readwrite');
    for (const stored of await tx.store.index('scopeKey').getAll(key)) await tx.store.delete(stored.key);
    for (const device of devices) await tx.store.put({ key: `${key}:${device.id}`, scopeKey: key, device, cachedAt });
    await tx.done;
  }

  async listPlatformDevices(scope) {
    return (await this.getPlatformSnapshot(scope)).devices;
  }

  async getPlatformSnapshot(scope) {
    const db = await this.db();
    const records = await db.getAllFromIndex('platformDevices', 'scopeKey', scopeKey(scope));
    return {
      devices: records.map((item) => item.device),
      cachedAt: records.reduce((latest, item) => Math.max(latest, item.cachedAt ?? 0), 0) || null
    };
  }

  async putLocalBinding(binding) {
    if (!binding.appInstallId || !binding.pluginDeviceId) throw new TypeError('Local binding requires install and plugin ids');
    const value = { ...binding, key: `${binding.appInstallId}:${binding.pluginDeviceId}`, localOnly: true };
    delete value.organizationCode;
    await (await this.db()).put('localBindings', value);
    return value;
  }

  async listLocalBindings() {
    return (await this.db()).getAll('localBindings');
  }

  async removeLocalBinding(appInstallId, pluginDeviceId) {
    if (!appInstallId || !pluginDeviceId) return false;
    const key = `${appInstallId}:${pluginDeviceId}`;
    const db = await this.db();
    const tx = db.transaction(['localBindings', 'localActivity'], 'readwrite');
    await tx.objectStore('localBindings').delete(key);
    const activity = tx.objectStore('localActivity');
    for (const entry of await activity.index('bindingKey').getAllKeys(key)) {
      await activity.delete(entry);
    }
    await tx.done;
    return true;
  }

  async addLocalActivity(activity) {
    if (!activity?.id || !activity?.bindingKey) throw new TypeError('Local activity requires id and bindingKey');
    const value = { ...activity, occurredAt: activity.occurredAt ?? new Date().toISOString() };
    await (await this.db()).put('localActivity', value);
    return value;
  }

  async listLocalActivity(bindingKey) {
    return (await this.db()).getAllFromIndex('localActivity', 'bindingKey', bindingKey);
  }
}
