import { BleAdapter } from './adapters/ble-adapter.js';

function textLogLine(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return `[${time}] ${message}`;
}

/**
 * Temporary bridge for the previous client entry point. New code should import
 * BleAdapter directly; this facade only preserves the old scan/connect events.
 */
export function createBleFacade(adapter = new BleAdapter()) {
  const listeners = new Map();
  const logs = [];

  function on(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('BLE listener must be a function');
    }
    const bucket = listeners.get(event) ?? new Set();
    bucket.add(listener);
    listeners.set(event, bucket);
    return () => bucket.delete(listener);
  }

  function emit(event, payload) {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  function addLog(message) {
    logs.unshift(textLogLine(message));
    logs.splice(50);
    emit('log', [...logs]);
  }

  const unsubscribeAdapter = adapter.subscribe((event) => {
    if (event.type === 'connection_update') {
      if (event.payload?.status === 'DISCONNECTED') {
        addLog('BLE device disconnected');
        emit('disconnected', event.payload);
      }
    }
  });

  async function scan(options) {
    addLog('Opening BLE device picker');
    try {
      const candidate = await adapter.requestCandidate(options);
      addLog(`Selected BLE device: ${candidate.name ?? candidate.id}`);
      emit('selected', candidate);
      return candidate;
    } catch (error) {
      addLog(`BLE picker failed: ${error.message}`);
      throw error;
    }
  }

  async function connect(candidate) {
    addLog('Connecting to BLE GATT server');
    try {
      const connection = await adapter.connect(candidate);
      addLog('BLE GATT connected');
      emit('connected', connection);
      return connection;
    } catch (error) {
      addLog(`BLE connection failed: ${error.message}`);
      throw error;
    }
  }

  function disconnect() {
    return adapter.disconnect();
  }

  async function read(serviceUuid, characteristicUuid) {
    if (!adapter.server) {
      throw new Error('BLE device is not connected');
    }
    const service = await adapter.server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
    return characteristic.readValue();
  }

  async function write(serviceUuid, characteristicUuid, bytes, withResponse = true) {
    if (!adapter.server) {
      throw new Error('BLE device is not connected');
    }
    const service = await adapter.server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
    const value = new Uint8Array(bytes);
    if (withResponse && typeof characteristic.writeValueWithResponse === 'function') {
      return characteristic.writeValueWithResponse(value);
    }
    if (!withResponse && typeof characteristic.writeValueWithoutResponse === 'function') {
      return characteristic.writeValueWithoutResponse(value);
    }
    if (typeof characteristic.writeValue === 'function') {
      return characteristic.writeValue(value);
    }
    throw new Error('BLE characteristic does not support writes');
  }

  return Object.freeze({
    on,
    scan,
    requestCandidate: scan,
    connect,
    disconnect,
    read,
    write,
    destroy: unsubscribeAdapter,
    adapter
  });
}

export const ble = createBleFacade();
