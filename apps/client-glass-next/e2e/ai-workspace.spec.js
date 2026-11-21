import { expect, test } from '@playwright/test';

// This harness imports production UI and controller modules with an in-memory
// API. It never logs in to or requests data from the deployed environment.
async function harness(page, { roles = ['OWNER'], pending = false, authRequired = false, historyMessageCount = 0 } = {}) {
  await page.goto('/src/js/ai/ai-controller.js');
  await page.setContent('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content"><link rel="stylesheet" href="/src/css/style.css"><link rel="stylesheet" href="/src/css/ai.css"><link rel="stylesheet" href="/src/css/glass.css"><link rel="stylesheet" href="/src/css/glass-layout.css"><link rel="stylesheet" href="/src/css/liquid.css"><link rel="stylesheet" href="/src/css/ai-docked.css"></head><body><div id="app"></div></body></html>');
  await page.evaluate(async ({ roles, pending, authRequired, historyMessageCount }) => {
    const { createClientUi } = await import('/src/js/ui.js');
    const { createAiController } = await import('/src/js/ai/ai-controller.js');
    const { createAiRecoveryStore } = await import('/src/js/ai/ai-state.js');
    const { resolveAiQuickPrompt } = await import('/src/js/ai/ai-quick-prompts.js');
    const values = new Map(), calls = [], versions = [];
    let active = { version: 0, name: '默认性格', instructions: '' }, done = !pending, ai, model = {
      context: { organizationCode: 'test-org', siteCode: 'test-site', siteName: '测试站点' }, auth: { configured: !authRequired, authenticated: !authRequired },
      startup: { phase: 'ready' }, devices: [], loading: {}, runtime: {}
    };
    const answer = '<img src=x onerror="window.aiInjected=1">模拟回答';
    const result = { requestId: 'r1', conversationId: 'c1', answer, personaVersion: 0, citations: [] };
    const api = { baseUrl: 'https://mock.example.test/api/v1',
      getCurrentUser: async () => {
        if (authRequired) throw Object.assign(new Error('Unauthorized'), { status: 401 });
        return { subject: 'user-1', roles, sites: [{ id: 1 }] };
      },
      getAiStatus: async () => ({ enabled: true }),
      getAiCapabilities: async () => ({ contractVersion: 1, features: { history: true, pagedMessages: true, requestRecovery: true, idempotency: true, personaActivationGuard: true } }),
      getAiPersona: async () => active, listAiPersonas: async () => versions,
      askAi: async (_site, question, conversationId, options) => { calls.push({ question, conversationId, key: options.headers['Idempotency-Key'] }); return done ? result : { state: 'PROCESSING', conversationId: 'c1', retryAfterSeconds: 30 }; },
      getAiRequest: async () => ({ state: done ? 'SUCCEEDED' : 'PROCESSING', question: '恢复问题', result: done ? result : null, expiresAt: new Date(Date.now() + 100000).toISOString(), retryAfterSeconds: 30 }),
      listAiConversations: async () => ({ items: [{ id: 'c1', title: '历史问题', updatedAt: new Date().toISOString() }], nextCursor: null }),
      getAiConversation: async () => ({ personaVersion: 0 }),
      listAiMessages: async (_site, _id, query = {}) => {
        if (!historyMessageCount) return {items:[{id:'u1',turnId:'r1',role:'USER',content:'历史问题'},
          {id:'a1',turnId:'r1',role:'ASSISTANT',content:answer}],nextCursor:null};
        const end=query.cursor ? Number(query.cursor) : historyMessageCount, start=Math.max(0,end-100);
        return {items:Array.from({length:end-start},(_,offset) => {
          const index=start+offset;
          return {id:'history-' + index,turnId:'turn-' + Math.floor(index/2),
            role:index % 2 ? 'ASSISTANT' : 'USER',content:index % 2 ? '模拟回答' : '历史问题'};
        }),nextCursor:start ? String(start) : null};
      },
      deleteAiConversation: async (_site, id) => { calls.push({ deleted: id }); },
      saveAiPersona: async (_site, body) => { calls.push({ saved: body }); versions.push({ ...body, version: versions.length + 1 }); },
      activateAiPersona: async (_site, version, expected) => { calls.push({ activated: version, expected }); active = versions.find(row => row.version === version); }
    };
    const ui = createClientUi(document.getElementById('app'), {
      screenChanged: screen => { void ai.setScreen(screen); },
      aiQuickPrompt: ({ id }) => {
        const item = resolveAiQuickPrompt(ai.getState(), id);
        if (item) ai.setDraft(item.prompt);
        return item?.prompt ?? null;
      },
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
        if (action === 'ai-reload') await ai.reload();
        if (action === 'ai-messages-more') await ai.loadMessages(true);
      }
    });
    ai = createAiController({ contextProvider: () => ({ api, siteId: authRequired ? null : 1, organization: 'test-org', auth: model.auth, endpoint: {} }),
      recovery: createAiRecoveryStore({ get: async ({ key }) => ({ value: values.get(key) }), set: async ({ key, value }) => values.set(key, value), remove: async ({ key }) => values.delete(key) }),
      onChange: (state, change) => { model = { ...model, ai: state }; ui.patchAi(model, change); } });
    ui.render(model);
    window.aiWorkspaceHarness = { calls, ai, ui, done: () => { done = true; }, refreshDevices: () => ui.patchRuntime({ ...model, devices: [] }),
      showMessages: (count) => {
        const messages = Array.from({length: count}, (_, index) => ({id:`fixture-${index}`,
          role:index % 2 ? 'ASSISTANT' : 'USER', content:index % 2
            ? '先确认设备电源和网络连接，再查看最近一次上报时间。若设备仍未恢复，请检查现场网关状态。'
            : '设备离线了，我应该先检查什么？'}));
        model = {...model, ai:{...ai.getState(), messages}};
        ui.patchAi(model);
      } };
  }, { roles, pending, authRequired, historyMessageCount });
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  if (!authRequired) await expect(page.locator('#ai-question')).toBeVisible();
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

