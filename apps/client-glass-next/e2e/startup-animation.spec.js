import { expect, test } from '@playwright/test';

// Vite adds cache-busting timestamps after hot updates; keep fault injection exact.
const mainEntry = /\/src\/main\.js(?:\?.*)?$/;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/weather') ? { status: 'UNAVAILABLE' } : []) }));
});

test('launch icon stays visible until the app shell is ready, then releases the page', async ({ page }) => {
  let releaseMain;
  const mainGate = new Promise((resolve) => { releaseMain = resolve; });
  await page.route(mainEntry, async (route) => {
    await mainGate;
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'commit' });
  const overlay = page.locator('#startup-overlay');
  const icon = overlay.locator('.startup-icon');
  await expect(overlay).toBeVisible();
  await expect(icon).toHaveJSProperty('complete', true);
  await expect(icon).toHaveCSS('animation-name', 'none');
  expect(await icon.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(icon).toHaveAttribute('src', /assets\/startup-icon\.png$/);
  await expect(overlay.locator('.startup-halo')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => {
    const app = document.getElementById('app');
    const startup = document.getElementById('startup-overlay');
    window.__startupFadeState = null;
    const observer = new MutationObserver(() => {
      if (!startup.classList.contains('startup-overlay--leaving')) return;
      window.__startupFadeState = {
        appInert: app.inert,
        appHidden: app.getAttribute('aria-hidden'),
        pointerEvents: getComputedStyle(startup).pointerEvents
      };
      observer.disconnect();
    });
    observer.observe(startup, { attributes: true, attributeFilter: ['class'] });
  });
  releaseMain();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(overlay).toHaveCount(0);
  expect(await page.evaluate(() => window.__startupFadeState)).toEqual({
    appInert: true,
    appHidden: 'true',
    pointerEvents: 'auto'
  });
  await expect(page.locator('#app')).not.toHaveAttribute('aria-hidden');
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
});

test('reduced motion uses a static icon and removes it when the shell is ready', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let releaseMain;
  const mainGate = new Promise((resolve) => { releaseMain = resolve; });
  await page.route(mainEntry, async (route) => {
    await mainGate;
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#startup-overlay')).toBeVisible();
  await expect(page.locator('.startup-icon')).toHaveCSS('animation-name', 'none');
  releaseMain();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
});

test('failed startup offers a retry that recovers after the module loads', async ({ page }) => {
  let attempts = 0;
  await page.route(mainEntry, async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort();
    else await route.continue();
  });

  await page.goto('/');
  await expect(page.locator('#startup-status')).toHaveText('界面启动未完成，请重新加载。', { timeout: 6000 });
  await expect(page.locator('#startup-retry')).toBeVisible();
  expect(await page.locator('.startup-visual').evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('a 5 second module delay shows slow feedback rather than a false startup error', async ({ page }) => {
  await page.clock.install();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(mainEntry, async route => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__iotStartupWatchdog);
  await page.clock.runFor(5100);
  expect(await page.evaluate(() => window.__iotStartupWatchdog.snapshot().state)).toBe('slow');
  await expect(page.locator('#startup-retry')).toBeHidden();
  await expect(page.locator('#startup-status')).toContainText('启动时间较长');
  release(); await page.clock.resume();
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
});

test('soft retry at 7.5 seconds accepts late readiness and cannot resurrect after completion', async ({ page }) => {
  await page.clock.install();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(mainEntry, async route => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__iotStartupWatchdog);
  await page.clock.runFor(7600);
  expect(await page.evaluate(() => window.__iotStartupWatchdog.snapshot().state)).toBe('retryAvailable');
  await expect(page.locator('#startup-retry')).toBeVisible();
  release(); await page.clock.resume();
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  await page.evaluate(() => window.__iotStartupWatchdog.fail());
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
});

test('broken startup artwork has a ready static fallback and does not prevent entering the app', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(mainEntry, async route => { await gate; await route.continue(); });
  await page.route('**/assets/startup-icon.png', route => route.abort());
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#startup-image-fallback')).toBeVisible();
  await expect(page.locator('#startup-overlay')).toHaveAttribute('data-cover-ready', 'true');
  release(); await expect(page.locator('#startup-overlay')).toHaveCount(0);
});

test('forced colors and 200 percent text preserve a reachable retry and stop decorative rings', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.route(mainEntry, route => route.abort());
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.locator('#startup-retry')).toBeVisible();
  await page.locator('#startup-status').evaluate(el => { el.style.fontSize = '26px'; });
  await page.locator('#startup-retry').evaluate(el => { el.style.fontSize = '28px'; });
  const bounds = await page.locator('#startup-retry').boundingBox();
  const statusBounds = await page.locator('#startup-status').boundingBox();
  expect(bounds.width).toBeGreaterThanOrEqual(48); expect(bounds.height).toBeGreaterThanOrEqual(48);
  expect(statusBounds.y + statusBounds.height).toBeLessThanOrEqual(bounds.y - 8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320); expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
  const ring = await page.locator('.startup-visual').evaluate(el => getComputedStyle(el, '::before').animationName);
  expect(ring).toBe('none');
  await page.keyboard.press('Tab'); await expect(page.locator('#startup-retry')).toBeFocused();
  await page.setViewportSize({ width:568, height:320 });
  const landscape = await page.locator('#startup-retry').boundingBox();
  const landscapeStatus = await page.locator('#startup-status').boundingBox();
  expect(landscapeStatus.y + landscapeStatus.height).toBeLessThanOrEqual(landscape.y - 8);
  expect(landscape.y + landscape.height).toBeLessThanOrEqual(320);
});

test('without JavaScript the startup screen gives a visible explanation', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage(); await page.goto(baseURL);
  await expect(page.locator('#startup-noscript')).toBeVisible();
  await expect(page.locator('#startup-overlay')).toBeHidden();
  await context.close();
});

