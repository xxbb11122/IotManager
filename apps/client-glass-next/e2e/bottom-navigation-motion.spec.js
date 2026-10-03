import { expect, test } from '@playwright/test';

test('bottom module selection follows four peers and respects reduced motion', async ({ page }, testInfo) => {
  await page.route('**/__bottom-navigation-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/css/style.css"></head><body><div id="app"></div></body></html>'
  }));
  await page.goto('/__bottom-navigation-fixture');
  await page.evaluate(async () => {
    const { createClientUi } = await import('/src/js/ui.js');
    window.__navModel = { context: { siteCode: 'demo-site' }, runtime: { accessRoute: 'SITE_API' }, devices: [] };
    window.__navUi = createClientUi(document.getElementById('app'));
    window.__navUi.render(window.__navModel);
    window.__navNode = document.querySelector('.bottom-nav');
  });

  const nav = page.locator('.bottom-nav');
  const buttons = nav.locator('.nav-button');
  await expect(buttons).toHaveCount(4);
  expect(await nav.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(4);
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'devices');

  await nav.locator('[data-screen="ai"]').click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'ai');
  await page.waitForTimeout(240);
  const aiGeometry = await nav.evaluate(element => {
    const track = element.querySelector('.nav-button').getBoundingClientRect().width;
    const indicator = getComputedStyle(element, '::before');
    return { track, width: parseFloat(indicator.width), offset: new DOMMatrix(indicator.transform).m41 };
  });
  expect(Math.abs(aiGeometry.width - aiGeometry.track)).toBeLessThan(1);
  expect(Math.abs(aiGeometry.offset - aiGeometry.track)).toBeLessThan(1);
  await nav.screenshot({ path: testInfo.outputPath('bottom-nav-ai.png') });

  await page.evaluate(() => { window.__navUi.navigate('ai-history'); window.__navUi.render(window.__navModel); });
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'ai');
  await nav.locator('[data-screen="activity"]').click();
  await nav.locator('[data-screen="add"]').click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'add');
  await page.waitForTimeout(240);
  const finalOffset = await nav.evaluate(element => new DOMMatrix(getComputedStyle(element, '::before').transform).m41);
  expect(Math.abs(finalOffset - aiGeometry.track * 3)).toBeLessThan(1);
  expect(await nav.evaluate(element => element === window.__navNode)).toBe(true);
  await nav.locator('[data-screen="add"]').click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'add');
  await nav.locator('[data-screen="activity"]').focus();
  await expect(nav.locator('[data-screen="activity"]')).toBeFocused();
  await page.evaluate(() => window.__navUi.render(window.__navModel));
  expect(await nav.evaluate(element => element === window.__navNode)).toBe(true);
  await expect(nav.locator('[data-screen="activity"]')).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await nav.locator('[data-screen="devices"]').click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'devices');
  const reduced = await nav.evaluate(element => {
    const indicator = getComputedStyle(element, '::before');
    const tabs = [...element.querySelectorAll('.nav-button')].map(button => button.getBoundingClientRect());
    return {
      offset: new DOMMatrix(indicator.transform).m41,
      durations: indicator.transitionDuration.split(',').map(value => value.trim()),
      widths: tabs.map(tab => tab.width),
      heights: tabs.map(tab => tab.height),
      overflow: document.documentElement.scrollWidth > innerWidth
    };
  });
  expect(reduced.offset).toBe(0);
  expect(reduced.durations.every(value => value === '0s')).toBe(true);
  expect(reduced.widths.every(width => width >= 48)).toBe(true);
  expect(reduced.heights.every(height => height >= 48)).toBe(true);
  expect(reduced.overflow).toBe(false);
});
