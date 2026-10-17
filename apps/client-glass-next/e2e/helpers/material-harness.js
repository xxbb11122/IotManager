import {expect} from '@playwright/test';

// Exercise the production UI and all its styles with bounded, synthetic state.
// This harness starts no API, identity session, Bluetooth or geolocation calls.
export async function materialHarness(page, {scenario = 'P01', variant = 'ready', screen} = {}) {
  await page.goto('/src/js/ui.js');
  const styles = ['style', 'ai', 'glass', 'glass-layout', 'liquid', 'device-detail', 'weather'];
  await page.setContent('<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1">'
    + styles.map(name => `<link rel="stylesheet" href="/src/css/${name}.css">`).join('')
    + '</head><body><div id="app"></div></body></html>');
  await page.evaluate(async configuration => {
    const {createClientUi} = await import('/src/js/ui.js');
    const {createPreviewFixture} = await import('/src/dev/motion-preview/fixtures.js');
    const {scenarioById} = await import('/src/dev/motion-preview/scenarios.js');
    const {createAiState} = await import('/src/js/ai/ai-state.js');
    const mount = ({scenario = 'P01', variant = 'ready', screen} = {}) => {
      window.materialHarness?.ui.destroy();
      const root = document.createElement('div'); root.id = 'app'; document.getElementById('app').replaceWith(root);
      const selected = scenarioById(scenario), fixture = createPreviewFixture(selected, variant);
      const model = fixture.model;
      model.ai = {...createAiState(), enabled: true, status: 'ready', canManage: true,
        features: {history: true, requestRecovery: true, personaActivationGuard: true},
        activePersona: {version: 1, name: '现场助手', instructions: '按已上报状态解释，不代替命令回执。'},
        versions: [{version: 1, name: '现场助手', instructions: '测试性格'}],
        history: [{id: 'material-history', title: '设备状态核对'.repeat(30), updatedAt: new Date().toISOString()}],
        personaDraft: {name: '现场助手', instructions: '设备信息核对'.repeat(400).slice(0, 4000)},
        pending: {clientRequestId: 'material-request', state: 'UNKNOWN'},
        error: '请求失败，请查询本次结果。', notice: '测试用普通提示。'};
      const ui = createClientUi(root, {});
      ui.render(model);
      Object.assign(ui.local.endpointDraft, {accessRoute: model.runtime.accessRoute, ...model.endpointProfile});
      const target = screen ?? selected.screen;
      ui.navigate(target, {entityId: target === 'detail' ? model.activeDeviceId : null});
      ui.render(model);
      if (fixture.local.selectedCandidateId) root.querySelector('[data-action="select-candidate"]')?.click();
      window.materialHarness = {ui, model, mount,
        patch: () => ui.patchRuntime(model),
        notices: () => {
          const list = document.createElement('div'); list.dataset.materialNotices = 'true';
          for (const tone of ['info','warning','danger','success'])
            list.append(ui.buildNotice('测试用持续提示。', tone, null, tone));
          root.querySelector('.screen-region').append(list);
        }};
      window.scrollTo(0, 0);
    };
    mount(configuration);
  }, {scenario, variant, screen});
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'liquid');
}

export async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

export async function expectOpaqueMode(page) {
  await expect(page.locator('#app')).toHaveAttribute('data-glass', 'solid');
  const filtered = await page.locator('#app').evaluate(root => [...root.querySelectorAll('*')]
    .filter(node => getComputedStyle(node).backdropFilter !== 'none')
    .map(node => node.className));
  expect(filtered).toEqual([]);
  const enabled = await page.locator('liquid-glass').evaluateAll(nodes => nodes.filter(node => node.getAttribute('effect-mode') !== 'off').length);
  expect(enabled).toBe(0);
}
