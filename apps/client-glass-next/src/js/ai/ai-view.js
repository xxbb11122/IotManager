import { createAiState, aiCanSend } from './ai-state.js';
import { addGlassSurface } from '../appearance/glass-surfaces.js';

function node(tag, className, text) {
  const value = document.createElement(tag);
  value.className = className;
  if (text !== undefined) value.textContent = String(text);
  return addGlassSurface(value);
}
function button(label, action, { id, screen, disabled = false, primary = false } = {}) {
  const value = node('button', 'button button--small ' + (primary ? 'button--primary' : 'button--secondary'), label);
  value.type = 'button'; value.dataset.action = action; value.disabled = disabled;
  if (id !== undefined) value.dataset.aiId = String(id);
  if (screen) { value.dataset.screen = screen; value.dataset.motion = 'push'; }
  return value;
}
function field(label, name, value, maxLength, multiline = true) {
  const wrap = node('label', 'ai-field');
  wrap.append(node('span', 'ai-field-label', label));
  const input = node(multiline ? 'textarea' : 'input', 'ai-input');
  input.id = name; input.dataset.field = name; input.value = value; input.maxLength = maxLength;
  if (multiline) input.rows = name === 'ai-question' ? 3 : 8;
  wrap.append(input, node('span', 'ai-count', value.length + ' / ' + maxLength + ' 字符'));
  return wrap;
}
function notice(parent, text, danger = false) {
  if (!text) return;
  const value = node('p', 'ai-notice' + (danger ? ' ai-notice--error' : ''), text);
  value.setAttribute('role', danger ? 'alert' : 'status'); parent.append(value);
}
function unavailable(parent, state) {
  const text = { login: '登录后可使用当前站点的 AI。', site: '请选择账号有权访问的站点。',
    unconfigured: '请先配置服务器连接。', offline: '当前网络不可用，联网后可继续查询。',
    auth_required: '服务器要求登录。请先在连接设置中填写登录服务、客户端 ID 和回调地址，再登录账号。',
    disabled: '服务器尚未启用 AI，启用后可重新检查。', loading: '正在核验账号及服务器 AI 功能。',
    failed: '连接未完成，请检查服务器与登录状态。' }[state.status];
  if (text) notice(parent, text);
  const actions = node('div', 'ai-actions');
  if (state.status === 'login') actions.append(button('登录', 'sign-in'));
  if (['site', 'unconfigured', 'failed', 'offline', 'auth_required', 'disabled', 'login'].includes(state.status))
    actions.append(button('连接设置', 'navigate', { screen: 'connections' }), button('重新检查', 'ai-reload', { disabled: state.loading }));
  if (state.status === 'site') actions.append(button('选择站点', 'navigate', { screen: 'sites' }));
  parent.append(actions);
}

