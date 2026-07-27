import { ApiClient, createIdempotencyKey } from '../api.js';
import { ConnectionAdapter } from './connection-adapter.js';

const LAN_MOCK_CAPABILITIES = Object.freeze({
  profileId: 'lan-agent-v1',
  known: true,
  controls: Object.freeze([
    Object.freeze({ id: 'power', commandType: 'set_power', writable: true }),
    Object.freeze({ id: 'level', commandType: 'set_level', writable: true }),
    Object.freeze({ id: 'mode', commandType: 'set_mode', writable: true })
  ]),
  readOnly: Object.freeze(['generic_information', 'telemetry'])
});

function copyCapabilities() {
  return {
    ...LAN_MOCK_CAPABILITIES,
    controls: LAN_MOCK_CAPABILITIES.controls.map((control) => ({ ...control })),
    readOnly: [...LAN_MOCK_CAPABILITIES.readOnly]
  };
}

function candidateId(candidate) {
  if (typeof candidate === 'string') {
    return candidate;
  }
  return candidate?.candidateId ?? null;
}

/**
 * REST/WS implementation for the backend's deterministic LAN simulator. It is
 * not browser subnet discovery; a future Edge Agent can replace this adapter.
 */
export class LanMockAdapter extends ConnectionAdapter {
  constructor({
    api = new ApiClient(),
    realtime = null,
    idempotencyKeyFactory = () => createIdempotencyKey('lan')
  } = {}) {
    super();
    this.api = api;
    this.realtime = realtime;
    this.idempotencyKeyFactory = idempotencyKeyFactory;
    this.listeners = new Set();
    this.realtimeUnsubscribe = null;
    this.activeConnection = null;
  }

  availability() {
    return {
      available: true,
      transport: 'LAN_AGENT',
      simulated: true,
      reason: null
    };
  }

  async requestCandidate(context = {}) {
    const siteCode = typeof context === 'string' ? context : context.siteCode;
    if (!siteCode) {
      throw new TypeError('LAN discovery requires siteCode');
    }
    return this.api.listLanCandidates(siteCode);
  }

  async connect(candidate, claim) {
    const id = candidateId(candidate);
    if (!id) {
      throw new TypeError('LAN claim requires a discovery candidate');
    }
    if (!claim?.siteCode || !claim?.spacePath || !claim?.displayName) {
      throw new TypeError('LAN claim requires siteCode, spacePath, and displayName');
    }

    const device = await this.api.claimLanCandidate(id, claim);
    this.activeConnection = {
      deviceId: device.id,
      devicePublicId: device.publicId ?? null,
      transport: candidate?.transport ?? 'LAN_AGENT',
      profileId: candidate?.profileId ?? 'lan-agent-v1',
      status: 'CONNECTED'
    };
    this.ensureRealtimeSubscription();
    return device;
  }

  getCapabilities() {
    return copyCapabilities();
  }

  async sendCommand(command = {}) {
    const deviceId = command.deviceId ?? this.activeConnection?.deviceId;
    if (deviceId === null || deviceId === undefined) {
      throw new TypeError('LAN command requires a deviceId');
    }
    if (!command.type) {
      throw new TypeError('LAN command requires a type');
    }
    return this.api.submitCommand(deviceId, {
      type: command.type,
      parameters: command.parameters ?? {},
      idempotencyKey: command.idempotencyKey ?? this.idempotencyKeyFactory()
    });
  }

  listActivity(deviceId = this.activeConnection?.deviceId) {
    if (deviceId === null || deviceId === undefined) {
      throw new TypeError('Activity lookup requires a deviceId');
    }
    return this.api.listActivity(deviceId);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('LAN adapter listener must be a function');
    }
    this.listeners.add(listener);
    this.ensureRealtimeSubscription();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.detachRealtimeSubscription();
      }
    };
  }

  disconnect() {
    this.activeConnection = null;
    this.detachRealtimeSubscription();
  }

  ensureRealtimeSubscription() {
    if (!this.realtime || this.realtimeUnsubscribe || this.listeners.size === 0) {
      return;
    }
    this.realtimeUnsubscribe = this.realtime.subscribe((event) => {
      for (const listener of this.listeners) {
        listener(event);
      }
    });
  }

  detachRealtimeSubscription() {
    this.realtimeUnsubscribe?.();
    this.realtimeUnsubscribe = null;
  }
}
