export const GENERIC_BLE_SERVICES = Object.freeze([
  'generic_access',
  'device_information',
  'battery_service'
]);

const NORDIC_NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_NUS_WRITE_CHARACTERISTIC = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_NUS_NOTIFY_CHARACTERISTIC = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const FRAME_VERSION = 1;
const COMMAND_MAGIC = 0xa5;
const RESPONSE_MAGIC = 0x5a;
const SET_POWER_OPCODE = 0x01;

export class BleCommandRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BleCommandRejectedError';
    this.code = 'BLE_DEVICE_REJECTED';
  }
}

export function crc8(bytes) {
  let crc = 0;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function commandToken() {
  const values = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  else values.forEach((_, index) => { values[index] = Math.floor(Math.random() * 256); });
  return values;
}

function toBytes(value) {
  if (value instanceof DataView) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('BLE confirmation must contain binary data');
}

function referencePowerOperation(parameters) {
  const token = commandToken();
  const command = new Uint8Array([COMMAND_MAGIC, FRAME_VERSION, SET_POWER_OPCODE, 0, ...token, parameters?.on === true ? 1 : 0, 0]);
  command[9] = crc8(command.subarray(0, 9));
  return {
    serviceUuid: NORDIC_NUS_SERVICE,
    characteristicUuid: NORDIC_NUS_WRITE_CHARACTERISTIC,
    value: command,
    withResponse: true,
    confirmation: {
      type: 'notification',
      serviceUuid: NORDIC_NUS_SERVICE,
      characteristicUuid: NORDIC_NUS_NOTIFY_CHARACTERISTIC,
      decode(value) {
        const frame = toBytes(value);
        if (frame.length !== 10 || frame[0] !== RESPONSE_MAGIC || frame[1] !== FRAME_VERSION || frame[2] !== SET_POWER_OPCODE) return null;
        if (crc8(frame.subarray(0, 9)) !== frame[9]) return null;
        for (let index = 0; index < token.length; index += 1) {
          if (frame[index + 4] !== token[index]) return null;
        }
        if (frame[3] !== 0) throw new BleCommandRejectedError(`Reference switch rejected command with code ${frame[3]}`);
        return { power: frame[8] === 1 };
      }
    }
  };
}

const DEFAULT_PROFILES = Object.freeze([
  Object.freeze({
    id: 'nordic-nrf52840-switch-v1',
    version: 1,
    serviceUuids: Object.freeze([NORDIC_NUS_SERVICE]),
    controls: Object.freeze([
      Object.freeze({
        id: 'power',
        kind: 'toggle',
        label: 'Power',
        commandType: 'set_power',
        parameter: 'on',
        writable: true
      })
    ]),
    commands: Object.freeze({
      set_power: referencePowerOperation
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
    version: profile.version ?? null,
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
