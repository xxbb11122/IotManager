import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiController } from '../src/js/ai/ai-controller.js';
import { createAiRecoveryStore, aiScopeKey, aiCanSend, createAiState } from '../src/js/ai/ai-state.js';

const features = { history: true, pagedMessages: true, requestRecovery: true, idempotency: true, personaActivationGuard: true };
const reply = { requestId: 'server-request', conversationId: 'conversation-1', answer: '模拟回答', citations: [], personaVersion: 0 };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function memoryPreferences() {
  const values = new Map();
  return { values, async get({ key }) { return { value: values.get(key) ?? null }; },
    async set({ key, value }) { values.set(key, value); }, async remove({ key }) { values.delete(key); } };
}
function fakeClock() {
  let clock = 1000000, next = 0; const timers = new Map();
  return { now: () => clock, timers,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); } await flush(); } };
}
function harness(overrides = {}, controllerOptions = {}) {
  const clock = fakeClock(), storage = memoryPreferences(), calls = [];
  const api = {
    baseUrl: 'https://api.example.test/api/v1',
    getCurrentUser: async () => ({ subject: 'user-a', roles: ['OWNER'], sites: [{ id: 1 }, { id: 2 }] }),
    getAiStatus: async () => ({ enabled: true }),
    getAiCapabilities: async () => ({ contractVersion: 1, features }),
    getAiPersona: async () => ({ version: 0, name: '默认性格' }), listAiPersonas: async () => [],
    listAiConversations: async () => ({ items: [], nextCursor: null }),
    getAiConversation: async () => ({ personaVersion: 0 }),
    listAiMessages: async () => ({ items: [], nextCursor: null }),
    askAi: async (...args) => { calls.push(args); return reply; },
    getAiRequest: async () => ({ state: 'PROCESSING', retryAfterSeconds: 3, expiresAt: new Date(clock.now() + 86400000).toISOString() }),
    ...overrides
  };
  let context = { api, siteId: 1, organization: 'org-a',
    endpoint: { oidcIssuerUrl: 'https://identity.example.test', oidcClientId: 'mobile' },
    auth: { configured: true, authenticated: true, cachePartition: 'login-a' } };
  const recovery = createAiRecoveryStore(storage, clock.now); let n = 0;
  const create = () => createAiController({ contextProvider: () => context, recovery, now: clock.now, scheduler: clock,
    requestTimeoutMs: 45000, keyFactory: () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0'), ...controllerOptions });
  const controller = create();
  return { controller, create, recovery, storage, clock, api, calls, context, change: (patch) => { context = { ...context, ...patch }; } };
}

test('question UTF-16 length, empty input, cooldown and pending state gate sending', () => {
  const state = { ...createAiState(), status: 'ready', enabled: true, draft: '😀'.repeat(1000) };
  assert.equal(aiCanSend(state), true);
  assert.equal(aiCanSend({ ...state, draft: state.draft + 'a' }), false);
  assert.equal(aiCanSend({ ...state, draft: '   ' }), false);
  assert.equal(aiCanSend({ ...state, pending: {} }), false);
  assert.equal(aiCanSend({ ...state, retryAt: state.now + 1000 }), false);
});
test('double click submits exactly once with a UUID and creates one message pair', async () => {
  const pending = deferred(), h = harness({ askAi: async (...args) => { h.calls.push(args); return pending.promise; } });
  await h.controller.setScreen('ai'); h.controller.setDraft('问题');
  const first = h.controller.send(), second = h.controller.send(); await flush();
  assert.equal(h.calls.length, 1); assert.match(h.calls[0][3].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  pending.resolve(reply); await Promise.all([first, second]);
  assert.equal(h.controller.getState().messages.length, 2);
  assert.equal(h.controller.getState().personaVersion, 0); h.controller.destroy();
});

test('an authenticated API without OIDC configuration exposes setup before any site is selected', async () => {
  let statusCalls = 0;
  const h = harness({ getCurrentUser: async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); },
    getAiStatus: async () => { statusCalls++; return { enabled: true }; } });
  h.change({ siteId: null, auth: { configured: false, authenticated: false } });
  await h.controller.setScreen('ai');
  assert.equal(h.controller.getState().status, 'auth_required');
  assert.equal(statusCalls, 0); assert.equal(h.calls.length, 0); h.controller.destroy();
});

test('connection recheck preserves a verified conversation and draft without another POST', async () => {
  const h = harness(); await h.controller.setScreen('ai');
  h.controller.setDraft('已完成的问题'); await h.controller.send();
  h.controller.setDraft('还未发送的新问题');
  await h.controller.reload();
  const state = h.controller.getState();
  assert.equal(state.status, 'ready'); assert.equal(state.conversationId, reply.conversationId);
  assert.equal(state.messages.length, 2); assert.equal(state.draft, '还未发送的新问题');
  assert.equal(h.calls.length, 1); h.controller.destroy();
});

test('connection recheck keeps the server Retry-After cooldown for the same verified identity', async () => {
  const h = harness({ askAi: async (...args) => {
    h.calls.push(args); throw Object.assign(new Error('Rate limited'), { status: 429, retryAfterSeconds: 20 });
  } });
  await h.controller.setScreen('ai'); h.controller.setDraft('限流后的问题'); await h.controller.send();
  const retryAt = h.controller.getState().retryAt;
  await h.controller.reload();
  assert.equal(h.controller.getState().retryAt, retryAt);
  assert.equal(aiCanSend(h.controller.getState()), false);
  await h.clock.advance(20000); assert.equal(aiCanSend(h.controller.getState()), true);
  assert.equal(h.calls.length, 1); h.controller.destroy();
});

test('an AI page opened offline rechecks when the network returns without submitting a question', async () => {
  let online = false;
  const h = harness({}, { isOnline: () => online });
  await h.controller.setScreen('ai'); assert.equal(h.controller.getState().status, 'offline');
  online = true;
  await h.controller.networkChanged();
  assert.equal(h.controller.getState().status, 'ready');
  assert.equal(h.controller.getState().draft, '');
  assert.equal(h.calls.length, 0); h.controller.destroy();
});

test('network restoration obtains a pending result with GET and keeps the original POST count', async () => {
  let online = true, completed = false;
  const h = harness({
    askAi: async (...args) => { h.calls.push(args); return { state: 'PROCESSING', conversationId: reply.conversationId, retryAfterSeconds: 30 }; },
    getAiRequest: async () => ({ state: completed ? 'SUCCEEDED' : 'PROCESSING', question: '原问题', result: completed ? reply : null,
      expiresAt: new Date(h.clock.now() + 86400000).toISOString(), retryAfterSeconds: 30 }),
    listAiMessages: async () => ({ items: [{ id: 'u', role: 'USER', content: '原问题' }, { id: 'a', role: 'ASSISTANT', content: reply.answer }], nextCursor: null })
  }, { isOnline: () => online });
  await h.controller.setScreen('ai'); h.controller.setDraft('原问题'); await h.controller.send();
  const pendingId = h.controller.getState().pending.clientRequestId;
  online = false; await h.controller.networkChanged();
  assert.equal(h.controller.getState().status, 'offline');
  assert.equal(h.controller.getState().pending.clientRequestId, pendingId);
  assert.equal(aiCanSend(h.controller.getState()), false);
  online = true; completed = true; await h.controller.networkChanged();
  assert.equal(h.controller.getState().pending, null);
  assert.equal(h.controller.getState().messages.length, 2);
  assert.equal(h.calls.length, 1); h.controller.destroy();
});

test('connectivity events do not interrupt or repeat a live Chat submission', async () => {
  let online = true;
  const pending = deferred();
  const h = harness({ askAi: async (...args) => { h.calls.push(args); return pending.promise; } }, { isOnline: () => online });
  await h.controller.setScreen('ai'); h.controller.setDraft('正在发送的问题');
  const submitted = h.controller.send(); await flush();
  online = false; await h.controller.networkChanged();
  online = true; await h.controller.networkChanged();
  assert.equal(h.controller.getState().busy, true); assert.equal(h.calls.length, 1);
  pending.resolve(reply); await submitted;
  assert.equal(h.controller.getState().messages.length, 2);
  assert.equal(h.calls.length, 1); h.controller.destroy();
});

test('server outage during recheck retains content for recovery and blocks sending', async () => {
  const h = harness(); await h.controller.setScreen('ai');
  h.controller.setDraft('原问题'); await h.controller.send(); h.controller.setDraft('离线草稿');
  const currentUser = h.api.getCurrentUser;
  h.api.getCurrentUser = async () => { throw new TypeError('Failed to fetch'); };
  await h.controller.reload();
  assert.equal(h.controller.getState().status, 'failed');
  assert.equal(h.controller.getState().draft, '离线草稿'); assert.equal(h.controller.getState().messages.length, 2);
  assert.equal(aiCanSend(h.controller.getState()), false);
  h.api.getCurrentUser = currentUser; await h.controller.reload();
  assert.equal(h.controller.getState().status, 'ready'); assert.equal(h.controller.getState().draft, '离线草稿');
  assert.equal(h.controller.getState().messages.length, 2); assert.equal(h.calls.length, 1); h.controller.destroy();
});

test('rechecking with a different verified subject cannot restore the preceding identity content', async () => {
  const h = harness(); await h.controller.setScreen('ai');
  h.controller.setDraft('旧身份问题'); await h.controller.send(); h.controller.setDraft('旧身份草稿');
  h.api.getCurrentUser = async () => ({ subject: 'user-b', roles: ['VIEWER'], sites: [{ id: 1 }] });
  await h.controller.reload();
  assert.deepEqual(h.controller.getState().messages, []); assert.equal(h.controller.getState().draft, '');
  assert.equal(h.controller.getState().canManage, false); h.controller.destroy();
});

test('AI disabled at startup can become enabled on foreground without sending a question', async () => {
  let enabled = false;
  const h = harness({ getAiStatus: async () => ({ enabled }) });
  await h.controller.setScreen('ai'); assert.equal(h.controller.getState().status, 'disabled');
  h.controller.setDraft('未发送问题'); h.controller.setForeground(false); enabled = true;
  h.controller.setForeground(true); await flush();
  assert.equal(h.controller.getState().status, 'ready'); assert.equal(h.controller.getState().draft, '未发送问题');
  assert.equal(h.calls.length, 0); h.controller.destroy();
});

test('rechecking after authorization expires clears the old conversation and draft', async () => {
  const h = harness(); await h.controller.setScreen('ai'); h.controller.setDraft('问题'); await h.controller.send();
  h.controller.setDraft('草稿');
  h.api.getCurrentUser = async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); };
  await h.controller.reload();
  assert.equal(h.controller.getState().status, 'login'); assert.equal(h.controller.getState().draft, '');
  assert.deepEqual(h.controller.getState().messages, []); h.controller.destroy();
});
test('a delayed reply from a previous site never appears in the new site', async () => {
  const pending = deferred(), h = harness({ askAi: () => pending.promise });
  await h.controller.setScreen('ai'); h.controller.setDraft('旧站点问题');
  const work = h.controller.send(); await flush(); h.change({ siteId: 2 });
  await h.controller.syncContext(); pending.resolve(reply); await work;
  assert.deepEqual(h.controller.getState().messages, []); assert.equal(h.controller.getState().conversationId, null);
  h.controller.destroy();
});
test('failure to persist recovery metadata sends no HTTP POST', async () => {
  const h = harness(); await h.controller.setScreen('ai');
  h.storage.set = async () => { throw new Error('storage unavailable'); };
  h.controller.setDraft('问题'); await h.controller.send();
  assert.equal(h.calls.length, 0); assert.equal(h.controller.getState().pending, null);
  assert.match(h.controller.getState().error, /尚未发送/); h.controller.destroy();
});
test('202 polls with backoff, honors Retry-After and stops in background without repeating POST', async () => {
  let gets = 0;
  const h = harness({ askAi: async (...args) => { h.calls.push(args); return { state: 'PROCESSING', conversationId: 'conversation-1', retryAfterSeconds: 3 }; },
    getAiRequest: async () => { gets++; return { state: 'PROCESSING', retryAfterSeconds: 40, expiresAt: new Date(h.clock.now() + 100000).toISOString() }; } });
  await h.controller.setScreen('ai'); h.controller.setDraft('问题'); await h.controller.send();
  await h.clock.advance(3000); assert.equal(gets, 1);
  await h.clock.advance(30000); assert.equal(gets, 1);
  h.controller.setForeground(false); await h.clock.advance(100000); assert.equal(gets, 1);
  h.controller.setForeground(true); await flush(); assert.equal(gets, 2);
  assert.equal(h.calls.length, 1); h.controller.destroy();
});
test('local timeout remains recoverable even if native transport ignores AbortSignal', async () => {
  const h = harness({ askAi: () => new Promise(() => {}) });
  await h.controller.setScreen('ai'); h.controller.setDraft('问题');
  const work = h.controller.send(); await flush(); await h.clock.advance(45000); await work;
  assert.equal(h.controller.getState().status, 'uncertain'); assert.ok(h.controller.getState().pending);
  h.controller.destroy();
});
test('cold restore uses IDs only and obtains the original successful result using GET', async () => {
  const h = harness({ askAi: async () => ({ state: 'PROCESSING', conversationId: 'conversation-1' }),
    getAiRequest: async () => ({ state: 'SUCCEEDED', result: reply, question: '敏感问题',
      expiresAt: new Date(h.clock.now() + 100000).toISOString() }),
    listAiMessages: async () => ({ items: [{ id: 'm1', role: 'USER', content: '敏感问题' }, { id: 'm2', role: 'ASSISTANT', content: '模拟回答' }] }) });
  await h.controller.setScreen('ai'); h.controller.setDraft('敏感问题'); await h.controller.send(); h.controller.destroy();
  const raw = [...h.storage.values.values()].join('');
  assert.ok(raw.includes('clientRequestId')); assert.ok(!raw.includes('敏感问题')); assert.ok(!raw.includes('模拟回答'));
  const restored = h.create(); await restored.setScreen('ai');
  assert.equal(restored.getState().messages.length, 2); assert.equal(restored.getState().pending, null); restored.destroy();
});
test('identity and API endpoint partitions are stable across login refresh but isolated from other scopes', () => {
  const scope = { apiBaseUrl: 'https://api.test/api/', issuer: 'https://id.test', clientId: 'mobile', subject: 'u1', organization: 'o1', siteId: 1 };
  assert.equal(aiScopeKey(scope), aiScopeKey({ ...scope, apiBaseUrl: 'https://api.test/api' }));
  for (const patch of [{ subject: 'u2' }, { siteId: 2 }, { organization: 'o2' }, { issuer: 'https://other.test' }, { apiBaseUrl: 'https://other.test/api' }])
    assert.notEqual(aiScopeKey(scope), aiScopeKey({ ...scope, ...patch }));
});

