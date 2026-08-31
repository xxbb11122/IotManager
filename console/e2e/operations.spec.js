import { expect, test } from '@playwright/test';

const sites = [
  { siteCode: 'site-a', siteName: 'Site A', organizationCode: 'org-a', organizationName: 'Organization A' },
  { siteCode: 'site-b', siteName: 'Site B', organizationCode: 'org-a', organizationName: 'Organization A' }
];

function dashboardStats(siteCode) {
  return siteCode === 'site-b'
    ? { total: 1, online: 1, warning: 0, offline: 0, typeBreakdown: { SENSOR: 1 } }
    : { total: 2, online: 1, warning: 1, offline: 0, typeBreakdown: { GATEWAY: 1, ACTUATOR: 1 } };
}

function devicesFor(siteCode) {
  return siteCode === 'site-b'
    ? [{ id: 22, deviceId: 'site-b-sensor', name: 'Site B Sensor', type: 'SENSOR', profileId: 'sensor-v1', profileVersion: 1, protocol: 'LAN_AGENT', status: 'ONLINE', location: 'Zone B', connections: [{ transport: 'LAN_AGENT' }] }]
    : [{ id: 11, deviceId: 'site-a-gateway', name: 'Site A Gateway', type: 'GATEWAY', profileId: 'gateway-v1', profileVersion: 1, protocol: 'LAN_AGENT', status: 'WARNING', location: 'Zone A', connections: [{ transport: 'LAN_AGENT' }] }];
}

function weatherFor(siteCode) {
  return {
    siteCode,
    status: 'FRESH',
    fetchedAt: '2026-08-24T08:00:00Z',
    current: { conditionText: siteCode === 'site-b' ? 'Cloudy' : 'Clear', temperatureC: 24, apparentTemperatureC: 25, relativeHumidityPct: 58, surfacePressureHpa: 1012, elevationM: 16 },
    indicators: {
      temperature: { level: 'SUITABLE', label: 'Suitable', reason: 'test' },
      humidity: { level: 'SUITABLE', label: 'Suitable', reason: 'test' },
      pressure: { level: 'SUITABLE', label: 'Suitable', reason: 'test' },
      esdRisk: { level: 'SUITABLE', label: 'Suitable', reason: 'test' },
      condensationRisk: { level: 'SUITABLE', label: 'Suitable', reason: 'test' }
    }
  };
}

async function installBrowserFakes(page) {
  await page.addInitScript(() => {
    class TestWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;
      constructor() { this.readyState = TestWebSocket.OPEN; }
      close() { this.readyState = TestWebSocket.CLOSED; this.onclose?.(); }
      send() {}
    }
    window.WebSocket = TestWebSocket;
  });
}

async function installApiMocks(page, requestLog) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const siteCode = url.searchParams.get('siteCode') || path.split('/')[4] || 'site-a';
    const method = request.method();
    const body = request.postDataJSON?.() ?? null;
    requestLog.push({ method, path, siteCode, body });

    let response;
    if (path === '/api/v1/sites') response = sites;
    else if (path === '/api/v1/devices/stats') response = dashboardStats(siteCode);
    else if (path === '/api/v1/devices') response = devicesFor(siteCode);
    else if (path === '/api/v1/device-groups') response = [{ groupId: 'group-1', name: 'Operators', memberCount: 1, onlineCount: 1, version: 1 }];
    else if (path === '/api/v1/command-batches' && method === 'POST') response = { batchId: 'batch-new', status: 'PENDING', ...body };
    else if (path === '/api/v1/command-batches') response = [{ batchId: 'batch-old', type: 'set_power', status: 'ACKNOWLEDGED', totalCount: 1, acknowledgedCount: 1, requestedAt: '2026-08-24T08:00:00Z' }];
    else if (path.endsWith('/commands')) response = [];
    else if (path.endsWith('/weather-settings') && method === 'PUT') response = { siteCode, providerCode: 'OPEN_METEO', ...body };
    else if (path.endsWith('/weather-settings')) response = { siteCode, enabled: true, providerCode: 'OPEN_METEO', latitude: 22.5431, longitude: 114.0579, timezone: 'Asia/Shanghai' };
    else if (path.endsWith('/weather/refresh')) response = weatherFor(siteCode);
    else if (path.endsWith('/weather')) response = weatherFor(siteCode);
    else if (path === '/api/v1/alerts/search' || path === '/api/v1/commands') response = { items: [] };
    else response = {};

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
}

test('operator console reloads site-scoped operations and submits site-bound mutations', async ({ page }) => {
  const requestLog = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installBrowserFakes(page);
  await installApiMocks(page, requestLog);

  await page.goto('/');
  await expect(page.locator('#site-selector')).toBeEnabled();
  await expect(page.locator('#d-total')).toHaveText('2');

  await page.selectOption('#site-selector', 'site-b');
  await expect(page.locator('#site-label')).toHaveText('Site B');
  await expect(page.locator('#d-total')).toHaveText('1');

  await page.locator('[data-page="devices"]').click();
  await expect(page.locator('#dev-table-body')).toContainText('Site B Sensor');

  await page.locator('[data-page="weather"]').click();
  await expect(page.locator('#weather-current')).toContainText('Cloudy');
  await page.locator('#weather-latitude').fill('31.2304');
  await page.locator('#weather-longitude').fill('121.4737');
  await page.locator('#weather-settings-form').evaluate((form) => form.requestSubmit());
  await expect.poll(() => requestLog.some((entry) => entry.method === 'PUT' && entry.path.endsWith('/weather-settings') && entry.siteCode === 'site-b')).toBe(true);

  await page.locator('[data-page="batches"]').click();
  await page.locator('#batch-device-ids').fill('22');
  await page.locator('#batch-form').evaluate((form) => form.requestSubmit());
  await expect.poll(() => requestLog.find((entry) => entry.method === 'POST' && entry.path === '/api/v1/command-batches')?.body?.siteCode).toBe('site-b');
  expect(pageErrors).toEqual([]);
});
