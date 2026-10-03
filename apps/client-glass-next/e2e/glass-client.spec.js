import {test, expect} from '@playwright/test';
import {syntheticDevice} from '../src/dev/motion-preview/fixtures.js';

// The real main entry, store, adapters and UI run here. Only network and
// hardware boundaries are replaced; production ships none of this fixture.
async function backend(page) {
  const errors = [], calls = {commands: [], locations: [], reads: 0, requests: []};
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Browser-only fixture: this endpoint and bearer token never leave the
    // intercepted Playwright requests. Production auth remains OIDC/PKCE.
    window.localStorage.setItem('CapacitorStorage.iot-manager.active-endpoint.v1', JSON.stringify({
      id: 'playwright-site', accessRoute: 'SITE_API',
      apiBaseUrl: `${window.location.origin}/api/v1`,
      wsUrl: `ws://${window.location.host}/ws/devices`,
      organizationCode: 'demo-org', accessToken: 'playwright-fixture-token'
    }));
    window.localStorage.setItem('CapacitorStorage.iot-manager.selected-site.v1', JSON.stringify({siteCode: 'demo-site'}));
    window.WebSocket = class {
      constructor() {this.readyState = 0; setTimeout(() => {this.readyState = 1; this.onopen?.({});}, 0);}
      send() {}
      close() {this.readyState = 3; this.onclose?.({code: 1000});}
      addEventListener(type, handler) {this['on' + type] = handler;}
      removeEventListener(type, handler) {if (this['on' + type] === handler) delete this['on' + type];}
    };
  });
  let location = {latitude: 31.2, longitude: 121.4, timezone: 'Asia/Shanghai', locationSource: 'MANUAL'};
  const state = {relay_a: true, level: 42, mode: 'manual'};
  const device = syntheticDevice('glass-test-device', {id: 7, deviceId: 'glass-test-device', displayName: '装配工位照明',
    siteCode: 'demo-site', spacePath: '/workshop/assembly', desiredState: {...state}, reportedState: {...state}});
  const weather = {siteCode: 'demo-site', status: 'FRESH', fetchedAt: new Date().toISOString(),
    current: {conditionText: '多云', iconKey: 'partly-cloudy', temperatureC: 24.6, apparentTemperatureC: 24.1,
      relativeHumidityPct: 58, surfacePressureHpa: 1012, windSpeedMps: 2.4, elevationM: 12}, indicators: {}};
  let command = null, submittedAt = 0;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    calls.requests.push({method: request.method(), pathname});
    const reply = body => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
    if (pathname === '/api/v1/sites') return reply([{id: 1, siteCode: 'demo-site', siteName: '装配车间', organizationCode: 'demo-org', organizationName: '运营园区'}]);
    if (pathname === '/api/v1/devices') {calls.reads++; return reply([device]);}
    if (pathname.endsWith('/weather-settings')) return reply(location);
    if (pathname.endsWith('/weather/location')) {
      const input = request.postDataJSON(); calls.locations.push(input); location = {...location, ...input};
      return reply(weather);
    }
    if (pathname.endsWith('/weather/forecast')) return reply({status: 'FRESH', hourly: [], daily: []});
    if (pathname.endsWith('/weather') || pathname.endsWith('/weather/refresh')) return reply(weather);
    if (pathname.endsWith('/activity')) return reply([]);
    if (pathname === '/api/v1/devices/7') return reply(device);
    if (pathname === '/api/v1/devices/7/commands' && request.method() === 'POST') {
      const input = request.postDataJSON(); calls.commands.push(input); submittedAt = Date.now();
      device.desiredState = {...device.desiredState, level: input.parameters.level};
      command = {...input, commandId: input.idempotencyKey, deviceId: 7, status: 'SENT', desiredState: {...device.desiredState}, createdAt: new Date().toISOString()};
      return reply(command);
    }
    if (pathname.startsWith('/api/v1/commands/')) {
      if (Date.now() - submittedAt > 250) {
        device.reportedState = {...device.desiredState};
        command = {...command, status: 'ACKNOWLEDGED', reportedState: {...device.reportedState}, updatedAt: new Date().toISOString()};
      }
      return reply(command);
    }
    if (pathname === '/api/v1/me') return reply({subject: 'test-owner', roles: ['OWNER'], sites: [{id: 1}]});
    return reply([]);
  });
  await page.goto('/');
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  await expect(page.locator('[data-action=open-device]'), JSON.stringify(calls.requests)).toHaveCount(1);
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'liquid');
  return {errors, calls};
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function snapshot(page, name, fullPage = false) {
  await page.evaluate(() => {document.activeElement?.blur(); window.scrollTo(0, 0);});
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({path: (process.env.IOT_PLAYWRIGHT_OUTPUT_DIR || 'verification') + '/' + name + '.png', animations: 'disabled', fullPage});
}

