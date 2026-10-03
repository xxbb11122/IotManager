import { expect, test } from '@playwright/test';

test('AI chat clears answers and ignores late replies after a site change', async ({ page }) => {
  // Load the module from Vite without starting the application or an identity session.
  await page.goto('/src/js/ai-chat-panel.js');
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.evaluate(async () => {
    const { createAiChatPanel } = await import('/src/js/ai-chat-panel.js');
    let siteId = 1;
    const pending = [];
    const api = {
      askAi: (requestedSite, question, conversationId) => new Promise((resolve) => {
        pending.push({ requestedSite, question, conversationId, resolve });
      })
    };
    const panel = createAiChatPanel({ apiProvider: () => api, siteIdProvider: () => siteId });
    window.aiHarness = {
      pending,
      reply: (index, response) => pending[index].resolve(response),
      switchSite: (next) => { siteId = next; panel.reset(); panel.updateAvailability(); }
    };
  });

  await page.getByRole('button', { name: '打开站点 AI 问答' }).click();
  await page.locator('#iot-ai-question').fill('解释 MQTT');
  await page.locator('.iot-ai-panel button[type="submit"]').click();
  await expect(page.locator('.iot-ai-answer')).toHaveText('正在回答…');
  await page.evaluate(() => window.aiHarness.reply(0, {
    conversationId: 'conversation-1',
    answer: '模拟回答',
    citations: [{ documentName: 'manual.txt', version: 1, pageNumber: 2, snippet: '摘录' }]
  }));
  await expect(page.locator('.iot-ai-answer')).toHaveText('模拟回答');
  await expect(page.locator('.iot-ai-citations')).toContainText('manual.txt');

  await page.locator('#iot-ai-question').fill('第二个问题');
  await page.locator('.iot-ai-panel button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.aiHarness.pending.length)).toBe(2);
  expect(await page.evaluate(() => window.aiHarness.pending[1].conversationId)).toBe('conversation-1');
  await page.evaluate(() => window.aiHarness.switchSite(2));
  await page.evaluate(() => window.aiHarness.reply(1, {
    conversationId: 'conversation-1', answer: '旧站点迟到回答', citations: []
  }));
  await expect(page.locator('.iot-ai-answer')).toBeEmpty();
  await expect(page.locator('.iot-ai-citations')).toBeEmpty();
  await expect(page.locator('.iot-ai-panel')).toBeHidden();
});
