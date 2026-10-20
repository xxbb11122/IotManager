import { test, expect } from '@playwright/test';

async function unreadableSettings(page, baseURL) {
  const requests = [];
  const profile = { id: 'saved', accessRoute: 'SITE_API', apiBaseUrl: new URL('/api/v1', baseURL).href,
    wsUrl: new URL('/ws/devices', baseURL).href.replace(/^http/, 'ws'), organizationCode: 'saved-org',
    oidcIssuerUrl: 'https://saved.example.invalid/oidc', oidcClientId: 'saved-client', oidcRedirectUri: new URL('/', baseURL).href };
  await page.addInitScript(({ profile }) => {
    const key = 'CapacitorStorage.iot-manager.active-endpoint.v1';
    localStorage.setItem(key, JSON.stringify(profile));
    sessionStorage.setItem('iot-manager.oidc-session.v1', JSON.stringify({ accessToken: 'browser-fixture',
      cachePartition: 'saved-owner', issuerUrl: profile.oidcIssuerUrl, clientId: profile.oidcClientId, expiresAt: Date.now() + 3600000 }));
    const getItem = Storage.prototype.getItem;
    window.__savedSettingsReadable = false;
    Storage.prototype.getItem = function (name) {
      if (this === window.localStorage && name === key && !window.__savedSettingsReadable) throw new Error('Fixture storage unavailable');
      return getItem.call(this, name);
    };
  }, { profile });
  await page.routeWebSocket('**/ws/devices*', socket => socket.onMessage(() => {}));
  await page.route('**/api/v1/**', async route => {
    requests.push({ url: route.request().url(), authenticated: route.request().headers().authorization === 'Bearer browser-fixture' });
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/me') ? { subject: 'saved-user', roles: ['OWNER'], sites: [{ id: 1 }] }
      : path.endsWith('/sites') ? [{ id: 1, siteCode: 'saved-site', siteName: '已保存站点', organizationCode: 'saved-org' }]
      : path.includes('/weather') ? { status: 'UNCONFIGURED', configured: false, hours: [], days: [] } : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/');
  await expect(page.locator('#startup-overlay')).toHaveCount(0);
  await expect(page.getByText('连接设置未确认', { exact: true })).toBeVisible();
  return requests;
}

const sessionRetained = page => page.evaluate(() => Boolean(sessionStorage.getItem('iot-manager.oidc-session.v1')));

test('unreadable settings keep the session and explicit retry restores authenticated requests', async ({ page, baseURL }) => {
  const requests = await unreadableSettings(page, baseURL);
  expect(await sessionRetained(page)).toBe(true);
  expect(requests).toHaveLength(0);
  const retry = page.getByRole('button', { name: '重新读取已保存设置', exact: true });
  await retry.click();
  await expect(page.getByText('仍无法读取已保存设置，登录信息已保留。请重试，或在连接设置中确认地址。', { exact: true })).toBeVisible();
  expect(await sessionRetained(page)).toBe(true);
  expect(requests).toHaveLength(0);
  await expect(retry).toBeEnabled();
  await page.evaluate(() => { window.__savedSettingsReadable = true; });
  await retry.click();
  await expect(page.getByRole('button', { name: '退出当前账号', exact: true })).toBeVisible();
  await expect(page.getByText('连接设置未确认', { exact: true })).toHaveCount(0);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.every(row => row.authenticated)).toBe(true);
  expect(await sessionRetained(page)).toBe(true);
});

test('unconfirmed startup leaves navigation usable while refresh and AI cannot contact defaults', async ({ page, baseURL }) => {
  const requests = await unreadableSettings(page, baseURL);
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByText('请先配置服务器连接。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设备', exact: true }).click();
  await page.getByRole('button', { name: '刷新设备与天气', exact: true }).click();
  await page.getByRole('button', { name: '连接设置', exact: true }).first().click();
  await expect(page.locator('#endpoint-api-url')).toBeVisible();
  expect(requests).toHaveLength(0);
  expect(await sessionRetained(page)).toBe(true);
});