test('new App uses the real API adapter and confirms a native range command exactly once', async ({page}) => {
  const {errors, calls} = await backend(page);
  await expect(page.locator('.device-row__reading')).toContainText('电源 开启');
  await page.locator('[data-action=open-device]').click();
  await expect(page.locator('[data-region=device-detail-panel]')).toHaveCount(1);
  await expect(page.locator('[data-region=device-state]')).toContainText('手动');
  const range = page.locator('[data-field=capability-range]');
  await range.focus(); await range.press('ArrowRight');
  await expect(range).toBeDisabled();
  await expect(page.locator('[data-region=device-command]')).toContainText('已确认', {timeout: 10000});
  await expect(range).toBeEnabled(); await expect(range).toHaveValue('43');
  expect(calls.commands).toHaveLength(1);
  expect(calls.commands[0].type).toBe('set_level');
  expect(calls.commands[0].parameters.level).toBe(43);
  expect(calls.commands[0].idempotencyKey).toBeTruthy();
  await snapshot(page, 'mobile-device', true);
  expect(errors).toEqual([]);
});

test('real connection and OIDC fields coexist with independent material and motion choices', async ({page}) => {
  const {errors, calls} = await backend(page);
  await snapshot(page, 'mobile-home');
  await page.locator('[data-action=open-connection-settings]').click();
  await expect(page.locator('#endpoint-api-url')).toBeVisible();
  await expect(page.locator('#endpoint-oidc-client-id')).toBeVisible();
  await page.locator('[data-action=choose-endpoint-route][data-route=CLOUD_API]').click();
  await expect(page.locator('#endpoint-oidc-client-id')).toBeVisible();
  await expect(page.locator('#endpoint-oidc-redirect-uri')).toHaveAttribute('data-field', 'endpointOidcRedirectUri');
  await page.locator('[data-material-mode=frosted]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'frosted');
  await page.locator('[data-material-mode=solid]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'solid');
  await expect(page.locator('.liquid-surface-layer').first()).toHaveAttribute('effect-mode', 'off');
  await page.locator('[data-material-mode=liquid]').click();
  await page.locator('[data-action=toggle-display-motion]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-motion', 'reduced');
  await page.locator('.bottom-nav [data-screen=devices]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'liquid');
  await page.emulateMedia({forcedColors: 'active'});
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'solid');
  await page.emulateMedia({forcedColors: 'none'});
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'liquid');
  expect(calls.commands).toEqual([]); expect(errors).toEqual([]);
});

test('weather saves through the production API and keeps manual settings expanded', async ({page}) => {
  const {errors, calls} = await backend(page);
  await page.locator('[data-action=open-weather]').first().click();
  await expect(page.locator('.weather-metrics')).toContainText('2.4 m/s');
  await page.locator('.weather-location__manual-title').click();
  await page.locator('#weather-latitude').fill('22.5431');
  await page.locator('#weather-longitude').fill('114.0579');
  await page.locator('[data-action=save-manual-weather-location]').click();
  await expect.poll(() => calls.locations.length).toBe(1);
  expect(calls.locations[0].latitude).toBe(22.5431);
  await expect(page.locator('[data-region=weather-coordinate-details]')).toHaveAttribute('open', '');
  await snapshot(page, 'mobile-weather', true);
  await noOverflow(page); expect(errors).toEqual([]);
});

test('latest App pages fit phone and desktop widths with the new glass styles', async ({page}) => {
  const {errors} = await backend(page);
  for (const width of [320, 390, 414, 768, 820, 1024, 1440]) {
    await page.setViewportSize({width, height: 900});
    const nav = page.locator(width >= 820 ? '.primary-nav' : '.bottom-nav');
    await nav.locator('[data-screen=devices]').click(); await noOverflow(page);
    await page.locator('[data-action=open-device]').click(); await noOverflow(page);
    await page.locator('[data-action=open-weather]').first().click(); await noOverflow(page);
    await page.locator('.weather-location__manual-title').click(); await noOverflow(page);
  }
  await snapshot(page, 'desktop-weather', true);
  await page.locator('.primary-nav [data-screen=devices]').click();
  await snapshot(page, 'desktop-home', true);
  await page.locator('[data-action=open-device]').click();
  await snapshot(page, 'desktop-device', true);
  expect(errors).toEqual([]);
});
