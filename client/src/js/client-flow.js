import { capabilityControls, resolveCapabilityEnvelope } from './device-capabilities.js';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringValue(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export { capabilityControls } from './device-capabilities.js';

export function decorateLanDevice(device = {}, capabilityEnvelope = null) {
  const connections = Array.isArray(device.connections) ? device.connections : [];
  const hasLanConnection = connections.some((connection) => (
    String(connection?.transport ?? '').toUpperCase().includes('LAN')
    || String(connection?.transport ?? '').toUpperCase().includes('AGENT')
  ));
  if (!hasLanConnection) {
    return device;
  }

  const declaredCapabilities = resolveCapabilityEnvelope(device, connections[0]) ?? capabilityEnvelope;
  if (declaredCapabilities == null) {
    return device;
  }

  const controls = capabilityControls(declaredCapabilities);
  return {
    ...device,
    capabilities: device.capabilities ?? device.profileCapabilities ?? controls,
    connections: connections.map((connection) => ({
      ...connection,
      capabilities: connection.capabilities ?? connection.profileCapabilities ?? controls
    }))
  };
}

export function createLocalBleDevice(candidate = {}, connection = {}, context = {}) {
  const browserDeviceId = stringValue(
    candidate.id ?? candidate.deviceId ?? connection.id ?? connection.deviceId ?? connection.externalId
  );
  if (!browserDeviceId) {
    throw new TypeError('A browser-local BLE device requires a browser device id');
  }

  const capabilityEnvelope = connection.capabilities ?? candidate.capabilities ?? null;
  const controls = capabilityControls(capabilityEnvelope);
  const genericInformation = asObject(connection.genericInformation ?? candidate.genericInformation);
  const normalizedConnection = {
    ...asObject(connection),
    deviceId: browserDeviceId,
    externalId: connection.externalId ?? browserDeviceId,
    transport: connection.transport ?? 'BLE_DIRECT',
    status: connection.status ?? 'DISCONNECTED',
    capabilities: controls,
    profileCapabilities: capabilityEnvelope,
    metadata: { ...asObject(connection.metadata), ...genericInformation },
    identityScope: 'browser_local'
  };

  return {
    id: `ble:${browserDeviceId}`,
    deviceId: browserDeviceId,
    name: candidate.name ?? connection.name ?? 'Unnamed BLE device',
    type: candidate.type ?? 'BLE_DEVICE',
    status: normalizedConnection.status === 'CONNECTED' ? 'ONLINE' : 'OFFLINE',
    pendingOrganizationContext: {
      organizationCode: context.organizationCode ?? null,
      siteCode: context.siteCode ?? null,
      spacePath: context.spacePath ?? null
    },
    reportedState: asObject(connection.reportedState),
    desiredState: asObject(connection.desiredState ?? connection.reportedState),
    connections: [normalizedConnection],
    capabilities: controls,
    metadata: { ...asObject(candidate.metadata), ...genericInformation },
    localOnly: true
  };
}

function deviceReferences(device = {}) {
  return new Set([device.id, device.deviceId, device.publicId]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value)));
}

export function mergePlatformAndLocalDevices(platformDevices = [], previousDevices = []) {
  const platform = Array.isArray(platformDevices) ? platformDevices : [];
  const knownReferences = new Set(platform.flatMap((device) => [...deviceReferences(device)]));
  const localSessions = (Array.isArray(previousDevices) ? previousDevices : [])
    .filter((device) => device?.localOnly === true)
    .filter((device) => [...deviceReferences(device)].every((reference) => !knownReferences.has(reference)));
  return [...platform, ...localSessions];
}
