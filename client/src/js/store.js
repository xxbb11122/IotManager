import { transitionCommand } from './command-state.js';

export const REALTIME_EVENT_VERSION = 1;

const DEFAULT_CONNECTION_HEALTH = Object.freeze({
  state: 'idle',
  stale: true,
  reconnectAttempt: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  error: null
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copyValue(value) {
  if (Array.isArray(value)) {
    return value.map(copyValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
  }
  return value;
}

function freezeDeep(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  Object.values(value).forEach((item) => freezeDeep(item, seen));
  return Object.freeze(value);
}

function normalizeDevice(device) {
  const copy = isRecord(device) ? copyValue(device) : {};
  copy.reportedState = isRecord(copy.reportedState) ? copy.reportedState : {};
  copy.desiredState = isRecord(copy.desiredState) ? copy.desiredState : {};
  copy.connections = Array.isArray(copy.connections) ? copy.connections : [];
  return copy;
}

function normalizeCollectionByDevice(collection) {
  if (!isRecord(collection)) {
    return {};
  }
  return Object.fromEntries(Object.entries(collection).map(([key, entries]) => [
    key,
    Array.isArray(entries) ? entries.map(copyValue) : []
  ]));
}

function normalizeState(candidate = {}) {
  const source = isRecord(candidate) ? candidate : {};
  return {
    devices: Array.isArray(source.devices) ? source.devices.map(normalizeDevice) : [],
    activeDeviceId: source.activeDeviceId ?? null,
    activeConnection: isRecord(source.activeConnection) ? copyValue(source.activeConnection) : null,
    commandsById: isRecord(source.commandsById) ? copyValue(source.commandsById) : {},
    activitiesByDeviceId: normalizeCollectionByDevice(source.activitiesByDeviceId),
    alertsByDeviceId: normalizeCollectionByDevice(source.alertsByDeviceId),
    runtime: {
      accessRoute: null,
      endpointId: null,
      stale: true,
      lastSyncedAt: null,
      ...(isRecord(source.runtime) ? copyValue(source.runtime) : {})
    },
    connectionHealth: {
      ...DEFAULT_CONNECTION_HEALTH,
      ...(isRecord(source.connectionHealth) ? copyValue(source.connectionHealth) : {})
    }
  };
}

function referencesMatch(device, reference) {
  if (!device || reference === null || reference === undefined) {
    return false;
  }
  const candidate = String(reference);
  return [device.id, device.publicId, device.deviceId]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => String(value) === candidate);
}

function findDeviceIndex(devices, reference) {
  return devices.findIndex((device) => referencesMatch(device, reference));
}

function deviceKey(device, fallback) {
  return String(device?.id ?? fallback);
}

function deviceReferences(device) {
  return new Set([device?.id, device?.deviceId, device?.publicId]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value)));
}

function payloadDeviceReference(payload) {
  if (!isRecord(payload)) {
    return null;
  }
  return payload.deviceDbId ?? payload.deviceId ?? payload.devicePublicId ?? payload.publicId ?? payload.id ?? null;
}

function mergeDevice(existing, patch) {
  const incoming = isRecord(patch) ? patch : {};
  return normalizeDevice({
    ...existing,
    ...incoming,
    reportedState: Object.prototype.hasOwnProperty.call(incoming, 'reportedState')
      ? incoming.reportedState
      : existing?.reportedState,
    desiredState: Object.prototype.hasOwnProperty.call(incoming, 'desiredState')
      ? incoming.desiredState
      : existing?.desiredState,
    connections: Object.prototype.hasOwnProperty.call(incoming, 'connections')
      ? incoming.connections
      : existing?.connections
  });
}

function applyKnownCommands(device, commandsById) {
  return Object.values(commandsById).reduce((next, command) => (
    referencesMatch(next, payloadDeviceReference(command))
      ? transitionCommand(next, command)
      : next
  ), normalizeDevice(device));
}

function parseActivityPayload(activity) {
  if (!isRecord(activity) || typeof activity.payloadJson !== 'string') {
    return activity;
  }
  try {
    return { ...activity, payload: JSON.parse(activity.payloadJson) };
  } catch {
    return { ...activity, payload: activity.payloadJson };
  }
}

function uniqueEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = entry?.id ?? JSON.stringify(entry);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function rekeyCollectionForDevices(collection, devices) {
  let next = collection;
  for (const device of devices) {
    if (device?.id === null || device?.id === undefined) {
      continue;
    }
    const canonicalKey = String(device.id);
    const aliases = [...deviceReferences(device)];
    const entries = aliases.flatMap((alias) => collection[alias] ?? []);
    if (entries.length === 0 || (aliases.length === 1 && aliases[0] === canonicalKey)) {
      continue;
    }
    next = { ...next };
    for (const alias of aliases) {
      if (alias !== canonicalKey) {
        delete next[alias];
      }
    }
    next[canonicalKey] = uniqueEntries(entries);
  }
  return next;
}

