import { createAiState, aiScopeKey, aiCanSend, aiErrorMessage } from './ai-state.js';

export function createAiController({
  contextProvider, recovery, onChange = () => {}, now = () => Date.now(),
  keyFactory = () => globalThis.crypto.randomUUID(), scheduler = globalThis, requestTimeoutMs = 45000,
  isOnline = () => globalThis.navigator?.onLine !== false
}) {
  let state = createAiState(), epoch = 0, operation = 0, signature = null, initialization = null;
  let api = null, siteId = null, screen = 'devices', foreground = true, timer = null, retryTimer = null, recoveryPromise = null;
  let screenHydration = 0, conversationRevision = 0;
  const controllers = new Set();
  const retainedContent = (value) => ({
    draft: value.draft, messages: value.messages, conversationId: value.conversationId,
    personaVersion: value.personaVersion, personaDraft: value.personaDraft,
    history: value.history, historyCursor: value.historyCursor, messageCursor: value.messageCursor, retryAt: value.retryAt
  });
  const visible = () => screen.startsWith('ai');
  const emit = (patch = {}) => { state = { ...state, ...patch, now: now() }; onChange(structuredClone(state)); };
  const current = (ticket, action = null) => ticket === epoch && (action === null || action === operation);
  const stopTimer = () => { if (timer !== null) scheduler.clearTimeout(timer); timer = null; };
  const abort = () => { for (const controller of controllers) controller.abort(); controllers.clear(); };
  async function request(fn) {
    const controller = new AbortController(); controllers.add(controller);
    let timeout;
    const failure = new Promise((_, reject) => {
      timeout = scheduler.setTimeout(() => { controller.abort(); reject(new Error('等待超时，请查询原请求结果。')); }, requestTimeoutMs);
      controller.signal.addEventListener('abort', () => reject(new Error('已取消本地等待，可查询原请求结果。')), { once: true });
    });
    try { return await Promise.race([fn({ signal: controller.signal }), failure]); }
    finally { scheduler.clearTimeout(timeout); controllers.delete(controller); }
  }
  function reset({ clearMetadata = false } = {}) {
    epoch++; operation++; conversationRevision++; signature = null; initialization = null; api = null; siteId = null;
    stopTimer(); abort(); recoveryPromise = null; if (retryTimer !== null) scheduler.clearTimeout(retryTimer); retryTimer = null;
    emit(createAiState());
    if (clearMetadata) return recovery.clear().catch(() => emit({ notice: '恢复记录清理失败，请重新退出登录后核对。' }));
  }
  async function syncContext({ force = false } = {}) {
    const context = contextProvider();
    const next = JSON.stringify([context.api?.baseUrl, context.siteId, context.endpoint?.oidcIssuerUrl,
      context.endpoint?.oidcClientId, context.auth?.cachePartition, context.auth?.authenticated, context.organization]);
    if (next === signature && !isOnline()) {
      emit({ status: 'offline', loading: false }); return;
    }
    if (next === signature && !force && state.status !== 'offline') return initialization;
    const previous = next === signature ? structuredClone(state) : null;
    reset(); signature = next;
    if (context.auth?.configured && !context.auth?.authenticated) { emit({ status: 'login' }); return; }
    if (!context.api) { emit({ status: 'unconfigured' }); return; }
    if (!isOnline()) { emit({ status: 'offline' }); return; }
    api = context.api; siteId = context.siteId;
    const ticket = epoch;
    emit({ status: 'loading', loading: true });
    initialization = (async () => {
      try {
        const me = await request((options) => api.getCurrentUser(options));
        if (!current(ticket)) return;
        if (!me?.subject) throw new Error('服务器未返回可核验的用户身份。');
        if (!siteId) { emit({ status: 'site', loading: false }); return; }
        if (me.sites?.length && !me.sites.some((site) => String(site.id) === String(siteId)))
          throw Object.assign(new Error('当前站点不在账号授权范围内。'), { status: 403 });
        const scopeKey = aiScopeKey({ apiBaseUrl: new URL(api.baseUrl, globalThis.location?.href ?? 'http://localhost/').href,
          issuer: context.endpoint?.oidcIssuerUrl, clientId: context.endpoint?.oidcClientId,
          subject: me.subject, organization: context.organization, siteId });
        const [status, capability] = await Promise.all([
          request((options) => api.getAiStatus(siteId, options)),
          request((options) => api.getAiCapabilities(siteId, options)).catch((error) => { if (error.status === 404) return null; throw error; })
        ]);
        if (!current(ticket)) return;
        const legacy = capability === null || capability.contractVersion !== 1;
        const recoveryRevision = conversationRevision;
        const retained = previous?.scopeKey === scopeKey ? retainedContent(previous) : {};
        emit({ ...retained, scopeKey, enabled: status.enabled === true, legacy, features: legacy ? {} : capability.features,
          limits: { ...state.limits, ...(capability?.limits ?? {}) }, loading: false,
          status: status.enabled ? (legacy ? 'legacy' : 'ready') : 'disabled',
          canManage: (me.roles ?? []).some((role) => ['OWNER', 'ADMIN'].includes(String(role).replace(/^ROLE_/, ''))),
          notice: legacy ? '服务器需要升级：当前可提问，历史分页、请求恢复和性格管理暂不可用。' : '站点知识库暂未启用；设备状态仅作只读解释。' });
        if (!status.enabled) return;
        const saved = state.features.requestRecovery ? await recovery.get(scopeKey) : null;
        if (!current(ticket)) return;
        if (saved && recoveryRevision === conversationRevision)
          emit({ pending: { ...saved, state: 'PROCESSING',
            ...(previous?.pending?.clientRequestId === saved.clientRequestId ? { question: previous.pending.question } : {}) },
            conversationId: saved.conversationId, status: 'uncertain' });
        // The App can open AI before startup has resolved the authorized site.
        // Finish the visible page after that later context becomes available.
        await hydrateScreen();
      } catch (error) {
        const retained = previous?.scopeKey && ![401, 403].includes(error.status)
          ? { ...retainedContent(previous), scopeKey: previous.scopeKey, pending: previous.pending } : {};
        if (current(ticket)) emit({ ...retained, status: error.status === 401 ? (context.auth?.configured ? 'login' : 'auth_required')
          : error.status === 403 ? 'site' : 'failed',
          loading: false, error: aiErrorMessage(error) });
      }
    })();
    return initialization;
  }
  function schedulePoll(seconds = 3) {
    stopTimer();
    if (!visible() || !foreground || !state.pending || state.pending.state !== 'PROCESSING') return;
    const ticket = epoch;
    timer = scheduler.setTimeout(() => { timer = null; if (current(ticket)) void recover(); }, Math.max(3, Number(seconds) || 3) * 1000);
  }
  function startCountdown() {
    if (retryTimer !== null) scheduler.clearTimeout(retryTimer);
    if (!foreground || !visible() || state.retryAt <= now()) { retryTimer = null; return; }
    retryTimer = scheduler.setTimeout(() => { retryTimer = null; emit(); startCountdown(); }, 1000);
  }
  async function applyReply(reply, question, ticket, action) {
    if (!current(ticket, action)) return;
    if (!reply || typeof reply.answer !== 'string' || !reply.requestId || !reply.conversationId)
      throw new Error('服务器回答格式不正确，请查询原请求。');
    const messages = state.messages.filter((row) => row.turnId !== reply.requestId && !row.temporary);
    messages.push({ id: reply.requestId + ':user', turnId: reply.requestId, role: 'USER', content: question },
      { id: reply.requestId + ':assistant', turnId: reply.requestId, role: 'ASSISTANT', content: reply.answer });
    const scope = state.scopeKey;
    emit({ messages, conversationId: reply.conversationId, personaVersion: reply.personaVersion,
      pending: null, busy: false, status: state.legacy ? 'legacy' : 'ready', error: null, draft: '',
      notice: reply.contextNotice === 'HISTORY_OMITTED_OVERSIZE' ? '上一轮内容过长，本次回答未带入历史上下文；原记录仍可查看。' : state.notice });
    stopTimer();
    await recovery.remove(scope).catch(() => {});
  }
  async function send() {
    await syncContext();
    if (!aiCanSend(state)) return false;
    const ticket = epoch, action = ++operation, question = state.draft.trim(), key = keyFactory();
    const pending = { clientRequestId: key, conversationId: state.conversationId, submittedAt: now(), state: 'PROCESSING', question };
    emit({ pending, busy: true, status: 'waiting', error: null,
      messages: [...state.messages, { id: key + ':pending', role: 'USER', content: question, temporary: true }] });
    let posted = false;
    try {
      if (state.features.requestRecovery) await recovery.put(state.scopeKey, pending);
      if (!current(ticket, action)) return false;
      posted = true;
      const reply = await request((options) => api.askAi(siteId, question, pending.conversationId,
        { ...options, headers: state.features.idempotency ? { 'Idempotency-Key': key } : {} }));
      if (!current(ticket, action)) return false;
      if (reply?.state === 'PROCESSING') {
        emit({ busy: false, pending: { ...pending, ...reply }, conversationId: reply.conversationId });
        schedulePoll(reply.retryAfterSeconds);
      } else await applyReply(reply, question, ticket, action);
      return true;
    } catch (error) {
      if (!current(ticket, action)) return false;
      if ([401, 403].includes(error.status)) { await revokeAccess(error); return false; }
      if (error.status === 410) {
        const id = state.conversationId;
        await newConversation();
        if (current(ticket)) emit({ history: state.history.filter((row) => row.id !== id), error: aiErrorMessage(error) });
        return false;
      }
      if (!posted) {
        emit({ busy: false, pending: null, status: 'failed',
          messages: state.messages.filter((row) => !row.temporary),
          error: '本机恢复记录保存失败，问题尚未发送。请检查存储后重试。' });
        return false;
      }
      const rejected = [400, 401, 403, 404, 409, 410, 429].includes(error.status);
      emit({ busy: false, status: rejected ? 'failed' : 'uncertain', error: aiErrorMessage(error),
        retryAt: error.retryAfterSeconds > 0 ? now() + error.retryAfterSeconds * 1000 : state.retryAt,
        pending: rejected || state.legacy ? null : pending });
      if (rejected || state.legacy) {
        emit({ messages: state.messages.filter((row) => !row.temporary) });
        await recovery.remove(state.scopeKey).catch(() => {});
      } else schedulePoll(error.retryAfterSeconds);
      startCountdown(); return false;
    }
  }
  async function recoverOnce() {
    if (!state.pending || !state.features.requestRecovery || !foreground || !visible()) return;
    stopTimer();
    const ticket = epoch, action = operation, pending = state.pending;
    try {
      const result = await request((options) => api.getAiRequest(siteId, pending.clientRequestId, options));
      if (!current(ticket, action)) return;
      if (new Date(result.expiresAt).getTime() <= now()) throw Object.assign(new Error('恢复期限已结束。'), { status: 410 });
      if (result.state === 'SUCCEEDED') {
        await applyReply(result.result, result.question ?? pending.question ?? '', ticket, action);
        if (current(ticket, action)) await loadMessages(false);
      } else if (result.state === 'PROCESSING') {
        const step = Math.min(3, (pending.pollStep ?? 0) + 1);
        emit({ pending: { ...pending, ...result, pollStep: step }, conversationId: result.conversationId, status: 'waiting', busy: false, error: null });
        schedulePoll(Math.max(result.retryAfterSeconds ?? 3, [3, 5, 10, 30][step]));
      } else if (['FAILED', 'UNKNOWN'].includes(result.state)) {
        emit({ pending: { ...pending, ...result }, conversationId: result.conversationId, busy: false,
          status: result.state === 'UNKNOWN' ? 'uncertain' : 'failed',
          error: result.state === 'UNKNOWN' ? '本次生成结果及费用无法确认。再次提问可能重复产生费用。' : '本次请求已失败，可修改问题或明确重试。' });
      } else throw new Error('服务器任务状态不正确。');
    } catch (error) {
      if (!current(ticket, action)) return;
      if ([401, 403].includes(error.status)) { await revokeAccess(error); return; }
      if (error.status === 410) {
        emit({ pending: null, messages: [], conversationId: null, busy: false, error: aiErrorMessage(error),
          status: error.status === 401 ? 'login' : error.status === 403 ? 'site' : 'ready' });
        await recovery.remove(state.scopeKey).catch(() => {});
      } else emit({ busy: false, status: 'uncertain', error: error.status === 404
        ? '未找到请求记录，暂不能确认服务器是否已接收。请稍后查询。' : aiErrorMessage(error) });
    }
  }
  async function recover() {
    if (recoveryPromise) return recoveryPromise;
    const task = recoverOnce();
    recoveryPromise = task;
    try { return await task; } finally { if (recoveryPromise === task) recoveryPromise = null; }
  }
  async function revokeAccess(error) {
    const scope = state.scopeKey;
    operation++; conversationRevision++; stopTimer(); abort(); recoveryPromise = null; signature = null;
    emit({ ...createAiState(), status: error.status === 401 ? 'login' : 'site', error: aiErrorMessage(error) });
    await recovery.remove(scope).catch(() => {});
  }
  async function readError(error, ticket, action = null) {
    if (!current(ticket, action)) return;
    if ([401, 403].includes(error.status)) await revokeAccess(error);
    else emit({ error: aiErrorMessage(error) });
  }
  function cancelWait() { operation++; stopTimer(); abort(); recoveryPromise = null; emit({ busy: false, status: state.pending ? 'uncertain' : state.status }); }
  async function newConversation() {
    conversationRevision++; cancelWait(); const scope = state.scopeKey;
    emit({ conversationId: null, personaVersion: null, messages: [], messageCursor: null, pending: null, draft: '', error: null,
      status: state.enabled ? state.legacy ? 'legacy' : 'ready' : state.status });
    await recovery.remove(scope).catch(() => {});
  }
  async function loadHistory(more = false) {
    if (!state.features.history) return;
    const ticket = epoch, action = operation;
    emit({ loading: true, error: null });
    try {
      const page = await request((options) => api.listAiConversations(siteId, { cursor: more ? state.historyCursor : null }, options));
      if (!current(ticket, action)) return;
      const items = more ? [...state.history, ...page.items] : page.items;
      emit({ history: [...new Map(items.map((row) => [row.id, row])).values()], historyCursor: page.nextCursor });
    } catch (error) { await readError(error, ticket, action); }
    finally { if (current(ticket, action)) emit({ loading: false }); }
  }
  async function loadMessages(more = false) {
    if (!state.conversationId || !state.features.pagedMessages) return;
    if (more && state.loading) return;
    const ticket = epoch, action = operation, id = state.conversationId;
    if (more) emit({ loading: true });
    try {
      const page = await request((options) => api.listAiMessages(siteId, id, { cursor: more ? state.messageCursor : null }, options));
      if (current(ticket, action)) {
        const rows = more ? [...page.items, ...state.messages] : page.items;
        emit({ messages: [...new Map(rows.map((row) => [row.id, row])).values()], messageCursor: page.nextCursor });
      }
    } catch (error) { await readError(error, ticket, action); }
    finally { if (more && current(ticket, action)) emit({ loading: false }); }
  }
  async function selectConversation(id) {
    const ticket = epoch;
    await newConversation();
    if (!current(ticket)) return;
    emit({ conversationId: id, loading: true });
    const action = operation;
    try {
      const view = await request((options) => api.getAiConversation(siteId, id, options));
      if (!current(ticket, action)) return;
      emit({ personaVersion: view.personaVersion });
      if (state.features.pagedMessages) await loadMessages();
      else emit({ messages: view.messages });
    } catch (error) {
      if (current(ticket, action)) {
        if ([401, 403].includes(error.status)) await revokeAccess(error);
        else emit({ conversationId: null, error: aiErrorMessage(error) });
      }
    }
    finally { if (current(ticket, action)) emit({ loading: false }); }
  }
  async function deleteConversation(id) {
    const ticket = epoch;
    try {
      await request((options) => api.deleteAiConversation(siteId, id, options));
      if (!current(ticket)) return;
      if (id === state.conversationId) await newConversation();
      await loadHistory();
    } catch (error) { await readError(error, ticket); }
  }
  async function loadPersona() {
    if (!state.enabled || state.legacy) return;
    const ticket = epoch;
    try {
      const active = await request((options) => api.getAiPersona(siteId, options));
      const versions = state.canManage ? await request((options) => api.listAiPersonas(siteId, options)) : [];
      if (current(ticket)) emit({ activePersona: active, versions });
    } catch (error) { await readError(error, ticket); }
  }
  async function savePersona() {
    if (!state.canManage || state.busy || state.legacy) return;
    const draft = state.personaDraft;
    if (!draft.name.trim() || !draft.instructions.trim() || draft.name.length > state.limits.maxPersonaNameChars
      || draft.instructions.length > state.limits.maxPersonaChars) { emit({ error: '请填写符合长度限制的性格名称和指令。' }); return; }
    const ticket = epoch; emit({ busy: true, error: null });
    try {
      await request((options) => api.saveAiPersona(siteId, { ...draft, expectedVersion: Math.max(0, ...state.versions.map((row) => row.version)) }, options));
      if (current(ticket)) { await loadPersona(); emit({ notice: '新性格版本已保存，请明确启用后用于新会话。' }); }
    } catch (error) { if (current(ticket)) { await readError(error, ticket); if (error.status === 409) await loadPersona(); } }
    finally { if (current(ticket)) emit({ busy: false }); }
  }
  async function activatePersona(version) {
    if (!state.canManage || state.busy || !state.features.personaActivationGuard) return;
    const ticket = epoch; emit({ busy: true, error: null });
    try {
      await request((options) => api.activateAiPersona(siteId, version, state.activePersona?.version ?? 0, options));
      if (current(ticket)) { await loadPersona(); emit({ notice: '性格已启用，新会话生效；已有会话沿用原版本。' }); }
    } catch (error) { if (current(ticket)) { await readError(error, ticket); if (error.status === 409) await loadPersona(); } }
    finally { if (current(ticket)) emit({ busy: false }); }
  }
  async function hydrateScreen() {
    if (!visible() || !foreground || !state.enabled) return;
    screenHydration++;
    const ticket = epoch, target = screen;
    startCountdown();
    if (state.pending) await recover();
    if (!current(ticket) || screen !== target || !foreground || !state.enabled) return;
    if (target === 'ai-history') await loadHistory();
    if (!current(ticket) || screen !== target || !foreground || !state.enabled) return;
    if (target === 'ai-persona' || !state.activePersona) await loadPersona();
  }
  async function setScreen(next) {
    const was = visible(); screen = next;
    if (!visible()) { if (was) cancelWait(); return; }
    const hydration = screenHydration;
    await syncContext();
    // A new context hydrates the current screen itself. Reuse that work rather
    // than issuing another immediate GET for a still-processing request.
    if (hydration === screenHydration) await hydrateScreen();
  }
  return {
    getState: () => structuredClone(state), syncContext, reset, setScreen, send, recover, cancelWait, newConversation,
    loadHistory, loadMessages, selectConversation, deleteConversation, loadPersona, savePersona, activatePersona,
    setDraft: (draft) => emit({ draft }),
    setPersonaDraft: (field, value) => emit({ personaDraft: { ...state.personaDraft, [field]: value } }),
    async retry() {
      if (!['FAILED', 'UNKNOWN'].includes(state.pending?.state)) return;
      const question = state.pending.question ?? '';
      emit({ pending: null, draft: question, error: null }); await send();
    },
    async reload() {
      if (state.busy || state.loading) return;
      await syncContext({ force: true });
    },
    async networkChanged() {
      if (!visible() || !foreground) return;
      if (!isOnline()) { stopTimer(); emit({ status: 'offline' }); return; }
      // A live POST owns its result until it finishes. Recovery uses GET only.
      if (!state.busy && !state.loading) await syncContext({ force: true });
    },
    setForeground(value) {
      foreground = value;
      if (!value) { stopTimer(); if (retryTimer !== null) scheduler.clearTimeout(retryTimer); retryTimer = null; }
      else {
        startCountdown();
        if (visible() && ['offline', 'failed', 'unconfigured', 'disabled', 'auth_required'].includes(state.status) && !state.pending)
          void syncContext({ force: true });
        else if (visible() && (state.pending || !state.activePersona)) void hydrateScreen();
      }
    },
    destroy() { screen = 'devices'; reset(); }
  };
}