test('AI entered before site startup automatically restores a saved result when the site arrives', async () => {
  let gets = 0;
  const h = harness({ getAiRequest: async () => { gets++; return { state: 'SUCCEEDED', result: reply, question: '恢复问题',
    expiresAt: new Date(h.clock.now() + 100000).toISOString() }; },
    getAiPersona: async () => ({ version: 3, name: '当前性格' }),
    listAiMessages: async () => ({ items: [{ id: 'u', role: 'USER', content: '恢复问题' }, { id: 'a', role: 'ASSISTANT', content: '模拟回答' }] }) });
  const scope = aiScopeKey({ apiBaseUrl: h.api.baseUrl, issuer: h.context.endpoint.oidcIssuerUrl,
    clientId: h.context.endpoint.oidcClientId, subject: 'user-a', organization: 'org-a', siteId: 1 });
  await h.recovery.put(scope, { clientRequestId: 'saved-request', conversationId: 'conversation-1', submittedAt: h.clock.now() });
  h.change({ siteId: null }); await h.controller.setScreen('ai');
  assert.equal(h.controller.getState().status, 'site');
  h.change({ siteId: 1 }); await h.controller.syncContext();
  assert.equal(gets, 1); assert.equal(h.calls.length, 0);
  assert.equal(h.controller.getState().messages.length, 2); assert.equal(h.controller.getState().pending, null);
  assert.equal(h.controller.getState().activePersona.version, 3); h.controller.destroy();
});

