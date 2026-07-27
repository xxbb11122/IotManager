import { ConnectionAdapter } from './connection-adapter.js';
import {
  BleProfileRegistry,
  GENERIC_BLE_SERVICES,
  defaultBleProfileRegistry
} from './ble-profile-registry.js';

function defaultBluetooth() {
  return globalThis.navigator?.bluetooth ?? null;
}

function browserSecureContext() {
  return typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : true;
}

function textFromDataView(value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof TextDecoder === 'function') {
    return new TextDecoder().decode(bytes).replace(/\0+$/, '');
  }
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('').replace(/\0+$/, '');
}

function reportedStateFromCommand(command) {
  switch (command?.type) {
    case 'set_power':
      return { power: command.parameters?.on === true };
    case 'set_level':
      return { level: command.parameters?.level };
    case 'set_mode':
      return { mode: command.parameters?.mode };
    default:
      return {};
  }
}

export class BleUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BleUnavailableError';
  }
}

/**
 * Real browser Web Bluetooth adapter. A caller must invoke requestCandidate
 * from a direct operator gesture because browsers reject deferred picker calls.
 */
export class BleAdapter extends ConnectionAdapter {
  constructor({
    bluetooth = defaultBluetooth(),
    registry = defaultBleProfileRegistry,
    secureContext = browserSecureContext()
  } = {}) {
    super();
    if (!(registry instanceof BleProfileRegistry) && typeof registry?.encodeCommand !== 'function') {
      throw new TypeError('BLE adapter requires a profile registry');
    }
    this.bluetooth = bluetooth;
    this.registry = registry;
    this.secureContext = secureContext;
    this.listeners = new Set();
    this.device = null;
    this.candidate = null;
    this.server = null;
    this.profile = null;
    this.activeConnection = null;
    this.disconnectListener = () => this.handleDisconnect();
  }

  availability() {
    if (!this.bluetooth || typeof this.bluetooth.requestDevice !== 'function') {
      return {
        available: false,
        transport: 'BLE_DIRECT',
        reason: 'Web Bluetooth is unavailable. Use a supported Chromium browser.'
      };
    }
    if (!this.secureContext) {
      return {
        available: false,
        transport: 'BLE_DIRECT',
        reason: 'Web Bluetooth requires HTTPS outside localhost.'
      };
    }
    return { available: true, transport: 'BLE_DIRECT', reason: null };
  }

  async requestCandidate(options = {}) {
    const availability = this.availability();
    if (!availability.available) {
      throw new BleUnavailableError(availability.reason);
    }

    const optionalServices = [...new Set([
      ...GENERIC_BLE_SERVICES,
      ...this.registry.optionalServiceUuids(),
      ...(options.optionalServices ?? [])
    ])];
    const requestOptions = Array.isArray(options.filters) && options.filters.length > 0
      ? { filters: options.filters, optionalServices }
      : { acceptAllDevices: true, optionalServices };

    // This is intentionally the immediate browser call, not a timer or effect.
    const device = await this.bluetooth.requestDevice(requestOptions);
    this.setDevice(device);
    return this.candidate;
  }

  async connect(candidate = this.candidate) {
    const device = candidate?.device ?? this.device;
    if (!device?.gatt || typeof device.gatt.connect !== 'function') {
      throw new BleUnavailableError('The selected BLE device does not expose GATT');
    }

    this.setDevice(device);
    this.server = await device.gatt.connect();
    const serviceUuids = await this.discoverServiceUuids();
    this.profile = this.registry.matchDiscoveredServices(serviceUuids);
    const genericInformation = await this.readGenericInformation();
    const capabilities = this.getCapabilities();
    this.activeConnection = {
      id: device.id,
      externalId: device.id,
      name: device.name ?? 'Unnamed BLE device',
      transport: 'BLE_DIRECT',
      profileId: this.profile?.id ?? null,
      status: 'CONNECTED',
      capabilities,
      genericInformation,
      identityScope: 'browser_local'
    };
    this.emit('connection_update', this.activeConnection);
    return this.activeConnection;
  }

