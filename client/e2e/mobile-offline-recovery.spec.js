import { expect, test } from '@playwright/test';

async function pullToRefresh(page, pointerId) {
  const app = page.locator('#app');
  await page.evaluate(() => window.scrollTo(0, 0));
  await app.dispatchEvent('pointerdown', { pointerId, pointerType: 'touch', clientY: 8 });
  await app.dispatchEvent('pointermove', { pointerId, pointerType: 'touch', clientY: 180 });
  await expect(page.locator('.pull-refresh')).toContainText('松开即可刷新');
  await app.dispatchEvent('pointerup', { pointerId, pointerType: 'touch', clientY: 180 });
}

test('mobile offline refresh keeps cached data, recovers, and suppresses rapid duplicate refreshes', async ({ page }) => {
  let backendOnline = true;
  let recovered = false;
  let deviceRequests = 0;
  let weatherRequests = 0;

  await page.addInitScript(() => {
    const initialNow = Date.now();
    window.__mobileSimulationNow = initialNow;
    Date.now = () => window.__mobileSimulationNow;

    class TestWebSocket {
      constructor() {
        this.readyState = 0;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
        }, 0);
      }

      close() {
        this.readyState = 3;
        this.onclose?.({ code: 1000 });
      }

      send() {}
    }
    window.WebSocket = TestWebSocket;
  });

  await page.route('**/api/v1/sites', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      siteCode: 'demo-site', siteName: 'Simulation Site',
      organizationCode: 'demo-org', organizationName: 'Simulation Org'
    }])
  }));
  await page.route('**/api/v1/devices**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/activity')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    deviceRequests += 1;
    if (!backendOnline) return route.abort('failed');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 7,
        deviceId: 'mobile-simulation-device',
        name: recovered ? 'Recovered Sensor' : 'Cached Sensor',
        status: 'ONLINE',
        connections: [{ transport: 'LAN_AGENT', status: 'CONNECTED' }]
      }])
    });
  });
  await page.route('**/api/v1/sites/demo-site/weather', (route) => {
    weatherRequests += 1;
    if (!backendOnline) return route.abort('failed');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        siteCode: 'demo-site',
        status: 'FRESH',
        fetchedAt: recovered ? '2026-09-04T15:02:00Z' : '2026-09-04T15:00:00Z',
        current: {
          conditionText: recovered ? 'Recovered weather' : 'Cached weather',
          iconKey: 'partly-cloudy',
          temperatureC: recovered ? 24 : 23,
          relativeHumidityPct: 65,
          surfacePressureHpa: 1013
        },
        indicators: {}
      })
    });
  });

  await page.goto('/');
  await expect(page.getByText('Cached Sensor')).toBeVisible();
  await expect(page.getByText('Cached weather')).toBeVisible();
  const initialDeviceRequests = deviceRequests;
  const initialWeatherRequests = weatherRequests;

  backendOnline = false;
  await pullToRefresh(page, 201);
  await expect.poll(() => deviceRequests).toBeGreaterThan(initialDeviceRequests);
  await expect.poll(() => weatherRequests).toBeGreaterThan(initialWeatherRequests);
  await expect(page.getByText('离线快照')).toBeVisible();
  await expect(page.getByText('Cached Sensor')).toBeVisible();
  await expect(page.getByText('Cached weather')).toBeVisible();
  await expect(page.locator('.pull-refresh')).toContainText('下拉刷新');

  backendOnline = true;
  recovered = true;
  await page.evaluate(() => { window.__mobileSimulationNow += 61_000; });
  const offlineDeviceRequests = deviceRequests;
  const offlineWeatherRequests = weatherRequests;
  await pullToRefresh(page, 202);
  await expect.poll(() => deviceRequests).toBeGreaterThan(offlineDeviceRequests);
  await expect.poll(() => weatherRequests).toBeGreaterThan(offlineWeatherRequests);
  await expect(page.getByText('Recovered Sensor')).toBeVisible();
  await expect(page.getByText('Recovered weather')).toBeVisible();
  await expect(page.getByText('离线快照')).toHaveCount(0);
  await expect(page.locator('.pull-refresh')).toContainText('下拉刷新');

  const recoveredDeviceRequests = deviceRequests;
  const recoveredWeatherRequests = weatherRequests;
  await pullToRefresh(page, 203);
  await expect(page.locator('.pull-refresh')).toContainText('下拉刷新');
  expect(deviceRequests).toBe(recoveredDeviceRequests);
  expect(weatherRequests).toBe(recoveredWeatherRequests);
});