test('context initialization queries a pending request only once and respects background state', async () => {
  let gets = 0;
  const h = harness({ getAiRequest: async () => { gets++; return { state: 'PROCESSING', retryAfterSeconds: 3,
    expiresAt: new Date(h.clock.now() + 100000).toISOString() }; } });
  const scope = aiScopeKey({ apiBaseUrl: h.api.baseUrl, issuer: h.context.endpoint.oidcIssuerUrl,
    clientId: h.context.endpoint.oidcClientId, subject: 'user-a', organization: 'org-a', siteId: 1 });
  await h.recovery.put(scope, { clientRequestId: 'saved-request', submittedAt: h.clock.now() });
  h.controller.setForeground(false); await h.controller.setScreen('ai');
  assert.equal(gets, 0); assert.ok(h.controller.getState().pending);
  h.controller.setForeground(true); await flush();
  assert.equal(gets, 1); assert.ok(h.controller.getState().activePersona);
  await h.clock.advance(5000); assert.equal(gets, 2); assert.equal(h.calls.length, 0); h.controller.destroy();
});

test('visible history reloads for the new site after its context finishes initialization', async () => {
  const sites = [];
  const h = harness({ listAiConversations: async site => { sites.push(site); return { items: [{ id: 'site-' + site }], nextCursor: null }; } });
  await h.controller.setScreen('ai-history');
  assert.deepEqual(sites, [1]);
  h.change({ siteId: 2 }); await h.controller.syncContext();
  assert.deepEqual(sites, [1, 2]); assert.equal(h.controller.getState().history[0].id, 'site-2'); h.controller.destroy();
});

