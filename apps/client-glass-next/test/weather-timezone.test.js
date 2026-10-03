import assert from 'node:assert/strict';
import test from 'node:test';
import { browserWeatherTimezone, normalizeWeatherTimezone } from '../src/js/platform/weather-timezone.js';

test('normalizes Android zero-offset timezone aliases to the Open-Meteo-safe UTC identifier', () => {
  for (const value of ['Z', '+00:00', '-00:00', '+0000', '-0000']) {
    assert.equal(normalizeWeatherTimezone(value), 'UTC');
  }
  assert.equal(normalizeWeatherTimezone('Asia/Shanghai'), 'Asia/Shanghai');
});

test('uses the browser timezone when valid and a safe default when unavailable', () => {
  assert.equal(browserWeatherTimezone(() => '+00:00'), 'UTC');
  assert.equal(browserWeatherTimezone(() => 'Asia/Shanghai'), 'Asia/Shanghai');
  assert.equal(browserWeatherTimezone(() => ''), 'Asia/Shanghai');
  assert.equal(browserWeatherTimezone(() => { throw new Error('unavailable'); }), 'Asia/Shanghai');
});
