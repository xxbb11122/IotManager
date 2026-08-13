import { expect, test } from '@playwright/test';

test('mobile client exposes devices, activity, add, and connection settings without overflow', async ({ page }, testInfo) => {
  const runtimeErrors = [];
  let deviceReadCount = 0;
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.route('**/api/devices', (route) => {
    deviceReadCount += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]'
    });
  });
  await page.route('**/api/sites/demo-site/weather', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      siteCode: 'demo-site', status: 'FRESH', fetchedAt: '2026-08-13T05:00:00Z',
      current: { conditionText: '晴间多云', iconKey: 'partly-cloudy', temperatureC: 23, relativeHumidityPct: 65, surfacePressureHpa: 1013 },
      indicators: {
        temperature: { level: 'SUITABLE', label: '适宜' },
        humidity: { level: 'SUITABLE', label: '适宜' },
        pressure: { level: 'SUITABLE', label: '适宜' }
      }
    })
  }));
  await page.route('**/api/sites/demo-site/weather/forecast?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ siteCode: 'demo-site', status: 'FRESH', hourly: [], daily: [] })
  }));
  await page.route('**/api/sites/demo-site/weather-settings', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      siteCode: 'demo-site', enabled: true, providerCode: 'OPEN_METEO', latitude: 22.5431, longitude: 114.0579,
      timezone: 'Asia/Shanghai', locationSource: 'MANUAL', locationUpdatedAt: '2026-08-13T05:00:00Z'
    })
  }));
  await page.addInitScript(() => {
    class TestWebSocket {
      constructor() {
        this.readyState = 0;
        this.listeners = new Map();
        setTimeout(() => {
          this.readyState = 1;
          this.emit('open', {});
          this.onopen?.();
        }, 0);
      }

      close() {
        this.readyState = 3;
        this.emit('close', {});
        this.onclose?.();
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
      }

      emit(type, event) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }

      send() {}
    }
    window.WebSocket = TestWebSocket;
  });
  await page.goto('/');
  await expect(page.locator('.weather-header-summary')).toBeVisible();
  await page.locator('#app').dispatchEvent('pointerdown', { pointerId: 77, pointerType: 'touch', clientY: 8 });
  await page.locator('#app').dispatchEvent('pointermove', { pointerId: 77, pointerType: 'touch', clientY: 180 });
  await expect(page.locator('.pull-refresh')).toContainText('松开即可刷新');
  await page.locator('#app').dispatchEvent('pointerup', { pointerId: 77, pointerType: 'touch', clientY: 180 });
  await expect.poll(() => deviceReadCount).toBeGreaterThan(1);
  await page.locator('.weather-header-summary').click();
  await expect(page.locator('.weather-location')).toBeVisible();
  await expect(page.locator('[data-action="update-weather-location"]')).toBeVisible();
  await expect(page.locator('#weather-latitude')).toBeVisible();
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' }).first()).toBeVisible();
  await expect(page.getByText('我的设备')).toBeVisible();
  await expect(page.getByRole('button', { name: /添加/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '连接设置' }).click();
  await expect(page.getByRole('heading', { name: '连接设置' })).toBeVisible();
  await expect(page.getByRole('button', { name: '现场 LAN' })).toBeVisible();
  await expect(page.getByRole('button', { name: '互联网远程' })).toBeVisible();
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText(/连接成功/)).toBeVisible();
  await expect(page.getByText(/当前没有设备/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  expect(runtimeErrors).toEqual([]);
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath('mobile-connections.png'), fullPage: true });

  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByText('设备运营')).toBeVisible();
  const compactHeader = await page.evaluate(() => {
    const title = document.querySelector('.app-brand h1')?.getBoundingClientRect();
    const connection = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('连接设置'))?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      titleHeight: title?.height ?? 0,
      connectionHeight: connection?.height ?? 0
    };
  });
  expect(compactHeader.overflow).toBe(false);
  expect(compactHeader.titleHeight).toBeLessThanOrEqual(20);
  expect(compactHeader.connectionHeight).toBeLessThanOrEqual(32);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('navigation', { name: '主导航' }).first()).toBeVisible();
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(desktopOverflow).toBe(false);
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath('desktop-connections.png'), fullPage: true });
});
