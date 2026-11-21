import { expect, test } from '@playwright/test';
import { materialHarness, noHorizontalOverflow } from './helpers/material-harness.js';

const app = '#app';
const screens = [
  ['P01', 'devices', '.device-list--cards'], ['P03', 'detail', '.detail-layout'],
  ['P06', 'activity', '.screen > .surface'], ['P07', 'add', '.path-choice'],
  ['P09', 'ble', '.screen > .surface'], ['P11', 'lan', '.screen > .surface'],
  ['P12', 'sites', '.screen > .surface'], ['P13', 'connections', '.screen > .surface'],
  ['P18', 'weather', '.weather-overview'], ['P01', 'ai', '.ai-composer'],
  ['P01', 'ai-history', '.ai-history-item'], ['P01', 'ai-persona', '.ai-field']
];

const paint = locator => locator.evaluate(node => {
  const { backgroundColor, backgroundImage, borderTopColor, boxShadow } = getComputedStyle(node);
  return [backgroundColor, backgroundImage, borderTopColor, boxShadow].join('|');
});

test('all twelve production screens use the shared material without per-row optical filters', async ({ page }, testInfo) => {
  test.slow();
  await materialHarness(page);
  for (const [scenario, screen, surface] of screens) {
    await page.evaluate(config => window.materialHarness.mount(config), { scenario, screen });
    const paints = [], backdrops = [];
    for (const mode of ['solid', 'frosted', 'liquid']) {
      await page.evaluate(mode => window.materialHarness.ui.glassAppearance.select(mode), mode);
      await expect(page.locator(app)).toHaveAttribute('data-glass', mode);
      const panel = page.locator(surface).first();
      paints.push(await paint(panel));
      backdrops.push(await paint(page.locator('.app-shell')));
      await expect(panel).toHaveCSS('backdrop-filter', 'none');
      await expect(page.locator('.screen-region liquid-glass')).toHaveCount(0);
      expect(await page.locator('liquid-glass').count()).toBeLessThanOrEqual(2);
      await noHorizontalOverflow(page);
      if (['devices', 'ai', 'connections'].includes(screen)) {
        await page.screenshot({ path: testInfo.outputPath(`${screen}-${mode}.png`), animations: 'disabled', fullPage: screen === 'connections' });
      }
    }
    expect(new Set(paints).size, `${screen}: surface paint changes in each mode`).toBe(3);
    expect(new Set(backdrops).size, `${screen}: workspace background changes in each mode`).toBe(3);
  }
});

test('narrow safe-area header shows all three weather readings, provenance and an explicit login label', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await materialHarness(page);
  await page.evaluate(() => {
    const { ui, model } = window.materialHarness;
    model.auth = { configured: true, authenticated: false, status: 'signed_out' };
    model.context.siteName = '超长的现场站点名称需要省略但不可顶出头部'.repeat(5);
    model.weather.indicators = Object.fromEntries(['temperature', 'humidity', 'pressure'].map(key => [key, { level: 'SUITABLE', label: '适宜' }]));
    document.documentElement.style.setProperty('--safe-area-inset-left', '12px');
    document.documentElement.style.setProperty('--safe-area-inset-right', '14px');
    ui.render(model);
  });
  const header = page.locator('.app-header');
  const metrics = header.locator('.weather-header-metric');
  await expect(header.locator('[data-action="sign-in"] span')).toBeVisible();
  await expect(metrics.filter({ visible: true })).toHaveCount(3);
  expect(await metrics.allTextContents()).toEqual(['25°C', '61%', '1008 hPa']);
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 640 });
    for (const element of await header.locator('.site-picker-trigger, .header-actions button, .weather-header-metric, .header-status').all()) {
      const box = await element.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(12);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 13);
    }
    await noHorizontalOverflow(page);
  }
  await page.evaluate(() => {
    const { ui, model } = window.materialHarness;
    model.weather = { ...model.weather, status: 'EXPIRED' };
    ui.patchWeather(model);
  });
  await expect(header.getByText('上次数据')).toBeVisible();
  await expect(metrics.filter({ visible: true })).toHaveCount(3);
  await expect(header.locator('.weather-header-metric--suitable')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('phone-390-expired.png'), animations: 'disabled' });
  await page.evaluate(() => {
    const { ui, model } = window.materialHarness;
    model.weather = { status: 'UNAVAILABLE' };
    ui.patchWeather(model);
  });
  await expect(header.getByText('天气未配置')).toBeVisible();
});

test('appearance choice is durable and a material click only updates its settings controls', async ({ page }) => {
  await materialHarness(page, { screen: 'connections' });
  const input = page.locator('#endpoint-api-url');
  await input.fill('https://draft.example.test/api/v1');
  await input.evaluate(node => {
    window.originalEndpointField = node;
    const ui = window.materialHarness.ui, original = ui.render.bind(ui);
    window.appearanceFullRenders = 0;
    ui.render = (...args) => { window.appearanceFullRenders++; return original(...args); };
  });
  const option = page.locator('[data-material-mode="frosted"]');
  await option.click();
  await expect(option).toBeFocused();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-material-mode="liquid"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(input).toHaveValue('https://draft.example.test/api/v1');
  expect(await input.evaluate(node => [node === window.originalEndpointField, window.appearanceFullRenders])).toEqual([true, 0]);
  // Navigate away and mount the real UI in a new document on the same origin.
  await page.goto('about:blank');
  await materialHarness(page, { screen: 'connections', expectedMaterial: 'frosted' });
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(app)).toHaveAttribute('data-glass', 'frosted');
  await page.emulateMedia({ contrast: 'more' });
  await expect(page.locator(app)).toHaveAttribute('data-glass', 'solid');
  await page.emulateMedia({ contrast: 'no-preference' });
  await expect(page.locator(app)).toHaveAttribute('data-glass', 'frosted');
});

test('settings have readable field spacing and toasts clear the dock on phone and tablet', async ({ page }) => {
  await materialHarness(page, { screen: 'connections' });
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px'));
    const api = page.locator('#endpoint-api-url').locator('..');
    const ws = page.locator('#endpoint-ws-url').locator('..');
    const first = await api.boundingBox(), second = await ws.boundingBox();
    expect(second.y - first.y - first.height).toBeGreaterThanOrEqual(10);
    await page.evaluate(() => window.materialHarness.ui.notify('现场连接已保存', 'success'));
    const toast = await page.locator('.toast').boundingBox();
    const dock = await page.locator('.bottom-nav').boundingBox();
    expect(toast.y + toast.height).toBeLessThanOrEqual(dock.y - 4);
    await noHorizontalOverflow(page);
  }
});
