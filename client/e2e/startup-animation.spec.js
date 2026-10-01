import { expect, test } from '@playwright/test';

test('launch icon stays visible until the app shell is ready, then releases the page', async ({ page }) => {
  let releaseMain;
  const mainGate = new Promise((resolve) => { releaseMain = resolve; });
  await page.route('**/src/main.js', async (route) => {
    await mainGate;
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'commit' });
  const overlay = page.locator('#startup-overlay');
  const icon = overlay.locator('.startup-icon');
  await expect(overlay).toBeVisible();
  await expect(icon).toHaveJSProperty('complete', true);
  expect(await icon.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden', 'true');
  releaseMain();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('#app')).not.toHaveAttribute('aria-hidden');
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
});

test('reduced motion uses a static icon and removes it when the shell is ready', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let releaseMain;
  const mainGate = new Promise((resolve) => { releaseMain = resolve; });
  await page.route('**/src/main.js', async (route) => {
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
  await page.route('**/src/main.js', async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort();
    else await route.continue();
  });

  await page.goto('/');
  await expect(page.locator('#startup-status')).toHaveText('界面启动未完成，请重新加载。', { timeout: 6000 });
  await expect(page.locator('#startup-retry')).toBeVisible();
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  expect(attempts).toBe(2);
});
