import { test, expect } from '@playwright/test';

async function fixture(page) {
  await page.route('**/__motion-render-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/css/style.css"></head><body><div id="app"></div></body></html>'
  }));
  await page.goto('/__motion-render-fixture');
  await page.evaluate(async () => {
    const { createClientUi } = await import('/src/js/ui.js');
    window.__requests = 0;
    window.__base = {
      context: { siteCode: 'fixture-site' }, runtime: { stale: false, accessRoute: 'SITE_API', sessionRevision: 1 },
      connectionHealth: { status: 'CONNECTED' },
      devices: Array.from({ length: 40 }, (_, index) => ({
        id: `d${index}`, deviceId: `d${index}`, displayName: `设备 ${index}`,
        connections: [{ transport: 'LAN_AGENT', status: 'CONNECTED', profileId: 'relay-v1' }],
        capabilities: { profileId: 'relay-v1', controls: [{ id: 'power', valueType: 'boolean', stateKey: 'on', commandType: 'set_power' }] },
        reportedState: { on: false }, desiredState: { on: false }
      })),
      resources: { devices: { phase: 'ready', freshness: 'fresh' } }
    };
    window.__ui = createClientUi(document.getElementById('app'), {
      pullRefresh: async () => { window.__requests += 1; return { status: 'updated' }; },
      openDevice: () => undefined
    });
    window.__ui.render(window.__base);
  });
}

test('keyed data patches preserve a pressed device row and current field node', async ({ page }) => {
  await fixture(page);
  const row = page.locator('[data-device-ref="d0"]');
  await row.focus();
  await row.evaluate(node => { window.__row = node; });
  await page.evaluate(() => {
    window.__base.devices[0].displayName = '设备名称已更新';
    window.__ui.patchDevices(['d0'], window.__base);
  });
  expect(await row.evaluate(node => node === window.__row)).toBe(true);
  await expect(row).toBeFocused();
  await expect(row).toContainText('设备名称已更新');
  await page.getByRole('button', { name: '连接设置', exact: true }).click();
  const input = page.locator('#endpoint-api-url');
  await input.fill('http://fixture.invalid/api/v1');
  await input.evaluate(node => { node.setSelectionRange(4, 11); window.__field = node; });
  await page.evaluate(() => window.__ui.render({ ...window.__base, resources: { sites: { phase: 'loading' } } }));
  expect(await input.evaluate(node => node === window.__field)).toBe(true);
  expect(await input.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([4, 11]);
  await expect(input).toHaveValue('http://fixture.invalid/api/v1');
});

test('runtime auth errors and stopped command observation are visible without a full navigation', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-device-ref="d0"]').click();
  await page.evaluate(() => {
    window.__base.activeDeviceId = 'd0';
    window.__ui.patchRuntime({ ...window.__base, auth: { configured: true, status: 'restoring' } });
  });
  await expect(page.locator('[data-region="global-feedback"]')).toContainText('正在恢复登录状态');
  await expect(page.locator('[data-action="sign-in"]')).toBeDisabled();
  await page.evaluate(() => {
    window.__base.activeDeviceId = 'd0';
    window.__ui.patchRuntime({ ...window.__base, auth: { error: '续期失败，请重新登录。' } });
  });
  await expect(page.locator('[data-region="global-feedback"]')).toContainText('续期失败');
  await page.evaluate(() => window.__ui.patchCommands(['d0'], {
    ...window.__base,
    commandsById: { c1: { id: 'c1', deviceId: 'd0', status: 'SENT', type: 'set_power' } },
    commandObservation: { c1: { phase: 'exhausted', message: '回执查询已结束，结果仍待核实。' } }
  }));
  await expect(page.locator('[data-region="device-command"]')).toContainText('结果仍待核实');
  await expect(page.locator('[data-region="device-command"] .spinner')).toHaveCount(0);
  await expect(page.locator('[data-region="device-controls"] .spinner')).toHaveCount(0);
  await expect(page.locator('[data-action="retry-command"]')).toHaveCount(0);
  await expect(page.locator('.switch-button')).toBeDisabled();
});

test('trusted touch input supports downward refresh and native upward scrolling', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await fixture(page);
    const session = await context.newCDPSession(page);
    const paragraph = await page.locator('.screen-heading p').boundingBox();
    const x = Math.round(paragraph.x + 8);
    const y = Math.round(paragraph.y + 5);
    const swipe = async (from, to) => {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
      for (let step = 1; step <= 6; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * step / 6 }] });
        await page.waitForTimeout(20);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe(y, y + 220);
    await expect.poll(() => page.evaluate(() => window.__requests)).toBe(1);
    await swipe(450, 200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__requests)).toBe(1);
  } finally { await context.close(); }
});

test('reduced-motion data redraw does not cancel an active refresh gesture', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  await page.evaluate(() => {
    const target = document.querySelector('.screen-heading p');
    const send = (type, y, node = target) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 81, pointerType: 'touch', isPrimary: true, clientX: 20, clientY: y
    }));
    send('pointerdown', 200);
    send('pointermove', 380);
    window.__ui.render(window.__base);
    send('pointerup', 380, document);
  });
  await expect.poll(() => page.evaluate(() => window.__requests)).toBe(1);
  await expect(page.locator('#app')).toHaveAttribute('data-motion', 'reduced');
});

