import { test, expect } from '@playwright/test';

// This document imports UI only: no main.js, credentials, storage or adapters.
async function fixture(page) {
  await page.route('**/__motion-interruptions-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/css/style.css"></head><body><div id="app"></div></body></html>'
  }));
  await page.goto('/__motion-interruptions-fixture');
  await page.evaluate(async () => {
    const { createClientUi } = await import('/src/js/ui.js');
    window.__networkCalls = [];
    window.fetch = (...args) => { window.__networkCalls.push(['fetch', String(args[0])]); throw new Error('Fixture forbids network'); };
    window.WebSocket = class { constructor(url) { window.__networkCalls.push(['websocket', String(url)]); throw new Error('Fixture forbids WebSocket'); } };
    window.__calls = {};
    window.__pending = {};
    const deferred = name => payload => {
      (window.__calls[name] ??= []).push(payload);
      return new Promise((resolve, reject) => (window.__pending[name] ??= []).push({ resolve, reject }));
    };
    window.__finish = (name, index, value, error) => {
      const request = window.__pending[name][index];
      if (error) request.reject(new Error(error));
      else request.resolve(value);
    };
    const devices = Array.from({ length: 35 }, (_, index) => ({
      id: `d${index}`, deviceId: `d${index}`, displayName: `合成设备 ${index}`,
      connections: [{ transport: 'LAN_AGENT', status: 'CONNECTED', profileId: 'relay-v1' }],
      capabilities: { profileId: 'relay-v1', controls: [
        { id: 'power', label: '电源', valueType: 'boolean', stateKey: 'on', commandType: 'set_power' },
        { id: 'level', label: '强度', inputType: 'range', stateKey: 'level', commandType: 'set_level', min: 0, max: 100 }
      ] },
      reportedState: { on: true, level: 20 }, desiredState: { on: true, level: 20 }
    }));
    window.__base = {
      context: { siteCode: 'fixture-A', organizationCode: 'fixture-org', spacePath: '/fixture' },
      runtime: { stale: false, accessRoute: 'SITE_API', sessionRevision: 1 },
      endpointProfile: { id: 'fixture', apiBaseUrl: 'https://fixture.invalid/api/v1', wsUrl: 'wss://fixture.invalid/ws' },
      connectionHealth: { status: 'CONNECTED' }, startup: { phase: 'ready' },
      devices, commandsById: {},
      activitiesByDeviceId: { d0: Array.from({ length: 30 }, (_, index) => ({ id: `a${index}`, deviceId: 'd0', eventType: 'DEVICE_CONNECTED', timestamp: `2026-09-27T08:${String(index).padStart(2, '0')}:00Z` })) },
      lanCandidates: [{ candidateId: 'c1', displayName: '候选一' }, { candidateId: 'c2', displayName: '候选二' }],
      weather: { status: 'FRESH', fetchedAt: '2026-09-27T08:00:00Z', current: { temperatureC: 24, conditionText: '晴' } },
      weatherForecast: { hourly: Array.from({ length: 24 }, (_, index) => ({ forecastAt: `2026-09-27T${String(index).padStart(2, '0')}:00:00Z`, temperatureC: 24, conditionText: '晴' })), daily: [] },
      resources: { devices: { phase: 'ready', freshness: 'fresh' }, activity: { phase: 'ready' } }
    };
    window.__ui = createClientUi(document.getElementById('app'), {
      pullRefresh: deferred('pull'), testEndpoint: deferred('endpoint'), claimLan: deferred('claim'),
      sendCommand: deferred('command'), refreshWeather: deferred('weather'),
      openDevice: () => undefined, openWeather: () => undefined,
      chooseAddPath: () => undefined, selectLanCandidate: () => undefined, setTab: () => undefined
    });
    window.__ui.render(window.__base);
  });
}

async function pointerSequence(page, { id = 1, moves = [[0, 180]], cancel = false, target = '.screen-heading p', pointerType = 'touch' } = {}) {
  await page.evaluate(({ id, moves, cancel, target, pointerType }) => {
    window.scrollTo(0, 0);
    const element = document.querySelector(`[data-region="screen-content"] ${target}`);
    const send = (type, x, y, eventTarget = element) => eventTarget.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: id, pointerType, isPrimary: true, clientX: 20 + x, clientY: 200 + y
    }));
    send('pointerdown', 0, 0);
    for (const [x, y] of moves) send('pointermove', x, y);
    send(cancel ? 'pointercancel' : 'pointerup', ...moves.at(-1), document);
  }, { id, moves, cancel, target, pointerType });
}

async function screenIs(page, screen) {
  await expect.poll(() => page.evaluate(() => window.__ui.local.screen)).toBe(screen);
}

async function finish(page, name, index, value = {}, error = null) {
  await page.evaluate(({ name, index, value, error }) => window.__finish(name, index, value, error), { name, index, value, error });
}

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__networkCalls ?? [])).toEqual([]);
});