test('a protected server without login configuration gives setup instead of an empty site picker', async ({ page }) => {
  await harness(page, { authRequired: true });
  await expect(page.getByText('服务器要求登录。请先在连接设置中填写登录服务、客户端 ID 和回调地址，再登录账号。')).toBeVisible();
  await expect(page.getByRole('button', { name: '连接设置', exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: '选择站点', exact: true })).toHaveCount(0);
  await expect(page.locator('#ai-question')).toHaveCount(0);
});

test('crystal quick prompts require explicit sending and recheck preserves the next draft', async ({ page }) => {
  await harness(page);
  await expect(page.locator('.ai-composer--crystal')).toBeVisible();
  await page.getByRole('button', { name: '回执说明', exact: true }).click();
  await expect(page.locator('#ai-question')).toHaveValue('解释指令待确认、超时与执行失败的区别。');
  expect(await page.evaluate(() => window.aiWorkspaceHarness.calls.length)).toBe(0);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.ai-message')).toHaveCount(2);
  await page.locator('#ai-question').fill('还未发送的草稿');
  await page.getByRole('button', { name: '检查连接', exact: true }).click();
  await expect(page.locator('#ai-question')).toHaveValue('还未发送的草稿');
  await expect(page.locator('.ai-message')).toHaveCount(2);
  expect(await page.evaluate(() => window.aiWorkspaceHarness.calls.length)).toBe(1);
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

test('chat input stays at the viewport bottom while long conversations scroll', async ({page}, testInfo) => {
  await harness(page);
  await page.evaluate(() => window.aiWorkspaceHarness.showMessages(40));
  const scroll = page.locator('[data-region="ai-scroll"]');
  const composer = page.locator('.ai-composer');
  await expect(scroll.locator('.ai-message')).toHaveCount(40);
  for (const viewport of [{width:390,height:844}, {width:320,height:640}, {width:320,height:480}, {width:390,height:500}, {width:1280,height:800}]) {
    await page.setViewportSize(viewport);
    await scroll.evaluate(node => { node.scrollTop = 0; });
    const before = await composer.boundingBox();
    const headerBefore = await page.locator('.ai-header').boundingBox();
    await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const after = await composer.boundingBox();
    expect(Math.abs(after.y - before.y), `composer moved at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    const headerAfter = await page.locator('.ai-header').boundingBox();
    expect(Math.abs(headerAfter.y - headerBefore.y), `header moved at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    const bounds = await page.evaluate(() => {
      const input = document.querySelector('#ai-question').getBoundingClientRect();
      const composer = document.querySelector('.ai-composer').getBoundingClientRect();
      const scroll = document.querySelector('[data-region="ai-scroll"]').getBoundingClientRect();
      const last = document.querySelector('.ai-message:last-child').getBoundingClientRect();
      const nav = document.querySelector('.bottom-nav');
      const navRect = nav.getBoundingClientRect();
      return {height:innerHeight, width:innerWidth, documentWidth:document.documentElement.scrollWidth,
        inputTop:input.top, inputBottom:input.bottom, composerTop:composer.top, composerBottom:composer.bottom,
        scrollBottom:scroll.bottom, lastBottom:last.bottom, navTop:getComputedStyle(nav).display === 'none' ? innerHeight : navRect.top};
    });
    expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.inputTop).toBeGreaterThanOrEqual(0);
    expect(bounds.inputBottom).toBeLessThanOrEqual(bounds.height + 1);
    expect(bounds.composerBottom).toBeLessThanOrEqual(bounds.navTop + 1);
    expect(bounds.navTop - bounds.composerBottom).toBeLessThan(80);
    expect(bounds.scrollBottom).toBeLessThanOrEqual(bounds.composerTop + 1);
    expect(bounds.lastBottom).toBeLessThanOrEqual(bounds.scrollBottom + 1);
  }
  await page.setViewportSize({width:390,height:844});
  await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.screenshot({path:testInfo.outputPath('ai-docked-mobile.png'), animations:'disabled'});
});

test('the compact composer keeps its accessible label and shortcuts in the conversation area', async ({page}, testInfo) => {
  await harness(page);
  await expect(page.getByRole('textbox', {name:'问题'})).toBeVisible();
  await expect(page.locator('[data-region="ai-scroll"] [data-region="ai-quick-prompts"]')).toBeVisible();
  await expect(page.locator('.ai-composer [data-region="ai-quick-prompts"]')).toHaveCount(0);
  await expect(page.locator('.ai-workspace--chat .liquid-surface-layer')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('ai-empty-mobile.png'), animations:'disabled'});
  await page.setViewportSize({width:320,height:480});
  await page.locator('#ai-question').fill('长问题'.repeat(400));
  await expect(page.getByRole('button', {name:'发送', exact:true})).toBeEnabled();
  const input = await page.locator('#ai-question').boundingBox();
  const send = await page.getByRole('button', {name:'发送', exact:true}).boundingBox();
  expect(input.y + input.height).toBeLessThanOrEqual(480);
  expect(send.y + send.height).toBeLessThanOrEqual(480);
  await page.emulateMedia({forcedColors:'active'});
  await expect(page.locator('.ai-composer')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('#ai-question')).toHaveValue('长问题'.repeat(400));
  await page.emulateMedia({forcedColors:'none'});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const enlargedInput = await page.locator('#ai-question').boundingBox();
  const enlargedSend = await page.getByRole('button', {name:'发送', exact:true}).boundingBox();
  const navTop = (await page.locator('.bottom-nav').boundingBox()).y;
  expect(enlargedInput.y + enlargedInput.height).toBeLessThanOrEqual(navTop + 1);
  expect(enlargedSend.y + enlargedSend.height).toBeLessThanOrEqual(navTop + 1);
  await expect(page.locator('#ai-question')).toBeFocused();
});

test('typing in a long conversation creates a bounded number of DOM elements', async ({page}) => {
  await harness(page, {historyMessageCount:100});
  await page.getByRole('button', {name:'历史', exact:true}).click();
  await page.getByRole('button', {name:'打开', exact:true}).click();
  await expect(page.locator('.ai-message')).toHaveCount(100);
  await page.evaluate(() => {
    window.createdDuringDraft = 0;
    window.originalCreateElement = document.createElement;
    window.firstChatMessage = document.querySelector('.ai-message');
    document.querySelector('[data-region="ai-scroll"]').scrollTop = 100;
    document.createElement = function(...args) { window.createdDuringDraft++; return window.originalCreateElement.apply(this, args); };
  });
  await page.locator('#ai-question').pressSequentially('abcdefghijklmnopqrst');
  const created = await page.evaluate(() => {
    document.createElement = window.originalCreateElement;
    return window.createdDuringDraft;
  });
  console.log(`AI draft: ${created} elements created for 20 characters with 100 messages`);
  expect(created).toBeLessThan(400);
  await expect(page.locator('.ai-message')).toHaveCount(100);
  expect(await page.evaluate(() => document.querySelector('.ai-message') === window.firstChatMessage)).toBe(true);
  expect(await page.locator('[data-region="ai-scroll"]').evaluate(node => node.scrollTop)).toBe(100);
  await expect(page.locator('.ai-count')).toHaveText('20 / 2000 字符');
  await expect(page.getByRole('button', {name:'发送', exact:true})).toBeEnabled();
});

test('chat keeps the reader position during updates and remains usable after a simulated keyboard resize', async ({page}) => {
  await harness(page);
  await page.evaluate(() => window.aiWorkspaceHarness.showMessages(40));
  const scroll = page.locator('[data-region="ai-scroll"]');
  await scroll.evaluate(node => { node.scrollTop = 100; });
  const before = await scroll.evaluate(node => node.scrollTop);
  await page.evaluate(() => window.aiWorkspaceHarness.showMessages(41));
  expect(await scroll.evaluate(node => node.scrollTop)).toBe(before);
  await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.evaluate(() => window.aiWorkspaceHarness.showMessages(42));
  expect(await scroll.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  await page.setViewportSize({width:390,height:500});
  const input = page.locator('#ai-question');
  await input.fill('模拟键盘收起空间后的提问');
  await expect(input).toBeFocused();
  const bounds = await input.boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(500);
  await page.getByRole('button', {name:'发送', exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.aiWorkspaceHarness.calls.length)).toBe(1);
  await expect(page.locator('.ai-message--assistant')).toContainText('模拟回答');
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

test('500 paged messages retain composition input, selection and bounded draft work', async ({page}, testInfo) => {
  await harness(page,{historyMessageCount:500});
  await page.getByRole('button',{name:'历史',exact:true}).click();
  await page.getByRole('button',{name:'打开',exact:true}).click();
  for(let count=100;count<500;count+=100) {
    await expect(page.locator('.ai-message')).toHaveCount(count);
    await page.getByRole('button',{name:'查看更早消息',exact:true}).click();
  }
  await expect(page.locator('.ai-message')).toHaveCount(500);
  const result=await page.locator('#ai-question').evaluate(async input => {
    input.focus();
    const identity=input;
    input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
    for(const value of ['设','设备','设备状']) {
      input.value=value; input.setSelectionRange(value.length,value.length);
      input.dispatchEvent(new InputEvent('input',{bubbles:true,data:value,isComposing:true,inputType:'insertCompositionText'}));
    }
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'设备状态'}));
    input.value='设备状态'; input.setSelectionRange(4,4);
    input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'设备状态',inputType:'insertText'}));
    const samples=[];
    for(let index=0;index<30;index++) {
      const start=performance.now();
      input.value='设备状态 ' + index; input.setSelectionRange(input.value.length,input.value.length);
      input.dispatchEvent(new InputEvent('input',{bubbles:true,data:String(index),inputType:'insertText'}));
      const dom=performance.now()-start;
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      samples.push({dom,paintOpportunity:performance.now()-start});
    }
    return {same:identity===document.getElementById('ai-question'),selection:input.selectionStart,value:input.value,samples};
  });
  expect(result.same).toBe(true);
  expect(result.selection).toBe(result.value.length);
  await expect(page.locator('#ai-question')).toBeFocused();
  expect(await page.evaluate(()=>window.aiWorkspaceHarness.calls.length)).toBe(0);
  await testInfo.attach('ai-500-input-samples',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

test('an overlay keyboard visual viewport keeps input visible and cleans up after navigation', async ({page}) => {
  await page.addInitScript(() => {
    const viewport=new EventTarget();
    Object.assign(viewport,{height:844,scale:1,offsetTop:0});
    window.fixtureVisualViewport=viewport;
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  });
  await harness(page);
  await page.locator('#ai-question').focus();
  await page.evaluate(()=> {
    window.fixtureVisualViewport.height=460;
    window.fixtureVisualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('#app')).toHaveAttribute('data-ai-keyboard-overlay','true');
  const input=await page.locator('#ai-question').boundingBox();
  const send=await page.getByRole('button',{name:'发送',exact:true}).boundingBox();
  expect(input.y+input.height).toBeLessThanOrEqual(460);
  expect(send.y+send.height).toBeLessThanOrEqual(460);
  await page.evaluate(()=> {
    window.fixtureVisualViewport.scale=2;
    window.fixtureVisualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('#app')).not.toHaveAttribute('data-ai-keyboard-overlay','true');
  await page.getByRole('button',{name:'设备',exact:true}).click();
  expect(await page.locator('#app').evaluate(node=>node.style.getPropertyValue('--ai-viewport-height'))).toBe('');
  await page.evaluate(()=>window.aiWorkspaceHarness.ui.destroy());
  await page.evaluate(()=> {
    window.fixtureVisualViewport.height=400; window.fixtureVisualViewport.scale=1;
    window.fixtureVisualViewport.dispatchEvent(new Event('resize'));
  });
  expect(await page.locator('#app').evaluate(node=>node.style.getPropertyValue('--ai-viewport-height'))).toBe('');
});
