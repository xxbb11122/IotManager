import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const baseUrl = String(process.env.IOT_RUNTIME_BASE_URL ?? '').replace(/\/$/, '');
const acceptanceEnabled = process.env.IOT_LIVE_AI_ACCEPTANCE === 'true';
const ownerUsername = process.env.IOT_E2E_OWNER_USERNAME || 'integration-owner';
const ownerPasswordFile = process.env.IOT_E2E_OWNER_PASSWORD_FILE;

async function browserApi(page, path) {
  return page.evaluate(async (requestPath) => {
    const raw = sessionStorage.getItem('iot-manager.browser-oidc-session.v1');
    const token = raw ? JSON.parse(raw).accessToken : null;
    if (!token) return { status: 0, payload: null };
    const response = await fetch(requestPath, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { status: response.status, payload: await response.json() };
  }, path);
}

test.describe('opt-in live AI acceptance against the Windows Docker stack', () => {
  test.skip(!baseUrl || !acceptanceEnabled || !ownerPasswordFile,
    'Set IOT_RUNTIME_BASE_URL, IOT_LIVE_AI_ACCEPTANCE=true and IOT_E2E_OWNER_PASSWORD_FILE to run a real provider call.');

  test('owner can use site chat while the knowledge base remains disabled', async ({ browser }) => {
    test.setTimeout(120_000);
    const password = readFileSync(ownerPasswordFile, 'utf8').trim();
    expect(password.length).toBeGreaterThan(0);
    const context = await browser.newContext({
      ignoreHTTPSErrors: process.env.IOT_RUNTIME_IGNORE_BROWSER_HTTPS_ERRORS === 'true'
    });
    try {
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('#auth-action').click();
      await page.locator('#username').waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('#username').fill(ownerUsername);
      await page.locator('#password').fill(password);
      await page.locator('#kc-login').click({ noWaitAfter: true });
      await expect.poll(async () => {
        try {
          return await page.evaluate(() => Boolean(JSON.parse(
            sessionStorage.getItem('iot-manager.browser-oidc-session.v1') || 'null'
          )?.accessToken));
        } catch {
          return false;
        }
      }, { timeout: 30_000 }).toBe(true);

      const sites = await browserApi(page, '/api/v1/sites');
      expect(sites.status).toBe(200);
      expect(Array.isArray(sites.payload)).toBe(true);
      const site = sites.payload.find((item) => item.siteCode === 'primary-site') || sites.payload[0];
      expect(site?.id).toBeTruthy();
      await page.locator('#site-selector').selectOption(String(site.id));

      const aiPath = `/api/v1/sites/${encodeURIComponent(site.id)}/ai`;
      const status = await browserApi(page, `${aiPath}/status`);
      expect(status.status).toBe(200);
      expect(status.payload).toEqual({
        enabled: true,
        knowledgeEnabled: false,
        state: 'CONFIGURED_REMOTE'
      });

      await expect(page.locator('#site-ai-panel')).toBeVisible();
      const chatResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith(`${aiPath}/chat`) && response.request().method() === 'POST');
      await page.locator('#site-ai-question').fill('用一句话解释温度传感器。');
      await page.locator('#site-ai-form button[type="submit"]').click();
      const chatResponse = await chatResponsePromise;
      expect(chatResponse.status()).toBe(200);
      const reply = await chatResponse.json();
      expect(typeof reply.answer).toBe('string');
      expect(reply.answer.trim().length).toBeGreaterThan(0);
      expect(reply.conversationId).toBeTruthy();
      expect(reply.citations).toEqual([]);
      await expect(page.locator('#site-ai-answer')).toHaveText(reply.answer);

      const knowledge = await browserApi(page, `${aiPath}/knowledge-bases`);
      expect(knowledge.status).toBe(404);
      console.log('LIVE_AI_ACCEPTANCE: login=ok status=configured chat=200 answer=nonempty citations=0 knowledge=disabled');
    } finally {
      await context.close();
    }
  });
});