test('pull cancellation, horizontal intent, reverse travel and excluded controls produce no request', async ({ page }) => {
  await fixture(page);
  await pointerSequence(page, { id: 1, cancel: true });
  await pointerSequence(page, { id: 2, moves: [[0, 0]] });
  await pointerSequence(page, { id: 3, moves: [[160, 100], [160, 250]] });
  await pointerSequence(page, { id: 4, moves: [[0, 180], [0, 40]] });
  await pointerSequence(page, { id: 5, pointerType: 'mouse' });
  await pointerSequence(page, { id: 6, target: '[data-action="pull-refresh"]' });
  expect(await page.evaluate(() => window.__calls.pull?.length ?? 0)).toBe(0);
  await expect(page.locator('.pull-refresh')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('[data-action="open-weather"]').first().click();
  await pointerSequence(page, { id: 7, target: '.weather-hourly-list' });
  expect(await page.evaluate(() => window.__calls.pull?.length ?? 0)).toBe(0);
});

test('gesture and accessible button share one in-flight refresh and permit retry only after settling', async ({ page }) => {
  await fixture(page);
  await pointerSequence(page);
  await expect.poll(() => page.evaluate(() => window.__calls.pull?.length ?? 0)).toBe(1);
  await pointerSequence(page, { id: 2 });
  await page.locator('[data-action="pull-refresh"]').dispatchEvent('click');
  expect(await page.evaluate(() => window.__calls.pull.length)).toBe(1);
  await finish(page, 'pull', 0, { status: 'cooldown', message: '冷却中，保留已有数据' });
  await expect(page.locator('.toast-region')).toContainText('冷却中');
  await expect(page.locator('.toast-region .toast--success')).toHaveCount(0);
  await expect(page.locator('[data-action="pull-refresh"]')).toBeEnabled();
  await page.locator('[data-action="pull-refresh"]').click();
  await expect.poll(() => page.evaluate(() => window.__calls.pull.length)).toBe(2);
  await finish(page, 'pull', 1, { status: 'updated', message: '合成数据已更新' });
  await expect(page.locator('.toast-region')).toContainText('合成数据已更新');
});

test('an old context result and finally cannot overwrite a newer task or clear its busy state', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-action="open-connection-settings"]').click();
  await page.locator('[data-action="test-endpoint"]').click();
  await page.evaluate(() => {
    window.__base.context.siteCode = 'fixture-B';
    window.__ui.render(window.__base);
  });
  await page.locator('[data-action="test-endpoint"]').click();
  expect(await page.evaluate(() => window.__calls.endpoint.length)).toBe(2);
  await finish(page, 'endpoint', 0, { ok: true, message: '旧站点测试成功' });
  await expect(page.locator('[data-action="test-endpoint"]')).toBeDisabled();
  await expect(page.locator('[data-region="endpoint-test-result"]')).toHaveCount(0);
  await finish(page, 'endpoint', 1, {}, '新站点测试失败');
  await expect(page.locator('[data-region="global-feedback"]')).toContainText('新站点测试失败');
  await expect(page.locator('[data-action="test-endpoint"]')).toBeEnabled();
  await expect(page.locator('#app')).not.toContainText('旧站点测试成功');
});

test('leaving and returning to the same page does not give a late result ownership or steal focus', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-action="open-connection-settings"]').click();
  await page.locator('[data-action="test-endpoint"]').click();
  await page.locator('.nav-button[data-screen="activity"]').click();
  await page.locator('[data-action="open-connection-settings"]').click();
  const input = page.locator('#endpoint-api-url');
  await input.focus();
  await input.evaluate(node => node.setSelectionRange(8, 15));
  await finish(page, 'endpoint', 0, { ok: true, message: '过期页面成功' });
  await screenIs(page, 'connections');
  await expect(input).toBeFocused();
  expect(await input.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([8, 15]);
  await expect(page.locator('[data-region="endpoint-test-result"]')).toHaveCount(0);
  await expect(page.locator('#app')).not.toContainText('过期页面成功');
});

test('global-task Back returns to the source tab and browser Back restores the detail entity and row position', async ({ page }) => {
  await fixture(page);
  await page.locator('.nav-button[data-screen="activity"]').click();
  await page.evaluate(() => window.scrollTo(0, 450));
  const activityScroll = await page.evaluate(() => window.scrollY);
  // Calling click in-page avoids Playwright scrolling the fixed/global header first.
  await page.locator('[data-action="open-weather"]').first().evaluate(node => node.click());
  await screenIs(page, 'weather');
  await page.locator('[data-motion="back"]').click();
  await screenIs(page, 'activity');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(activityScroll);
  await page.locator('.nav-button[data-screen="devices"]').click();
  const row = page.locator('[data-device-ref="d12"]');
  await row.scrollIntoViewIfNeeded();
  await row.focus();
  const deviceScroll = await page.evaluate(() => window.scrollY);
  await row.click();
  await screenIs(page, 'detail');
  await expect(page.locator('[data-region="screen-content"]')).toContainText('合成设备 12');
  await page.locator('[data-action="open-weather"]').first().click();
  await page.evaluate(() => window.history.back());
  await screenIs(page, 'detail');
  await expect(page.locator('[data-region="screen-content"]')).toContainText('合成设备 12');
  await page.evaluate(() => window.history.back());
  await screenIs(page, 'devices');
  await expect(row).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(deviceScroll);
});

