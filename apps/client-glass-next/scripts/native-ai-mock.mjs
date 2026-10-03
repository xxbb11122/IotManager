import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

// Development only. This server is created by native-ai-smoke.mjs and is never
// imported by the App bundle. No provider, credentials or deployed API is used.
export async function startNativeAiMock({ port = 8080 } = {}) {
  const calls = [], requests = new Map(), conversations = new Map(), sockets = new Set();
  const versions = [];
  let activePersona = { version: 0, name: '默认性格', instructions: '' };
  const now = () => new Date().toISOString();
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': 'https://localhost' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const fail = (res, status, message, code) => send(res, status, { message, fieldErrors: { code } });
  function finish(row) {
    row.state = 'SUCCEEDED';
    row.result = { requestId: randomUUID(), conversationId: row.conversationId,
      answer: '<img src=x onerror="window.nativeAiInjected=1">原生模拟回答：' + row.question,
      personaVersion: conversations.get(row.conversationId).personaVersion, citations: [] };
    const conversation = conversations.get(row.conversationId);
    conversation.messages.push({ id: randomUUID(), turnId: row.result.requestId, role: 'USER', content: row.question },
      { id: randomUUID(), turnId: row.result.requestId, role: 'ASSISTANT', content: row.result.answer });
    conversation.updatedAt = now();
  }
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      const method = req.method;
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 32768) return fail(res, 413, 'Mock request too large');
      }
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method, pathname, key: req.headers['idempotency-key'] ?? null, body });
      if (pathname === '/mock-login') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<!doctype html><title>Native mock browser</title><p>Native browser plugin fixture</p>');
      }
      if (pathname === '/api/v1/me') return send(res, 200, { subject: 'native-smoke-owner', roles: ['OWNER'], sites: [{ id: 1 }] });
      if (pathname === '/api/v1/sites') return send(res, 200, [{ id: 1, siteCode: 'native-smoke-site', siteName: '原生模拟站点', organizationCode: 'native-smoke-org' }]);
      if (pathname === '/api/v1/devices') return send(res, 200, []);
      if (pathname.endsWith('/weather-settings')) return send(res, 200, { enabled: false, configured: false });
      if (pathname.endsWith('/weather') || pathname.endsWith('/weather/forecast')) return send(res, 200, { status: 'UNCONFIGURED', hours: [], days: [] });
      const suffix = pathname.replace('/api/v1/sites/1/ai', '');
      if (suffix === '/status') return send(res, 200, { enabled: true, knowledgeBaseEnabled: false, provider: 'native-mock' });
      if (suffix === '/capabilities') return send(res, 200, { contractVersion: 1,
        features: { history: true, pagedMessages: true, requestRecovery: true, idempotency: true, personaActivationGuard: true },
        limits: { maxQuestionChars: 2000, maxPersonaChars: 4000, maxPersonaNameChars: 80, maxPageSize: 100 } });
      if (suffix === '/persona' && method === 'GET') return send(res, 200, activePersona);
      if (suffix === '/persona/versions') return send(res, 200, versions);
      if (suffix === '/persona' && method === 'PUT') {
        if (body.expectedVersion !== versions.length) return fail(res, 409, 'Version changed', 'PERSONA_VERSION_CONFLICT');
        const persona = { version: versions.length + 1, name: body.name, instructions: body.instructions };
        versions.push(persona);
        return send(res, 200, persona);
      }
      if (/^\/persona\/\d+\/activate$/.test(suffix) && method === 'POST') {
        if (body.expectedActiveVersion !== activePersona.version) return fail(res, 409, 'Active version changed', 'PERSONA_VERSION_CONFLICT');
        const version = Number(suffix.split('/')[2]);
        activePersona = versions.find(row => row.version === version);
        return activePersona ? send(res, 200, activePersona) : fail(res, 404, 'Persona not found');
      }
      if (suffix === '/chat' && method === 'POST') {
        const key = req.headers['idempotency-key'];
        if (!/^[0-9a-f-]{36}$/i.test(key ?? '')) return fail(res, 400, 'Idempotency key required');
        let row = requests.get(key);
        if (row && (row.question !== body.question || row.originalConversationId !== body.conversationId)) return fail(res, 409, 'Payload changed', 'IDEMPOTENCY_CONFLICT');
        if (!row) {
          const conversationId = body.conversationId ?? randomUUID();
          if (!conversations.has(conversationId)) conversations.set(conversationId, {
            id: conversationId, title: body.question, updatedAt: now(), personaVersion: activePersona.version, messages: [] });
          row = { clientRequestId: key, originalConversationId: body.conversationId, conversationId,
            question: body.question, state: 'PROCESSING', expiresAt: new Date(Date.now() + 86400000).toISOString(), retryAfterSeconds: 3 };
          requests.set(key, row);
          if (!body.question.includes('native-recovery')) finish(row);
        }
        return row.state === 'SUCCEEDED' ? send(res, 200, row.result) : send(res, 202, row);
      }
      if (suffix.startsWith('/requests/')) {
        const row = requests.get(suffix.split('/')[2]);
        if (!row) return fail(res, 404, 'Request not found');
        if (!conversations.has(row.conversationId)) return fail(res, 410, 'Conversation deleted');
        return send(res, 200, row);
      }
      if (suffix === '/conversations') return send(res, 200, { items: [...conversations.values()].map(({ messages, ...row }) => row), nextCursor: null });
      if (suffix.startsWith('/conversations/')) {
        const id = suffix.split('/')[2], conversation = conversations.get(id);
        if (!conversation) return fail(res, 410, 'Conversation deleted');
        if (method === 'DELETE') { conversations.delete(id); return send(res, 204); }
        return suffix.endsWith('/messages') ? send(res, 200, { items: conversation.messages, nextCursor: null }) : send(res, 200, conversation);
      }
      return fail(res, 404, 'Unexpected mock route: ' + pathname);
    } catch (error) { fail(res, 500, error.message); }
  });
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/ws/devices') return socket.destroy();
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const protocol = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim()).includes('iot-v1')
      ? 'Sec-WebSocket-Protocol: iot-v1\r\n' : '';
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n' + protocol + '\r\n');
    sockets.add(socket);
    socket.on('data', () => {});
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { calls, requests, versions,
    completePending() { for (const row of requests.values()) if (row.state === 'PROCESSING') finish(row); },
    async close() { for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}
