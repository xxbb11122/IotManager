import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientStore } from '../src/js/store.js';
import { createWeatherFreshnessGuard, maskUnavailableWeather } from '../src/js/weather-freshness.js';

function fixture() {
  const start = Date.parse('2026-11-17T00:00:00Z');
  let wall = start, mono = 0;
  const timers = new Set();
  const store = createClientStore();
  const scheduler = { setTimeout(callback, delay) { const task = { callback, delay }; timers.add(task); return task; }, clearTimeout(task) { timers.delete(task); } };
  const guard = createWeatherFreshnessGuard(store, { now: () => wall, monotonicNow: () => mono, scheduler, document: null });
  const indicator = { level: 'SUITABLE', label: '适宜', ideal: true, reason: 'test' };
  const fresh = { siteCode: 'test-site', status: 'FRESH', current: { temperatureC: 24 }, indicators: {
    temperature: indicator, humidity: indicator, pressure: indicator, esdRisk: indicator, condensationRisk: indicator },
    assessment: { evaluatedAt: new Date(start).toISOString(), clientReceivedAt: new Date(start).toISOString(),
      weatherValidUntil: new Date(start + 6 * 3600000).toISOString(),
      temperatureSource: { deviceId: 8, publicDeviceId: 'sensor-8', field: 'temperature',
        receivedAt: new Date(start).toISOString(), validUntil: new Date(start + 300000).toISOString() } } };
  store.setWeather(fresh);
  return { store, guard, fresh, timers, advance(ms) { wall += ms; mono += ms; guard.check(); }, rollback() { wall -= 1000; guard.check(); } };
}
test('expired and disabled weather have no current green/red/yellow conclusions but preserve historical values', () => {
  const f = fixture();
  for (const status of ['EXPIRED', 'UNAVAILABLE']) {
    const masked = maskUnavailableWeather({ ...f.fresh, status });
    assert.equal(masked.current.temperatureC, 24);
    for (const indicator of Object.values(masked.indicators)) assert.equal(indicator.level, 'UNAVAILABLE');
  }
  f.guard.destroy();
});
test('exactly 300 seconds remains valid; 300 seconds plus 1 ms expires locally with zero network calls', () => {
  const f = fixture();
  f.advance(300000);
  assert.equal(f.store.getState().weather.indicators.condensationRisk.level, 'SUITABLE');
  f.advance(1);
  assert.equal(f.store.getState().weather.indicators.condensationRisk.level, 'UNAVAILABLE');
  assert.equal(f.store.getState().weather.indicators.temperature.level, 'SUITABLE');
  assert.ok(f.timers.size <= 1);
  f.guard.destroy(); assert.equal(f.timers.size, 0);
});
test('source offline and archive events invalidate immediately, unrelated and duplicate events are suppressed', () => {
  const f = fixture();
  const before = f.store.diagnostics().publications;
  for (let i = 0; i < 1000; i++) f.guard.handleDeviceEvent({ type: 'device_update', payload: { id: 99, status: 'OFFLINE' } });
  assert.equal(f.store.diagnostics().publications, before);
  f.guard.handleDeviceEvent({ type: 'device_update', payload: { deviceId: 'sensor-8', status: 'OFFLINE' } });
  assert.equal(f.store.getState().weather.indicators.condensationRisk.level, 'UNAVAILABLE');
  const after = f.store.diagnostics().publications;
  f.guard.handleDeviceEvent({ type: 'device_update', payload: { deviceId: 'sensor-8', status: 'OFFLINE' } });
  assert.equal(f.store.diagnostics().publications, after);
  f.store.setWeather(f.fresh);
  f.guard.handleDeviceEvent({ type: 'device_archived', payload: { id: 8 } });
  assert.equal(f.store.getState().weather.indicators.condensationRisk.level, 'UNAVAILABLE');
  f.guard.destroy();
});
test('weather itself expires without another API call and moving the phone clock backwards cannot extend validity', () => {
  const f = fixture(); f.advance(6 * 3600000 + 1);
  assert.equal(f.store.getState().weather.status, 'EXPIRED');
  for (const indicator of Object.values(f.store.getState().weather.indicators)) assert.equal(indicator.level, 'UNAVAILABLE');
  f.guard.destroy();
  const g = fixture(); g.rollback();
  assert.equal(g.store.getState().weather.indicators.condensationRisk.level, 'UNAVAILABLE');
  g.guard.destroy();
});
test('an authoritative fresh reading can restore a conclusion after local expiry', () => {
  const f = fixture(); f.advance(301000);
  const at = new Date(Date.parse(f.fresh.assessment.evaluatedAt) + 301000).toISOString();
  f.store.setWeather({ ...f.fresh, assessment: { ...f.fresh.assessment, evaluatedAt: at, clientReceivedAt: at,
    temperatureSource: { ...f.fresh.assessment.temperatureSource, receivedAt: at,
      validUntil: new Date(Date.parse(at) + 300000).toISOString() } } });
  assert.equal(f.store.getState().weather.indicators.condensationRisk.level, 'SUITABLE');
  f.guard.destroy();
});
