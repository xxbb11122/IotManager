import { expect, test } from '@playwright/test';

const sites = [
  { siteCode: 'site-a', siteName: 'Site A', organizationCode: 'org-a', organizationName: 'Organization A' },
  { siteCode: 'site-b', siteName: 'Site B', organizationCode: 'org-a', organizationName: 'Organization A' }
];

function devicesFor(siteCode) {
  return siteCode === 'site-b'
    ? [{ deviceId: 'site-b-sensor', name: 'Site B Sensor', type: 'SENSOR', protocol: 'LAN_AGENT', status: 'WARNING', location: 'Zone B', temperature: 29.2, cpuUsage: 52, signalStrength: -58, lastSeen: '2026-08-24T08:00:00Z' }]
    : [
      { deviceId: 'site-a-gateway', name: 'Site A Gateway', type: 'GATEWAY', protocol: 'LAN_AGENT', status: 'ONLINE', location: 'Zone A', temperature: 23.4, cpuUsage: 16, signalStrength: -42, lastSeen: '2026-08-24T08:00:00Z' },
      { deviceId: 'site-a-sensor', name: 'Site A Sensor', type: 'SENSOR', protocol: 'BLE', status: 'OFFLINE', location: 'Zone A', temperature: 21.8, cpuUsage: 0, signalStrength: -80, lastSeen: '2026-08-24T07:58:00Z' }
    ];
}

function statsFor(siteCode) {
  return siteCode === 'site-b'
    ? { total: 1, online: 0, warning: 1, offline: 0, typeBreakdown: { SENSOR: 1 } }
    : { total: 2, online: 1, warning: 0, offline: 1, typeBreakdown: { GATEWAY: 1, SENSOR: 1 } };
}

function weatherFor(siteCode) {
  const siteB = siteCode === 'site-b';
  return {
    siteCode,
    status: 'FRESH',
    fetchedAt: '2026-08-24T08:00:00Z',
    current: {
      conditionText: siteB ? 'Cloudy' : 'Clear',
      temperatureC: siteB ? 29.2 : 23.4,
      relativeHumidityPct: siteB ? 74 : 52,
      surfacePressureHpa: 1008,
      elevationM: siteB ? 36 : 12
    },
    indicators: {
      temperature: { level: siteB ? 'OBSERVE' : 'SUITABLE', label: siteB ? 'Observe' : 'Suitable', reason: 'test' },
      humidity: { level: siteB ? 'OBSERVE' : 'SUITABLE', label: siteB ? 'Observe' : 'Suitable', reason: 'test' },
      pressure: { level: 'SUITABLE', label: 'Suitable', reason: 'test' },
      esdRisk: { level: 'SUITABLE', label: 'Suitable', reason: 'test' },
      condensationRisk: { level: 'SUITABLE', label: 'Suitable', reason: 'test' }
    }
  };
}

async function installBrowserFakes(page) {
  await page.addInitScript(() => {
    window.__iotTestSockets = [];
    class TestWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor() {
        this.readyState = TestWebSocket.CONNECTING;
        window.__iotTestSockets.push(this);
        window.setTimeout(() => {
          this.readyState = TestWebSocket.OPEN;
          this.onopen?.();
        }, 0);
      }

      close() {
        this.readyState = TestWebSocket.CLOSED;
        this.onclose?.();
      }

      send() {}

      emitMessage(message) {
        this.onmessage?.({ data: JSON.stringify(message) });
      }
    }
    window.WebSocket = TestWebSocket;
  });
}

async function installApiMocks(page, requests) {
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const siteCode = url.searchParams.get('siteCode') || path.split('/')[4] || 'site-a';
    requests.push({ method: request.method(), path, siteCode });

    let body;
    if (path === '/api/v1/sites') body = sites;
    else if (path === '/api/v1/devices') body = devicesFor(siteCode);
    else if (path === '/api/v1/devices/stats') body = statsFor(siteCode);
    else if (path.endsWith('/weather/forecast')) body = { siteCode, status: 'FRESH', hourly: [], daily: [] };
    else if (path.endsWith('/weather')) body = weatherFor(siteCode);
    else if (path === '/api/v1/alerts/active') body = [];
    else if (path.endsWith('/resolve') && request.method() === 'PUT') body = { id: path.split('/').at(-2), status: 'RESOLVED' };
    else body = {};

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('dashboard isolates data by selected site and accepts current-site realtime updates', async ({ page }) => {
  const requests = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installBrowserFakes(page);
  await installApiMocks(page, requests);

  await page.goto('/');
  await expect(page.locator('#site-selector')).toBeEnabled();
  await expect(page.locator('#stat-total')).toHaveText('2');
  await expect(page.locator('#weather-temperature')).toContainText('23.4');
  await expect(page.locator('tr[data-device-id="site-a-gateway"]')).toBeVisible();

  await page.locator('#device-search').fill('sensor');
  await expect(page.locator('tr[data-device-id="site-a-sensor"]')).toBeVisible();
  await expect(page.locator('tr[data-device-id="site-a-gateway"]')).toHaveCount(0);

  await page.selectOption('#site-selector', 'site-b');
  await expect(page.locator('#site-label')).toHaveText('Site B');
  await expect(page.locator('#stat-total')).toHaveText('1');
  await expect(page.locator('tr[data-device-id="site-b-sensor"]')).toBeVisible();
  await expect(page.locator('#weather-temperature')).toContainText('29.2');

  await page.evaluate(() => {
    window.__iotTestSockets.at(-1).emitMessage({
      type: 'device_update',
      payload: {
        siteCode: 'site-b', deviceId: 'site-b-sensor', name: 'Site B Sensor Updated', type: 'SENSOR',
        protocol: 'LAN_AGENT', status: 'ONLINE', location: 'Zone B', temperature: 26.1, cpuUsage: 14, signalStrength: -43
      }
    });
  });
  await expect(page.locator('tr[data-device-id="site-b-sensor"]')).toContainText('Site B Sensor Updated');
  expect(requests.some((request) => request.path === '/api/v1/devices' && request.siteCode === 'site-b')).toBe(true);
  expect(pageErrors).toEqual([]);
});
