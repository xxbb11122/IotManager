export const GENERIC_BLE_SERVICES = Object.freeze([
  'generic_access',
  'device_information',
  'battery_service'
]);

const DEMO_SWITCH_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const DEMO_SWITCH_WRITE_CHARACTERISTIC = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

const DEFAULT_PROFILES = Object.freeze([
  Object.freeze({
    id: 'iot-demo-switch-v1',
    serviceUuids: Object.freeze([DEMO_SWITCH_SERVICE]),
    controls: Object.freeze([
      Object.freeze({ id: 'power', commandType: 'set_power', writable: true })
    ]),
    commands: Object.freeze({
      set_power: (parameters) => ({
        serviceUuid: DEMO_SWITCH_SERVICE,
        characteristicUuid: DEMO_SWITCH_WRITE_CHARACTERISTIC,
        value: new Uint8Array([parameters?.on === true ? 1 : 0]),
        withResponse: true,
        confirmation: { type: 'none' }
      })
    })
  })
]);

function normalizeUuid(value) {
  return String(value).trim().toLowerCase();
}

function copyControl(control) {
  return { ...control };
}

function profileCapabilityView(profile) {
  if (!profile) {
    return {
      profileId: null,
      known: false,
      controls: [],
      readOnly: ['generic_information', 'battery_level']
    };
  }

  return {
    profileId: profile.id,
    known: true,
    controls: profile.controls.map(copyControl),
    readOnly: ['generic_information', 'battery_level']
  };
}

export class UnsupportedBleProfileError extends Error {
  constructor(profileId) {
    super(`BLE profile '${profileId ?? 'unknown'}' does not support device control`);
    this.name = 'UnsupportedBleProfileError';
  }
}

/**
 * Holds explicitly supplied BLE protocol knowledge. The registry deliberately
 * has no generic write fallback because arbitrary GATT characteristics are not
 * safe to control without a vendor protocol.
 */
export class BleProfileRegistry {
  constructor(profiles = DEFAULT_PROFILES) {
    this.profilesById = new Map();
    this.profiles = [];

    for (const profile of profiles) {
      if (!profile?.id || !Array.isArray(profile.serviceUuids) || !profile.commands) {
        throw new TypeError('BLE profile requires id, serviceUuids, and commands');
      }
      const normalized = {
        ...profile,
        serviceUuids: profile.serviceUuids.map(normalizeUuid),
        controls: Array.isArray(profile.controls) ? profile.controls.map(copyControl) : []
      };
      this.profiles.push(normalized);
      this.profilesById.set(normalized.id, normalized);
    }
  }

  get(profileId) {
    return this.profilesById.get(profileId) ?? null;
  }

  getCapabilities(profileId) {
    return profileCapabilityView(this.get(profileId));
  }

  matchDiscoveredServices(serviceUuids = []) {
    const discovered = new Set(serviceUuids.map(normalizeUuid));
    return this.profiles.find((profile) => profile.serviceUuids.some((uuid) => discovered.has(uuid))) ?? null;
  }

  optionalServiceUuids() {
    return [...new Set(this.profiles.flatMap((profile) => profile.serviceUuids))];
  }

  encodeCommand(profileId, command) {
    const profile = this.get(profileId);
    const encoder = profile?.commands?.[command?.type];
    if (!encoder) {
      throw new UnsupportedBleProfileError(profileId);
    }

    const operation = encoder(command.parameters ?? {});
    if (!operation?.serviceUuid || !operation?.characteristicUuid || !operation?.value) {
      throw new TypeError(`BLE profile '${profileId}' returned an invalid command operation`);
    }

    const confirmation = operation.confirmation ?? { type: 'none' };
    if (!['none', 'read', 'notification'].includes(confirmation.type)) {
      throw new TypeError(`BLE profile '${profileId}' returned an invalid confirmation type`);
    }
    if (confirmation.type !== 'none' && (!confirmation.serviceUuid || !confirmation.characteristicUuid || typeof confirmation.decode !== 'function')) {
      throw new TypeError(`BLE profile '${profileId}' requires confirmation UUIDs and decoder`);
    }

    return {
      serviceUuid: operation.serviceUuid,
      characteristicUuid: operation.characteristicUuid,
      value: new Uint8Array(operation.value),
      withResponse: operation.withResponse !== false,
      confirmation: { ...confirmation }
    };
  }
}

export const defaultBleProfileRegistry = new BleProfileRegistry();
