import { expect, test } from '@playwright/test';
import { MOTION_SCENARIOS, PREVIEW_SCREENS } from '../src/dev/motion-preview/scenarios.js';
import { createPreviewFixture } from '../src/dev/motion-preview/fixtures.js';

async function openPreview(page) {
  await page.goto('/__motion/');
  await expect(page.locator('html')).toHaveAttribute('data-preview-ready', 'true');
  return page.frameLocator('#preview-app');
}

test('preview manifest describes all 42 IDs, nine screens and valid isolated fixtures', () => {
  const expected = [['G', 11], ['P', 20], ['C', 11]].flatMap(([prefix, length]) => Array.from({ length }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`));
  expect(MOTION_SCENARIOS.map((scene) => scene.id).sort()).toEqual(expected.sort());
  expect([...new Set(MOTION_SCENARIOS.map((scene) => scene.screen))].sort()).toEqual([...PREVIEW_SCREENS].sort());
  for (const scenario of MOTION_SCENARIOS) {
    for (const variant of scenario.variants) {
      const fixture = createPreviewFixture(scenario, variant);
      expect(fixture.model.endpointProfile.apiBaseUrl).toBe('https://synthetic.invalid');
      expect(fixture.local.screen).toBe(scenario.screen);
      expect(scenario.boundary).toContain('验收');
    }
  }
});

test('isolated preview renders every registered scene without booting main or using a transport', async ({ page }) => {
  test.setTimeout(90000);
  const requests = [];
  const sockets = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  const app = await openPreview(page);
  await expect(page.locator('#preview-scene option')).toHaveCount(42);
  await expect(page.locator('[data-scenario-id]')).toHaveCount(42);
  for (const scene of MOTION_SCENARIOS) {
    for (const variant of scene.variants) {
      await page.evaluate(({ id, variant }) => window.__motionPreview.select(id, variant), { id: scene.id, variant });
      await expect(app.locator('html')).toHaveAttribute('data-scenario', scene.id);
      await expect(app.locator('html')).toHaveAttribute('data-variant', variant);
      await expect(app.locator('#app .app-shell')).toHaveCount(1);
      const expectedScreen = scene.screen === 'detail' && variant === 'empty' ? 'devices' : scene.screen;
      expect(await page.evaluate(() => window.__motionPreview.snapshot().screen)).toBe(expectedScreen);
    }
  }
  expect(requests.filter((url) => /\/api(?:\/|\?)|\/ws(?:\/|\?|$)|\/src\/main\.js/.test(url))).toEqual([]);
  expect(requests.filter((url) => new URL(url).origin !== new URL(page.url()).origin)).toEqual([]);
  expect(sockets).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__motionPreview.snapshot().blockedAttempts)).toEqual([]);
});

test('synthetic command preserves reported truth until ACK and reset cancels old work', async ({ page }) => {
  const app = await openPreview(page);
  await page.evaluate(() => { window.__motionPreview.select('P04', 'ready'); window.__motionPreview.configure({ delayMs: 900, outcome: 'unconfirmed' }); });
  await app.locator('[data-action="command-capability-toggle"]').click();
  await expect(app.locator('.command-card')).toContainText(/待发送|等待回执|发送/);
  expect(await page.evaluate(() => window.__motionPreview.snapshot().model.devices[0].reportedState.relay_a)).toBe(false);
  await expect(app.locator('.command-card')).toContainText('结果未确认');
  await expect(app.locator('.command-card [data-action="retry-command"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__motionPreview.snapshot().simulator.calls.filter((call) => call.name === 'sendCommand').length)).toBe(1);
  await page.evaluate(() => { window.__motionPreview.select('P04', 'ready'); window.__motionPreview.configure({ delayMs: 10000, outcome: 'success' }); window.__motionPreview.run(); });
  expect(await page.evaluate(() => window.__motionPreview.snapshot().simulator.pendingTimers)).toBeGreaterThan(0);
  await page.evaluate(() => window.__motionPreview.reset());
  expect(await page.evaluate(() => window.__motionPreview.snapshot().simulator.pendingTimers)).toBe(0);
  expect(await page.evaluate(() => Object.keys(window.__motionPreview.snapshot().model.commandsById))).toEqual([]);
  await expect(app.locator('.command-card')).toHaveCount(0);
  await page.evaluate(() => { window.__motionPreview.configure({ delayMs: 0, outcome: 'success' }); window.__motionPreview.run(); });
  await expect(app.locator('.command-card')).toContainText('已确认');
  expect(await page.evaluate(() => window.__motionPreview.snapshot().model.devices[0].reportedState.relay_a)).toBe(true);
});

test('preview normal/reduce toggling retains final control state and all screen widths fit', async ({ page }) => {
  test.setTimeout(90000);
  const app = await openPreview(page);
  await page.evaluate(() => { window.__motionPreview.select('C11', 'acknowledged'); window.__motionPreview.configure({ motion: 'reduce' }); });
  const toggle = app.locator('.switch-button');
  await expect(toggle).toHaveClass(/switch-button--on/);
  expect(await toggle.evaluate((button) => getComputedStyle(button).animationName)).toBe('none');
  const knobTransform = await toggle.evaluate((button) => getComputedStyle(button, '::after').transform);
  expect(knobTransform).toBe('matrix(1, 0, 0, 1, 20, 0)');
  await page.evaluate(() => window.__motionPreview.configure({ motion: 'normal' }));
  await expect(toggle).toHaveClass(/switch-button--on/);
  for (const width of [320, 390, 768, 1280]) {
    await page.locator('#preview-viewport').selectOption(String(width));
    for (const screen of PREVIEW_SCREENS) {
      const scene = MOTION_SCENARIOS.find((item) => item.screen === screen);
      await page.evaluate((id) => window.__motionPreview.select(id, 'ready'), scene.id);
      expect(await app.locator('body').evaluate((body) => body.scrollWidth <= document.documentElement.clientWidth + 1), `${screen} at ${width}px`).toBe(true);
    }
  }
});

test('preview illustrates actual empty, partial, permission, OIDC and cooldown states', async ({ page }) => {
  const app = await openPreview(page);
  await page.evaluate(() => window.__motionPreview.select('P12', 'empty'));
  await expect(app.locator('#app')).not.toContainText('正在同步站点列表');
  await page.evaluate(() => window.__motionPreview.select('G09', 'permission-denied'));
  await expect(app.locator('[data-action="open-app-settings"]')).toBeVisible();
  await app.locator('[data-action="open-app-settings"]').click();
  expect(await page.evaluate(() => window.__motionPreview.snapshot().simulator.calls.at(-1).name)).toBe('openBleAppSettings');
  await page.evaluate(() => window.__motionPreview.select('P13', 'remote'));
  await expect(app.locator('[data-field="endpointOidcIssuerUrl"]')).toBeVisible();
  await page.evaluate(() => window.__motionPreview.select('P11', 'partial'));
  await expect(app.locator('#app')).toContainText('主体操作已完成');
  await page.evaluate(() => window.__motionPreview.select('P17', 'cooldown'));
  await expect(app.locator('[data-action="refresh-weather"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(app.locator('[data-region="weather-cooldown"]')).toContainText('冷却');
  await page.evaluate(() => window.__motionPreview.select('P09', 'unknown-profile'));
  await expect(app.locator('#app')).toContainText('未知设备 Profile');
  await expect(app.locator('[data-action="connect-ble"]')).toContainText('已连接');
  await page.evaluate(() => { window.__motionPreview.select('P14', 'ready'); window.__motionPreview.configure({ outcome: 'partial', delayMs: 0 }); window.__motionPreview.run(); });
  await expect(app.locator('[data-region="endpoint-test-result"]')).toHaveClass(/notice--warning/);
  await expect(app.locator('[data-region="endpoint-test-result"]')).toContainText('部分连接可用');
});

test('P19 replay uses the real non-gesture refresh entry exactly once', async ({ page }) => {
  await openPreview(page);
  const result = await page.evaluate(() => {
    window.__motionPreview.select('P19', 'ready');
    window.__motionPreview.configure({ delayMs: 50 });
    return window.__motionPreview.run();
  });
  expect(result.replayed).toBe(true);
  expect(result.action).toBe('pull-refresh');
  await expect.poll(() => page.evaluate(() => window.__motionPreview.snapshot().simulator.calls.filter(call => call.name === 'pullRefresh').length)).toBe(1);
});
