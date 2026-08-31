const handlers = new Set();
let socket = null;
let reconnectTimer = null;
let activeSiteCode = null;
let accessTokenProvider = () => null;
let shouldReconnect = true;
const BROWSER_SUBPROTOCOL = 'iot-v1';

function endpoint() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${protocol}//${location.host}/ws/devices`);
  if (activeSiteCode) url.searchParams.set('siteCode', activeSiteCode);
  return url.toString();
}

function notify(message) {
  for (const handler of handlers) handler(message);
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  shouldReconnect = true;
  const token = String(accessTokenProvider?.() ?? '').trim();
  socket = token
    ? new WebSocket(endpoint(), [BROWSER_SUBPROTOCOL, `iot-bearer.${token}`])
    : new WebSocket(endpoint());
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message?.type) notify(message);
    } catch {
      // A malformed realtime frame must not interrupt the operator console.
    }
  };
  socket.onclose = () => {
    socket = null;
    if (shouldReconnect && !reconnectTimer) reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  };
  socket.onerror = () => socket?.close();
}

function disconnect() {
  shouldReconnect = false;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  socket?.close();
  socket = null;
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

export const realtime = { connect, disconnect, setSiteCode, setAccessTokenProvider, on };
