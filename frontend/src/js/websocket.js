export const RECONNECT_DELAYS_MS = Object.freeze([3_000, 6_000, 12_000, 24_000, 30_000]);
export const RECONNECT_STABLE_WINDOW_MS = 30_000;
export const BROWSER_SUBPROTOCOL = 'iot-v1';

export function reconnectDelay(attempt, random = Math.random) {
  const index = Math.min(Math.max(0, Number(attempt) || 0), RECONNECT_DELAYS_MS.length - 1);
  const base = RECONNECT_DELAYS_MS[index];
  return Math.round(base * (0.8 + random() * 0.4));
}

function defaultWebSocketFactory(url, protocols) {
  const WebSocketConstructor = globalThis.WebSocket;
  if (typeof WebSocketConstructor !== 'function') {
    throw new Error('WebSocket is unavailable in this environment');
  }
  return protocols?.length ? new WebSocketConstructor(url, protocols) : new WebSocketConstructor(url);
}

function defaultLocationProvider() {
  return globalThis.location;
}

/**
 * Dashboard WebSocket lifecycle with bounded exponential retry.  The service
 * emits connection metadata instead of triggering REST loads itself, keeping
 * reconciliation policy in the UI layer where site and visibility state exist.
 */
export function createWebSocketService({
  webSocketFactory = defaultWebSocketFactory,
  scheduler = globalThis,
  locationProvider = defaultLocationProvider,
  random = Math.random,
  now = () => Date.now()
} = {}) {
  const handlers = {};
  let ws = null;
  let reconnectTimer = null;
  let stableTimer = null;
  let reconnectAttempt = 0;
  let disconnectedAt = null;
  let shouldReconnect = true;
  let activeSiteCode = null;
  let accessTokenProvider = () => '';

  function websocketUrl() {
    const location = locationProvider();
    const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(`${protocol}//${location?.host}/ws/devices`);
    if (activeSiteCode) url.searchParams.set('siteCode', activeSiteCode);
    return url.toString();
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      scheduler.clearTimeout?.(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearStableTimer() {
    if (stableTimer !== null) {
      scheduler.clearTimeout?.(stableTimer);
      stableTimer = null;
    }
  }

  function emit(type, data) {
    (handlers[type] || []).forEach((handler) => handler(data));
  }

  function isConnected() {
    return ws?.readyState === 1;
  }

  function scheduleStableReset() {
    clearStableTimer();
    stableTimer = scheduler.setTimeout(() => {
      stableTimer = null;
      reconnectAttempt = 0;
      emit('connection_stable', { stableForMs: RECONNECT_STABLE_WINDOW_MS });
    }, RECONNECT_STABLE_WINDOW_MS);
  }

  function scheduleReconnect() {
    if (!shouldReconnect || reconnectTimer !== null) return;
    const attempt = reconnectAttempt;
    const delay = reconnectDelay(attempt, random);
    reconnectAttempt = Math.min(reconnectAttempt + 1, RECONNECT_DELAYS_MS.length - 1);
    reconnectTimer = scheduler.setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
    emit('reconnect_scheduled', { attempt: attempt + 1, delay });
  }

  function openSocket() {
    if (!shouldReconnect || ws?.readyState === 0 || ws?.readyState === 1) return ws;
    const token = String(accessTokenProvider?.() ?? '').trim();
    let socket;
    try {
      socket = token
        ? webSocketFactory(websocketUrl(), [BROWSER_SUBPROTOCOL, `iot-bearer.${token}`])
        : webSocketFactory(websocketUrl());
    } catch (error) {
      disconnectedAt ??= now();
      emit('disconnected', { error, reconnectAttempt });
      scheduleReconnect();
      return null;
    }

    ws = socket;
    socket.onopen = () => {
      if (ws !== socket) return;
      clearReconnectTimer();
      const connectedAt = now();
      const disconnectedForMs = disconnectedAt === null ? 0 : Math.max(0, connectedAt - disconnectedAt);
      const reconnected = disconnectedAt !== null;
      disconnectedAt = null;
      scheduleStableReset();
      emit('connected', { reconnected, disconnectedForMs, reconnectAttempt });
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.type) {
          emit(message.type, message.payload);
          emit('*', message);
        }
      } catch (error) {
        console.error('[WS] 消息解析失败', error);
      }
    };

    socket.onclose = () => {
      if (ws === socket) ws = null;
      clearStableTimer();
      disconnectedAt = now();
      emit('disconnected', { reconnectAttempt });
      scheduleReconnect();
    };
    socket.onerror = () => socket?.close();
    return socket;
  }

  function connect() {
    shouldReconnect = true;
    if (ws?.readyState === 0 || ws?.readyState === 1) return ws;
    clearReconnectTimer();
    return openSocket();
  }

  function disconnect() {
    shouldReconnect = false;
    clearReconnectTimer();
    clearStableTimer();
    const socket = ws;
    ws = null;
    if (socket && socket.readyState !== 3) socket.close();
  }

  function setAccessTokenProvider(provider) {
    accessTokenProvider = typeof provider === 'function' ? provider : () => null;
  }

  function setSiteCode(siteCode) {
    activeSiteCode = siteCode === null || siteCode === undefined || String(siteCode).trim() === ''
      ? null
      : String(siteCode).trim();
  }

  function on(type, handler) {
    if (!handlers[type]) handlers[type] = [];
    handlers[type].push(handler);
    return () => {
      handlers[type] = handlers[type].filter((candidate) => candidate !== handler);
    };
  }

  function getHealth() {
    return Object.freeze({
      connected: isConnected(),
      reconnectAttempt,
      disconnectedAt,
      reconnectScheduled: reconnectTimer !== null
    });
  }

  return Object.freeze({
    connect,
    disconnect,
    setSiteCode,
    setAccessTokenProvider,
    on,
    isConnected,
    getHealth
  });
}

export const wsService = createWebSocketService();