test('new conversation during a slow startup preference read never restores the discarded request', async () => {
  let gets = 0;
  const h = harness({ getAiRequest: async () => { gets++; return { state: 'PROCESSING' }; } });
  const scope = aiScopeKey({ apiBaseUrl: h.api.baseUrl, issuer: h.context.endpoint.oidcIssuerUrl,
    clientId: h.context.endpoint.oidcClientId, subject: 'user-a', organization: 'org-a', siteId: 1 });
  await h.recovery.put(scope, { clientRequestId: 'discarded-request', submittedAt: h.clock.now() });
  const read = deferred(), originalGet = h.storage.get;
  const saved = await originalGet({ key: 'iot-manager.ai-recovery.v1' });
  h.storage.get = () => read.promise;
  const initialization = h.controller.setScreen('ai'); await flush();
  assert.equal(h.controller.getState().enabled, true);
  const cleared = h.controller.newConversation();
  read.resolve(saved); await Promise.all([initialization, cleared]);
  h.storage.get = originalGet;
  assert.equal(gets, 0); assert.equal(h.controller.getState().pending, null);
  assert.deepEqual(h.controller.getState().messages, []); assert.equal(await h.recovery.get(scope), null); h.controller.destroy();
});
test('24 hour metadata expires and recovery never reads a foreign scope', async () => {
  const storage = memoryPreferences(), clock = fakeClock(), recovery = createAiRecoveryStore(storage, clock.now);
  await recovery.put('a', { clientRequestId: 'uuid', submittedAt: clock.now(), question: 'must not persist' });
  assert.equal(await recovery.get('b'), null);
  await clock.advance(86400001); assert.equal(await recovery.get('a'), null);
});
test('UNKNOWN requires explicit retry with a new key and never automatically resends', async () => {
  const h = harness({ askAi: async (...args) => { h.calls.push(args); return { state: 'PROCESSING' }; },
    getAiRequest: async () => ({ state: 'UNKNOWN', question: '问题', expiresAt: new Date(h.clock.now() + 100000).toISOString() }) });
  await h.controller.setScreen('ai'); h.controller.setDraft('问题'); await h.controller.send(); await h.controller.recover();
  assert.equal(h.calls.length, 1); assert.match(h.controller.getState().error, /费用/);
  await h.controller.retry(); assert.equal(h.calls.length, 2);
  assert.notEqual(h.calls[0][3].headers['Idempotency-Key'], h.calls[1][3].headers['Idempotency-Key']); h.controller.destroy();
});
test('403 during history reading clears all AI messages, draft and role information', async () => {
  const h = harness(); await h.controller.setScreen('ai'); h.controller.setDraft('问题'); await h.controller.send();
  h.api.listAiConversations = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); };
  await h.controller.loadHistory(); const state = h.controller.getState();
  assert.equal(state.status, 'site'); assert.equal(state.enabled, false); assert.equal(state.canManage, false);
  assert.deepEqual(state.messages, []); assert.equal(state.draft, ''); h.controller.destroy();
});
test('persona save and activation send independent expected versions and preserve the conversation version', async () => {
  let saved, activated;
  const h = harness({ getAiPersona: async () => ({ version: 2, name: '当前性格' }), listAiPersonas: async () => [{ version: 2 }, { version: 4 }],
    saveAiPersona: async (_site, body) => { saved = body; },
    activateAiPersona: async (_site, version, expected) => { activated = { version, expected }; } });
  await h.controller.setScreen('ai'); h.controller.setDraft('问题'); await h.controller.send();
  h.controller.setPersonaDraft('name', '新性格'); h.controller.setPersonaDraft('instructions', 'a'.repeat(4000));
  await h.controller.savePersona(); await h.controller.activatePersona(4);
  assert.equal(saved.expectedVersion, 4); assert.equal(saved.instructions.length, 4000);
  assert.deepEqual(activated, { version: 4, expected: 2 }); assert.equal(h.controller.getState().personaVersion, 0);
  h.controller.destroy();
});
test('older server capability 404 permits only legacy chat', async () => {
  const h = harness({ getAiCapabilities: async () => { throw Object.assign(new Error('missing'), { status: 404 }); } });
  await h.controller.setScreen('ai'); h.controller.setDraft('问题'); await h.controller.send();
  assert.equal(h.controller.getState().legacy, true); assert.deepEqual(h.calls[0][3].headers, {});
  assert.deepEqual(h.controller.getState().features, {}); h.controller.destroy();
});

