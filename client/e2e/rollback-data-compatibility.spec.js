import { expect, test } from '@playwright/test';

const baseUrl = String(process.env.IOT_RUNTIME_BASE_URL ?? '').replace(/\/$/, '');
const ownerUsername = process.env.IOT_E2E_OWNER_USERNAME;
const ownerPassword = process.env.IOT_E2E_OWNER_PASSWORD;
const marker = process.env.IOT_ROLLBACK_MARKER;
const phase = process.env.IOT_ROLLBACK_PHASE;

async function accessToken(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('iot-manager.browser-oidc-session.v1');
    return raw ? JSON.parse(raw).accessToken : null;
  });
}

async function loginAsOwner(browser) {
  expect(baseUrl, 'IOT_RUNTIME_BASE_URL must identify the isolated Caddy endpoint').toBeTruthy();
  expect(ownerUsername, 'IOT_E2E_OWNER_USERNAME must be set').toBeTruthy();
  expect(ownerPassword, 'IOT_E2E_OWNER_PASSWORD must be set').toBeTruthy();
  const context = await browser.newContext({
    ignoreHTTPSErrors: process.env.IOT_RUNTIME_IGNORE_BROWSER_HTTPS_ERRORS === 'true'
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-action').click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#username').fill(ownerUsername);
  await page.locator('#password').fill(ownerPassword);
  await page.locator('#kc-login').click({ noWaitAfter: true });
  await expect.poll(() => accessToken(page), { timeout: 30_000 }).toBeTruthy();
  return { context, page, token: await accessToken(page) };
}

async function api(page, token, path, options = {}) {
  return page.evaluate(async ({ accessToken, requestPath, requestOptions }) => {
    const response = await fetch(requestPath, {
      ...requestOptions,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  }, { accessToken: token, requestPath: path, requestOptions: options });
}

test.describe('N to N-1 rollback data compatibility', () => {
  test('writes under N and reads plus writes under N-1', async ({ browser }) => {
    test.setTimeout(90_000);
    expect(['write', 'read'], 'IOT_ROLLBACK_PHASE must be write or read').toContain(phase);
    expect(marker, 'IOT_ROLLBACK_MARKER must identify this drill').toMatch(/^rollback-[a-z0-9-]+$/);
    const { context, page, token } = await loginAsOwner(browser);
    try {
      if (phase === 'write') {
        // /api/v1/time is an additive N feature. Requiring it from N-1 would
        // incorrectly fail an otherwise compatible application rollback.
        const serverTime = await api(page, token, '/api/v1/time');
        expect(serverTime.status, JSON.stringify(serverTime.body)).toBe(200);
        expect(serverTime.body?.zone).toBe('UTC');
        const created = await api(page, token, '/api/v1/devices?siteCode=primary-site', {
          method: 'POST',
          body: JSON.stringify({
            name: marker,
            type: 'SENSOR',
            protocol: 'HTTP',
            location: 'rollback-drill',
            firmwareVersion: 'rollback-n',
            status: 'ONLINE'
          })
        });
        expect(created.status, JSON.stringify(created.body)).toBe(200);
        expect(created.body?.name).toBe(marker);
        const submitted = await api(page, token, `/api/v1/devices/${created.body.id}/commands`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'set_power',
            idempotencyKey: `${marker}-n-command`,
            parameters: { on: true }
          })
        });
        expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
        expect(submitted.body?.commandId).toBeTruthy();
        return;
      }

      const found = await api(page, token,
        `/api/v1/devices?siteCode=primary-site&search=${encodeURIComponent(marker)}`);
      expect(found.status, JSON.stringify(found.body)).toBe(200);
      expect(found.body?.some((device) => device.name === marker)).toBe(true);
      const nDevice = found.body.find((device) => device.name === marker);
      const nCommands = await api(page, token, `/api/v1/commands?deviceId=${nDevice.id}&type=set_power`);
      expect(nCommands.status, JSON.stringify(nCommands.body)).toBe(200);
      expect(nCommands.body?.items?.length).toBeGreaterThan(0);
      const nCommand = nCommands.body.items[0];
      expect(nCommand.commandId).toBeTruthy();
      // The protected drill fixes both N-1 TZ and the new legacy compatibility
      // zone to Asia/Shanghai. A UTC-naive dual-write would appear eight hours
      // old to N-1 even though its authoritative Instant is correct.
      const legacyRequestedAt = Date.parse(`${nCommand.requestedAt}+08:00`);
      expect(Number.isFinite(legacyRequestedAt)).toBe(true);
      expect(Math.abs(Date.now() - legacyRequestedAt)).toBeLessThan(90 * 60_000);

      const nMinusOneWrite = await api(page, token, '/api/v1/devices?siteCode=primary-site', {
        method: 'POST',
        body: JSON.stringify({
          name: `${marker}-n1-write`,
          type: 'SENSOR',
          protocol: 'HTTP',
          location: 'rollback-drill',
          firmwareVersion: 'rollback-n1',
          status: 'ONLINE'
        })
      });
      expect(nMinusOneWrite.status, JSON.stringify(nMinusOneWrite.body)).toBe(200);
      expect(nMinusOneWrite.body?.name).toBe(`${marker}-n1-write`);
      const nMinusOneCommand = await api(page, token, `/api/v1/devices/${nMinusOneWrite.body.id}/commands`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'set_power',
          idempotencyKey: `${marker}-n1-command`,
          parameters: { on: false }
        })
      });
      expect(nMinusOneCommand.status, JSON.stringify(nMinusOneCommand.body)).toBe(202);
      expect(nMinusOneCommand.body?.commandId).toBeTruthy();
    } finally {
      await context.close();
    }
  });
});
