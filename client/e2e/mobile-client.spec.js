import { expect, test } from '@playwright/test';

test('mobile client exposes devices, activity, add, and connection settings without overflow', async ({ page }, testInfo) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.route('**/api/devices', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]'
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

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('navigation', { name: '主导航' }).first()).toBeVisible();
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(desktopOverflow).toBe(false);
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath('desktop-connections.png'), fullPage: true });
});
