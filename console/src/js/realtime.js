export const RECONNECT_DELAYS_MS = Object.freeze([3_000, 6_000, 12_000, 24_000, 30_000]);
export const RECONNECT_STABLE_WINDOW_MS = 30_000;
const BROWSER_SUBPROTOCOL = 'iot-v1';

export function reconnectDelay(attempt, random = Math.random) {
  const index = Math.min(Math.max(0, Number(attempt) || 0), RECONNECT_DELAYS_MS.length - 1);
  return Math.round(RECONNECT_DELAYS_MS[index] * (0.8 + random() * 0.4));
}

function defaultWebSocketFactory(url, protocols) {
  const WebSocketConstructor = globalThis.WebSocket;
  if (typeof WebSocketConstructor !== 'function') throw new Error('WebSocket is unavailable in this environment');
  return protocols?.length ? new WebSocketConstructor(url, protocols) : new WebSocketConstructor(url);
}

/**
 * The operations console consumes normalized realtime messages but owns its
 * own REST refresh policy. This service merely reconnects with bounded backoff.
 */
export function createRealtimeService({
  webSocketFactory = defaultWebSocketFactory,
  scheduler = globalThis,
  locationProvider = () => globalThis.location,
  random = Math.random
} = {}) {
  const handlers = new Set();
  let socket = null;
  let reconnectTimer = null;
  let stableTimer = null;
  let reconnectAttempt = 0;
  let activeSiteCode = null;
  let accessTokenProvider = () => null;
  let shouldReconnect = true;

  function endpoint() {
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

  function notify(message) {
    for (const handler of handlers) handler(message);
  }

  function scheduleReconnect() {
    if (!shouldReconnect || reconnectTimer !== null) return;
    const delay = reconnectDelay(reconnectAttempt, random);
    reconnectAttempt = Math.min(reconnectAttempt + 1, RECONNECT_DELAYS_MS.length - 1);
    reconnectTimer = scheduler.setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  function openSocket() {
    if (!shouldReconnect || socket?.readyState === 0 || socket?.readyState === 1) return socket;
    const token = String(accessTokenProvider?.() ?? '').trim();
    let nextSocket;
    try {
      nextSocket = token
        ? webSocketFactory(endpoint(), [BROWSER_SUBPROTOCOL, `iot-bearer.${token}`])
        : webSocketFactory(endpoint());
    } catch {
      scheduleReconnect();
      return null;
    }
    socket = nextSocket;
    nextSocket.onopen = () => {
      if (socket !== nextSocket) return;
      clearReconnectTimer();
      clearStableTimer();
      stableTimer = scheduler.setTimeout(() => {
        stableTimer = null;
        reconnectAttempt = 0;
      }, RECONNECT_STABLE_WINDOW_MS);
    };
    nextSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.type) notify(message);
      } catch {
        // A malformed realtime frame must not interrupt the operator console.
      }
    };
    nextSocket.onclose = () => {
      if (socket === nextSocket) socket = null;
      clearStableTimer();
      scheduleReconnect();
    };
    nextSocket.onerror = () => nextSocket.close();
    return nextSocket;
  }

  function connect() {
    shouldReconnect = true;
    if (socket?.readyState === 0 || socket?.readyState === 1) return socket;
    clearReconnectTimer();
    return openSocket();
  }

  function disconnect() {
    shouldReconnect = false;
    clearReconnectTimer();
    clearStableTimer();
    const current = socket;
    socket = null;
    if (current && current.readyState !== 3) current.close();
  }

  function setSiteCode(siteCode) {
    activeSiteCode = siteCode === null || siteCode === undefined || String(siteCode).trim() === ''
      ? null
      : String(siteCode).trim();
  }

  function setAccessTokenProvider(provider) {
    accessTokenProvider = typeof provider === 'function' ? provider : () => null;
  }

  function on(handler) {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  return Object.freeze({ connect, disconnect, setSiteCode, setAccessTokenProvider, on });
}

export const realtime = createRealtimeService();