test('exit copies are inert and absent from live field/action selectors', async ({ page }) => {
  await fixture(page);
  await page.locator('[data-action="open-connection-settings"]').click();
  const state = await page.evaluate(() => {
    window.__ui.exitGhost(document.querySelector('[data-region="screen-content"]'));
    const ghost = document.querySelector('#app > .motion-exit');
    return {
      inert: ghost.inert, hidden: ghost.getAttribute('aria-hidden'),
      liveKeys: ghost.querySelectorAll('[data-action], [data-region], [data-field], [id], [role], [aria-live]').length,
      fieldCount: document.querySelectorAll('[data-field="endpointApiUrl"]').length
    };
  });
  expect(state).toEqual({ inert: true, hidden: 'true', liveKeys: 0, fieldCount: 1 });
  await expect(page.locator('#app > .motion-exit')).toHaveCount(0);
});

test('endpoint validation blocks invalid writes and retains local development compatibility', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => window.__ui.bindEvents({ switchEndpoint: () => { window.__requests += 1; } }));
  await page.locator('[data-action="open-connection-settings"]').click();
  await page.locator('#endpoint-api-url').fill('not a url');
  await page.locator('#endpoint-ws-url').fill('ws://localhost/ws');
  await page.locator('[data-action="save-endpoint"]').click();
  await expect(page.locator('#endpoint-api-url')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#endpoint-api-url')).toBeFocused();
  expect(await page.evaluate(() => window.__requests)).toBe(0);
  await page.locator('#endpoint-api-url').fill('/api/v1');
  await page.locator('[data-action="choose-endpoint-route"][data-route="CLOUD_API"]').click();
  await page.locator('[data-action="save-endpoint"]').click();
  expect(await page.evaluate(() => window.__requests)).toBe(1);
  await page.locator('#endpoint-oidc-issuer-url').fill('http://localhost:8081/realms/test');
  await page.locator('[data-action="save-endpoint"]').click();
  expect(await page.evaluate(() => window.__requests)).toBe(1);
  await expect(page.locator('#endpoint-oidc-client-id')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#endpoint-oidc-client-id').fill('fixture-public-client');
  await page.locator('#endpoint-oidc-redirect-uri').fill('http://localhost/callback');
  await page.locator('[data-action="save-endpoint"]').click();
  expect(await page.evaluate(() => window.__requests)).toBe(2);
});

test('BLE selected-candidate status is identity-scoped and a failed scan stop remains retryable', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.__base.ble = {
      native: true, availability: true, scanning: true, errorCode: 'SCAN_STOP_FAILED',
      candidate: { deviceId: 'b', name: 'Candidate B' }, selectedCandidateId: 'b',
      candidates: [{ deviceId: 'a', name: 'Candidate A' }, { deviceId: 'b', name: 'Candidate B' }],
      connection: { deviceId: 'a', status: 'CONNECTED', profileId: 'known' }
    };
    window.__ui.navigate('ble'); window.__ui.render(window.__base);
  });
  await expect(page.locator('[data-action="connect-ble"]')).toContainText('连接此设备');
  await expect(page.locator('[data-action="connect-ble"]')).toBeEnabled();
  await expect(page.locator('[data-action="disconnect-ble"]')).toHaveCount(0);
  await expect(page.locator('[data-action="stop-ble-scan"]')).toBeEnabled();
  await expect(page.locator('[data-region="screen-content"]')).toContainText('未确认扫描已停止');
  await page.evaluate(() => window.__ui.render({ ...window.__base, loading: { bleConnect: true } }));
  await expect(page.locator('[data-action="connect-ble"]')).toBeDisabled();
  await expect(page.locator('[data-action="select-ble-candidate"]').first()).toBeDisabled();
});

test('scope invalidation is immediate but only the newly activated context animates', async ({ page }) => {
  await fixture(page);
  await page.waitForTimeout(240);
  await page.evaluate(() => {
    window.__motions = [];
    document.querySelector('[data-region="screen"]').addEventListener('animationstart', event => {
      if (event.target.matches('[data-region="screen"]')) window.__motions.push(event.animationName);
    });
    window.__base.runtime.sessionRevision += 1;
    window.__ui.render({ ...window.__base, loading: { endpointPhase: 'saving' } });
  });
  await expect(page.locator('[data-region="global-feedback"]')).toContainText('正在保存连接配置');
  await page.waitForTimeout(240);
  expect(await page.evaluate(() => window.__motions)).toEqual([]);
  await page.evaluate(() => {
    window.__base.context.siteCode = 'fixture-new-site';
    window.__ui.render({ ...window.__base, loading: { endpointPhase: 'synchronizing' } });
  });
  await expect.poll(() => page.evaluate(() => window.__motions.length)).toBe(1);
  await expect(page.locator('[data-region="global-feedback"]')).toContainText('正在同步新端点');
  await page.evaluate(() => window.__ui.render(window.__base));
  expect(await page.evaluate(() => window.__motions.length)).toBe(1);
});
