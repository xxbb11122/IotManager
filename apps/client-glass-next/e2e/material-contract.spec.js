import {test, expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {materialHarness, noHorizontalOverflow, expectOpaqueMode} from './helpers/material-harness.js';

const output = process.env.IOT_PLAYWRIGHT_OUTPUT_DIR || 'verification';
async function snapshot(page, name) {
  await mkdir(output, {recursive: true});
  await page.evaluate(() => {document.activeElement?.blur(); window.scrollTo(0, 0);});
  await page.screenshot({path: join(output, 'glass5-' + name + '.png'), animations: 'disabled'});
}

// Sample the actual composited background, including transparency and blur.
// Hide only foreground paint while retaining the original geometry/material.
async function minimumRenderedContrast(page, locator) {
  const original = await locator.evaluate(node => {
    const color = getComputedStyle(node).color;
    const styles = [node, ...node.querySelectorAll('*')].map(item => ({style: item.getAttribute('style')}));
    for (const item of [node, ...node.querySelectorAll('*')]) item.style.color = 'transparent';
    return {color, styles};
  });
  let png;
  try { png = await locator.screenshot({animations: 'disabled'}); }
  finally {
    await locator.evaluate((node, styles) => {
      [node, ...node.querySelectorAll('*')].forEach((item, index) => {
        const saved = styles[index]?.style;
        if (saved == null) item.removeAttribute('style'); else item.setAttribute('style', saved);
      });
    }, original.styles);
  }
  return page.evaluate(async ({image, color}) => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + image)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
    const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
    const luminance = rgb => rgb.map(value => {const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;})
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const text = luminance(color.match(/[\d.]+/g).slice(0, 3).map(Number));
    let minimum = Infinity;
    for (let y = 10; y < canvas.height - 10; y += 3) for (let x = 10; x < canvas.width - 10; x += 3) {
      const offset = (y * canvas.width + x) * 4;
      const background = luminance([...data.slice(offset, offset + 3)]);
      minimum = Math.min(minimum, (Math.max(text, background) + .05) / (Math.min(text, background) + .05));
    }
    return minimum;
  }, {image: png.toString('base64'), color: original.color});
}

test('T01: all AI pages retain a CSS workspace when optional optics cannot load', async ({page}) => {
  await page.route(/simple-liquid-glass|web-component(?:\.esm)?/, route => route.abort());
  await materialHarness(page, {screen: 'ai'});
  await expect(page.locator('#app')).toHaveAttribute('data-glass-optics', 'unavailable');
  for (const screen of ['ai','ai-persona','ai-history']) {
    await page.evaluate(screen => window.materialHarness.mount({screen}), screen);
    await expect(page.locator('.ai-workspace')).toHaveCSS('backdrop-filter', /blur/);
    await expect(page.locator('.ai-workspace')).not.toHaveCSS('background-image', 'none');
    await expect(page.locator('.ai-workspace')).toHaveCSS('border-top-width', '1px');
    await noHorizontalOverflow(page);
  }
  await page.evaluate(() => window.materialHarness.mount({screen: 'ai-persona'}));
  await page.locator('#ai-persona-name').fill('无需光学脚本也能输入');
  await expect(page.locator('#ai-persona-name')).toHaveValue('无需光学脚本也能输入');
});

test('T02: system and explicit solid modes disable every managed filter and preserve the material choice', async ({page}) => {
  await materialHarness(page, {screen: 'ai-persona'});
  await page.evaluate(() => window.materialHarness.ui.glassAppearance.select('solid'));
  await expectOpaqueMode(page);
  await page.evaluate(() => window.materialHarness.ui.glassAppearance.select('frosted'));
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'frosted');
  await page.emulateMedia({contrast: 'more'});
  await expectOpaqueMode(page);
  await page.emulateMedia({contrast: 'no-preference'});
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'frosted');
  await page.emulateMedia({forcedColors: 'active'});
  await expectOpaqueMode(page);
  await page.emulateMedia({forcedColors: 'none', reducedMotion: 'reduce'});
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'frosted');
  await expect(page.locator('#app')).toHaveAttribute('data-motion', 'reduced');
});