function rekeyDeviceCollections(devices, activitiesByDeviceId, alertsByDeviceId) {
  return {
    activitiesByDeviceId: rekeyCollectionForDevices(activitiesByDeviceId, devices),
    alertsByDeviceId: rekeyCollectionForDevices(alertsByDeviceId, devices)
  };
}

function connectionFromPayload(payload) {
  const connection = {
    transport: payload.transport,
    profileId: payload.profileId ?? null,
    externalId: payload.externalId ?? null,
    status: payload.status ?? 'UNKNOWN',
    metadata: isRecord(payload.metadata) ? payload.metadata : {}
  };
  return connection;
}

/**
 * Transport-neutral client state. Mutators publish frozen snapshot objects, so
 * page code cannot accidentally change a previous or current store value.
 */
export function createClientStore(initialState = {}) {
  let currentState = freezeDeep(normalizeState(initialState));
  const listeners = new Set();

  function publish(next) {
    currentState = freezeDeep(normalizeState(next));
    for (const listener of listeners) {
      listener(currentState);
    }
    return currentState;
  }

  function getState() {
    return currentState;
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') {
      throw new TypeError('Store subscriber must be a function');
    }
    listeners.add(listener);
    if (emitCurrent) {
      listener(currentState);
    }
    return () => listeners.delete(listener);
  }

  function selectDevice(reference) {
    return currentState.devices.find((device) => referencesMatch(device, reference)) ?? null;
  }

  function selectActiveDevice() {
    return selectDevice(currentState.activeDeviceId);
  }

  function setDevices(devices) {
    const normalizedDevices = Array.isArray(devices)
      ? devices.map((device) => applyKnownCommands(device, currentState.commandsById))
      : [];
    const collections = rekeyDeviceCollections(
      normalizedDevices,
      currentState.activitiesByDeviceId,
      currentState.alertsByDeviceId
    );
    return publish({ ...currentState, devices: normalizedDevices, ...collections });
  }

  function upsertDevice(device) {
    const reference = payloadDeviceReference(device);
    const index = findDeviceIndex(currentState.devices, reference);
    const devices = [...currentState.devices];
    if (index >= 0) {
      devices[index] = applyKnownCommands(mergeDevice(devices[index], device), currentState.commandsById);
    } else {
      devices.push(applyKnownCommands(device, currentState.commandsById));
    }
    const collections = rekeyDeviceCollections(
      devices,
      currentState.activitiesByDeviceId,
      currentState.alertsByDeviceId
    );
    return publish({ ...currentState, devices, ...collections });
  }

  function patchDevice(reference, patch) {
    const index = findDeviceIndex(currentState.devices, reference);
    if (index < 0) {
      return null;
    }
    const devices = [...currentState.devices];
    devices[index] = mergeDevice(devices[index], patch);
    publish({ ...currentState, devices });
    return devices[index];
  }

  function removeDevice(reference) {
    const devices = currentState.devices.filter((device) => !referencesMatch(device, reference));
    const nextActiveDeviceId = referencesMatch(selectActiveDevice(), reference)
      ? null
      : currentState.activeDeviceId;
    return publish({ ...currentState, devices, activeDeviceId: nextActiveDeviceId });
  }

  function setActiveDevice(reference) {
    const device = selectDevice(reference);
    return publish({ ...currentState, activeDeviceId: device?.id ?? reference ?? null });
  }

  function setActiveConnection(connection) {
    return publish({ ...currentState, activeConnection: connection ?? null });
  }

  function setConnectionHealth(health) {
    return publish({
      ...currentState,
      connectionHealth: { ...currentState.connectionHealth, ...(isRecord(health) ? health : {}) }
    });
  }

  function setRuntimeContext(patch = {}) {
    const next = publish({
      ...currentState,
      runtime: { ...currentState.runtime, ...copyValue(patch) }
    });
    return next.runtime;
  }

  function upsertCommand(command) {
    if (!isRecord(command) || !command.commandId) {
      return null;
    }
    const commandsById = { ...currentState.commandsById, [command.commandId]: copyValue(command) };
    const reference = payloadDeviceReference(command);
    const index = findDeviceIndex(currentState.devices, reference);
    const devices = [...currentState.devices];
    if (index >= 0) {
      devices[index] = transitionCommand(devices[index], command);
    }
    publish({ ...currentState, devices, commandsById });
    return commandsById[command.commandId];
  }

  function addActivity(reference, activity) {
    const index = findDeviceIndex(currentState.devices, reference);
    const device = index >= 0 ? currentState.devices[index] : null;
    const key = deviceKey(device, reference);
    const normalizedActivity = parseActivityPayload(copyValue(activity));
    const existing = currentState.activitiesByDeviceId[key] ?? [];
    const withoutDuplicate = normalizedActivity?.id == null
      ? existing
      : existing.filter((item) => item.id !== normalizedActivity.id);
    return publish({
      ...currentState,
      activitiesByDeviceId: {
        ...currentState.activitiesByDeviceId,
        [key]: [normalizedActivity, ...withoutDuplicate]
      }
    });
  }

  function upsertAlert(reference, alert) {
    const index = findDeviceIndex(currentState.devices, reference);
    const device = index >= 0 ? currentState.devices[index] : null;
    const key = deviceKey(device, reference);
    const existing = currentState.alertsByDeviceId[key] ?? [];
    const withoutDuplicate = alert?.id == null ? existing : existing.filter((item) => item.id !== alert.id);
    return publish({
      ...currentState,
      alertsByDeviceId: {
        ...currentState.alertsByDeviceId,
        [key]: [copyValue(alert), ...withoutDuplicate]
      }
    });
  }

  function applyConnectionUpdate(payload) {
    const reference = payloadDeviceReference(payload);
    const index = findDeviceIndex(currentState.devices, reference);
    if (index < 0) {
      return false;
    }
    const existing = currentState.devices[index];
    const connection = connectionFromPayload(payload);
    const connectionIndex = existing.connections.findIndex((item) => (
      item.externalId && connection.externalId
        ? item.externalId === connection.externalId
        : item.transport === connection.transport && item.profileId === connection.profileId
    ));
    const connections = [...existing.connections];
    if (connectionIndex >= 0) {
      connections[connectionIndex] = { ...connections[connectionIndex], ...connection };
    } else {
      connections.push(connection);
    }
    patchDevice(reference, { connections });
    return true;
  }

  function applyTelemetryUpdate(payload) {
    const updates = Array.isArray(payload) ? payload : [payload];
    let changed = false;
    for (const update of updates) {
      if (!isRecord(update)) {
        continue;
      }
      const reference = payloadDeviceReference(update);
      if (patchDevice(reference, update)) {
        changed = true;
      }
    }
    return changed;
  }

  function applyRealtimeEvent(event) {
    if (!isRecord(event) || event.version !== REALTIME_EVENT_VERSION || typeof event.type !== 'string') {
      return false;
    }

    const { type, payload } = event;
    switch (type) {
      case 'device_update':
        upsertDevice(payload);
        return true;
      case 'telemetry_update':
        return applyTelemetryUpdate(payload);
      case 'connection_update':
        return isRecord(payload) && applyConnectionUpdate(payload);
      case 'command_update':
        return Boolean(upsertCommand(payload));
      case 'activity_update':
        addActivity(payloadDeviceReference(payload), payload);
        return true;
      case 'alert':
      case 'alert_update':
        upsertAlert(payloadDeviceReference(payload), payload);
        return true;
      case 'device_updates':
        // The legacy batch event can race the singular normalized events.
        return true;
      default:
        return false;
    }
  }

  return Object.freeze({
    getState,
    subscribe,
    selectDevice,
    selectActiveDevice,
    setDevices,
    upsertDevice,
    patchDevice,
    removeDevice,
    setActiveDevice,
    setActiveConnection,
    setConnectionHealth,
    setRuntimeContext,
    upsertCommand,
    addActivity,
    upsertAlert,
    applyRealtimeEvent
  });
}

export const store = createClientStore();

// Compatibility exports keep the former client entry point buildable while it
// is migrated to the normalized store API.
export const state = new Proxy({}, {
  get(_target, property) {
    if (property === 'currentDevice') {
      return store.selectActiveDevice();
    }
    if (property === 'logs') {
      return Object.values(store.getState().activitiesByDeviceId).flat();
    }
    return store.getState()[property];
  }
});

export function setDevices(devices) {
  return store.setDevices(devices);
}

export function setCurrentDevice(device) {
  if (device == null) {
    return store.setActiveDevice(null);
  }
  store.upsertDevice(device);
  return store.setActiveDevice(device.id ?? device.deviceId ?? device.publicId);
}

export function addDevice(device) {
  return store.upsertDevice(device);
}

export function removeDevice(reference) {
  return store.removeDevice(reference);
}

export function updateDeviceState(reference, newState) {
  const device = store.selectDevice(reference);
  if (!device) {
    return null;
  }
  return store.patchDevice(reference, {
    state: { ...(isRecord(device.state) ? device.state : {}), ...(isRecord(newState) ? newState : {}) },
    reportedState: { ...device.reportedState, ...(isRecord(newState) ? newState : {}) }
  });
}
