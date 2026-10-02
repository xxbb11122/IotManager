import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const base = process.env.GLASS_DEMO_URL ?? 'http://127.0.0.1:5188';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'verification');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [], external = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => { if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url()); });
async function check(name, run) { await run(); checks.push({ name, passed: true }); }
let failure = null;
try {
  await page.goto(base);
  await check('Built home loads four devices, without a test global', async () => {
    await expect(page.locator('[data-action=open-device]')).toHaveCount(4);
    expect(await page.evaluate(() => typeof globalThis.__glassDemo)).toBe('undefined');
  });
  await page.waitForTimeout(250); await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'mobile-home.png') });
  await page.locator('[data-action=open-device]').first().click();
  await check('Built range command waits and displays confirmed mock ACK', async () => {
    const range = page.locator('[data-field=capability-range]');
    await range.focus(); await range.press('ArrowRight');
    await expect(range).toBeDisabled(); await expect(range).toBeEnabled(); await expect(range).toHaveValue('43');
    await expect(page.locator('[data-region=device-command]')).toContainText('已确认');
  });
  await page.locator('[data-region=device-controls]').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.activeElement?.blur()); await page.screenshot({ animations: 'disabled', path: path.join(output, 'mobile-device.png') });
  await page.locator('[data-action=open-connection-settings]').click();
  await check('Built solid material applies and keeps its selected state', async () => {
    await page.locator('[data-material-mode=solid]').click();
    await expect(page.locator('#app')).toHaveAttribute('data-material', 'solid');
    await expect(page.locator('[data-material-mode=solid]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('.app-header').evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
    await page.locator('[data-material-mode=auto]').click();
  });
  await page.locator('.bottom-nav [data-screen=ai]').click();
  await check('Built AI quick prompt, explicit send and simulation label work', async () => {
    await page.locator('[data-ai-id=receipt-help]').click();
    await expect(page.locator('[data-field=ai-question]')).toHaveValue('解释指令待确认、超时与执行失败的区别。');
    await page.locator('[data-action=ai-send]').click(); await expect(page.locator('.ai-message--assistant')).toContainText('本地模拟回答');
  });
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'mobile-ai.png') });
  await check('Built test panel records submissions and resets its data', async () => {
    await page.locator('#open-demo-panel').click(); await expect(page.locator('#demo-command-count')).toHaveText('1');
    await expect(page.locator('#demo-ai-count')).toHaveText('1');
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'test-panel.png') });
    await page.locator('#demo-reset').click(); await expect(page.locator('#demo-command-count')).toHaveText('0'); await page.locator('#demo-return').click();
  });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(base);
  await expect(page.locator('[data-action=open-device]')).toHaveCount(4);
  await page.waitForTimeout(250); await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'desktop-home.png') });
  await check('No production source or module folder is exposed by the static server', async () => {
    expect((await page.request.get(base + '/src/main.js')).status()).toBe(404);
    expect((await page.request.get(base + '/client/src/js/main.js')).status()).toBe(404);
  });
  await check('No page error or external request during built operations', async () => { expect(errors).toEqual([]); expect(external).toEqual([]); });
} catch (error) { failure = error.stack; process.exitCode = 1; }
finally {
  const assets = [];
  for (const name of await fs.readdir(path.join(root, 'dist/assets'))) {
    const bytes = await fs.readFile(path.join(root, 'dist/assets', name));
    assets.push({ file: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  const result = { verifiedAt: new Date().toISOString(), browser: browser.version(), target: 'dependency-free static build', checks, failure, errors, external, assets };
  await fs.writeFile(path.join(output, 'built-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, failure, errors, external })); await browser.close();
}
