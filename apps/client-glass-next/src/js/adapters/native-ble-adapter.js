import { BleClient, numberToUUID } from '@capacitor-community/bluetooth-le';
import { defaultBleProfileRegistry } from './ble-profile-registry.js';

const BATTERY_SERVICE = numberToUUID(0x180f);
const BATTERY_LEVEL = numberToUUID(0x2a19);

export class NativeBlePermissionError extends Error {
  constructor(cause) {
    super(`BLE permission denied: ${cause?.message ?? cause}`);
    this.name = 'NativeBlePermissionError';
    this.code = 'BLE_PERMISSION_DENIED';
  }
}

export class BluetoothDisabledError extends Error {
  constructor() {
    super('Bluetooth is disabled');
    this.name = 'BluetoothDisabledError';
    this.code = 'BLE_DISABLED';
  }
}

export class NativeBleAdapter {
  constructor({ bleClient = BleClient, registry = defaultBleProfileRegistry, confirmationTimeoutMs = 5000 } = {}) {
    this.bleClient = bleClient;
    this.registry = registry;
    this.listeners = new Set();
    this.candidates = new Map();
    this.scanning = false;
    this.scanRevision = 0;
    this.connection = null;
    this.profile = null;
    this.connectionSequence = 0;
    this.connecting = false;
    this.unreleasedDeviceId = null;
    this.confirmationTimeoutMs = confirmationTimeoutMs;
  }

  availability() {
    return { available: true, transport: 'BLE_DIRECT' };
  }

  async requestPermissions() {
    try {
      await this.bleClient.initialize({ androidNeverForLocation: true });
    } catch (error) {
      throw new NativeBlePermissionError(error);
    }
    const enabled = await this.bleClient.isEnabled();
    if (!enabled) throw new BluetoothDisabledError();
    return true;
  }

  async scan(listener) {
    if (typeof listener !== 'function') throw new TypeError('BLE scan requires a listener');
    const revision = ++this.scanRevision;
    await this.requestPermissions();
    if (revision !== this.scanRevision) return;
    this.scanning = true;
    try {
      await this.bleClient.requestLEScan({}, (result) => {
        if (revision !== this.scanRevision || !this.scanning) return;
        const deviceId = result?.device?.deviceId;
        if (!deviceId) return;
        const existing = this.candidates.get(deviceId);
        const candidate = {
          ...(existing ?? {}),
          ...result.device,
          rssi: result.rssi ?? existing?.rssi ?? null,
          transport: 'BLE_DIRECT',
          identityScope: 'app_local',
          firstSeenAt: existing?.firstSeenAt ?? Date.now(),
          lastSeenAt: Date.now()
        };
        this.candidates.set(deviceId, candidate);
        listener(candidate, this.getCandidates());
      });
    } catch (error) {
      if (revision === this.scanRevision) this.scanning = false;
      throw error;
    }
  }

  async stopScan() {
    const revision = ++this.scanRevision;
    if (!this.scanning) return undefined;
    const result = await this.bleClient.stopLEScan();
    // A rejected stop is not a confirmed stop: retain a retryable state.
    if (revision === this.scanRevision) this.scanning = false;
    return result;
  }

  clearCandidates() {
    this.candidates.clear();
  }

  getCandidates() {
    return [...this.candidates.values()];
  }

  async connect(candidate) {
    const deviceId = candidate?.deviceId;
    if (!deviceId) throw new TypeError('BLE connection requires deviceId');
    if (this.connecting) throw new Error('BLE connection is already being changed');
    this.connecting = true;
    try {
      // Do not replace a live GATT handle with a JS reference to another device.
      if (this.unreleasedDeviceId) {
        await this.bleClient.disconnect(this.unreleasedDeviceId);
        this.unreleasedDeviceId = null;
      }
      if (this.connection?.status === 'CONNECTED') await this.disconnect();
      const session = ++this.connectionSequence;
      let closed = false;
      let readableBattery = false;
      try {
        await this.bleClient.connect(deviceId, () => {
          closed = true;
          this.handleDisconnect(deviceId, session);
        });
        const services = await this.bleClient.getServices(deviceId);
        if (closed) throw new Error('BLE device disconnected during service discovery');
        this.profile = this.registry.matchDiscoveredServices(services.map((service) => service.uuid));
        readableBattery = services.some((service) => service.uuid?.toLowerCase() === BATTERY_SERVICE
          && service.characteristics?.some((entry) => entry.uuid?.toLowerCase() === BATTERY_LEVEL && entry.properties?.read === true));
      } catch (error) {
        if (!closed) {
          try { await this.bleClient.disconnect(deviceId); }
          catch { this.unreleasedDeviceId = deviceId; }
        }
        throw error;
      }
      this.connection = {
        deviceId,
        session,
        name: candidate.name ?? 'Unnamed BLE device',
        transport: 'BLE_DIRECT',
        status: 'CONNECTED',
        changedAt: Date.now(),
        profileId: this.profile?.id ?? null,
        readableBattery,
        reportedState: {}
      };
      this.emit('connection_update', this.connection);
      return this.connection;
    } finally {
      this.connecting = false;
    }
  }

  getCapabilities() { return this.registry.getCapabilities(this.profile?.id ?? null); }
  openAppSettings() { return this.bleClient.openAppSettings(); }
  openBluetoothSettings() { return this.bleClient.openBluetoothSettings(); }