test('solid material removes startup glass filters and decorative rings', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(mainEntry, async route => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await page.locator('#app').evaluate(root => { root.dataset.material = 'solid'; });
  await expect(page.locator('.startup-icon')).toHaveCSS('backdrop-filter', 'none');
  expect(await page.locator('.startup-visual').evaluate(el => getComputedStyle(el, '::before').display)).toBe('none');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('#startup-overlay')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  release();
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
});

test('restored BLE summaries enter offline and load local history only on demand in pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  await page.evaluate(async () => {
    const { CacheRepository } = await import('/src/js/platform/cache-repository.js');
    const cache = new CacheRepository();
    localStorage.setItem('CapacitorStorage.iot-manager.app-install-id.v1', 'history-install');
    const binding = await cache.putLocalBinding({ appInstallId: 'history-install', pluginDeviceId: 'history-device',
      displayName: '历史分页测试设备', lastConnectionState: 'CONNECTED' });
    for (let i = 0; i < 55; i++) await cache.addLocalActivity({ id: `history-${i}`, bindingKey: binding.key,
      eventType: 'local_history', message: `本地记录 ${i}`, occurredAt: new Date(1000 * i).toISOString() });
  });
  await page.reload();
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  const row = page.locator('[data-action="open-device"]').filter({ hasText: '历史分页测试设备' });
  await expect(row).toContainText('离线');
  await page.getByRole('button', { name: '动态', exact: true }).click();
  await expect(page.locator('.timeline-item')).toHaveCount(0);
  await page.getByRole('button', { name: '设备', exact: true }).click();
  await row.click();
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  await expect(page.locator('.timeline-item')).toHaveCount(50);
  await page.getByRole('button', { name: '加载更多本地动态' }).click();
  await expect(page.locator('.timeline-item')).toHaveCount(55);
  await expect(page.getByRole('button', { name: '加载更多本地动态' })).toHaveCount(0);
  expect(await page.locator('[data-activity-key]').evaluateAll(items => new Set(items.map(item => item.dataset.activityKey)).size)).toBe(55);
});