test('runtime reduced motion cancels decoration without erasing the selected switch or changing commands', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-device-ref="d0"]').click();
  const toggle = page.locator('.switch-button');
  await expect(toggle).toHaveClass(/switch-button--on/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#app')).toHaveAttribute('data-motion', 'reduced');
  expect(await toggle.evaluate(node => getComputedStyle(node, '::after').transform)).toBe('matrix(1, 0, 0, 1, 20, 0)');
  expect(await page.locator('[data-region="screen"]').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await toggle.click();
  expect(await page.evaluate(() => window.__calls.command.length)).toBe(1);
  await finish(page, 'command', 0, { status: 'SENT' });
  await expect(toggle).toHaveClass(/switch-button--on/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#app')).toHaveAttribute('data-motion', 'full');
  expect(await page.evaluate(() => window.__calls.command.length)).toBe(1);
});

test('candidate drafts survive data updates and cancelling; late claim cannot navigate a different selection', async ({ page }) => {
  await fixture(page);
  await page.locator('.nav-button[data-screen="add"]').click();
  await page.locator('[data-action="choose-add-path"][data-path="lan"]').click();
  await page.locator('[data-action="select-candidate"][data-candidate-id="c1"]').click();
  const name = page.locator('#claim-display-name');
  await name.fill('保留的设备草稿');
  await name.evaluate(node => node.setSelectionRange(1, 4));
  await page.evaluate(() => {
    window.__base.lanCandidates[0].displayName = '更新候选名称';
    window.__ui.render(window.__base);
  });
  await expect(name).toHaveValue('保留的设备草稿');
  await expect(name).toBeFocused();
  expect(await name.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
  await page.locator('[data-action="cancel-claim"]').click();
  await expect(page.locator('[data-region="claim-form"]')).toHaveCount(0);
  await expect(page.locator('[data-action="discover-lan"]')).toBeFocused();
  await page.locator('[data-action="select-candidate"][data-candidate-id="c1"]').click();
  await expect(name).toHaveValue('保留的设备草稿');
  await page.locator('[data-action="claim-lan"]').click();
  await page.locator('[data-action="select-candidate"][data-candidate-id="c2"]').click();
  await finish(page, 'claim', 0, { status: 'claimed', candidateId: 'c1' });
  await screenIs(page, 'lan');
  await expect(name).toHaveValue('候选二');
  expect(await page.evaluate(() => window.__calls.claim.length)).toBe(1);
});

test('forecast patches preserve the horizontal reading anchor and form draft; errors remain visible', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-action="open-weather"]').first().click();
  await page.locator('.weather-location__manual-title').click();
  const latitude = page.locator('#weather-latitude');
  await latitude.fill('22.12345');
  await latitude.evaluate(node => node.setSelectionRange(3, 6));
  await page.locator('.weather-hourly-list').evaluate(node => { node.scrollLeft = 240; });
  await page.evaluate(() => {
    window.__base.weatherForecast.hourly[0].temperatureC = 25;
    window.__base.resources.weatherForecast = { phase: 'ready', error: '预报刷新失败，保留上次内容' };
    window.__ui.patchWeatherForecast(window.__base);
  });
  await expect(latitude).toBeFocused();
  await expect(latitude).toHaveValue('22.12345');
  expect(await latitude.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([3, 6]);
  expect(await page.locator('.weather-hourly-list').evaluate(node => node.scrollLeft)).toBe(240);
  await expect(page.locator('[data-region="weather-data"]')).toContainText('保留上次内容');
  await latitude.fill('');
  await page.locator('[data-action="save-manual-weather-location"]').click();
  await expect(latitude).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#weather-latitude-error')).toBeVisible();
  await page.evaluate(() => window.__ui.patchWeatherCooldown({ retryAt: Date.now() + 20000 }));
  await expect(page.locator('#weather-latitude-error')).toBeVisible();
  await expect(latitude).toHaveValue('');
});

test('ACK does not reclaim focus after the user has moved to another control', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-device-ref="d0"]').click();
  await page.locator('.switch-button').focus();
  await page.evaluate(() => {
    window.__base.activeDeviceId = 'd0';
    window.__base.commandsById = { command1: { id: 'command1', deviceId: 'd0', type: 'set_power', status: 'PENDING' } };
    window.__ui.patchCommands(['d0'], window.__base);
  });
  await expect(page.locator('.switch-button')).toBeDisabled();
  const settings = page.locator('[data-action="open-connection-settings"]');
  await settings.focus();
  await page.evaluate(() => {
    window.__base.commandsById.command1.status = 'ACKNOWLEDGED';
    window.__ui.patchCommands(['d0'], window.__base);
  });
  await expect(settings).toBeFocused();
  await expect(page.locator('.switch-button')).toBeEnabled();
  expect(await page.evaluate(() => window.__calls.command?.length ?? 0)).toBe(0);
});
