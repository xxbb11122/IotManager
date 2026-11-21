import { BLE_SETUP_KEY } from './ble-evidence.js';
import { LINK_LABELS, VALIDITY_LABELS, fieldLabel, timeValue } from './device-repair.js';

const COMMAND_LABELS = {
  PENDING: '待发送', SENT: '待确认', ACKNOWLEDGED: '已确认', UNCONFIRMED: '未确认', FAILED: '失败', REJECTED: '已拒绝'
};
const RESULT_LABELS = { RECOVERED: '已恢复', STILL_FAULTY: '仍异常', NOT_VERIFIED: '未验证' };
const CONFIDENCE_LABELS = { CONFIRMED: '已确认的现象', NEEDS_CHECK: '原因待核对', INSUFFICIENT: '证据不足' };
function node(tag, className, text) {
  const value = document.createElement(tag);
  value.className = className;
  if (text !== undefined) value.textContent = String(text);
  return value;
}
function button(label, action, { id, field, disabled = false } = {}) {
  const value = node('button', 'button button--small button--secondary', label);
  value.type = 'button';
  value.disabled = disabled;
  value.dataset.action = action;
  if (id != null) value.dataset.aiId = id;
  if (field != null) value.dataset.aiField = field;
  return value;
}
const when = (value) => Number.isFinite(timeValue(value)) ? new Date(timeValue(value)).toLocaleString() : '未知';
const scalar = (value) => value === true ? '开' : value === false ? '关' : String(value);
const commandLabel = (value) => COMMAND_LABELS[value] ?? '状态未知';

function deviceCard(device, busy) {
  const article = node('article', 'assessment-device');
  article.dataset.key = device.key;
  article.append(node('h4', 'assessment-title', device.name ?? '未命名设备'));
  article.append(node('p', 'ai-caption', [
    device.demo ? '演示站点' : device.source === 'MOBILE_BLE' ? '本机 BLE' : device.source === 'EDGE_AGENT' ? 'Edge Agent' : '平台',
    device.cached ? '上次记录 · 当前未知' : LINK_LABELS[device.linkState] ?? '状态未知',
    device.profileId, device.firmwareVersion ? '固件 ' + device.firmwareVersion : null
  ].filter(Boolean).join(' · ')));
  article.append(node('p', 'ai-caption', (device.source === 'MOBILE_BLE' ? '连接观测：' : '设备通信：')
    + when(device.lastCommunicationAt) + '；状态读取：' + when(device.asOf)));
  if (device.links?.length) {
    for (const link of device.links) article.append(node('p', 'ai-caption',
      link.transport + ' · 设备连接报告 ' + link.reportedStatus + (link.transport === 'LAN_AGENT'
        ? ' · 代理 ' + link.agentStatus + '（非设备状态）' : '')));
  }
  if (device.command) article.append(node('p', 'ai-caption', '最近命令：' + commandLabel(device.command.state)
    + ' · ' + when(device.command.completedAt ?? device.command.requestedAt)));
  if (device.fields?.length) {
    const fields = node('ul', 'assessment-fields');
    for (const metric of device.fields) {
      const reading = metric.samples?.[0];
      const row = node('li', 'assessment-field');
      row.dataset.key = metric.key;
      const validity = device.cached ? '缓存' : VALIDITY_LABELS[metric.validity] ?? '状态未知';
      row.append(node('span', '', fieldLabel(metric.key) + '：'
        + (reading ? scalar(reading.value) + (metric.unit ? ' ' + metric.unit : '') : '—') + ' · ' + validity));
      if (reading) row.append(node('small', 'ai-caption', reading.source === 'BLE_ACK'
        ? '本机回执 ' + when(reading.receivedAt)
        : '采样 ' + when(reading.observedAt) + ' · 接收 ' + when(reading.receivedAt) + ' · ' + reading.source));
      if (!device.cached && ['STALE', 'NO_SAMPLE'].includes(metric.validity))
        row.append(button('排查此项', 'ai-assessment-diagnose', { id: device.key, field: metric.key, disabled: busy }));
      fields.append(row);
    }
    article.append(fields);
  } else article.append(node('p', 'ai-caption', '没有可核实的字段样本。'));
  if (!device.cached) article.append(button('排查与解决', 'ai-assessment-diagnose', { id: device.key, disabled: busy }));
  return article;
}