test('T03: optics are idempotent, inert, absent from input hosts and do not replace a focused draft', async ({page}) => {
  await materialHarness(page, {screen: 'ai-persona'});
  const input = page.locator('#ai-persona-name');
  await input.fill('保留输入'); await input.focus();
  await input.evaluate(node => {window.originalMaterialInput = node;});
  await page.evaluate(() => window.materialHarness.patch());
  await expect(input).toBeFocused(); await expect(input).toHaveValue('保留输入');
  expect(await input.evaluate(node => node === window.originalMaterialInput)).toBe(true);
  expect(await page.locator('input liquid-glass, select liquid-glass, textarea liquid-glass').count()).toBe(0);
  const ownership = await page.evaluate(async () => {
    const {addGlassSurface} = await import('/src/js/appearance/glass-surfaces.js');
    const button = document.querySelector('.header-actions .button');
    addGlassSurface(button); addGlassSurface(button);
    const lens = button.querySelector(':scope > .liquid-surface-layer');
    const input = document.createElement('input'); input.className = 'button'; addGlassSurface(input);
    return {layers: button.querySelectorAll(':scope > .liquid-surface-layer').length,
      hidden: lens.getAttribute('aria-hidden'), inert: lens.hasAttribute('inert'),
      pointer: getComputedStyle(lens).pointerEvents, inputChildren: input.childElementCount};
  });
  expect(ownership).toEqual({layers: 1, hidden: 'true', inert: true, pointer: 'none', inputChildren: 0});
  await expect(page.locator('.ai-workspace > .liquid-surface-layer, .ai-field > .liquid-surface-layer')).toHaveCount(0);
});

test('T04: notices retain distinct semantic text and surfaces in glass and solid modes', async ({page}) => {
  await materialHarness(page, {screen: 'ai'});
  await page.evaluate(() => window.materialHarness.notices());
  for (const mode of ['liquid','frosted','solid']) {
    await page.evaluate(mode => window.materialHarness.ui.glassAppearance.select(mode), mode);
    const tones = await page.locator('[data-material-notices] .notice').evaluateAll(nodes => nodes.map(node => {
      const css = getComputedStyle(node); return {color: css.color, background: css.background};
    }));
    expect(new Set(tones.map(row => row.color)).size).toBe(4);
    expect(new Set(tones.map(row => row.background)).size).toBe(4);
    await expect(page.locator('.ai-notice--error')).toHaveAttribute('role', 'alert');
    const color = await page.locator('.ai-notice--error').evaluate(node => getComputedStyle(node).color);
    expect(color).toBe(tones[2].color);
    for (const notice of await page.locator('[data-material-notices] .notice, .ai-notice--error').all())
      expect(await minimumRenderedContrast(page, notice)).toBeGreaterThanOrEqual(4.5);
  }
});

test('T05: detail keeps a single continuous panel and reports selected capabilities accessibly', async ({page}) => {
  await materialHarness(page, {scenario: 'P03'});
  await expect(page.locator('[data-region=device-detail-panel]')).toHaveCSS('backdrop-filter', /blur/);
  for (const selector of ['.state-panel','.state-comparison','[data-region=device-state]','[data-region=device-controls]']) {
    for (const node of await page.locator(selector).all()) {
      await expect(node).toHaveCSS('backdrop-filter', 'none');
      await expect(node).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
  }
  await expect(page.locator('.mode-button--selected')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mode-button:not(.mode-button--selected)').first()).toHaveAttribute('aria-pressed', 'false');
  await snapshot(page, 'detail');
});

test('T07: persona and history have visible focus, usable fields and wrapping at 320px', async ({page}) => {
  await materialHarness(page, {screen: 'ai-persona'});
  await page.setViewportSize({width: 320, height: 844});
  const name = page.locator('#ai-persona-name');
  await expect(name).toHaveCSS('min-height', '48px');
  await expect(page.locator('#ai-persona-instructions')).toHaveCSS('min-height', '88px');
  await name.focus();
  await expect(name).toHaveCSS('outline-style', 'solid');
  await expect(name).toHaveCSS('outline-width', '2px');
  await expect(page.locator('.ai-field').first()).toHaveCSS('padding-left', '16px');
  await noHorizontalOverflow(page);
  await snapshot(page, 'ai-persona');
  await page.evaluate(() => window.materialHarness.mount({screen: 'ai-history'}));
  await expect(page.locator('.ai-history-item')).toHaveCSS('padding-left', '16px');
  expect(await page.locator('.ai-history-title').evaluate(node => node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight))).toBeLessThanOrEqual(3.1);
  await expect(page.locator('.ai-history-title')).toContainText('设备状态核对'.repeat(30));
  await noHorizontalOverflow(page);
  await snapshot(page, 'ai-history');
});

test('T08: hourly forecast has boundaries while metrics stay on the continuous weather surface', async ({page}) => {
  await materialHarness(page, {scenario: 'P18'});
  await expect(page.locator('.weather-hourly-item').first()).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('.weather-metric').first()).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.weather-metric').first()).toHaveCSS('backdrop-filter', 'none');
  await snapshot(page, 'weather');
});

