const handlers = {};

let ws = null;
let reconnectTimer = null;
const RECONNECT_MS = 3000;

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws/devices');

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
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(connect, RECONNECT_MS);
    }
    emit('disconnected');
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
}

function on(type, fn) {
  if (!handlers[type]) handlers[type] = [];
  handlers[type].push(fn);
}

function emit(type, data) {
  (handlers[type] || []).forEach(fn => fn(data));
}

export const wsService = { connect, disconnect, on };
