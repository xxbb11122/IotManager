import { expect, test } from '../../../apps/client-glass-next/node_modules/@playwright/test/index.mjs';

const baseUrl = process.env.IOT_RUNTIME_BASE_URL;
test.describe('explicit isolated HTTPS AI provider contract', () => {
  test.skip(process.env.IOT_EIGHT_AI_FIXTURE !== 'true' || !baseUrl, 'Requires the dedicated runtime-eight stack and internal provider fixture');
  test('site chat uses the real Backend and one HTTPS fixture call with knowledge disabled', async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext();
    let conversationId;
    const page = await context.newPage();
    async function api(path, method = 'GET') {
      return page.evaluate(async ({ path, method }) => {
        const session = JSON.parse(sessionStorage.getItem('iot-manager.browser-oidc-session.v1') || 'null');
        const response = await fetch(path, { method, headers: { Authorization: 'Bearer ' + session.accessToken } });
        const text = await response.text();
        return { status: response.status, data: text ? JSON.parse(text) : null };
      }, { path, method });
    }
    let aiPath;
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('#auth-action').click();
      await page.locator('#username').fill(process.env.IOT_E2E_OWNER_USERNAME);
      await page.locator('#password').fill(process.env.IOT_E2E_OWNER_PASSWORD);
      await page.locator('#kc-login').click({ noWaitAfter: true });
      await expect.poll(() => page.evaluate(() => Boolean(sessionStorage.getItem('iot-manager.browser-oidc-session.v1'))).catch(() => false),
        { timeout: 30000 }).toBe(true);
      const sites = await api('/api/v1/sites');
      expect(sites.status).toBe(200);
      const site = sites.data.find(row => row.siteCode === 'primary-site');
      expect(site?.id).toBeTruthy();
      await page.locator('#site-selector').selectOption(String(site.id));
      aiPath = '/api/v1/sites/' + site.id + '/ai';
      const status = await api(aiPath + '/status');
      expect(status.status).toBe(200);
      expect(status.data).toEqual({ enabled: true, knowledgeEnabled: false, state: 'CONFIGURED_REMOTE' });
      const replyPromise = page.waitForResponse(response => response.url().endsWith(aiPath + '/chat') && response.request().method() === 'POST');
      await page.locator('#site-ai-question').fill('模拟测试：用一句话解释温度传感器。');
      await page.locator('#site-ai-form button[type="submit"]').click();
      const replyResponse = await replyPromise;
      expect(replyResponse.status()).toBe(200);
      const reply = await replyResponse.json();
      conversationId = reply.conversationId;
      expect(conversationId).toBeTruthy();
      expect(reply.citations).toEqual([]);
      expect(reply.answer).toContain('模拟回答：温度传感器');
      await expect(page.locator('#site-ai-answer')).toHaveText(reply.answer);
      expect(await page.locator('#site-ai-answer img').count()).toBe(0);
      expect(await page.evaluate(() => window.runtimeAiInjected)).toBeUndefined();
      expect((await api(aiPath + '/knowledge-bases')).status).toBe(404);
    } finally {
      if (conversationId && aiPath) expect((await api(aiPath + '/conversations/' + encodeURIComponent(conversationId), 'DELETE')).status).toBe(204);
      await context.close();
    }
  });
});