export function buildAiView(value, { screen = 'ai' } = {}) {
  const state = value ?? createAiState();
  const root = node('div', 'ai-workspace'); root.dataset.region = 'ai-content';
  const header = node('header', 'ai-header');
  header.append(node('h2', 'ai-title', screen === 'ai-history' ? 'AI 会话历史' : screen === 'ai-persona' ? 'AI 性格' : 'AI 助手'));
  const actions = node('div', 'ai-actions');
  if (screen !== 'ai') actions.append(button('返回聊天', 'navigate', { screen: 'ai' }));
  else actions.append(button('历史', 'navigate', { screen: 'ai-history', disabled: !state.features.history }),
    button('性格', 'navigate', { screen: 'ai-persona', disabled: !state.enabled || state.legacy }),
    button('新会话', 'ai-new', { disabled: !state.enabled }),
    button('检查连接', 'ai-reload', { disabled: state.busy || state.loading }));
  header.append(actions); root.append(header);
  notice(root, state.error, true); notice(root, state.notice);
  if (!state.enabled || ['offline', 'auth_required', 'login', 'site', 'unconfigured'].includes(state.status)) {
    unavailable(root, state); return root;
  }
  if (screen === 'ai-history') { buildHistory(root, state); return root; }
  if (screen === 'ai-persona') { buildPersona(root, state); return root; }
  const persona = state.conversationId ? (state.personaVersion == null || state.personaVersion === 0 ? '默认性格' : '性格版本 ' + state.personaVersion)
    : (state.activePersona?.name ?? '默认性格');
  root.append(node('p', 'ai-caption', (state.conversationId ? '本会话固定使用：' : '新会话将使用：') + persona));
  if (state.messageCursor) root.append(button('查看更早消息', 'ai-messages-more', { disabled: state.loading }));
  const log = node('div', 'ai-messages'); log.dataset.region = 'ai-messages';
  log.setAttribute('role', 'log'); log.setAttribute('aria-label', '聊天消息'); log.setAttribute('aria-live', 'polite');
  if (!state.messages.length) log.append(node('p', 'ai-empty', '可以问一个通用问题，或请 AI 解释已认领设备的状态。'));
  for (const row of state.messages) {
    const article = node('article', 'ai-message ' + (row.role === 'USER' ? 'ai-message--user' : 'ai-message--assistant'));
    article.dataset.key = row.id;
    article.append(node('strong', 'ai-message-role', row.role === 'USER' ? '我' : 'AI'), node('p', 'ai-message-text', row.content));
    if (row.temporary) article.append(node('small', 'ai-caption', '等待服务器确认'));
    else if (row.role === 'ASSISTANT') article.append(button('复制回答', 'ai-copy', { id: row.id }));
    log.append(article);
  }
  root.append(log);
  if (state.pending) {
    const pending = node('div', 'ai-pending');
    pending.append(node('p', 'ai-caption', '请求编号：' + state.pending.clientRequestId));
    if (['FAILED', 'UNKNOWN'].includes(state.pending.state)) pending.append(button('明确重试', 'ai-retry', { disabled: state.busy }));
    else if (state.features.requestRecovery) pending.append(button('查询本次结果', 'ai-recover', { disabled: state.busy }));
    if (state.busy || state.status === 'waiting') pending.append(button('停止本地等待', 'ai-cancel'));
    notice(pending, '停止等待不会取消服务器生成；查询结果不会再次发送问题。'); root.append(pending);
  }
  if (state.retryAt > state.now) notice(root, '请等待 ' + Math.ceil((state.retryAt - state.now) / 1000) + ' 秒后再提问。');
  const composer = buildCrystalComposer(state);
  root.append(composer); return root;
}
function buildHistory(root, state) {
  if (!state.features.history) { notice(root, '当前服务器暂不支持会话历史。'); return; }
  if (state.loading) notice(root, '正在读取会话。');
  if (!state.history.length && !state.loading) notice(root, '暂无会话。');
  for (const row of state.history) {
    const item = node('article', 'ai-history-item'); item.dataset.key = row.id;
    const text = node('div', 'ai-history-text');
    text.append(node('h3', 'ai-history-title', row.title || 'AI 会话'),
      node('small', 'ai-caption', new Date(row.updatedAt).toLocaleString()));
    item.append(text, button('打开', 'ai-select', { id: row.id, disabled: state.loading }),
      button('删除', 'ai-delete', { id: row.id, disabled: state.loading })); root.append(item);
  }
  if (state.historyCursor) root.append(button('更多会话', 'ai-history-more', { disabled: state.loading }));
}
function buildPersona(root, state) {
  if (state.legacy) { notice(root, '请先升级服务器再管理性格。'); return; }
  const active = state.activePersona;
  root.append(node('h3', 'ai-subtitle', '当前启用：' + (active?.name ?? '默认性格')));
  if (active?.instructions) root.append(node('p', 'ai-persona-text', active.instructions));
  notice(root, '性格启用后用于新会话，已有会话沿用创建时的版本。');
  if (!state.canManage) { notice(root, '性格由组织所有者或管理员管理。'); return; }
  root.append(field('性格名称', 'ai-persona-name', state.personaDraft.name, state.limits.maxPersonaNameChars, false),
    field('性格指令', 'ai-persona-instructions', state.personaDraft.instructions, state.limits.maxPersonaChars),
    button('保存新版本', 'ai-persona-save', { primary: true, disabled: state.busy || !state.personaDraft.name.trim() || !state.personaDraft.instructions.trim() }));
  root.append(node('h3', 'ai-subtitle', '已保存版本'));
  for (const row of state.versions) {
    const item = node('article', 'ai-history-item'); item.dataset.key = 'persona:' + row.version;
    item.append(node('p', 'ai-history-text', row.name + ' · 版本 ' + row.version),
      button(active?.version === row.version ? '已启用' : '启用', 'ai-persona-activate',
        { id: row.version, disabled: state.busy || active?.version === row.version || !state.features.personaActivationGuard }));
    root.append(item);
  }
}

import { AI_QUICK_PROMPTS, resolveAiQuickPrompt } from './ai-quick-prompts.js';

function buildCrystalComposer(state) {
  const composer = node('div', 'ai-composer ai-composer--crystal');
  composer.classList.toggle('ai-composer--busy', Boolean(state.busy));
  const chips = node('div', 'ai-quick-chips');
  chips.dataset.region = 'ai-quick-prompts';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', '快捷提问，仅填写草稿');
  for (const item of AI_QUICK_PROMPTS) {
    const chip = button(item.label, 'ai-quick-prompt', {
      id: item.id, disabled: !resolveAiQuickPrompt(state, item.id)
    });
    chip.classList.add('ai-chip');
    chips.append(chip);
  }
  composer.append(chips, field('问题', 'ai-question', state.draft, state.limits.maxQuestionChars),
    button(state.busy ? '等待回答…' : '发送', 'ai-send', {
      primary: true, disabled: !aiCanSend(state)
    }));
  return composer;
}
