import { test, expect } from '@playwright/test';
import { materialHarness } from './helpers/material-harness.js';
import { syntheticDevice } from '../src/dev/motion-preview/fixtures.js';

for (const status of ['EXPIRED', 'UNAVAILABLE']) {
  test(`invalid ${status} weather is neutral even when the supplied legacy indicators are green`, async ({ page }) => {
    await materialHarness(page, { screen: 'weather' });
    await page.evaluate(status => {
      const { ui, model } = window.materialHarness;
      const suitable = { level: 'SUITABLE', label: '适宜', ideal: true, reason: 'old reading' };
      model.weather = { status, current: { temperatureC: 24, relativeHumidityPct: 50, surfacePressureHpa: 1000 },
        indicators: Object.fromEntries(['temperature', 'humidity', 'pressure', 'esdRisk', 'condensationRisk'].map(key => [key, suitable])) };
      ui.render(model);
    }, status);
    await expect(page.locator('.weather-header-metric--suitable')).toHaveCount(0);
    await expect(page.locator('.weather-risk-row--suitable')).toHaveCount(0);
    await expect(page.locator('.weather-header-summary')).toContainText('上次数据');
  });
}

test('loading the packaged default endpoint is explicit and does not overwrite the saved user endpoint', async ({ page }) => {
  await materialHarness(page, { screen: 'connections' });
  const previous = await page.evaluate(() => {
    const { ui, model } = window.materialHarness;
    model.defaultEndpointProfile = { apiBaseUrl: 'https://new.example.test/api/v1', wsUrl: 'wss://new.example.test/ws/devices',
      oidcIssuerUrl: 'https://new.example.test/auth/realms/iot-manager', oidcClientId: 'iot-glass-next',
      oidcRedirectUri: 'com.iot.manager.glassnext://oauth/callback' };
    ui.render(model);
    return model.endpointProfile.apiBaseUrl;
  });
  await page.locator('[data-action="load-default-endpoint"]').click();
  await expect(page.locator('#endpoint-api-url')).toHaveValue('https://new.example.test/api/v1');
  await expect(page.locator('#endpoint-oidc-issuer-url')).toHaveValue('https://new.example.test/auth/realms/iot-manager');
  expect(await page.evaluate(() => window.materialHarness.model.endpointProfile.apiBaseUrl)).toBe(previous);
});

for (const failure of ['discovery', 'browser']) {
  test(`the actual login manager surfaces a stalled ${failure} in the production UI`, async ({ page }) => {
    await materialHarness(page, { screen: 'ai' });
    await page.evaluate(async failure => {
      const { OidcSessionManager, oidcErrorMessage } = await import('/src/js/auth/oidc-session.js');
      const { ui, model } = window.materialHarness;
      model.auth = { configured: true, authenticated: false, status: 'signed_out' };
      model.ai = { ...model.ai, enabled: false, status: 'login', error: null, notice: null, loading: false };
      const update = auth => { model.auth = auth; ui.patchRuntime(model); };
      const issuer = 'https://identity.example.test/realm';
      const manager = new OidcSessionManager({
        config: { issuerUrl: issuer, clientId: 'iot-glass-next', redirectUri: 'com.iot.manager.glassnext://oauth/callback' },
        tokenStore: { getJson: async () => null, setJson: async () => {}, remove: async () => {} },
        fetchImpl: failure === 'discovery' ? () => new Promise(() => {}) : async () => new Response(JSON.stringify({
          issuer, authorization_endpoint: issuer + '/auth', token_endpoint: issuer + '/token' })),
        navigate: () => new Promise(() => {}), requestTimeoutMs: 500, bridgeTimeoutMs: 500,
        onProgress: stage => update({ ...model.auth, status: 'redirecting', loginStage: stage }),
        onStateChange: auth => update({ ...auth, error: auth.error ? oidcErrorMessage({ code: auth.errorCode }) : null })
      });
      ui.handlers.signIn = async () => { try { await manager.beginLogin(); }
        catch (error) { update({ ...manager.getState(), error: oidcErrorMessage(error) }); } };
      ui.handlers.cancelSignIn = () => manager.cancelLoginPreparation();
      ui.render(model);
    }, failure);
    await page.locator('.ai-workspace [data-action="sign-in"]').click();
    await expect(page.locator('[data-region="global-feedback"]')).toContainText(failure === 'discovery' ? '登录服务连接超时' : '浏览器未及时响应');
    await expect(page.locator('.app-header [data-action="sign-in"]')).toBeEnabled();
    await expect(page.locator('.ai-workspace [data-action="sign-in"]')).toBeVisible();
  });
}

