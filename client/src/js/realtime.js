import { resolveClientConfig } from './api.js';

export const SUPPORTED_REALTIME_VERSION = 1;

function parseEvent(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

export function normalizeRealtimeEvent(value) {
  const event = parseEvent(value);
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }
  if (typeof event.type !== 'string' || event.version !== SUPPORTED_REALTIME_VERSION) {
    return null;
  }
  if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) {
    return null;
  }
  return {
    type: event.type,
    payload: event.payload,
    timestamp: event.timestamp,
    version: event.version
  };
}

function defaultWebSocketFactory(url) {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('WebSocket is unavailable in this environment');
  }
  return new globalThis.WebSocket(url);
}

function connectionHealth(patch = {}) {
  return Object.freeze({
    state: 'idle',
    stale: true,
    reconnectAttempt: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    error: null,
    ...patch
  });
}

/**
 * Versioned /ws/devices subscriber. Reconnection does not resync inventory by
 * itself; the caller can use the health transition to refetch REST snapshots.
 */
export class RealtimeClient {
  constructor({
    url = resolveClientConfig().wsUrl,
    webSocketFactory = defaultWebSocketFactory,
    scheduler = globalThis,
    reconnectBaseDelayMs = 500,
    reconnectMaxDelayMs = 10_000,
    jitter = Math.random
  } = {}) {
    this.url = url;
    this.webSocketFactory = webSocketFactory;
    this.scheduler = scheduler;
    this.reconnectBaseDelayMs = reconnectBaseDelayMs;
    this.reconnectMaxDelayMs = reconnectMaxDelayMs;
    this.jitter = jitter;
    this.eventListeners = new Set();
    this.statusListeners = new Set();
    this.socket = null;
    this.reconnectTimer = null;
    this.manualDisconnect = false;
    this.reconnectAttempt = 0;
    this.health = connectionHealth();
  }

  getHealth() {
    return this.health;
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') {
      throw new TypeError('Realtime listener must be a function');
    }
    this.eventListeners.add(listener);
    if (emitCurrent) {
      // There is no event snapshot to replay; callers should read the store.
    }
    return () => this.eventListeners.delete(listener);
  }

  subscribeStatus(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') {
      throw new TypeError('Realtime status listener must be a function');
    }
    this.statusListeners.add(listener);
    if (emitCurrent) {
      listener(this.health);
    }
    return () => this.statusListeners.delete(listener);
  }

  connect() {
    this.manualDisconnect = false;
    if (this.socket && this.socket.readyState !== 3) {
      return this.socket;
    }
    this.clearReconnectTimer();
    return this.openSocket();
  }

  disconnect() {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== 3) {
      socket.close(1000, 'client disconnect');
    }
    this.updateHealth({
      state: 'disconnected',
      stale: true,
      error: null,
      reconnectAttempt: this.reconnectAttempt,
      lastDisconnectedAt: Date.now()
    });
  }

  sendPing() {
    if (!this.socket || this.socket.readyState !== 1 || typeof this.socket.send !== 'function') {
      return false;
    }
    this.socket.send('ping');
    return true;
  }

  openSocket() {
    this.updateHealth({
      state: this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      stale: true,
      error: null,
      reconnectAttempt: this.reconnectAttempt
    });

    let socket;
    try {
      socket = this.webSocketFactory(this.url);
    } catch (error) {
      this.handleOpenFailure(error);
      return null;
    }

    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.reconnectAttempt = 0;
      this.updateHealth({
        state: 'connected',
        stale: false,
        error: null,
        reconnectAttempt: 0,
        lastConnectedAt: Date.now()
      });
    };
    socket.onmessage = (message) => {
      const event = normalizeRealtimeEvent(message?.data);
      if (!event) {
        return;
      }
      for (const listener of this.eventListeners) {
        listener(event);
      }
    };
    socket.onerror = () => {
      // Browser implementations normally follow this with close. The close
      // handler owns retry scheduling so that only one retry is queued.
    };
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      if (this.manualDisconnect) {
        this.updateHealth({
          state: 'disconnected',
          stale: true,
          error: null,
          lastDisconnectedAt: Date.now(),
          reconnectAttempt: this.reconnectAttempt
        });
        return;
      }
      this.scheduleReconnect();
    };
    return socket;
  }

  handleOpenFailure(error) {
    this.updateHealth({
      state: 'error',
      stale: true,
      error: error instanceof Error ? error.message : String(error),
      reconnectAttempt: this.reconnectAttempt
    });
    if (!this.manualDisconnect) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.manualDisconnect || this.reconnectTimer) {
      return;
    }
    this.reconnectAttempt += 1;
    const exponentialDelay = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectBaseDelayMs * (2 ** (this.reconnectAttempt - 1))
    );
    const jitterFactor = 1 + Math.max(0, Number(this.jitter?.() ?? 0));
    const delay = Math.min(this.reconnectMaxDelayMs, Math.round(exponentialDelay * jitterFactor));
    this.updateHealth({
      state: 'reconnecting',
      stale: true,
      reconnectAttempt: this.reconnectAttempt,
      lastDisconnectedAt: Date.now()
    });
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualDisconnect) {
        this.openSocket();
      }
    }, delay);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      this.scheduler.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  updateHealth(patch) {
    this.health = connectionHealth({ ...this.health, ...patch });
    for (const listener of this.statusListeners) {
      listener(this.health);
    }
  }
}
