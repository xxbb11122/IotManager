import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const rangeSelector = '[data-field=capability-range]';
const stats = page => page.evaluate(() => __glassDemo.store.getDiagnostics().stats);
const model = page => page.evaluate(() => __glassDemo.store.getModel());
const errors = new WeakMap(), external = new WeakMap();
test.beforeEach(async ({ page }) => {
  errors.set(page, []); external.set(page, []);
  page.on('pageerror', error => errors.get(page).push(error.message));
  page.on('request', request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.get(page).push(request.url()); });
  await page.goto('/?test=1');
  await expect(page.locator('[data-action=open-device]').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => __glassDemo.ai.getState().enabled)).toBe(true);
  await page.evaluate(() => __glassDemo.store.setDelay(250));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); expect(external.get(page)).toEqual([]); });
async function openLamp(page) { await page.locator('[data-action=open-device]').first().click(); await expect(page.locator(rangeSelector)).toBeVisible(); }
async function nav(page, screen) { await page.locator('.bottom-nav [data-action=navigate][data-screen=' + screen + ']').click(); }
async function aiScreen(page) { await nav(page, 'ai'); await expect(page.locator('[data-field=ai-question]')).toBeVisible(); }
async function panel(page) { await page.locator('#open-demo-panel').click(); await expect(page.locator('#demo-panel')).toBeVisible(); }
async function scenario(page, value) { await panel(page); await page.locator('#demo-scenario').selectOption(value); await page.locator('#demo-return').click(); }
async function touchMove(page) {
  await page.locator(rangeSelector).scrollIntoViewIfNeeded();
  const bounds = await page.locator(rangeSelector).boundingBox();
  const session = await page.context().newCDPSession(page);
  const start = { id: 1, x: bounds.x + bounds.width * .42, y: bounds.y + bounds.height / 2 };
  const moved = { ...start, x: bounds.x + bounds.width * .8 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
  return { session, moved, second: { id: 2, x: bounds.x + bounds.width / 2, y: moved.y - 40 } };
}
async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
}
test('home, site switch and isolated initial data', async ({ page }) => {
  await expect(page.locator('[data-action=open-device]')).toHaveCount(4);
  await page.locator('[data-action=open-site-switcher]').click();
  await page.locator('[data-action=select-site][data-site-code=demo-b]').click();
  await expect(page.locator('.screen-heading h2')).toHaveText('我的设备');
  expect((await model(page)).context.siteCode).toBe('demo-b');
  await expect(page.locator('[data-action=open-device]').first()).toContainText('实验台照明');
  expect((await stats(page)).commandSubmits).toBe(0);
});
test('native range preview submits only on release and ACK restores focus', async ({ page }) => {
  await openLamp(page);
  const { session } = await touchMove(page);
  const target = Number(await page.locator(rangeSelector).inputValue());
  expect((await stats(page)).commandSubmits).toBe(0);
  expect((await model(page)).devices[0].reportedState.level).toBe(42);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await stats(page)).commandSubmits).toBe(1);
  expect((await model(page)).devices[0].reportedState.level).toBe(42);
  await expect(page.locator(rangeSelector)).toBeDisabled();
  await expect.poll(async () => (await model(page)).devices[0].reportedState.level).toBe(target);
  await expect(page.locator(rangeSelector)).toBeEnabled();
  await page.locator(rangeSelector).focus(); await page.locator(rangeSelector).press('ArrowRight');
  await expect.poll(async () => (await stats(page)).commandSubmits).toBe(2);
  await expect(page.locator(rangeSelector)).toBeEnabled(); await expect(page.locator(rangeSelector)).toBeFocused();
});
test('real multitouch retires old input and a fresh keyboard intent works', async ({ page }) => {
  await openLamp(page);
  await page.evaluate(() => { window.oldInput = document.querySelector('[data-field=capability-range]'); });
  const { session, moved, second } = await touchMove(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [moved, second] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await stats(page)).commandSubmits).toBe(0);
  expect(await page.evaluate(() => oldInput.isConnected)).toBe(false);
  await expect(page.locator(rangeSelector)).toHaveValue('42');
  await page.locator(rangeSelector).focus(); await page.locator(rangeSelector).press('ArrowRight');
  expect((await stats(page)).commandSubmits).toBe(1);
});
test('pointer cancel and late change cannot send a command', async ({ page }) => {
  await openLamp(page);
  await page.evaluate(() => { window.oldInput = document.querySelector('[data-field=capability-range]'); });
  const { session } = await touchMove(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const accepted = await page.evaluate(() => {
    oldInput.dispatchEvent(new Event('change', { bubbles: true }));
    return __glassDemo.ui.rangeGuard.commit(oldInput);
  });
  expect(accepted).toBe(null); expect((await stats(page)).commandSubmits).toBe(0);
  await expect(page.locator(rangeSelector)).toHaveValue('42');
});
for (const outcome of ['failed', 'unconfirmed']) test('command ' + outcome + ' preserves reported value and stays single', async ({ page }) => {
  await panel(page); await page.locator('#demo-outcome').selectOption(outcome); await page.locator('#demo-return').click();
  await openLamp(page); await page.locator(rangeSelector).focus(); await page.locator(rangeSelector).press('ArrowRight');
  await expect(page.locator('[data-region=device-command]')).toContainText(outcome === 'failed' ? '失败' : '结果未确认');
  expect((await model(page)).devices[0].reportedState.level).toBe(42);
  expect((await stats(page)).commandSubmits).toBe(1);
  await expect(page.locator(rangeSelector)).toHaveValue('42');
  if (outcome === 'failed') {
    await page.evaluate(() => __glassDemo.store.setOutcome('ack'));
    await page.locator('[data-action=retry-command]').click();
    await expect.poll(async () => (await model(page)).devices[0].reportedState.level).toBe(43);
    expect((await stats(page)).commandSubmits).toBe(2);
  } else await expect(page.locator('[data-action=retry-command]')).toHaveCount(0);
});
test('power and mode have real mock command receipts', async ({ page }) => {
  await openLamp(page); await page.locator('[data-action=command-capability-toggle]').click();
  await expect.poll(async () => (await model(page)).devices[0].reportedState.power).toBe(false);
  await page.locator('[data-action=command-capability-select]').filter({ hasText: '节能' }).click();
  await expect.poll(async () => (await model(page)).devices[0].reportedState.mode).toBe('eco');
  expect((await stats(page)).commandSubmits).toBe(2);
  await nav(page, 'activity'); await expect(page.locator('[data-region=screen-content]')).toContainText('模拟回执已确认');
});
for (const readonly of ['cache', 'offline', 'unknown']) test(readonly + ' scene has no executable controls', async ({ page }) => {
  await scenario(page, readonly); await page.locator('[data-action=open-device]').first().click();
  await expect(page.locator(rangeSelector)).toHaveCount(0);
  await expect(page.locator('[data-action=command-capability-toggle]')).toHaveCount(0);
  await expect(page.locator('[data-region=device-controls]')).toContainText(readonly === 'unknown' ? '暂无可用控制能力' : '缓存状态');
  expect((await stats(page)).commandSubmits).toBe(0);
});
for (const invalid of ['invalid', 'unknown-value']) test(invalid + ' range disables control and explains why', async ({ page }) => {
  await scenario(page, invalid); await page.locator('[data-action=open-device]').first().click();
  await expect(page.locator(rangeSelector)).toBeDisabled();
  await expect(page.locator('[data-region=device-controls]')).toContainText(invalid === 'invalid' ? '能力范围或步长无效' : '尚未上报有效数值');
  expect((await stats(page)).commandSubmits).toBe(0);
});
test('site change during accepted command suppresses late receipt in the new scope', async ({ page }) => {
  await page.evaluate(() => __glassDemo.store.setDelay(6000)); await openLamp(page);
  await page.locator(rangeSelector).focus(); await page.locator(rangeSelector).press('ArrowRight');
  await page.locator('[data-action=open-site-switcher]').click(); await page.locator('[data-action=select-site][data-site-code=demo-b]').click();
  expect((await model(page)).devices[0].reportedState.level).toBe(68);
  expect((await model(page)).commandsById).toEqual({});
});
test('quick AI prompt fills stable draft and never sends until explicit action', async ({ page }) => {
  await aiScreen(page); await page.locator('[data-ai-id=receipt-help]').click();
  await expect(page.locator('[data-field=ai-question]')).toHaveValue('解释指令待确认、超时与执行失败的区别。');
  await expect(page.locator('[data-field=ai-question]')).toBeFocused();
  expect((await stats(page)).aiSends).toBe(0);
  await page.locator('[data-field=ai-question]').fill('说明当前设备状态');
  await page.evaluate(() => __glassDemo.ui.patchAi(__glassDemo.store.getModel()));
  await expect(page.locator('[data-field=ai-question]')).toHaveValue('说明当前设备状态');
  await page.locator('[data-action=ai-send]').click();
  await expect(page.locator('[data-action=ai-quick-prompt]').first()).toBeDisabled();
  await expect(page.locator('.ai-message--assistant')).toContainText('本地模拟回答');
  expect((await stats(page)).aiSends).toBe(1); expect((await stats(page)).commandSubmits).toBe(0);
});
test('AI processing recovers the original request without a second send', async ({ page }) => {
  await panel(page); await page.locator('#demo-ai-mode').selectOption('processing'); await page.locator('#demo-return').click();
  await aiScreen(page); await page.locator('[data-ai-id=receipt-help]').click(); await page.locator('[data-action=ai-send]').click();
  await expect(page.locator('[data-action=ai-recover]')).toBeVisible();
  await expect(page.locator('.ai-message--assistant')).toContainText('本地模拟回答');
  expect((await stats(page)).aiSends).toBe(1); expect((await stats(page)).aiQueries).toBeGreaterThanOrEqual(1);
});
test('AI stopped local wait can query its result without sending again', async ({ page }) => {
  await aiScreen(page); await page.locator('[data-ai-id=receipt-help]').click(); await page.locator('[data-action=ai-send]').click();
  await page.locator('[data-action=ai-cancel]').click();
  await expect(page.locator('[data-action=ai-recover]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => __glassDemo.ai.getState().busy)).toBe(false);
  // Wait for the simulated server's original result to become available, then explicitly query it.
  await page.waitForTimeout(1100); await page.locator('[data-action=ai-recover]').click();
  await expect(page.locator('.ai-message--assistant')).toContainText('本地模拟回答'); expect((await stats(page)).aiSends).toBe(1);
});
test('AI failed request requires explicit retry and preserves draft contract', async ({ page }) => {
  await panel(page); await page.locator('#demo-ai-mode').selectOption('failed'); await page.locator('#demo-return').click();
  await aiScreen(page); await page.locator('[data-ai-id=receipt-help]').click(); await page.locator('[data-action=ai-send]').click();
  await page.locator('[data-action=ai-recover]').click(); await expect(page.locator('[data-action=ai-retry]')).toBeVisible();
  await panel(page); await page.locator('#demo-ai-mode').selectOption('reply'); await page.locator('#demo-return').click();
  await page.locator('[data-action=ai-retry]').click(); await expect(page.locator('.ai-message--assistant')).toContainText('本地模拟回答');
  expect((await stats(page)).aiSends).toBe(2);
});
test('AI cooldown allows drafting, blocks sending and can then resume', async ({ page }) => {
  await panel(page); await page.locator('#demo-ai-mode').selectOption('rate-limit'); await page.locator('#demo-return').click();
  await aiScreen(page); await page.locator('[data-ai-id=receipt-help]').click(); await page.locator('[data-action=ai-send]').click();
  await expect(page.locator('[data-action=ai-send]')).toBeDisabled(); await page.locator('[data-ai-id=bluetooth-help]').click();
  await expect(page.locator('[data-field=ai-question]')).toHaveValue('说明蓝牙连接断开后重新连接的排查步骤。');
  await panel(page); await page.locator('#demo-ai-mode').selectOption('reply'); await page.locator('#demo-return').click();
  await expect(page.locator('[data-action=ai-send]')).toBeEnabled({ timeout: 7000 });
  await page.locator('[data-action=ai-send]').click(); await expect(page.locator('.ai-message--assistant')).toContainText('本地模拟回答');
});
test('AI history opens and deletes actual mock conversations', async ({ page }) => {
  await aiScreen(page); await page.locator('[data-ai-id=receipt-help]').click(); await page.locator('[data-action=ai-send]').click();
  await expect(page.locator('.ai-message--assistant')).toBeVisible();
  await page.locator('[data-screen=ai-history]').click(); await expect(page.locator('[data-action=ai-select]')).toHaveCount(1);
  await page.locator('[data-action=ai-select]').click(); await expect(page.locator('.ai-message--assistant')).toContainText('本地模拟回答');
  await page.locator('[data-screen=ai-history]').click(); await page.locator('[data-action=ai-delete]').click();
  await expect(page.locator('[data-action=ai-select]')).toHaveCount(0);
});
test('AI persona saves and activates for new conversations', async ({ page }) => {
  await aiScreen(page); await page.locator('[data-screen=ai-persona]').click();
  await page.locator('[data-field=ai-persona-name]').fill('巡检助手'); await page.locator('[data-field=ai-persona-instructions]').fill('使用简洁语气解释模拟状态。');
  await page.locator('[data-action=ai-persona-save]').click(); await expect(page.locator('[data-action=ai-persona-activate]')).toHaveCount(2);
  await page.locator('[data-action=ai-persona-activate][data-ai-id="2"]').click();
  await expect(page.locator('.ai-subtitle').first()).toContainText('巡检助手');
});
test('logout blocks controls and AI, login restores independent demo access', async ({ page }) => {
  await page.locator('[data-action=sign-out]').click(); await page.locator('[data-action=open-device]').first().click();
  await expect(page.locator(rangeSelector)).toHaveCount(0);
  await nav(page, 'ai'); await expect(page.locator('[data-region=ai-content]')).toContainText('登录后可使用');
  await page.locator('.header-actions [data-action=sign-in]').click(); await expect(page.locator('[data-field=ai-question]')).toBeVisible();
  expect((await stats(page)).commandSubmits).toBe(0);
});
test('LAN discover and claim changes the local device list', async ({ page }) => {
  await nav(page, 'add'); await page.locator('[data-action=choose-add-path][data-path=lan]').click();
  await page.locator('[data-action=discover-lan]').first().click(); await page.locator('[data-action=select-candidate]').first().click();
  await page.locator('[data-field=displayName]').fill('测试新增照明'); await page.locator('[data-action=claim-lan]').click();
  await expect(page.locator('[data-action=open-device]')).toHaveCount(5); await expect(page.locator('[data-region=device-list]')).toContainText('测试新增照明');
});
test('mock BLE disconnect and reconnect are functional without hardware', async ({ page }) => {
  await nav(page, 'add'); await page.locator('[data-action=choose-add-path][data-path=ble]').click();
  await page.locator('[data-action=request-ble]').click(); await page.locator('[data-action=disconnect-ble]').click();
  await expect(page.locator('[data-action=connect-ble]')).toBeEnabled(); await page.locator('[data-action=connect-ble]').click();
  await expect(page.locator('[data-action=connect-ble]')).toBeDisabled(); expect((await stats(page)).commandSubmits).toBe(0);
});
test('material and motion switches are independent and survive navigation', async ({ page }) => {
  await page.locator('[data-action=open-connection-settings]').click(); await page.locator('[data-material-mode=solid]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-material', 'solid'); await expect(page.locator('[data-material-mode=solid]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.app-header').evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
  await page.locator('[data-action=demo-toggle-motion]').click();
  expect(await page.evaluate(() => __glassDemo.ui.motionPolicy.snapshot().degraded)).toBe(true);
  await nav(page, 'ai'); await expect(page.locator('#app')).toHaveAttribute('data-material', 'solid');
  await page.locator('[data-action=open-connection-settings]').click(); await page.locator('[data-material-mode=auto]').click();
  expect(await page.evaluate(() => __glassDemo.ui.motionPolicy.snapshot().degraded)).toBe(true);
});
test('panel exports real counters and reset clears accepted pending work', async ({ page }) => {
  await page.evaluate(() => __glassDemo.store.setDelay(6000)); await openLamp(page); await page.locator(rangeSelector).focus(); await page.locator(rangeSelector).press('ArrowRight');
  await panel(page); const downloadEvent = page.waitForEvent('download'); await page.locator('#demo-export').click(); const download = await downloadEvent;
  const record = JSON.parse(await fs.readFile(await download.path(), 'utf8')); expect(record.stats.commandSubmits).toBe(1); expect(record.demoVersion).toBe('1.2.0');
  await page.locator('#demo-reset').click(); await expect(page.locator('#demo-command-count')).toHaveText('0'); await page.locator('#demo-return').click();
  expect((await model(page)).devices[0].reportedState.level).toBe(42); expect((await model(page)).commandsById).toEqual({});
});
for (const width of [320, 390, 414, 768, 820, 1024, 1440]) test('responsive layout ' + width + 'px, including detail and AI', async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await assertNoOverflow(page);
  await openLamp(page); await assertNoOverflow(page);
  await page.locator((width >= 820 ? '.primary-nav' : '.bottom-nav') + ' [data-screen=ai]').click(); await expect(page.locator('[data-field=ai-question]')).toBeVisible();
  await assertNoOverflow(page);
});
test('200% text and simulated safe areas fit a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 }); await panel(page); await page.locator('#demo-text-scale').selectOption('200'); await page.locator('#demo-safe-area').selectOption('1');
  await page.locator('#demo-return').click(); await assertNoOverflow(page);
  await openLamp(page); await assertNoOverflow(page);
  await nav(page, 'ai'); await assertNoOverflow(page); await page.locator('[data-field=ai-question]').fill('测试大字体');
  await page.locator('[data-action=ai-send]').scrollIntoViewIfNeeded(); await expect(page.locator('[data-action=ai-send]')).toBeInViewport();
});
test('forced colors keeps a system-colored range track and crystal focus', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' }); await openLamp(page); await page.locator(rangeSelector).focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const styles = await page.evaluate(() => {
    const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
    const contrast = rules.filter(rule => rule.media?.mediaText.includes('forced-colors'));
    const track = contrast.flatMap(rule => [...rule.cssRules]).find(rule => rule.selectorText === '.range-input--fluid::-webkit-slider-runnable-track');
    return { track: track?.style.borderStyle, focus: getComputedStyle(document.querySelector('[data-field=capability-range]')).outlineStyle };
  });
  expect(styles.track).toBe('solid'); expect(styles.focus).toBe('solid');
  await page.screenshot({ path: 'verification/forced-colors-device.png' });
  await nav(page, 'ai'); await page.locator('[data-field=ai-question]').focus();
  expect(await page.locator('.ai-field').evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
});
test('compact height after textarea focus still permits send and scrolling', async ({ page }) => {
  await aiScreen(page); await page.locator('[data-field=ai-question]').fill('键盘视口测试'); await page.setViewportSize({ width: 390, height: 500 });
  await page.locator('[data-action=ai-send]').scrollIntoViewIfNeeded(); await expect(page.locator('[data-action=ai-send]')).toBeInViewport();
  await page.locator('[data-action=ai-send]').click(); await expect(page.locator('.ai-message--assistant')).toContainText('本地模拟回答'); await assertNoOverflow(page);
});
test('native decimal range display matches the browser value including tiny steps', async ({ page }) => {
  await openLamp(page);
  for (const definition of [{ min: -5.5, max: 5.5, step: .25, value: -1.125 }, { min: 0, max: 1, step: .3, value: 1 }, { min: 0, max: 1, step: .000001, value: .123456 }]) {
    const values = await page.evaluate(definition => {
      const fixture = __glassDemo.store.getModel(), lamp = fixture.devices[0];
      Object.assign(lamp.capabilities.controls.find(row => row.id === 'level'), definition);
      lamp.reportedState.level = definition.value; __glassDemo.ui.render(fixture);
      const input = document.querySelector('[data-field=capability-range]');
      return { input: input.value, output: input.parentElement.querySelector('output').textContent, aria: input.getAttribute('aria-valuetext'), stepMismatch: input.validity.stepMismatch };
    }, definition);
    expect(values.input).toBe(values.output); expect(values.aria).toBe(values.input); expect(values.stepMismatch).toBe(false);
  }
  expect((await stats(page)).commandSubmits).toBe(0);
});
test('context switch during a native drag discards the old input and release', async ({ page }) => {
  await openLamp(page); const { session } = await touchMove(page);
  await page.evaluate(() => __glassDemo.store.switchSite({ siteCode: 'demo-b' }));
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await stats(page)).commandSubmits).toBe(0); expect((await model(page)).devices[0].reportedState.level).toBe(68);
});
test('AI site switch during generation clears the draft and suppresses the old answer', async ({ page }) => {
  await aiScreen(page); await page.locator('[data-ai-id=receipt-help]').click(); await page.locator('[data-action=ai-send]').click();
  await page.locator('[data-action=open-site-switcher]').click(); await page.locator('[data-action=select-site][data-site-code=demo-b]').click();
  await aiScreen(page); await page.waitForTimeout(1100);
  await expect(page.locator('.ai-message')).toHaveCount(0); await expect(page.locator('[data-field=ai-question]')).toHaveValue('');
  expect((await stats(page)).aiSends).toBe(1);
});
test('weather refresh and manual location are functional local operations', async ({ page }) => {
  await page.locator('[data-action=open-weather]').first().click();
  await expect(page.locator('[data-region=screen-content]')).toContainText('多云 · 模拟');
  await page.locator('[data-field=weatherLatitude]').fill('22.5431'); await page.locator('[data-field=weatherLongitude]').fill('114.0579');
  await page.locator('[data-field=weatherTimezone]').fill('Asia/Shanghai'); await page.locator('[data-action=save-manual-weather-location]').click();
  expect((await model(page)).weatherSettings.latitude).toBe(22.5431);
  await page.locator('[data-action=refresh-weather]').click(); await expect(page.locator('[data-region=weather-update-stamp]')).toContainText('更新于');
  expect((await model(page)).weather.current.temperatureC).toBe(24.6); expect((await stats(page)).commandSubmits).toBe(0);
});