  async verifyConnection() {
    const owned = this.connection;
    if (owned?.status !== 'CONNECTED') return false;
    if (typeof this.bleClient.getConnectedDevices !== 'function') return null;
    const connected = await this.bleClient.getConnectedDevices([]);
    if (this.connection?.session !== owned.session || this.connection.status !== 'CONNECTED') return null;
    const present = connected.some((device) => device.deviceId === owned.deviceId);
    if (!present) this.handleDisconnect(owned.deviceId, owned.session);
    return present;
  }

  assessmentConnection() { return this.connection; }

  async readAssessmentField(field) {
    const owned = this.connection;
    // Never allow a model, a URI, or an untrusted Profile to choose a GATT characteristic.
    if (field !== 'battery' || owned?.status !== 'CONNECTED' || !owned.readableBattery) return null;
    const reading = await this.bleClient.read(owned.deviceId, BATTERY_SERVICE, BATTERY_LEVEL);
    if (this.connection?.session !== owned.session || this.connection.status !== 'CONNECTED'
      || reading?.byteLength !== 1) return null;
    const battery = reading.getUint8(0);
    if (battery > 100) return null;
    const sample = { value: battery, observedAt: Date.now() };
    this.connection = { ...this.connection, assessmentBattery: sample };
    return sample;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async disconnect() {
    const owned = this.connection;
    if (owned?.deviceId) await this.bleClient.disconnect(owned.deviceId);
    if (owned) this.handleDisconnect(owned.deviceId, owned.session);
  }

  handleDisconnect(deviceId, session = this.connection?.session) {
    if (!this.connection || this.connection.status === 'DISCONNECTED') return;
    if (this.connection.session !== session || (deviceId && deviceId !== this.connection.deviceId)) return;
    this.connection = { ...this.connection, status: 'DISCONNECTED', changedAt: Date.now() };
    this.emit('connection_update', this.connection);
  }

  emit(type, payload) {
    const event = { type, payload, timestamp: Date.now(), version: 1 };
    for (const listener of this.listeners) listener(event);
  }

  async sendCommand(command) {
    if (this.connection?.status !== 'CONNECTED') throw new Error('BLE device is not connected');
    const owned = this.connection;
    const operation = this.registry.encodeCommand(this.profile?.id ?? null, command);
    const bytes = new Uint8Array(operation.value);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const notification = operation.confirmation.type === 'notification'
      ? await this.startNotificationConfirmation(command, operation.confirmation)
      : null;
    try {
      if (this.connection?.session !== owned.session || this.connection.status !== 'CONNECTED')
        throw new Error('The BLE connection changed before command delivery');
      await this.bleClient.write(owned.deviceId, operation.serviceUuid, operation.characteristicUuid, view);
    } catch (error) {
      await notification?.cancel();
      throw error;
    }

    if (operation.confirmation.type === 'none') {
      return { ...command, deviceId: owned.deviceId, status: 'UNCONFIRMED', reportedState: owned.reportedState ?? {} };
    }
    if (operation.confirmation.type === 'read') {
      const value = await this.bleClient.read(
        owned.deviceId,
        operation.confirmation.serviceUuid,
        operation.confirmation.characteristicUuid
      );
      const reportedState = operation.confirmation.decode(value);
      if (this.connection?.session !== owned.session || this.connection.status !== 'CONNECTED')
        return { ...command, deviceId: owned.deviceId, status: 'UNCONFIRMED' };
      const reportedAt = Date.now();
      this.connection = { ...this.connection, reportedState, reportedAt, reportedCommandId: command.commandId };
      return { ...command, deviceId: owned.deviceId, status: 'ACKNOWLEDGED', reportedState, reportedAt };
    }
    return notification.result;
  }

  async startNotificationConfirmation(command, confirmation) {
    const deviceId = this.connection.deviceId;
    const session = this.connection.session;
    let settled = false;
    let timer = null;
    let subscribed = false;
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    // A cancelled write deliberately rejects this private promise; suppress it
    // until sendCommand propagates the original write error to the caller.
    result.catch(() => {});

    const cleanup = async () => {
      if (!subscribed || (this.connection?.deviceId === deviceId && this.connection.session !== session)) return;
      try {
        await this.bleClient.stopNotifications(deviceId, confirmation.serviceUuid, confirmation.characteristicUuid);
      } catch {
        // Notification cleanup must not rewrite the command outcome.
      }
    };
    const finish = async (next, error = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      await cleanup();
      if (error) rejectResult(error);
      else resolveResult(next);
    };
    const onNotification = (value) => {
      try {
        if (settled || this.connection?.session !== session || this.connection.status !== 'CONNECTED') return;
        const reportedState = confirmation.decode(value);
        if (reportedState == null) return;
        const reportedAt = Date.now();
        this.connection = { ...this.connection, reportedState, reportedAt, reportedCommandId: command.commandId };
        void finish({ ...command, deviceId, status: 'ACKNOWLEDGED', reportedState, reportedAt });
      } catch (error) {
        void finish(null, error);
      }
    };

    try {
      await this.bleClient.startNotifications(
        deviceId,
        confirmation.serviceUuid,
        confirmation.characteristicUuid,
        onNotification
      );
      subscribed = true;
    } catch (error) {
      await finish(null, error);
      throw error;
    }

    if (settled) {
      await cleanup();
      return { result, cancel: async () => {} };
    }

    timer = setTimeout(() => {
      void finish({
        ...command,
        deviceId,
        status: 'UNCONFIRMED',
        reportedState: this.connection?.session === session ? this.connection.reportedState ?? {} : {},
        confirmationTimedOut: true
      });
    }, this.confirmationTimeoutMs);

    return {
      result,
      cancel: async () => {
        await finish(null, new Error('BLE command was not written'));
      }
    };
  }
}
