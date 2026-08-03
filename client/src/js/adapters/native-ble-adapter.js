import { BleClient } from '@capacitor-community/bluetooth-le';
import { defaultBleProfileRegistry } from './ble-profile-registry.js';

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
    this.connection = null;
    this.profile = null;
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
    await this.requestPermissions();
    await this.bleClient.requestLEScan({}, (result) => {
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
    this.scanning = true;
  }

  async stopScan() {
    if (!this.scanning) return undefined;
    try {
      return await this.bleClient.stopLEScan();
    } finally {
      this.scanning = false;
    }
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
    await this.bleClient.connect(deviceId, () => this.handleDisconnect(deviceId));
    const services = await this.bleClient.getServices(deviceId);
    this.profile = this.registry.matchDiscoveredServices(services.map((service) => service.uuid));
    this.connection = {
      deviceId,
      name: candidate.name ?? 'Unnamed BLE device',
      transport: 'BLE_DIRECT',
      status: 'CONNECTED',
      profileId: this.profile?.id ?? null,
      reportedState: {}
    };
    this.emit('connection_update', this.connection);
    return this.connection;
  }

  getCapabilities() { return this.registry.getCapabilities(this.profile?.id ?? null); }
  openAppSettings() { return this.bleClient.openAppSettings(); }
  openBluetoothSettings() { return this.bleClient.openBluetoothSettings(); }

  async verifyConnection() {
    if (this.connection?.status !== 'CONNECTED') return false;
    if (typeof this.bleClient.getConnectedDevices !== 'function') return true;
    const connected = await this.bleClient.getConnectedDevices([]);
    const present = connected.some((device) => device.deviceId === this.connection.deviceId);
    if (!present) this.handleDisconnect(this.connection.deviceId);
    return present;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async disconnect() {
    if (this.connection?.deviceId) await this.bleClient.disconnect(this.connection.deviceId);
    this.handleDisconnect(this.connection?.deviceId);
  }

  handleDisconnect(deviceId) {
    if (!this.connection || this.connection.status === 'DISCONNECTED') return;
    this.connection = { ...this.connection, deviceId, status: 'DISCONNECTED' };
    this.emit('connection_update', this.connection);
  }

  emit(type, payload) {
    const event = { type, payload, timestamp: Date.now(), version: 1 };
    for (const listener of this.listeners) listener(event);
  }

  async sendCommand(command) {
    if (this.connection?.status !== 'CONNECTED') throw new Error('BLE device is not connected');
    const operation = this.registry.encodeCommand(this.profile?.id ?? null, command);
    const bytes = new Uint8Array(operation.value);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const notification = operation.confirmation.type === 'notification'
      ? await this.startNotificationConfirmation(command, operation.confirmation)
      : null;
    try {
      await this.bleClient.write(this.connection.deviceId, operation.serviceUuid, operation.characteristicUuid, view);
    } catch (error) {
      await notification?.cancel();
      throw error;
    }

    if (operation.confirmation.type === 'none') {
      return { ...command, deviceId: this.connection.deviceId, status: 'UNCONFIRMED', reportedState: this.connection.reportedState ?? {} };
    }
    if (operation.confirmation.type === 'read') {
      const value = await this.bleClient.read(
        this.connection.deviceId,
        operation.confirmation.serviceUuid,
        operation.confirmation.characteristicUuid
      );
      const reportedState = operation.confirmation.decode(value);
      this.connection = { ...this.connection, reportedState };
      return { ...command, deviceId: this.connection.deviceId, status: 'ACKNOWLEDGED', reportedState };
    }
    return notification.result;
  }

  async startNotificationConfirmation(command, confirmation) {
    const deviceId = this.connection.deviceId;
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
      if (!subscribed) return;
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
        const reportedState = confirmation.decode(value);
        if (reportedState == null) return;
        this.connection = { ...this.connection, reportedState };
        void finish({ ...command, deviceId, status: 'ACKNOWLEDGED', reportedState });
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
        reportedState: this.connection?.reportedState ?? {},
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