test('403 while saving persona revokes all AI data and management permissions', async () => {
  const h = harness({ saveAiPersona: async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); } });
  await h.controller.setScreen('ai'); h.controller.setDraft('问题'); await h.controller.send();
  h.controller.setPersonaDraft('name', '性格'); h.controller.setPersonaDraft('instructions', '简洁回答');
  await h.controller.savePersona();
  const state = h.controller.getState();
  assert.equal(state.enabled, false); assert.equal(state.canManage, false); assert.deepEqual(state.messages, []);
  assert.equal(state.personaDraft.instructions, ''); h.controller.destroy();
});

test('overlapping older-message pages never duplicate stored message IDs', async () => {
  const h = harness({ listAiMessages: async (_site, _id, query) => query.cursor
    ? { items: [{ id: 'older', role: 'USER', content: '早期' }, { id: 'newer', role: 'ASSISTANT', content: '近期' }], nextCursor: null }
    : { items: [{ id: 'newer', role: 'ASSISTANT', content: '近期' }], nextCursor: 'cursor-1' } });
  await h.controller.setScreen('ai'); await h.controller.selectConversation('conversation-1'); await h.controller.loadMessages(true);
  assert.deepEqual(h.controller.getState().messages.map(row => row.id), ['older', 'newer']); h.controller.destroy();
});

test('410 on an in-flight follow-up clears the deleted conversation and its local contents', async () => {
  const h = harness(); await h.controller.setScreen('ai'); h.controller.setDraft('第一问'); await h.controller.send();
  h.api.askAi = async () => { throw Object.assign(new Error('deleted'), { status: 410 }); };
  h.controller.setDraft('追问'); await h.controller.send();
  const state = h.controller.getState();
  assert.deepEqual(state.messages, []); assert.equal(state.conversationId, null); assert.equal(state.pending, null);
  assert.equal(state.draft, ''); assert.match(state.error, /已删除或过期/); h.controller.destroy();
});
