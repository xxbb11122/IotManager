export const AI_LIMITS = Object.freeze({
  maxQuestionChars: 2000, maxPersonaChars: 4000, maxPersonaNameChars: 80,
  maxPageSize: 100, recoveryWindowSeconds: 86400
});

export function createAiState() {
  return {
    status: 'unconfigured', enabled: false, legacy: false, loading: false, busy: false,
    error: null, notice: null, scopeKey: '', limits: { ...AI_LIMITS }, features: {},
    conversationId: null, personaVersion: null, draft: '', messages: [], pending: null,
    history: [], historyCursor: null, messageCursor: null,
    activePersona: null, versions: [], personaDraft: { name: '', instructions: '' },
    canManage: false, retryAt: 0, now: Date.now()
  };
}

export function aiScopeKey({ apiBaseUrl, issuer, clientId, subject, organization, siteId }) {
  const base = String(apiBaseUrl ?? '').replace(/\/+$/, '');
  return JSON.stringify([base, issuer ?? '', clientId ?? '', subject, organization ?? '', String(siteId)]);
}

export function aiCanSend(state) {
  return state.enabled && !state.busy && !state.loading && !state.pending
    && !['unconfigured', 'auth_required', 'login', 'site', 'offline', 'disabled'].includes(state.status)
    && state.draft.trim().length > 0 && state.draft.length <= state.limits.maxQuestionChars
    && state.retryAt <= state.now;
}

export function aiErrorMessage(error) {
  const code = error?.problem?.fieldErrors?.code ?? error?.code;
  if (code === 'CONVERSATION_BUSY') return '本会话正在另一台设备上生成回答，请稍后查询历史。';
  if (code === 'IDEMPOTENCY_CONFLICT') return '请求标识与问题不一致，请新建会话后提问。';
  if (code === 'PERSONA_VERSION_CONFLICT') return '性格版本已被其他管理员修改，请核对重新加载的版本。';
  if (code === 'INPUT_BUDGET_EXCEEDED') return '本次问题与性格等内容超过上下文容量，请缩短后重试。';
  if (error?.status === 401) return '登录已失效，请重新登录。';
  if (error?.status === 403) return '当前账号已无权访问此站点，请重新选择授权站点。';
  if (error?.status === 410) return '会话或请求已删除或过期，请新建会话继续。';
  if (error?.status === 429) return '请求达到限流或站点今日额度，请按提示等待。';
  if ([502, 503, 504].includes(error?.status)) return 'AI 服务暂时无法完成请求，可查询本次结果。';
  return error?.message || '连接暂不可用，请检查网络并查询本次结果。';
}

/** Preferences contains bounded IDs and timestamps only, never prompts or replies. */
export function createAiRecoveryStore(storage, now = () => Date.now()) {
  const key = 'iot-manager.ai-recovery.v1';
  let queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  async function read() {
    const value = await storage.get({ key });
    try {
      const rows = JSON.parse(value?.value ?? '{}');
      if (!rows || Array.isArray(rows) || typeof rows !== 'object') return {};
      return Object.fromEntries(Object.entries(rows).filter(([, row]) =>
        row && Number.isFinite(row.submittedAt) && now() - row.submittedAt >= 0
        && now() - row.submittedAt <= 86400000 && typeof row.clientRequestId === 'string'));
    } catch { return {}; }
  }
  return {
    get: (scope) => serial(async () => (await read())[scope] ?? null),
    put: (scope, value) => serial(async () => {
      const rows = await read();
      rows[scope] = { clientRequestId: value.clientRequestId, conversationId: value.conversationId ?? null, submittedAt: value.submittedAt };
      const bounded = Object.fromEntries(Object.entries(rows).sort((a, b) => b[1].submittedAt - a[1].submittedAt).slice(0, 20));
      await storage.set({ key, value: JSON.stringify(bounded) });
    }),
    remove: (scope) => serial(async () => { const rows = await read(); delete rows[scope]; await storage.set({ key, value: JSON.stringify(rows) }); }),
    clear: () => serial(() => storage.remove({ key }))
  };
}
