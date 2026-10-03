import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-action=open-device]')).toHaveCount(4);
});

test('material comparison renders a real WebGL surface and releases it on close', async ({ page }) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.locator('#open-material-preview').click();
  const sample = page.locator('#liquid-material-sample');
  await expect(sample).toHaveAttribute('data-glass-strategy', 'webgl');
  expect(await sample.evaluate(node => node.shadowRoot.querySelector('canvas')?.width)).toBeGreaterThan(0);
  await expect(page.locator('#material-renderer')).toHaveText('折射已启用');
  await page.screenshot({ path: 'verification/liquid-comparison-desktop.png' });
  await page.locator('#material-preview-return').click();
  await expect(sample).toHaveAttribute('effect-mode', 'off');
  expect(await sample.evaluate(node => node.shadowRoot.querySelector('canvas'))).toBe(null);
  expect(failures).toEqual([]);
});

test('comparison settings survive navigation and existing automatic material restores optics', async ({ page }) => {
  await page.locator('#open-material-preview').click();
  await page.locator('[data-glass-choice=frosted]').click();
  await page.locator('#material-preview-return').click();
  await page.locator('.bottom-nav [data-screen=ai]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'frosted');
  await page.locator('#open-material-preview').click();
  await page.locator('[data-glass-choice=liquid]').click();
  await page.locator('[data-glass-choice=solid]').click();
  await page.locator('#material-preview-return').click();
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'solid');
  await page.locator('[data-action=open-connection-settings]').click();
  await page.locator('[data-material-mode=auto]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'liquid');
  await page.locator('.bottom-nav [data-screen=devices]').click();
  await page.locator('[data-action=open-device]').first().click();
  const range = page.locator('[data-field=capability-range]');
  await page.evaluate(() => __glassDemo.store.setDelay(250));
  await range.focus(); await range.press('ArrowRight');
  await expect(range).toHaveValue('43');
  await expect.poll(() => page.evaluate(() => __glassDemo.store.getModel().devices[0].reportedState.level)).toBe(43);
  expect(await page.evaluate(() => __glassDemo.store.getDiagnostics().stats.commandSubmits)).toBe(1);
  await expect(page.locator('.bottom-nav > liquid-glass')).toHaveCount(1);
});

test('reduced motion remains static and high contrast uses solid surfaces', async ({ page }) => {
  await page.locator('[data-action=open-connection-settings]').click();
  await page.locator('[data-action=demo-toggle-motion]').click();
  await page.locator('.bottom-nav [data-screen=ai]').click();
  expect(await page.locator('.liquid-nav-lens').first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'liquid');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'solid');
  await page.locator('#open-material-preview').click();
  await expect(page.locator('#liquid-material-sample')).toHaveAttribute('effect-mode', 'off');
  await page.locator('#material-preview-return').click();
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'liquid');
});

test('comparison fits a narrow screen with enlarged text and remains keyboard dismissible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('#open-demo-panel').click();
  await page.locator('#demo-text-scale').selectOption('200');
  await page.locator('#demo-return').click();
  await page.locator('#open-material-preview').click();
  const bounds = await page.locator('#material-preview').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#material-preview')).not.toBeVisible();
  await expect(page.locator('#liquid-material-sample')).toHaveAttribute('effect-mode', 'off');
});
