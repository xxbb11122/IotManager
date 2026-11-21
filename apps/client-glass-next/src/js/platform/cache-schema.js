import { openDB } from 'idb';

const stores = {
  platformDevices: 'key', localBindings: 'key', localActivity: 'id', platformWeather: 'key'
};

function assertSchema(db, requestedVersion) {
  if (db.version < requestedVersion || db.version > 3) throw new Error(`Unsupported cache schema: ${db.version}`);
  for (const name of Object.keys(stores)) {
    if (!db.objectStoreNames.contains(name)) throw new Error(`Missing cache store: ${name}`);
  }
  const tx = db.transaction(Object.keys(stores), 'readonly');
  for (const [name, keyPath] of Object.entries(stores)) {
    const store = tx.objectStore(name);
    if (store.keyPath !== keyPath || store.autoIncrement) throw new Error(`Incompatible cache store: ${name}`);
  }
  const index = (store, name, keyPath) => {
    const value = tx.objectStore(store).index(name);
    if (JSON.stringify(value.keyPath) !== JSON.stringify(keyPath) || value.unique || value.multiEntry) {
      throw new Error(`Incompatible cache index: ${name}`);
    }
  };
  index('platformDevices', 'scopeKey', 'scopeKey');
  index('localActivity', 'bindingKey', 'bindingKey');
  if (db.version === 3) index('localActivity', 'bindingTime', ['bindingKey', 'occurredAt', 'id']);
}

/** Accept only the two reviewed schemas. Never delete or downgrade a database. */
export async function openCompatibleCache(name, requestedVersion, callbacks = {}) {
  if (![2, 3].includes(requestedVersion)) throw new TypeError('Unsupported requested cache schema');
  let connection;
  const options = {
    ...callbacks,
    blocking(...args) {
      connection?.close();
      callbacks.blocking?.(...args);
    }
  };
  try {
    connection = await openDB(name, requestedVersion, options);
  } catch (error) {
    if (error?.name !== 'VersionError') throw error;
    // A patched v2 reader may open a reviewed v3 database without lowering it.
    connection = await openDB(name, undefined, options);
  }
  try {
    assertSchema(connection, requestedVersion);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}
