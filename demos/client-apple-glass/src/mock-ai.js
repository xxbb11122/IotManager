const copy = value => structuredClone(value);
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DOMException('本地等待已停止', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
function answer(question, model) {
  let text;
  if (/回执|指令|命令/.test(question)) text = '待发送表示命令已排队；等待回执表示已发送但尚未确认。只有 ACK 会更新已上报状态。失败和结果未确认会保留原上报值，结果未确认不会自动重发。你可以在演示测试台选择这三种结果，再操作照明强度查看差异。';
  else if (/蓝牙|连接|断开/.test(question)) text = '先确认设备供电、距离和连接状态；断开后重新选择设备并连接，等待能力识别与状态同步再控制。未知 Profile 仅展示通用信息。在本演示中，“添加 → 蓝牙直连”使用本地模拟设备，不访问蓝牙硬件。';
  else if (/结露|湿度|温度/.test(question)) text = '结露通常出现在表面温度低于露点时。室外天气只提供参考，不能代替设备表面温度和现场传感器。巡检时记录现场环境、冷表面与可见水汽，再按设备操作规程处理。本演示的 24.6°C、58% 均为合成数据。';
  else {
    const device = model.devices.find(row => row.capabilities.controls?.some(control => control.id === 'level'));
    text = `当前演示站点是“${model.context.siteName}”。${device ? `“${device.displayName}”最近一次模拟上报的强度为 ${device.reportedState.level ?? '未知'}。` : ''}你可以打开设备详情测试控制，或使用“回执说明”“蓝牙排查”“结露常识”快捷提问。回答只读取模拟快照，不会发送设备命令。`;
  }
  return '【本地模拟回答】\n' + text;
}
export function createMockAi({ getModel, note = () => {}, replyDelay = 1000, now = () => Date.now() }) {
  let mode = 'reply', serial = 0;
  const scopes = new Map(), requests = new Map();
  function scope(site) {
    if (!scopes.has(site)) scopes.set(site, { conversations: new Map(), versions: [{ version: 1, name: '现场助手 · 模拟', instructions: '简洁解释模拟状态；不执行设备控制。' }], activeVersion: 1 });
    return scopes.get(site);
  }
  function access(site) {
    if (!getModel().auth.authenticated) throw Object.assign(new Error('模拟账号已退出。'), { status: 401 });
    if (!getModel().sites.some(row => row.id === site)) throw Object.assign(new Error('无该演示站点。'), { status: 403 });
    return scope(site);
  }
  function findConversation(site, id) {
    const row = access(site).conversations.get(id);
    if (!row) throw Object.assign(new Error('演示会话不存在。'), { status: 404 });
    return row;
  }
  function complete(record) {
    if (record.state !== 'SUCCEEDED' || record.saved) return;
    const conversation = scope(record.site).conversations.get(record.result.conversationId);
    if (!conversation) return;
    record.saved = true;
    conversation.messages.push({ id: record.result.requestId + ':user', turnId: record.result.requestId, role: 'USER', content: record.question },
      { id: record.result.requestId + ':assistant', turnId: record.result.requestId, role: 'ASSISTANT', content: record.result.answer });
    conversation.updatedAt = new Date(now()).toISOString();
  }
  function resolveRecord(record) {
    if (record.state === 'PROCESSING' && now() >= record.readyAt) record.state = 'SUCCEEDED';
    complete(record); return record;
  }
  const api = {
    baseUrl: '/__demo_memory',
    async getCurrentUser() { return { subject: 'demo-user', roles: ['ADMIN'], sites: getModel().sites }; },
    async getAiStatus(site) { access(site); return { enabled: true }; },
    async getAiCapabilities(site) { access(site); return { contractVersion: 1,
      features: { history: true, pagedMessages: true, requestRecovery: true, idempotency: true, personaActivationGuard: true },
      limits: { maxQuestionChars: 1200, maxPersonaNameChars: 60, maxPersonaChars: 4000 } }; },
    async askAi(site, question, conversationId, options = {}) {
      const data = access(site), key = options.headers?.['Idempotency-Key'];
      if (!key) throw new Error('缺少演示幂等标识。');
      const requestKey = `${site}:${key}`;
      if (requests.has(requestKey)) {
        const old = resolveRecord(requests.get(requestKey));
        return old.state === 'SUCCEEDED' ? copy(old.result) : { state: old.state, requestId: key, conversationId: old.result.conversationId };
      }
      note('send', 'AI 模拟发送 · ' + key);
      if (mode === 'rate-limit') throw Object.assign(new Error('模拟限流，请等待 5 秒。'), { status: 429, retryAfterSeconds: 5 });
      let conversation = conversationId ? findConversation(site, conversationId) : null;
      if (!conversation) {
        const id = 'demo-conversation-' + ++serial;
        conversation = { id, title: question.slice(0, 30), personaVersion: data.activeVersion, messages: [], updatedAt: new Date(now()).toISOString() };
        data.conversations.set(id, conversation);
      }
      const result = { requestId: key, conversationId: conversation.id, answer: answer(question, getModel()), personaVersion: conversation.personaVersion, citations: [] };
      const record = { site, question, state: mode === 'failed' ? 'FAILED' : 'PROCESSING', result,
        readyAt: now() + replyDelay, expiresAt: new Date(now() + 3600000).toISOString() };
      requests.set(requestKey, record);
      if (mode === 'failed') { await wait(200, options.signal); throw new Error('模拟服务返回失败，可查询原请求后明确重试。'); }
      if (mode === 'processing') return { requestId: key, conversationId: conversation.id, state: 'PROCESSING', retryAfterSeconds: 3 };
      await wait(replyDelay, options.signal); resolveRecord(record); return copy(result);
    },
    async getAiRequest(site, key) {
      access(site); note('query', 'AI 查询原请求 · ' + key);
      const record = requests.get(`${site}:${key}`);
      if (!record) throw Object.assign(new Error('未找到演示请求。'), { status: 404 });
      resolveRecord(record);
      return copy({ state: record.state, question: record.question, requestId: key, conversationId: record.result.conversationId,
        result: record.state === 'SUCCEEDED' ? record.result : undefined, expiresAt: record.expiresAt, retryAfterSeconds: 3 });
    },
    async listAiConversations(site) {
      for (const record of requests.values()) if (record.site === site) resolveRecord(record);
      return { items: [...access(site).conversations.values()].filter(row => row.messages.length).map(({ messages, ...row }) => copy(row)).reverse(), nextCursor: null };
    },
    async getAiConversation(site, id) { return copy(findConversation(site, id)); },
    async listAiMessages(site, id) { return { items: copy(findConversation(site, id).messages), nextCursor: null }; },
    async deleteAiConversation(site, id) { access(site).conversations.delete(id); },
    async getAiPersona(site) { const data = access(site); return copy(data.versions.find(row => row.version === data.activeVersion)); },
    async listAiPersonas(site) { return copy(access(site).versions); },
    async saveAiPersona(site, draft) {
      const data = access(site), current = data.versions.at(-1).version;
      if (draft.expectedVersion !== current) throw Object.assign(new Error('演示性格版本冲突。'), { status: 409 });
      const row = { version: current + 1, name: draft.name.trim(), instructions: draft.instructions.trim() }; data.versions.push(row); return copy(row);
    },
    async activateAiPersona(site, version, expectedVersion) {
      const data = access(site);
      if (data.activeVersion !== expectedVersion) throw Object.assign(new Error('演示启用版本冲突。'), { status: 409 });
      if (!data.versions.some(row => row.version === Number(version))) throw new Error('不存在此演示版本。');
      data.activeVersion = Number(version);
    }
  };
  return { api, setMode(value) { if (['reply', 'processing', 'failed', 'rate-limit'].includes(value)) mode = value; },
    getMode: () => mode, reset() { mode = 'reply'; serial = 0; scopes.clear(); requests.clear(); } };
}
