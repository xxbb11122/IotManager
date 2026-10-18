import { createServer } from 'node:http';

// Internal-network-only provider fixture; never part of an App or release image.
const evidence = { chatCalls: 0, embeddingCalls: 0, rejectedCalls: 0, model: 'runtime-fixture', realProviderCalled: false };
const answer = '模拟回答：温度传感器将温度转换为可读取的信号。<img src=x onerror="window.runtimeAiInjected=1">';
createServer(async (request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (request.method === 'GET' && request.url === '/__evidence') return send(200, evidence);
  if (request.url.includes('embedding')) { evidence.embeddingCalls++; return send(503, { error: 'Embedding is not enabled in this fixture' }); }
  if (request.method !== 'POST' || request.url !== '/chat/completions' || request.headers.authorization !== 'Bearer test-only-key') {
    evidence.rejectedCalls++; return send(403, { error: 'Unexpected fixture request' });
  }
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 65536) return send(413, { error: 'Fixture request too large' });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return send(400, { error: 'Invalid JSON' }); }
  if (body.model !== evidence.model || body.stream === true || !body.messages?.some(row => row.role === 'user' && String(row.content).endsWith('Question: 模拟测试：用一句话解释温度传感器。'))) {
    evidence.rejectedCalls++; return send(400, { error: 'Unexpected fixture model or question' });
  }
  evidence.chatCalls++;
  send(200, { id: 'fixture-chat-' + evidence.chatCalls, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: evidence.model,
    choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 24, completion_tokens: 32, total_tokens: 56 } });
}).listen(8081, '0.0.0.0', () => console.log('Internal AI fixture ready'));
