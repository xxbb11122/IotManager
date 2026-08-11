const handlers = new Set();
let socket = null;
let reconnectTimer = null;

function endpoint() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/devices`;
}

function notify(message) {
  for (const handler of handlers) handler(message);
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  socket = new WebSocket(endpoint());
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
    if (!reconnectTimer) reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  };
  socket.onerror = () => socket?.close();
}

function disconnect() {
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  socket?.close();
  socket = null;
}

function on(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export const realtime = { connect, disconnect, on };
