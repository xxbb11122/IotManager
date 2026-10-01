import { expect, test } from '@playwright/test';

// This harness imports production UI and controller modules with an in-memory
// API. It never logs in to or requests data from the deployed environment.
async function harness(page, { roles = ['OWNER'], pending = false } = {}) {
  await page.goto('/src/js/ai/ai-controller.js');
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/css/style.css"><link rel="stylesheet" href="/src/css/ai.css"></head><body><div id="app"></div></body></html>');
  await page.evaluate(async ({ roles, pending }) => {
    const { createClientUi } = await import('/src/js/ui.js');
    const { createAiController } = await import('/src/js/ai/ai-controller.js');
    const { createAiRecoveryStore } = await import('/src/js/ai/ai-state.js');
    const values = new Map(), calls = [], versions = [];
    let active = { version: 0, name: '默认性格', instructions: '' }, done = !pending, ai, model = {
      context: { organizationCode: 'test-org', siteCode: 'test-site', siteName: '测试站点' }, auth: { configured: true, authenticated: true },
      startup: { phase: 'ready' }, devices: [], loading: {}, runtime: {}
    };
    const answer = '<img src=x onerror="window.aiInjected=1">模拟回答';
    const result = { requestId: 'r1', conversationId: 'c1', answer, personaVersion: 0, citations: [] };
    const api = { baseUrl: 'https://mock.example.test/api/v1',
      getCurrentUser: async () => ({ subject: 'user-1', roles, sites: [{ id: 1 }] }),
      getAiStatus: async () => ({ enabled: true }),
      getAiCapabilities: async () => ({ contractVersion: 1, features: { history: true, pagedMessages: true, requestRecovery: true, idempotency: true, personaActivationGuard: true } }),
      getAiPersona: async () => active, listAiPersonas: async () => versions,
      askAi: async (_site, question, conversationId, options) => { calls.push({ question, conversationId, key: options.headers['Idempotency-Key'] }); return done ? result : { state: 'PROCESSING', conversationId: 'c1', retryAfterSeconds: 30 }; },
      getAiRequest: async () => ({ state: done ? 'SUCCEEDED' : 'PROCESSING', question: '恢复问题', result: done ? result : null, expiresAt: new Date(Date.now() + 100000).toISOString(), retryAfterSeconds: 30 }),
      listAiConversations: async () => ({ items: [{ id: 'c1', title: '历史问题', updatedAt: new Date().toISOString() }], nextCursor: null }),
      getAiConversation: async () => ({ personaVersion: 0 }),
      listAiMessages: async () => ({ items: [{ id: 'u1', turnId: 'r1', role: 'USER', content: '历史问题' }, { id: 'a1', turnId: 'r1', role: 'ASSISTANT', content: answer }], nextCursor: null }),
      deleteAiConversation: async (_site, id) => { calls.push({ deleted: id }); },
      saveAiPersona: async (_site, body) => { calls.push({ saved: body }); versions.push({ ...body, version: versions.length + 1 }); },
      activateAiPersona: async (_site, version, expected) => { calls.push({ activated: version, expected }); active = versions.find(row => row.version === version); }
    };
    const ui = createClientUi(document.getElementById('app'), {
      screenChanged: screen => { void ai.setScreen(screen); },
      aiInput: ({ field, value }) => field === 'ai-question' ? ai.setDraft(value) : ai.setPersonaDraft(field === 'ai-persona-name' ? 'name' : 'instructions', value),
      aiAction: async ({ action, id }) => {
        if (action === 'ai-send') await ai.send();
        if (action === 'ai-new') await ai.newConversation();
        if (action === 'ai-recover') await ai.recover();
        if (action === 'ai-cancel') ai.cancelWait();
        if (action === 'ai-select') { await ai.selectConversation(id); ui.navigate('ai'); ui.render(model); }
        if (action === 'ai-delete') { if (window.confirm('删除？')) await ai.deleteConversation(id); }
        if (action === 'ai-persona-save') await ai.savePersona();
        if (action === 'ai-persona-activate') await ai.activatePersona(Number(id));
      }
    });
    ai = createAiController({ contextProvider: () => ({ api, siteId: 1, organization: 'test-org', auth: model.auth, endpoint: {} }),
      recovery: createAiRecoveryStore({ get: async ({ key }) => ({ value: values.get(key) }), set: async ({ key, value }) => values.set(key, value), remove: async ({ key }) => values.delete(key) }),
      onChange: (state) => { model = { ...model, ai: state }; ui.patchAi(model); } });
    ui.render(model);
    window.aiWorkspaceHarness = { calls, ai, ui, done: () => { done = true; }, refreshDevices: () => ui.patchRuntime({ ...model, devices: [] }) };
  }, { roles, pending });
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.locator('#ai-question')).toBeVisible();
}

