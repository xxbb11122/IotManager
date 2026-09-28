import { test, expect } from '@playwright/test';

// Real UI + Store + coordinator; all hardware and transport boundaries are inert.
async function fixture(page) {
  await page.route('**/__refresh-stability', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/css/style.css"></head><body><div id="app"></div></body></html>' }));
  await page.goto('/__refresh-stability');
  await page.evaluate(async () => {
    const { createClientUi } = await import('/src/js/ui.js');
    const { createClientStore } = await import('/src/js/store.js');
    const { createRenderCoordinator } = await import('/src/js/render-coordinator.js');
    const { createRenderMetrics } = await import('/src/js/render-metrics.js');
    const base = {
      context: { siteCode: 'fixture-site' }, activeDeviceId: 'd0',
      runtime: { stale: false, accessRoute: 'SITE_API', sessionRevision: 1, siteCode: 'fixture-site' },
      connectionHealth: { state: 'connected', stale: false },
      devices: [{ id: 'd0', deviceId: 'd0', displayName: '稳定性测试开关', status: 'ONLINE',
        connections: [{ transport: 'LAN_AGENT', status: 'CONNECTED', profileId: 'relay-v1' }],
        capabilities: { profileId: 'relay-v1', controls: [{ id: 'power', valueType: 'boolean', stateKey: 'on', commandType: 'set_power' }] },
        reportedState: { on: false }, desiredState: { on: false } }],
      resources: { devices: { phase: 'ready', freshness: 'fresh' }, weather: { phase: 'ready', freshness: 'fresh' } },
      weather: { siteCode: 'fixture-site', status: 'FRESH', fetchedAt: '2026-09-27T08:00:00Z',
        current: { conditionText: '晴', temperatureC: 24, relativeHumidityPct: 50, surfacePressureHpa: 1013 } },
      weatherForecast: { status: 'FRESH', hourly: [], daily: [] }
    };
    const metrics = createRenderMetrics();
    const store = createClientStore(base);
    const commands = [];
    const model = () => ({ ...base, ...store.getState() });
    const ui = createClientUi(document.getElementById('app'), {
      openDevice: () => undefined, sendCommand: payload => { commands.push(payload); }
    }, { metrics });
    const coordinator = createRenderCoordinator({ metrics,
      fullRender: () => ui.renderFull(model()),
      patchDevices: refs => ui.patchDevices(refs, model()),
      patchCommands: (refs, _snapshot, options) => ui.patchCommands(refs, model(), options),
      patchRuntime: (_snapshot, options) => ui.patchRuntime(model(), options),
      patchScreen: () => ui.patchScreen(model()),
      patchWeather: (_snapshot, options) => ui.patchWeather(model(), options), patchForecast: () => ui.patchWeatherForecast(model())
    });
    store.subscribe((snapshot, metadata) => coordinator.enqueue(snapshot, metadata));
    ui.render(model());
    window.stability = { ui, store, metrics, coordinator, commands, model };
  });
}

async function detail(page) {
  await fixture(page);
  await page.locator('[data-device-ref="d0"]').click();
  await page.waitForTimeout(250);
  await page.locator('.switch-button').scrollIntoViewIfNeeded();
}

test('twenty identical pushes produce no publications, DOM mutations or region replacements', async ({ page }) => {
  await detail(page);
  const result = await page.evaluate(async () => {
    const { store, metrics, coordinator } = window.stability;
    const selectors = ['device-controls', 'device-detail-heading', 'device-connection', 'device-state'];
    const before = selectors.map(region => document.querySelector(`[data-region="${region}"]`));
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(document.querySelector('[data-region="screen-content"]'), { childList: true, subtree: true, attributes: true, characterData: true });
    metrics.reset();
    const initial = store.diagnostics().publications;
    for (let i = 0; i < 20; i++) {
      store.applyRealtimeEvent({ version: 1, type: 'device_update', payload: structuredClone(store.selectDevice('d0')) });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    coordinator.flush();
    await Promise.resolve();
    observer.disconnect();
    return { publications: store.diagnostics().publications - initial, mutations, metrics: metrics.snapshot(),
      stable: selectors.every((region, i) => before[i] === document.querySelector(`[data-region="${region}"]`)) };
  });
  expect(result.publications).toBe(0);
  expect(result.mutations).toBe(0);
  expect(result.stable).toBe(true);
  expect(result.metrics.fullRenderCount).toBe(0);
  expect(result.metrics.devicePatchCount).toBe(0);
});

for (const input of ['mouse', 'touch']) {
  for (const changed of [false, true]) {
    test(`${input}: ${changed ? 'changed press intent cancels without an opposite command' : 'same-value update preserves a legal click'}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: input === 'touch', hasTouch: input === 'touch' });
      const page = await context.newPage();
      try {
        await detail(page);
        const button = page.locator('.switch-button');
        const box = await button.boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const session = input === 'touch' ? await context.newCDPSession(page) : null;
        if (session) await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        else { await page.mouse.move(x, y); await page.mouse.down(); }
        expect(await page.evaluate(changed => {
          const { store, ui, model } = window.stability;
          const before = document.querySelector('.switch-button');
          if (changed) store.patchDevice('d0', { reportedState: { on: true } });
          // Exercise direct same-view patches as well as the store's no-op guard.
          ui.patchDevices(['d0'], model());
          return before === document.querySelector('.switch-button');
        }, changed)).toBe(true);
        if (session) await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else await page.mouse.up();
        if (changed) {
          await expect(page.locator('.toast-region')).toContainText('本次操作已取消');
          expect(await page.evaluate(() => window.stability.commands)).toEqual([]);
          expect(await page.evaluate(() => window.stability.metrics.snapshot().commandIntentCancelledCount)).toBe(1);
        } else {
          await expect.poll(() => page.evaluate(() => window.stability.commands.length)).toBe(1);
          expect(await page.evaluate(() => window.stability.commands[0].parameters.on)).toBe(true);
        }
      } finally { await context.close(); }
    });
  }
}

test('switch transitions use the original node; reduced motion retains the same final state', async ({ page }) => {
  await detail(page);
  await page.evaluate(() => {
    window.switchTransitions = [];
    window.switchNode = document.querySelector('.switch-button');
    window.switchNode.addEventListener('transitionrun', event => window.switchTransitions.push([event.propertyName, event.pseudoElement]));
    window.stability.store.patchDevice('d0', { reportedState: { on: true } });
    window.stability.coordinator.flush();
  });
  await expect.poll(() => page.evaluate(() => window.switchTransitions.some(([property, pseudo]) => property === 'transform' && pseudo === '::after'))).toBe(true);
  expect(await page.locator('.switch-button').evaluate(node => node === window.switchNode)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    window.switchTransitions = [];
    window.stability.store.patchDevice('d0', { reportedState: { on: false } });
    window.stability.coordinator.flush();
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.switchTransitions)).toEqual([]);
  await expect(page.locator('.switch-button')).not.toHaveClass(/switch-button--on/);
});

test('one weather change gives one local cue; forecast, duplicates and countdown retain nodes', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { const { ui, model } = window.stability; ui.navigate('weather'); ui.render(model()); });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.weatherNodes = ['weather-data', 'weather-hero', 'weather-header', 'weather-refresh-action'].map(region => document.querySelector(`[data-region="${region}"]`));
    window.weatherAnimations = [];
    document.getElementById('app').addEventListener('animationstart', e => {
      if (e.target.closest('[data-region="weather-data"]')) window.weatherAnimations.push(e.target.dataset.region);
    });
    const { store, coordinator } = window.stability;
    store.setWeather({ ...store.getState().weather, fetchedAt: '2026-09-27T08:01:00Z', current: { ...store.getState().weather.current, temperatureC: 25 } });
    coordinator.flush();
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => window.stability.ui.patchWeatherForecast(window.stability.model()));
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const { ui, model } = window.stability;
    ui.patchWeather(model());
    ui.patchWeatherCooldown({ retryAt: Date.now() + 60000 });
    ui.patchWeatherCooldown({ retryAt: Date.now() + 59000 });
  });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.weatherAnimations)).toEqual(['weather-update-stamp']);
  expect(await page.evaluate(() => ['weather-data', 'weather-hero', 'weather-header', 'weather-refresh-action']
    .every((region, index) => document.querySelector(`[data-region="${region}"]`) === window.weatherNodes[index]))).toBe(true);
  expect(await page.locator('[data-region="weather-data"]').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
});

test('duplicate receipts are suppressed and mixed domains patch controls only once', async ({ page }) => {
  await detail(page);
  const result = await page.evaluate(async () => {
    const { metrics, store, coordinator } = window.stability;
    const control = document.querySelector('.switch-button');
    metrics.reset();
    const receipt = { commandId: 'c1', deviceId: 'd0', status: 'SENT', type: 'set_power', parameters: { on: true }, desiredState: { on: true } };
    store.upsertCommand(receipt);
    store.setConnectionHealth({ reconnectAttempt: 1 });
    coordinator.flush();
    for (let i = 0; i < 4; i++) {
      store.upsertCommand({ ...receipt });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return { metrics: metrics.snapshot(), stable: control === document.querySelector('.switch-button') };
  });
  expect(result.stable).toBe(true);
  expect(result.metrics.controlsPatchCount).toBe(1);
  expect(result.metrics.commandPatchCount).toBe(1);
  expect(result.metrics.devicePatchCount).toBe(1);
  await expect(page.locator('.switch-button')).toBeDisabled();
});

test('temporary read-only and pointer cancellation cannot revive an old command intent', async ({ page }) => {
  await detail(page);
  const button = page.locator('.switch-button');
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => {
    const { store, coordinator } = window.stability;
    store.setRuntimeContext({ stale: true }); coordinator.flush();
    store.setRuntimeContext({ stale: false }); coordinator.flush();
  });
  await page.mouse.up();
  expect(await page.evaluate(() => window.stability.commands.length)).toBe(0);
  await button.dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'touch', isPrimary: true });
  await button.dispatchEvent('pointercancel', { pointerId: 42, pointerType: 'touch', isPrimary: true });
  await button.dispatchEvent('click', { detail: 1 });
  expect(await page.evaluate(() => window.stability.commands.length)).toBe(0);
  // Keyboard activation is a fresh intent, not the cancelled pointer gesture.
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.stability.commands.length)).toBe(1);
});

test('actual runtime: failed startup plus three WS reconnects performs one list read and exposes build identity', async ({ page }) => {
  let reads = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/devices')) {
      reads++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"fixture outage"}' });
    }
    const body = url.pathname.endsWith('/sites')
      ? [{ siteCode: 'demo-site', organizationCode: 'demo-org' }]
      : { siteCode: 'demo-site', status: 'UNAVAILABLE', current: null, hourly: [], daily: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    window.fixtureSockets = [];
    window.WebSocket = class {
      constructor() { this.readyState = 0; window.fixtureSockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
      close() { this.readyState = 3; this.onclose?.(); }
      send() {}
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => window.fixtureSockets.length > 0);
  await page.waitForTimeout(400);
  expect(reads).toBe(1);
  for (let i = 0; i < 3; i++) {
    const count = await page.evaluate(() => { const count = window.fixtureSockets.length; window.fixtureSockets.at(-1).close(); return count; });
    await page.waitForFunction(count => window.fixtureSockets.length > count && window.fixtureSockets.at(-1).readyState === 1, count);
    await page.waitForTimeout(200);
    expect(reads).toBe(1);
  }
  expect(await page.evaluate(() => window.__iotUiMetrics().snapshotCooldownCount)).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
  await page.locator('[data-action="open-connection-settings"]').click();
  await expect(page.locator('[data-region="build-identity"]')).toContainText('提交');
  await expect(page.locator('[data-region="build-identity"]')).not.toContainText('unknown');
});

test('continuous measurement pushes retain controls and present only the latest sample at 1Hz', async ({ page }) => {
  await detail(page);
  const result = await page.evaluate(async () => {
    const { store, ui } = window.stability;
    const control = document.querySelector('.switch-button');
    const patch = ui.patchDevices.bind(ui);
    const times = [];
    ui.patchDevices = (...args) => { times.push(performance.now()); return patch(...args); };
    for (let i = 0; i < 60; i++) {
      store.applyRealtimeEvent({ type: 'device_update', version: 1, payload: { id: 'd0', temperature: i } });
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await new Promise(resolve => setTimeout(resolve, 1100));
    return { times, latest: ui.model.devices[0].temperature, sameNode: control === document.querySelector('.switch-button') };
  });
  expect(result.sameNode).toBe(true);
  expect(result.latest).toBe(59);
  expect(result.times.length).toBeLessThanOrEqual(5);
  for (let i = 1; i < result.times.length; i++) expect(result.times[i] - result.times[i - 1]).toBeGreaterThanOrEqual(990);
});

test('account partition changes cancel an old press even if both accounts are authenticated', async ({ page }) => {
  await detail(page);
  await page.evaluate(() => {
    const { ui, model } = window.stability;
    ui.patchRuntime({ ...model(), auth: { authenticated: true, cachePartition: 'account-a' } });
    ui.navigate('detail', { entityId: 'd0' });
    ui.render({ ...model(), auth: { authenticated: true, cachePartition: 'account-a' } });
  });
  await page.locator('.switch-button').dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'mouse', isPrimary: true });
  await page.evaluate(() => {
    const { ui, model } = window.stability;
    ui.patchRuntime({ ...model(), auth: { authenticated: true, cachePartition: 'account-b' } });
    ui.navigate('detail', { entityId: 'd0' });
    ui.render({ ...model(), auth: { authenticated: true, cachePartition: 'account-b' } });
  });
  await page.locator('.switch-button').dispatchEvent('click', { detail: 1 });
  expect(await page.evaluate(() => window.stability.commands.length)).toBe(0);
  await expect(page.locator('.toast-region')).toContainText('本次操作已取消');
});