test('T01/T09: independent empty, BLE/LAN and segmented panels keep navigation and touch targets', async ({page}) => {
  for (const [scenario, variant, selector] of [['P01','empty','.empty-state--panel'], ['P11','selected','.ble-device-summary'], ['P13','ready','.segmented-control']]) {
    await materialHarness(page, {scenario, variant});
    await expect(page.locator(selector).first()).toHaveCSS('backdrop-filter', /blur/);
    await expect(page.locator('.app-header')).toHaveCSS('position', 'sticky');
    await expect(page.locator('.bottom-nav')).toHaveCSS('position', 'sticky');
    for (const target of ['.site-picker-trigger','.weather-header-summary','.bottom-nav .nav-button'])
      for (const node of await page.locator(target).all()) expect((await node.boundingBox()).height).toBeGreaterThanOrEqual(48);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const nav = await page.locator('.bottom-nav').boundingBox();
    expect(nav.y + nav.height).toBeLessThanOrEqual(845);
    await noHorizontalOverflow(page);
  }
});

test('T03: background optics stop and destroyed UI releases its observers', async ({page}) => {
  await materialHarness(page);
  const result = await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', {configurable: true, value: true});
    document.dispatchEvent(new Event('visibilitychange'));
    const effects = () => [...document.querySelectorAll('liquid-glass')].map(node => node.getAttribute('effect-mode'));
    const hidden = effects();
    Object.defineProperty(document, 'hidden', {configurable: true, value: false});
    document.dispatchEvent(new Event('visibilitychange'));
    const visible = effects();
    window.materialHarness.ui.destroy();
    const stopped = effects();
    if (original) Object.defineProperty(document, 'hidden', original); else delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    return {hidden, visible, stopped, after: effects()};
  });
  expect(result.hidden.every(value => value === 'off')).toBe(true);
  expect(result.visible.some(value => value === 'auto')).toBe(true);
  expect(result.stopped.every(value => value === 'off')).toBe(true);
  expect(result.after).toEqual(result.stopped);
});

test('T09: twelve pages fit seven phone and desktop widths and enlarged text', async ({page}) => {
  test.setTimeout(90_000);
  await materialHarness(page);
  const screens = [['P01','devices'],['P03','detail'],['P06','activity'],['P07','add'],
    ['P09','ble'],['P11','lan'],['P12','sites'],['P13','connections'],['P18','weather'],
    ['P01','ai'],['P01','ai-history'],['P01','ai-persona']];
  for (const width of [320,390,414,768,820,1024,1440]) {
    await page.setViewportSize({width, height: 900});
    for (const [scenario, screen] of screens) {
      await page.evaluate(configuration => window.materialHarness.mount(configuration), {scenario, screen});
      await noHorizontalOverflow(page);
    }
  }
  await page.setViewportSize({width: 390, height: 844});
  for (const screen of ['ai','ai-history','ai-persona','connections']) {
    await page.evaluate(screen => window.materialHarness.mount({screen}), screen);
    await page.evaluate(() => {document.documentElement.style.fontSize = '200%';});
    await noHorizontalOverflow(page);
  }
});

test('T10: startup glass respects system contrast before the main module loads', async ({page}) => {
  await page.emulateMedia({contrast: 'more'});
  await page.route(/\/src\/main\.js(?:\?.*)?$/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#startup-overlay')).toBeVisible();
  await expect(page.locator('.startup-icon')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('#startup-retry')).toBeVisible({timeout: 6000});
  await expect(page.locator('#startup-retry')).toHaveCSS('min-height', '48px');
  await page.locator('#startup-retry').focus();
  await expect(page.locator('#startup-retry')).toHaveCSS('outline-style', 'solid');
});

test('T10: no-JavaScript startup exposes a readable recovery message', async ({browser, baseURL}) => {
  const context = await browser.newContext({javaScriptEnabled: false});
  try {
    const page = await context.newPage(); await page.goto(baseURL);
    await expect(page.locator('#startup-overlay')).toBeHidden();
    await expect(page.locator('#startup-noscript')).toBeVisible();
    await expect(page.locator('#startup-noscript')).toContainText('设备运营需要启用 JavaScript');
  } finally { await context.close(); }
});