function repairCard(plan, result, ai, busy) {
  const article = node('article', 'assessment-plan');
  article.dataset.region = 'device-repair-plan';
  article.dataset.key = 'repair:' + plan.key + ':' + (plan.field ?? plan.issue);
  article.append(node('h3', 'assessment-title', plan.name + '：' + plan.title),
    node('p', 'ai-caption', (CONFIDENCE_LABELS[plan.confidence] ?? '待核对') + ' · ' + when(plan.asOf)));
  if (plan.sampleAt) article.append(node('p', 'ai-caption', '最近样本时间：' + when(plan.sampleAt)));
  else if (plan.lastCommunicationAt) article.append(node('p', 'ai-caption', '最近通信或连接观测：' + when(plan.lastCommunicationAt)));
  if (plan.demo) article.append(node('p', 'ai-notice', '这是演示记录，不能用于确认现场设备已恢复。'));
  const evidence = node('ul', 'assessment-steps');
  for (const line of plan.evidence) evidence.append(node('li', '', line));
  article.append(evidence, node('h4', 'assessment-title', '修复步骤'));
  const steps = node('ol', 'assessment-steps');
  for (const step of plan.steps) steps.append(node('li', '', step.actor + '：' + step.instruction));
  article.append(steps, node('p', 'ai-caption', '恢复判据：' + plan.check), node('p', 'ai-caption', '失败后：' + plan.escalation));
  const actions = node('div', 'ai-actions');
  actions.append(button('重新验证', 'ai-assessment-verify', { disabled: busy || plan.demo || plan.verification === 'NONE' }));
  if (!plan.demo && ai?.features?.deviceDiagnosis)
    actions.append(button('用 AI 细化方案', 'ai-assessment-explain', {
      disabled: busy || !ai.enabled || ai.busy || ai.loading || Boolean(ai.pending) || ai.status === 'offline'
    }));
  article.append(actions);
  if (result) {
    const status = node('p', 'ai-notice', (RESULT_LABELS[result.state] ?? '未验证') + '：' + result.message);
    status.setAttribute('role', 'status');
    article.append(status);
  }
  return article;
}

export function buildDeviceAssessmentView(state, ai) {
  const root = node('section', 'ai-device-assessment');
  root.dataset.region = 'device-assessment';
  root.setAttribute('aria-label', '设备状态与排查');
  const busy = Boolean(state?.busy);
  const actions = node('div', 'ai-actions');
  actions.append(button(state?.opened ? '重新核对全部状态' : '查看全部设备状态', 'ai-assessment-overview', { disabled: busy }));
  root.append(actions);
  if (!state?.opened) return root;
  root.append(node('p', 'ai-caption', '以下为按需读取的快照。刷新显示不会生成新数据，Profile 也不等于现场安装记录。'));
  if (busy) {
    const status = node('p', 'ai-caption', '正在按需读取，未启动设备扫描或定时刷新。');
    status.setAttribute('role', 'status');
    root.append(status);
  }
  if (state.notice) root.append(node('p', 'ai-notice', state.notice));
  if (state.plan) root.append(repairCard(state.plan, state.result, ai, busy));
  if (state.platform) {
    const { platform } = state;
    const group = node('section', 'assessment-group');
    group.dataset.key = 'platform';
    const demoRows = platform.items.filter((row) => row.demo);
    const rows = platform.items.filter((row) => !row.demo);
    group.append(node('h3', 'assessment-title', '平台设备'),
      node('p', 'ai-caption', (platform.cached ? '已缓存 ' + platform.items.length + ' 条' :
        '总数 ' + (platform.total - (platform.demoTotal ?? 0)) + ' · 已列出 ' + rows.length
        + ' · 近期有通信 ' + (platform.links?.RECENT ?? 0) + ' · 超期未见 ' + (platform.links?.NOT_SEEN ?? 0)
        + ' · 未知 ' + (platform.links?.UNKNOWN ?? 0)) + ' · ' + when(platform.asOf)));
    rows.forEach((row) => group.append(deviceCard(row, busy)));
    if (demoRows.length || platform.demoTotal) {
      group.append(node('h4', 'assessment-title', '演示或未核验来源（不计入实物）'));
      demoRows.forEach((row) => group.append(deviceCard(row, busy)));
    }
    if (platform.nextCursor) group.append(button('查看下一页设备', 'ai-assessment-more', { disabled: busy }));
    root.append(group);
  }
  if (state.local) {
    const group = node('section', 'assessment-group');
    group.dataset.key = 'mobile-ble';
    const connected = state.local.items.filter((row) => row.linkState === 'CONNECTED').length;
    group.append(node('h3', 'assessment-title', '本机 BLE'),
      node('p', 'ai-caption', '已核验连接 ' + connected + ' · 本机记录 ' + state.local.items.length
        + ' · ' + when(state.local.asOf) + '。未扫入附近其他设备。'));
    if (state.local.setup && !connected)
      group.append(button('排查蓝牙连接', 'ai-assessment-diagnose', { id: BLE_SETUP_KEY, disabled: busy }));
    state.local.items.forEach((row) => group.append(deviceCard(row, busy)));
    root.append(group);
  }
  return root;
}
