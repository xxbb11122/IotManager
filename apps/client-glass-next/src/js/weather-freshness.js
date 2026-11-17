import { valueEqual } from './value-equality.js';

const INVALID_WEATHER = new Set(['EXPIRED', 'UNAVAILABLE']);
const unavailable = reason => ({ level: 'UNAVAILABLE', label: '不可评估', ideal: false, reason });
const millis = value => value == null ? NaN : Date.parse(value);

export function assessmentKey(weather) {
  const a = weather?.assessment, s = a?.temperatureSource;
  return JSON.stringify([weather?.siteCode, weather?.siteId, a?.evaluatedAt, a?.weatherValidUntil,
    s?.deviceId, s?.publicDeviceId, s?.field, s?.receivedAt, s?.validUntil]);
}

export function stampWeatherReceipt(weather, previous = null, receivedAt = Date.now()) {
  if (!weather?.assessment || weather.assessment.clientReceivedAt) return weather;
  const oldReceipt = assessmentKey(weather) === assessmentKey(previous) ? previous?.assessment?.clientReceivedAt : null;
  return { ...weather, assessment: { ...weather.assessment,
    clientReceivedAt: oldReceipt || new Date(receivedAt).toISOString() } };
}

export function invalidateWeather(weather, reason, { all = false } = {}) {
  if (!weather?.indicators) return weather;
  const keys = all ? ['temperature', 'humidity', 'pressure', 'esdRisk', 'condensationRisk'] : ['condensationRisk'];
  const indicators = { ...weather.indicators };
  for (const key of keys) indicators[key] = unavailable(reason);
  const result = { ...weather, indicators };
  return valueEqual(result, weather) ? weather : result;
}

export function maskUnavailableWeather(weather) {
  return INVALID_WEATHER.has(weather?.status)
    ? invalidateWeather(weather, '天气数据已过期或停用，仅保留上次读数。', { all: true }) : weather;
}

/** One timer for validity, no polling or network access. Monotonic elapsed time
 * prevents moving the phone clock backwards from extending a current reading. */
export function createWeatherFreshnessGuard(store, {
  now = () => Date.now(), monotonicNow = () => performance.now(), scheduler = globalThis,
  document = globalThis.document
} = {}) {
  let timer = null, anchor = null, updating = false, disposed = false;
  const clearTimer = () => { if (timer !== null) scheduler.clearTimeout(timer); timer = null; };
  const check = () => {
    if (disposed || updating) return;
    clearTimer();
    const weather = store.getState().weather;
    if (!weather) { anchor = null; return; }
    const assessment = weather.assessment;
    const key = assessmentKey(weather) + ':' + assessment?.clientReceivedAt;
    if (!anchor || anchor.key !== key) {
      const receipt = millis(assessment?.clientReceivedAt);
      anchor = { key, mono: monotonicNow(), wall: now(), initialElapsed: Number.isFinite(receipt) ? now() - receipt : NaN,
        receipt, server: millis(assessment?.evaluatedAt) };
    }
    const clockInvalid = Number.isFinite(anchor.receipt) && (anchor.initialElapsed < 0 || now() < anchor.wall);
    const elapsed = Math.max(anchor.initialElapsed + Math.max(0, monotonicNow() - anchor.mono), now() - anchor.receipt);
    const serverNow = anchor.server + elapsed;
    let result = maskUnavailableWeather(weather);
    const weatherUntil = millis(assessment?.weatherValidUntil);
    const sourceUntil = millis(assessment?.temperatureSource?.validUntil);
    if (clockInvalid) {
      result = invalidateWeather(result, '本机时间发生回拨，请重新读取以确认数据有效期。', { all: true });
    } else if (Number.isFinite(serverNow)) {
      if (Number.isFinite(weatherUntil) && serverNow > weatherUntil)
        result = invalidateWeather({ ...result, status: 'EXPIRED' }, '天气数据已过期，仅保留上次读数。', { all: true });
      else if (Number.isFinite(sourceUntil) && serverNow > sourceUntil)
        result = invalidateWeather(result, '温度来源已超过 5 分钟有效期，请等待新的有效遥测。');
      const deadline = Math.min(...[weatherUntil, sourceUntil].filter(value => Number.isFinite(value) && value >= serverNow));
      if (Number.isFinite(deadline))
        timer = scheduler.setTimeout(check, Math.min(2147483647, Math.max(1, Math.ceil(deadline - serverNow) + 1)));
    }
    if (result !== weather && !valueEqual(result, weather)) {
      updating = true;
      try { store.setWeather(result); } finally { updating = false; }
    }
  };
  const handleDeviceEvent = event => {
    const weather = store.getState().weather, source = weather?.assessment?.temperatureSource;
    if (!source || !['device_update', 'device_archived', 'connection_update', 'telemetry_update'].includes(event?.type)) return;
    const rows = Array.isArray(event.payload) ? event.payload : [event.payload];
    const sourceKeys = [source.deviceId, source.publicDeviceId].filter(value => value != null).map(String);
    const invalid = rows.some(row => row && [row.id, row.deviceId, row.publicId, row.databaseId]
      .some(value => value != null && sourceKeys.includes(String(value)))
      && (event.type === 'device_archived' || row.archivedAt
        || (row.status && !['ONLINE', 'WARNING', 'CONNECTED'].includes(row.status))));
    if (invalid) {
      const next = invalidateWeather(weather, '温度来源已离线或归档，等待新的有效遥测。');
      if (next !== weather) store.setWeather(next);
    }
  };
  const unsubscribe = store.subscribe(check);
  const onVisibility = () => { if (!document?.hidden) check(); };
  document?.addEventListener?.('visibilitychange', onVisibility);
  check();
  return { check, handleDeviceEvent, destroy() {
    disposed = true; clearTimer(); unsubscribe();
    document?.removeEventListener?.('visibilitychange', onVisibility);
  } };
}
