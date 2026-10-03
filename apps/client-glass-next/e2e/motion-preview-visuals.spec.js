import { test, expect } from '@playwright/test';

test('exports representative real-UI snapshots in normal and reduced motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/__motion/');
  await expect(page.locator('html')).toHaveAttribute('data-preview-ready', 'true');
  const scenes = [
    ['devices', 'P01', 'ready'], ['detail', 'P04', 'acknowledged'], ['activity', 'P06', 'ready'],
    ['add', 'P07', 'ready'], ['ble', 'P08', 'ready'], ['lan', 'P11', 'ready'],
    ['sites', 'P12', 'ready'], ['connections', 'P13', 'remote'], ['weather', 'P15', 'ready']
  ];
  for (const motion of ['normal', 'reduce']) {
    for (const [screen, id, variant] of scenes) {
      await page.evaluate(({ id, variant, motion }) => {
        window.__motionPreview.configure({ motion });
        window.__motionPreview.select(id, variant);
      }, { id, variant, motion });
      await expect(page.frameLocator('#preview-app').locator('html')).toHaveAttribute('data-scenario', id);
      // Capture the settled visual, not a random animation frame. Assertions
      // about motion/request timing live in the behavioral suites.
      await page.waitForTimeout(240);
      const path = testInfo.outputPath(`${screen}-${motion}.png`);
      await page.locator('#preview-app').screenshot({ path });
      await testInfo.attach(`${screen}-${motion}`, { path, contentType: 'image/png' });
    }
  }
  await page.evaluate(() => { window.__motionPreview.configure({ motion: 'normal' }); window.__motionPreview.select('P04', 'ready'); });
  await page.waitForTimeout(240);
  await page.screenshot({ path: testInfo.outputPath('preview-workbench.png'), fullPage: true });
});