test('the real App locally expires condensation without extra weather reads or full renders', async ({ page }) => {
  const instant = Date.parse('2026-11-17T00:00:00Z');
  let weatherReads = 0;
  await page.clock.install({ time: new Date(instant) });
  await page.addInitScript(() => {
    localStorage.setItem('CapacitorStorage.iot-manager.active-endpoint.v1', JSON.stringify({
      id: 'reliability', accessRoute: 'SITE_API', apiBaseUrl: location.origin + '/api/v1',
      wsUrl: 'ws://' + location.host + '/ws/devices', organizationCode: 'demo-org' }));
    localStorage.setItem('CapacitorStorage.iot-manager.selected-site.v1', JSON.stringify({ siteCode: 'site-a' }));
    window.__reliabilitySockets = [];
    window.WebSocket = class {
      constructor() { window.__reliabilitySockets.push(this); this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0); }
      send() {} close() { this.readyState = 3; }
      addEventListener(type, fn) { this['on' + type] = fn; } removeEventListener(type) { delete this['on' + type]; }
    };
  });
  const device = syntheticDevice('source-8', { id: 8, deviceId: 'source-8', siteCode: 'site-a', displayName: '温度来源' });
  const suitable = { level: 'SUITABLE', label: '适宜', ideal: true, reason: 'current' };
  const weather = { siteCode: 'site-a', siteId: 7, status: 'FRESH', fetchedAt: new Date(instant).toISOString(),
    current: { temperatureC: 24, relativeHumidityPct: 50, surfacePressureHpa: 1000 },
    indicators: Object.fromEntries(['temperature', 'humidity', 'pressure', 'esdRisk', 'condensationRisk'].map(key => [key, suitable])),
    assessment: { evaluatedAt: new Date(instant).toISOString(), weatherValidUntil: new Date(instant + 21600000).toISOString(),
      temperatureSource: { deviceId: 8, publicDeviceId: 'source-8', field: 'temperature', receivedAt: new Date(instant).toISOString(),
        validUntil: new Date(instant + 300000).toISOString() } } };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/sites') return reply([{ id: 7, siteCode: 'site-a', siteName: '测试站点', organizationCode: 'demo-org' }]);
    if (path === '/api/v1/devices') return reply([device]);
    if (path === '/api/v1/me') return reply({ subject: 'test-owner', roles: ['OWNER'], sites: [{ id: 7 }] });
    if (path.endsWith('/weather-settings')) return reply({ enabled: true, timezone: 'Asia/Shanghai', condensationTemperatureDeviceId: 8 });
    if (path.endsWith('/weather/forecast')) return reply({ hourly: [], daily: [] });
    if (path.endsWith('/weather')) { weatherReads++; return reply(weather); }
    if (path.endsWith('/ai/status')) return reply({ enabled: false });
    return reply([]);
  });
  await page.goto('/');
  await page.locator('[data-region="weather-header"]').click();
  const condensation = page.locator('.weather-risk-row').filter({ hasText: '结露风险' });
  await expect(condensation).toHaveClass(/--suitable/);
  const baseline = await page.evaluate(() => window.__iotUiMetrics());
  const reads = weatherReads;
  await page.clock.fastForward(301000);
  await expect(condensation).toHaveClass(/--neutral/);
  await expect(condensation).toContainText('不可评估');
  expect(await page.evaluate(async () => (await import('/src/js/store.js')).store.getState()
    .weather.indicators.condensationRisk.level)).toBe('UNAVAILABLE');
  expect(weatherReads).toBe(reads);
  const after = await page.evaluate(() => window.__iotUiMetrics());
  expect(typeof after.fullRenderCount).toBe('number');
  expect(after.fullRenderCount).toBe(baseline.fullRenderCount);
  await page.evaluate(weather => {
    const at = Date.now();
    const next = { ...weather, assessment: { ...weather.assessment, evaluatedAt: new Date(at).toISOString(),
      temperatureSource: { ...weather.assessment.temperatureSource, receivedAt: new Date(at).toISOString(),
        validUntil: new Date(at + 300000).toISOString() } } };
    window.__reliabilitySockets.at(-1).onmessage({ data: JSON.stringify({ version: 1, type: 'weather_update', payload: next, timestamp: at }) });
  }, weather);
  await expect(condensation).toHaveClass(/--suitable/);
  await page.evaluate(device => {
    window.__reliabilitySockets.at(-1).onmessage({ data: JSON.stringify({ version: 1, type: 'device_update',
      payload: { ...device, status: 'OFFLINE' }, timestamp: Date.now() }) });
  }, device);
  await expect(condensation).toHaveClass(/--neutral/);
  await expect(condensation).toContainText('离线或归档');
  expect(weatherReads).toBe(reads);
  expect((await page.evaluate(() => window.__iotUiMetrics())).fullRenderCount).toBe(baseline.fullRenderCount);
});