test('AI navigation, safe text rendering and device refresh preserve the focused question', async ({ page }) => {
  await harness(page);
  await page.locator('#ai-question').fill('解释 MQTT'); await page.locator('#ai-question').focus();
  await page.evaluate(() => window.aiWorkspaceHarness.refreshDevices());
  await expect(page.locator('#ai-question')).toBeFocused();
  await expect(page.locator('#ai-question')).toHaveValue('解释 MQTT');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.ai-message--assistant')).toContainText('<img src=x');
  await expect(page.locator('.ai-messages img')).toHaveCount(0);
  expect(await page.evaluate(() => window.aiInjected)).toBeUndefined();
  await page.getByRole('button', { name: '新会话' }).click();
  await expect(page.locator('.ai-message')).toHaveCount(0);
  await page.getByRole('button', { name: '设备', exact: true }).click();
  await expect(page.locator('[data-region="ai-content"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.aiWorkspaceHarness.calls.length)).toBe(1);
});

test('history opens the full message pair and supports explicit deletion', async ({ page }) => {
  await harness(page); await page.getByRole('button', { name: '历史', exact: true }).click();
  await expect(page.locator('.ai-history-title')).toHaveText('历史问题');
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await expect(page.locator('.ai-message')).toHaveCount(2);
  await page.getByRole('button', { name: '历史', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.aiWorkspaceHarness.calls.some(row => row.deleted === 'c1'))).toBe(true);
});

test('persona saves 4000 characters and activation has a separate expected version', async ({ page }) => {
  await harness(page); await page.getByRole('button', { name: '性格', exact: true }).click();
  await page.locator('#ai-persona-name').fill('简洁助手'); await page.locator('#ai-persona-instructions').fill('a'.repeat(4000));
  await page.getByRole('button', { name: '保存新版本' }).click();
  await expect(page.getByRole('button', { name: '启用', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await expect(page.getByRole('heading', { name: '当前启用：简洁助手' })).toBeVisible();
  const calls = await page.evaluate(() => window.aiWorkspaceHarness.calls);
  expect(calls[0].saved.instructions.length).toBe(4000); expect(calls[0].saved.expectedVersion).toBe(0);
  expect(calls[1]).toEqual({ activated: 1, expected: 0 });
});

test('members can view persona but cannot edit or activate it', async ({ page }) => {
  await harness(page, { roles: ['MEMBER'] }); await page.getByRole('button', { name: '性格', exact: true }).click();
  await expect(page.getByText('性格由组织所有者或管理员管理。')).toBeVisible();
  await expect(page.locator('#ai-persona-instructions')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存新版本' })).toHaveCount(0);
});

test('wide AI layout keeps header controls below the system safe area', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await harness(page);
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '24px'));
  const controls = await page.locator('.app-header').evaluate(header => ({
    top: header.getBoundingClientRect().top,
    controls: [...header.querySelectorAll('button')].filter(button => button.getBoundingClientRect().height)
      .map(button => button.getBoundingClientRect().top)
  }));
  expect(controls.controls.length).toBeGreaterThan(0);
  expect(controls.controls.every(top => top >= controls.top + 24)).toBe(true);
});

test('leaving a pending request stops waiting and return obtains its result without a second POST', async ({ page }) => {
  await harness(page, { pending: true }); await page.locator('#ai-question').fill('恢复问题');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '查询本次结果' })).toBeVisible();
  await page.getByRole('button', { name: '设备', exact: true }).click();
  await page.evaluate(() => window.aiWorkspaceHarness.done());
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.locator('.ai-message--assistant')).toContainText('模拟回答');
  expect(await page.evaluate(() => window.aiWorkspaceHarness.calls.length)).toBe(1);
  await page.setViewportSize({ width: 390, height: 520 });
  await expect(page.locator('#ai-question')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 700, height: 520 });
  await expect(page.locator('.bottom-nav')).toBeVisible();
  expect(await page.locator('.bottom-nav').evaluate(nav => getComputedStyle(nav).gridTemplateColumns.split(' ').length)).toBe(4);
});
