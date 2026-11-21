import {test, expect} from '@playwright/test';
import {syntheticDevice} from '../src/dev/motion-preview/fixtures.js';

// The real main entry, store, adapters and UI run here. Only network and
// hardware boundaries are replaced; production ships none of this fixture.
async function backend(page, {aiReady = false, assessment = false} = {}) {
  const errors = [], calls = {commands: [], locations: [], reads: 0, requests: [], ai: []};
  let restored = false, details = 0;
  const fixtureAt = Date.parse('2026-11-21T03:00:00Z');
  const sample = (offset, bucket) => ({ value: 0, source: 'EDGE_AGENT', timeTrust: 'TRUSTED',
    observedAt: new Date(fixtureAt + offset - 100).toISOString(), receivedAt: new Date(fixtureAt + offset).toISOString(),
    bucketStart: new Date(fixtureAt + bucket).toISOString() });
  const assessmentDevice = (publicId = 'assessment-valve') => ({
    publicId, name: publicId === 'assessment-valve' ? '排障验证设备' : '下一页设备',
    source: 'PLATFORM', linkState: 'RECENT', demo: false, asOf: new Date(fixtureAt + (restored ? 181_000 : 0)).toISOString(),
    fields: [{ key: 'temperature', unit: 'C', validity: restored ? 'FRESH' : 'STALE',
      samples: restored ? [sample(121_000, 120_000), sample(61_000, 60_000)] : [sample(-121_000, -180_000)] }]
  });
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
    if (assessment && pathname.endsWith('/device-status-overview')) {
      const more = new URL(request.url()).searchParams.has('cursor');
      return reply({siteId: 1, asOf: new Date(fixtureAt).toISOString(), demo: false, total: 2,
        links: {RECENT: 2}, items: [assessmentDevice(more ? 'other-device' : undefined)], nextCursor: more ? null : '1:2:1'});
    }
    if (assessment && pathname.endsWith('/device-status-overview/assessment-valve')) {
      const data = assessmentDevice();
      if (!restored) data.asOf = new Date(fixtureAt + ++details * 100).toISOString();
      return reply(data);
    }
    if (assessment && !aiReady && pathname.endsWith('/ai/status')) return reply({enabled:false, knowledgeEnabled:false});
    if (assessment && !aiReady && pathname.endsWith('/ai/capabilities')) return reply({contractVersion:1,features:{}});
    if (aiReady && pathname.endsWith('/ai/status')) return reply({enabled:true});
    if (aiReady && pathname.endsWith('/ai/capabilities')) return reply({contractVersion:1,
      features:{history:true, requestRecovery:true, idempotency:true, personaActivationGuard:true, deviceDiagnosis:assessment}});
    if (aiReady && pathname.endsWith('/ai/persona')) return reply({version:0, name:'默认性格', instructions:''});
    if (aiReady && pathname.endsWith('/ai/persona/versions')) return reply([]);
    if (aiReady && pathname.endsWith('/ai/chat') && request.method() === 'POST') {
      calls.ai.push(request.postDataJSON());
      return reply({requestId:'fixture-request', conversationId:'fixture-conversation', answer:'模拟设备回答', personaVersion:0, citations:[]});
    }
    return reply([]);
  });
  await page.goto('/');
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  await expect(page.locator('[data-action=open-device]'), JSON.stringify(calls.requests)).toHaveCount(1);
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'liquid');
  return {errors, calls, restoreEvidence: () => { restored = true; }};
}

test('device assessment works without the model, pages all devices, and verifies only after two new samples', async ({page}) => {
  const {errors, calls, restoreEvidence} = await backend(page, {assessment:true});
  await page.getByRole('button', {name:'AI', exact:true}).click();
  await expect(page.getByText('服务器尚未启用 AI', {exact:false})).toBeVisible();
  expect(calls.requests.filter(row => row.pathname.includes('/device-status-overview'))).toHaveLength(0);
  await page.getByRole('button', {name:'查看全部设备状态'}).click();
  await expect(page.getByRole('heading', {name:'排障验证设备'})).toBeVisible();
  await page.getByRole('button', {name:'查看下一页设备'}).click();
  await expect(page.getByRole('heading', {name:'下一页设备'})).toBeVisible();
  await page.getByRole('button', {name:'排查此项'}).first().click();
  const card = page.locator('[data-region="device-repair-plan"]');
  await expect(card).toContainText('修复步骤');
  const verify = card.getByRole('button', {name:'重新验证'});
  await verify.click();
  await expect(card).toContainText('仍异常');
  restoreEvidence();
  await verify.click();
  await expect(card).toContainText('已恢复');
  expect(calls.requests.filter(row => row.pathname.includes('/device-status-overview'))).toHaveLength(5);
  expect(calls.requests.filter(row => row.method === 'POST' && (row.pathname.includes('/commands') || row.pathname.endsWith('/ai/chat')))).toEqual([]);
  expect(errors).toEqual([]);
  await noOverflow(page);
});

test('asking AI about a repair sends one scoped diagnosis without overwriting the composer draft', async ({page}) => {
  const {errors, calls} = await backend(page, {aiReady:true, assessment:true});
  await page.getByRole('button', {name:'AI', exact:true}).click();
  const question = page.getByRole('textbox', {name:'问题'});
  await question.fill('保留这段普通聊天草稿');
  await page.getByRole('button', {name:'查看全部设备状态'}).click();
  await page.getByRole('button', {name:'排查此项'}).first().click();
  const card = page.locator('[data-region="device-repair-plan"]');
  await card.getByRole('button', {name:'用 AI 细化方案'}).click();
  await expect(page.locator('.ai-message--assistant')).toContainText('模拟设备回答');
  await expect(question).toHaveValue('保留这段普通聊天草稿');
  expect(calls.ai).toHaveLength(1);
  expect(calls.ai[0].deviceDiagnosis).toEqual({
    version:1, source:'PLATFORM', issue:'FIELD_STALE', publicId:'assessment-valve', field:'temperature'
  });
  expect(errors).toEqual([]);
});

test('production entry keeps AI draft controls responsive and sends once with the docked composer', async ({page}) => {
  const {errors, calls} = await backend(page, {aiReady:true});
  await page.getByRole('button', {name:'AI', exact:true}).click();
  const input = page.getByRole('textbox', {name:'问题'});
  await expect(input).toBeVisible();
  await input.fill('设备状态');
  await expect(input).toBeFocused();
  await expect(page.locator('.ai-composer .ai-count')).toHaveText('4 / 2000 字符');
  const send = page.getByRole('button', {name:'发送', exact:true});
  await expect(send).toBeEnabled();
  await page.setViewportSize({width:390, height:500});
  expect((await send.boundingBox()).y + (await send.boundingBox()).height).toBeLessThanOrEqual(500);
  await send.click();
  await expect(page.locator('.ai-message--assistant')).toContainText('模拟设备回答');
  expect(calls.requests.filter(row => row.method === 'POST' && row.pathname.endsWith('/ai/chat'))).toHaveLength(1);
  expect(errors).toEqual([]);
});

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
  await expect(page.locator('liquid-glass').first()).toHaveAttribute('effect-mode', 'off');
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