  getCapabilities() {
    return this.registry.getCapabilities(this.profile?.id ?? null);
  }

  async sendCommand(command) {
    if (!this.server) {
      throw new Error('BLE device is not connected');
    }
    // encodeCommand rejects unknown profiles and unsupported commands.
    const operation = this.registry.encodeCommand(this.profile?.id ?? null, command);
    const service = await this.server.getPrimaryService(operation.serviceUuid);
    const characteristic = await service.getCharacteristic(operation.characteristicUuid);

    if (operation.withResponse && typeof characteristic.writeValueWithResponse === 'function') {
      await characteristic.writeValueWithResponse(operation.value);
    } else if (!operation.withResponse && typeof characteristic.writeValueWithoutResponse === 'function') {
      await characteristic.writeValueWithoutResponse(operation.value);
    } else if (typeof characteristic.writeValue === 'function') {
      await characteristic.writeValue(operation.value);
    } else {
      throw new Error('BLE characteristic does not support writes');
    }

    const result = {
      commandId: command?.commandId ?? null,
      deviceId: this.activeConnection?.id ?? null,
      type: command?.type,
      status: 'ACKNOWLEDGED',
      reportedState: reportedStateFromCommand(command)
    };
    this.emit('command_update', result);
    return result;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('BLE adapter listener must be a function');
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
      return;
    }
    this.handleDisconnect();
  }

  setDevice(device) {
    if (this.device !== device) {
      this.device?.removeEventListener?.('gattserverdisconnected', this.disconnectListener);
      this.device = device;
      this.device?.addEventListener?.('gattserverdisconnected', this.disconnectListener);
    }
    this.candidate = {
      id: device.id,
      name: device.name ?? 'Unnamed BLE device',
      transport: 'BLE_DIRECT',
      identityScope: 'browser_local',
      device
    };
  }

  async discoverServiceUuids() {
    if (typeof this.server?.getPrimaryServices !== 'function') {
      return [];
    }
    try {
      const services = await this.server.getPrimaryServices();
      return services
        .map((service) => typeof service === 'string' ? service : service?.uuid)
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async readGenericInformation() {
    const information = {};
    const manufacturer = await this.readTextCharacteristic('device_information', 'manufacturer_name_string');
    const model = await this.readTextCharacteristic('device_information', 'model_number_string');
    const serial = await this.readTextCharacteristic('device_information', 'serial_number_string');
    const battery = await this.readBatteryLevel();
    if (manufacturer) information.manufacturer = manufacturer;
    if (model) information.model = model;
    if (serial) information.serialNumber = serial;
    if (battery !== null) information.batteryLevel = battery;
    return information;
  }

  async readTextCharacteristic(serviceUuid, characteristicUuid) {
    try {
      const service = await this.server.getPrimaryService(serviceUuid);
      const characteristic = await service.getCharacteristic(characteristicUuid);
      return textFromDataView(await characteristic.readValue());
    } catch {
      return null;
    }
  }

  async readBatteryLevel() {
    try {
      const service = await this.server.getPrimaryService('battery_service');
      const characteristic = await service.getCharacteristic('battery_level');
      const value = await characteristic.readValue();
      return value.getUint8(0);
    } catch {
      return null;
    }
  }

  handleDisconnect() {
    if (this.activeConnection?.status === 'DISCONNECTED') {
      return;
    }
    this.server = null;
    this.profile = null;
    const connection = {
      ...(this.activeConnection ?? {
        id: this.device?.id ?? null,
        externalId: this.device?.id ?? null,
        name: this.device?.name ?? 'Unnamed BLE device',
        transport: 'BLE_DIRECT',
        profileId: null,
        identityScope: 'browser_local'
      }),
      status: 'DISCONNECTED'
    };
    this.activeConnection = connection;
    this.emit('connection_update', connection);
  }

  emit(type, payload) {
    const event = { type, payload, timestamp: Date.now(), version: 1 };
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
