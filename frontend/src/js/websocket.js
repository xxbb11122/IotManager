const handlers = {};

let ws = null;
let reconnectTimer = null;
const RECONNECT_MS = 3000;
const BROWSER_SUBPROTOCOL = 'iot-v1';
let activeSiteCode = null;
// OIDC injects the short-lived token through setAccessTokenProvider. Build-
// time and global token injection are intentionally unsupported.
let accessTokenProvider = () => '';
let shouldReconnect = true;

function websocketUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(proto + '//' + location.host + '/ws/devices');
  if (activeSiteCode) url.searchParams.set('siteCode', activeSiteCode);
  return url.toString();
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  shouldReconnect = true;
  const token = String(accessTokenProvider?.() ?? '').trim();
  ws = token
    ? new WebSocket(websocketUrl(), [BROWSER_SUBPROTOCOL, `iot-bearer.${token}`])
    : new WebSocket(websocketUrl());

  ws.onopen = () => {
    console.log('[WS] 已连接');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    emit('connected');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type) {
        emit(msg.type, msg.payload);
        emit('*', msg);
      }
    } catch (e) {
      console.error('[WS] 消息解析失败', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS] 断开, 3s 后重连');
    if (shouldReconnect && !reconnectTimer) {
      reconnectTimer = setTimeout(connect, RECONNECT_MS);
    }
    emit('disconnected');
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function disconnect() {
  shouldReconnect = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
}

function setAccessTokenProvider(provider) {
  accessTokenProvider = typeof provider === 'function' ? provider : () => null;
}

function setSiteCode(siteCode) {
  activeSiteCode = siteCode === null || siteCode === undefined || String(siteCode).trim() === ''
    ? null
    : String(siteCode).trim();
}

function on(type, fn) {
  if (!handlers[type]) handlers[type] = [];
  handlers[type].push(fn);
}

function isConnected() {
  return ws?.readyState === WebSocket.OPEN;
}

function emit(type, data) {
  (handlers[type] || []).forEach(fn => fn(data));
}

export const wsService = { connect, disconnect, setSiteCode, setAccessTokenProvider, on, isConnected };
