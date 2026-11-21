import { BLE_SETUP_KEY } from './ble-evidence.js';
import { makeRepairPlan, verifyRepair } from './device-repair.js';

const empty = () => ({ opened: false, busy: null, platform: null, local: null, plan: null, result: null, notice: null });
const platformRow = (value) => ({ ...value, key: 'site:' + value.publicId });
const publicId = (key) => key.startsWith('site:') ? key.slice(5) : null;
const gone = (error) => [401, 403].includes(error?.status);
const emptyLocal = { items: [], setup: null, asOf: null };

function withCache(value) {
  if (!value) return null;
  return { ...value, cached: true, nextCursor: null,
    items: (value.items ?? []).map((row) => ({ ...row, cached: true, linkState: 'UNKNOWN' })) };
}

/** No effects or timers run on render/screen entry. Each action owns at most one in-flight read per source. */
export function createDeviceAssessmentController({
  contextProvider, observeBle, onChange = () => {}, scheduler = globalThis, timeoutMs = 9_000
}) {
  let state = empty(), revision = 0, scope = null;
  const pending = new Set();
  const emit = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  function reset({ notify = true } = {}) {
    revision++;
    for (const controller of pending) controller.abort();
    pending.clear();
    scope = null;
    state = empty();
    if (notify) onChange(state);
  }
  async function once(operation) {
    const controller = new AbortController();
    pending.add(controller);
    let timer;
    const cutoff = new Promise((_, reject) => {
      timer = scheduler.setTimeout(() => controller.abort(), timeoutMs);
      controller.signal.addEventListener('abort', () => reject(new Error('设备状态读取已停止或超时')), { once: true });
    });
    try { return await Promise.race([operation({ signal: controller.signal }), cutoff]); }
    finally { scheduler.clearTimeout(timer); pending.delete(controller); }
  }
  function begin(task) {
    const context = contextProvider();
    if (scope !== context.scopeKey) reset();
    if (state.busy) return null;
    scope = context.scopeKey;
    const ticket = ++revision;
    emit({ opened: true, busy: task, notice: null });
    return { ...context, ticket };
  }
  function current(context) {
    return context.ticket === revision && context.scopeKey === contextProvider().scopeKey;
  }
  async function load(more = false) {
    if (more && scope !== contextProvider().scopeKey) return false;
    const cursor = state.platform?.nextCursor;
    if (more && !cursor) return false;
    const context = begin(more ? 'more' : 'overview');
    if (!context) return false;
    const api = context.api;
    const activeSite = Number.isSafeInteger(Number(context.siteId)) && Number(context.siteId) > 0;
    const platform = api && activeSite
      ? once((options) => api.getDeviceStatusOverview(context.siteId, { cursor: more ? cursor : null }, options))
      : Promise.resolve(null);
    const local = more ? Promise.resolve(state.local) : once(() => observeBle());
    const [result, ble] = await Promise.allSettled([platform, local]);
    if (!current(context)) return false;
    let platformView = null;
    const notes = [];
    if (result.status === 'fulfilled' && result.value
        && String(result.value.siteId) === String(context.siteId) && Array.isArray(result.value.items)) {
      const page = result.value;
      const previous = more ? state.platform?.items ?? [] : [];
      const unique = new Map([...previous, ...page.items.map(platformRow)].map((row) => [row.key, row]));
      platformView = { ...page, items: [...unique.values()], cached: false };
    } else if (more && !gone(result.reason)) {
      platformView = state.platform;
      notes.push('下一页未读取成功，可手动重试。已显示的页仍标注原观测时间。');
    } else if (gone(result.reason)) {
      notes.push('当前站点权限已失效，已清除该站点设备状态。');
    } else {
      platformView = activeSite ? withCache(state.platform ?? (typeof context.cachedPlatform === 'function'
        ? context.cachedPlatform() : context.cachedPlatform)) : null;
      if (result.reason?.status === 404) notes.push('找不到站点状态接口；请核对站点或升级后端。');
      else if (platformView) notes.push('平台未取得本次数据，只显示上次记录。');
      else notes.push('未取得平台状态；可先核对登录、站点和服务器连接。');
    }
    if (ble.status === 'rejected') notes.push('本次未取得 BLE 核验结果。');
    emit({ platform: platformView, local: ble.status === 'fulfilled' ? (ble.value ?? emptyLocal) : emptyLocal,
      busy: null, plan: more && !gone(result.reason) ? state.plan : null,
      result: more && !gone(result.reason) ? state.result : null, notice: notes.join(' ') || null });
    return true;
  }
  function find(key) {
    return state.platform?.items?.find((row) => row.key === key)
      ?? state.local?.items?.find((row) => row.key === key)
      ?? (key === BLE_SETUP_KEY ? state.local?.setup : null);
  }
  async function readTarget(context, key, { commandId = null, readField = null } = {}) {
    const id = publicId(key);
    if (id !== null) {
      if (!context.api || !context.siteId) return null;
      const value = await once((options) => context.api.getDeviceStatusEvidence(context.siteId, id, { commandId }, options));
      return value?.publicId === id ? platformRow(value) : null;
    }
    const local = await once(() => observeBle({ targetKey: key, readField }));
    if (key === BLE_SETUP_KEY) return local?.setup;
    return local?.items?.find((row) => row.key === key) ?? null;
  }
  async function diagnose(key, field = null) {
    if (typeof key !== 'string' || !find(key) || state.busy || scope !== contextProvider().scopeKey) return false;
    const context = begin('diagnose');
    if (!context) return false;
    const initial = find(key);
    try {
      if (!initial) return false;
      const device = await readTarget(context, key);
      if (!current(context)) return false;
      if (!device) throw new Error('Evidence unavailable');
      // Only a field that is part of the confirmed device projection can drive a verifier.
      const selected = device.fields?.some((entry) => entry.key === field) ? field : null;
      const plan = makeRepairPlan(device, selected);
      const metric = device.fields?.find((entry) => entry.key === plan.field);
      const sample = metric?.samples?.[0];
      emit({ plan: { ...plan, sampleAt: sample?.observedAt ?? null, lastCommunicationAt: device.lastCommunicationAt ?? null, observation: {
        capturedAt: device.asOf, linkState: device.linkState, hasProfile: Boolean(device.profileId),
        hasReading: Boolean(sample && sample.source !== 'BLE_ACK'), errorCode: device.errorCode ?? null,
        commandState: device.command?.state ?? null
      } }, result: null });
      return true;
    } catch (error) {
      if (!current(context)) return false;
      if (gone(error)) emit({ platform: null, plan: null, result: null, notice: '当前站点权限已失效。' });
      else emit({ plan: null, result: null, notice: '未取得该设备的新证据，不能按旧记录给出现场结论。' });
      return false;
    } finally {
      if (current(context)) emit({ busy: null });
    }
  }
  async function verify() {
    const plan = state.plan;
    if (!plan || state.busy || plan.demo || plan.verification === 'NONE' || scope !== contextProvider().scopeKey) return false;
    const context = begin('verify');
    if (!context) return false;
    try {
      const latest = await readTarget(context, plan.key, { commandId: plan.commandId,
        readField: plan.verification === 'BLE_FIELD' ? plan.field : null });
      if (!current(context)) return false;
      emit({ result: verifyRepair(plan, latest) });
      return true;
    } catch (error) {
      if (!current(context)) return false;
      if (gone(error)) emit({ platform: null, plan: null, result: null, notice: '当前站点权限已失效。' });
      else emit({ result: { state: 'NOT_VERIFIED', message: '本次未能读取新证据。没有重发命令或自动刷新。' } });
      return false;
    } finally {
      if (current(context)) emit({ busy: null });
    }
  }
  function explanation() {
    const plan = state.plan;
    if (!plan || plan.demo || state.busy || scope !== contextProvider().scopeKey) return null;
    return plan.source === 'MOBILE_BLE'
      ? { version: 1, source: plan.source, issue: plan.issue, field: plan.field, observation: {
        ...plan.observation, capturedAt: new Date(plan.observation.capturedAt).toISOString()
      } }
      : { version: 1, source: 'PLATFORM', issue: plan.issue, publicId: publicId(plan.key), field: plan.field };
  }
  return { getState: () => scope !== null && scope !== contextProvider().scopeKey ? empty() : state,
    load, diagnose, verify, explanation, reset };
}
