import {test, expect} from '../../apps/client-glass-next/node_modules/@playwright/test/index.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {materialHarness} from '../../apps/client-glass-next/e2e/helpers/material-harness.js';
import {syntheticDevice} from '../../apps/client-glass-next/src/dev/motion-preview/fixtures.js';

const probe = JSON.parse(readFileSync(new URL('weather-probe.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));

// Diagnostic reproductions deliberately assert the observed defect. They are
// evidence of the bug, NOT acceptance assertions for correct behaviour.
for (const scenario of ['expiredWeather', 'disabledWeather']) {
  test(`reproduction: ${scenario} retains suitable header/risk colours`, async ({page}) => {
    await materialHarness(page, {screen: 'weather'});
    await page.evaluate(weather => {
      const {model, ui} = window.materialHarness;
      model.weather = weather;
      model.weatherForecast = {hourly: [], daily: []};
      ui.renderFull(model);
    }, probe[scenario]);
    await expect(page.locator('.weather-header-metric--suitable')).toHaveCount(3);
    await expect(page.locator('.weather-risk-row--suitable')).toHaveCount(4);
    await expect(page.locator('.weather-risk-row').filter({hasText: '结露风险'})).toContainText('不可用');
    await page.screenshot({path: fileURLToPath(new URL(`${scenario}.png`, import.meta.url)), fullPage: true});
  });
}

test('reproduction: actual App keeps suitable condensation beyond 5 minutes and source-offline push', async ({page}) => {
  const calls = {weatherReads: 0};
  await page.clock.install({time: new Date('2026-11-17T00:00:00Z')});
  await page.addInitScript(() => {
    window.localStorage.setItem('CapacitorStorage.iot-manager.active-endpoint.v1', JSON.stringify({
      id: 'weather-review', accessRoute: 'SITE_API', apiBaseUrl: `${location.origin}/api/v1`,
      wsUrl: `ws://${location.host}/ws/devices`, organizationCode: 'demo-org', accessToken: 'review-only-token'
    }));
    window.localStorage.setItem('CapacitorStorage.iot-manager.selected-site.v1', JSON.stringify({siteCode: 'site-a'}));
    window.__reviewSockets = [];
    window.WebSocket = class {
      constructor() { window.__reviewSockets.push(this); this.readyState = 0;
        setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0); }
      send() {}
      close() { this.readyState = 3; this.onclose?.({code: 1000}); }
      addEventListener(type, handler) { this['on' + type] = handler; }
      removeEventListener(type, handler) { if (this['on' + type] === handler) delete this['on' + type]; }
    };
  });
  const device = syntheticDevice('review-device', {id: 8, deviceId: 'review-device', siteCode: 'site-a', displayName: '温度来源'});
  await page.route('**/api/v1/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const reply = body => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
    if (pathname === '/api/v1/sites') return reply([{id: 7, siteCode: 'site-a', siteName: '复核站点', organizationCode: 'demo-org'}]);
    if (pathname === '/api/v1/devices') return reply([device]);
    if (pathname === '/api/v1/devices/8') return reply(device);
    if (pathname === '/api/v1/me') return reply({subject: 'review-owner', roles: ['OWNER'], sites: [{id: 7}]});
    if (pathname.endsWith('/weather-settings')) return reply({enabled: true, providerCode: 'OPEN_METEO', latitude: 22.5,
      longitude: 114.0, timezone: 'Asia/Shanghai', condensationTemperatureDeviceId: 8, condensationTemperatureField: 'temperature'});
    if (pathname.endsWith('/weather/forecast')) return reply({status: 'FRESH', hourly: [], daily: []});
    if (pathname.endsWith('/weather')) { calls.weatherReads++; return reply(probe.fresh); }
    if (pathname.endsWith('/ai/status')) return reply({enabled: false});
    return reply([]);
  });
  await page.goto('/');
  await expect(page.locator('[data-region="weather-header"]')).toBeVisible();
  await page.locator('[data-region="weather-header"]').click();
  const condensation = page.locator('.weather-risk-row').filter({hasText: '结露风险'});
  await expect(condensation).toHaveClass(/weather-risk-row--suitable/);
  const readsAtStart = calls.weatherReads;
  await page.clock.fastForward(6 * 60 * 1000);
  const beforeOfflinePush = await page.evaluate(() => window.__iotUiMetrics().store.publications);
  await page.evaluate(device => {
    const socket = window.__reviewSockets.at(-1);
    if (typeof socket?.onmessage !== 'function') throw new Error('The actual App WebSocket listener is not attached');
    socket.onmessage({data: JSON.stringify({version: 1, type: 'device_update',
      payload: {...device, status: 'OFFLINE'}, timestamp: Date.now()})});
  }, device);
  await expect.poll(() => page.evaluate(() => window.__iotUiMetrics().store.publications)).toBeGreaterThan(beforeOfflinePush);
  await expect(condensation).toHaveClass(/weather-risk-row--suitable/);
  expect(calls.weatherReads).toBe(readsAtStart);
  await page.screenshot({path: fileURLToPath(new URL('source-expired-cache.png', import.meta.url)), fullPage: true});
});
