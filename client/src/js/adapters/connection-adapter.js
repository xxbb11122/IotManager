export const CONNECTION_ADAPTER_METHODS = Object.freeze([
  'availability',
  'requestCandidate',
  'connect',
  'getCapabilities',
  'sendCommand',
  'subscribe',
  'disconnect'
]);

export class ConnectionAdapter {
  availability() {
    return { available: false, reason: 'Adapter is not configured' };
  }

  async requestCandidate() {
    throw new Error('ConnectionAdapter.requestCandidate must be implemented');
  }

  async connect() {
    throw new Error('ConnectionAdapter.connect must be implemented');
  }

  getCapabilities() {
    return { known: false, controls: [], readOnly: [] };
  }

  async sendCommand() {
    throw new Error('ConnectionAdapter.sendCommand must be implemented');
  }

  subscribe() {
    return () => {};
  }

  disconnect() {}
}

export function assertConnectionAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Connection adapter must be an object');
  }
  const missing = CONNECTION_ADAPTER_METHODS.filter((method) => typeof adapter[method] !== 'function');
  if (missing.length > 0) {
    throw new TypeError(`Connection adapter is missing: ${missing.join(', ')}`);
  }
  return adapter;
}
