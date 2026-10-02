import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createDemoStore } from '../src/demo-store.js';
import { normalizeCapability } from '../src/framework/device-capabilities.js';
import { rangeSpec } from '../src/framework/range-contract.js';
import { createMockAi } from '../src/mock-ai.js';

const payload = (store, level = 78) => ({ deviceId: store.getModel().devices[0].id, type: 'set_level', parameters: { level } });
test('PENDING and SENT only change desired; ACK changes reported from the receipt', async () => {
  const store = createDemoStore({ commandDelay: 10 });
  const task = store.sendCommand(payload(store));
  assert.equal(store.getModel().devices[0].reportedState.level, 42);
  assert.equal(store.getModel().devices[0].desiredState.level, 78);
  assert.equal(Object.values(store.getModel().commandsById)[0].status, 'PENDING');
  await task;
  assert.equal(store.getModel().devices[0].reportedState.level, 78);
  assert.equal(Object.values(store.getModel().commandsById)[0].status, 'ACKNOWLEDGED'); store.destroy();
});
for (const outcome of ['failed', 'unconfirmed']) test(outcome + ' preserves reported state without automatic retransmission', async () => {
  const store = createDemoStore({ commandDelay: 5 }); store.setOutcome(outcome);
  await store.sendCommand(payload(store));
  assert.equal(store.getModel().devices[0].reportedState.level, 42);
  assert.equal(store.getDiagnostics().stats.commandSubmits, 1);
  assert.equal(Object.values(store.getModel().commandsById)[0].status, outcome === 'failed' ? 'FAILED' : 'UNCONFIRMED');
  await delay(20); assert.equal(store.getDiagnostics().stats.commandSubmits, 1); store.destroy();
});
test('pending blocks duplicate submission and captures selected outcome', async () => {
  const store = createDemoStore({ commandDelay: 5 }), task = store.sendCommand(payload(store));
  assert.throws(() => store.sendCommand(payload(store, 60)), /等待回执/); store.setOutcome('failed');
  await task; assert.equal(Object.values(store.getModel().commandsById)[0].status, 'ACKNOWLEDGED');
  assert.equal(store.getDiagnostics().stats.commandSubmits, 1); store.destroy();
});
test('switching site retires old wait and cannot update the new site', async () => {
  const store = createDemoStore({ commandDelay: 5 }), task = store.sendCommand(payload(store));
  await store.switchSite({ siteCode: 'demo-b' }); await task; await delay(150);
  assert.equal(store.getModel().devices[0].reportedState.level, 68);
  assert.deepEqual(store.getModel().commandsById, {});
  await store.switchSite({ siteCode: 'demo-a' });
  assert.equal(Object.values(store.getModel().commandsById)[0].status, 'UNCONFIRMED');
  assert.equal(store.getModel().devices[0].reportedState.level, 42); store.destroy();
});
test('reset cancels an accepted command and clears data without a late update', async () => {
  const store = createDemoStore({ commandDelay: 5 }), task = store.sendCommand(payload(store));
  store.reset(); await task; await delay(150);
  assert.equal(store.getModel().devices[0].reportedState.level, 42);
  assert.equal(store.getDiagnostics().stats.commandSubmits, 0); store.destroy();
});
test('controller rejects every readonly and invalid scenario, independent of UI', () => {
  const store = createDemoStore();
  for (const scenario of ['cache', 'offline', 'unknown', 'invalid', 'unknown-value']) {
    store.setScenario(scenario); assert.throws(() => store.sendCommand(payload(store)));
  }
  store.setScenario('normal'); store.setAuthenticated(false); assert.throws(() => store.sendCommand(payload(store)), /登录/);
  assert.equal(store.getDiagnostics().stats.commandSubmits, 0); store.destroy();
});
test('raw bad ranges remain invalid after capability normalization', () => {
  for (const definition of [{ min: 20, max: 10 }, { min: 2, max: 2 }, { step: 0 }, { step: -1 }, { max: 'Infinity' }, { min: 'bad' }]) {
    const cap = normalizeCapability({ id: 'level', inputType: 'range', ...definition });
    assert.equal(cap.rangeDefinitionInvalid, true); assert.equal(rangeSpec(cap), null);
  }
  assert.deepEqual(rangeSpec(normalizeCapability({ id: 'level', inputType: 'range', min: -2, max: 3, step: .001 })), { min: -2, max: 3, step: .001 });
});
test('LAN claim validates site and registers exactly one local device', async () => {
  const store = createDemoStore(); await store.discoverLan(); const candidate = store.getModel().lanCandidates[0];
  await assert.rejects(store.claimLan({ candidateId: candidate.id, siteCode: 'demo-b', displayName: '新增照明', spacePath: '/lab' }));
  await store.claimLan({ candidateId: candidate.id, siteCode: 'demo-a', displayName: '新增照明', spacePath: '/lab' });
  assert.equal(store.getModel().devices.length, 5); await store.discoverLan(); assert.equal(store.getModel().lanCandidates.length, 0); store.destroy();
});
test('mock AI idempotent send and recovery use the original request', async () => {
  const store = createDemoStore(), mock = createMockAi({ getModel: store.getModel, note: store.noteAi, replyDelay: 10 });
  mock.setMode('processing'); const options = { headers: { 'Idempotency-Key': 'test-key' } };
  const first = await mock.api.askAi('demo-a', '回执说明', null, options);
  const duplicate = await mock.api.askAi('demo-a', '回执说明', null, options);
  assert.equal(first.conversationId, duplicate.conversationId); await delay(15);
  const result = await mock.api.getAiRequest('demo-a', 'test-key');
  assert.equal(result.state, 'SUCCEEDED'); assert.match(result.result.answer, /本地模拟回答/);
  assert.equal(store.getDiagnostics().stats.aiSends, 1); assert.equal(store.getDiagnostics().stats.aiQueries, 1);
  assert.equal((await mock.api.listAiMessages('demo-a', first.conversationId)).items.length, 2);
  assert.equal(store.getDiagnostics().stats.commandSubmits, 0); store.destroy();
});
test('mock AI stores history and persona in independent site scopes', async () => {
  const store = createDemoStore(), mock = createMockAi({ getModel: store.getModel, replyDelay: 1 });
  await mock.api.askAi('demo-a', '设备状态', null, { headers: { 'Idempotency-Key': 'one' } });
  assert.equal((await mock.api.listAiConversations('demo-a')).items.length, 1);
  assert.equal((await mock.api.listAiConversations('demo-b')).items.length, 0);
  await mock.api.saveAiPersona('demo-a', { name: '巡检助手', instructions: '只读说明', expectedVersion: 1 });
  await mock.api.activateAiPersona('demo-a', 2, 1);
  assert.equal((await mock.api.getAiPersona('demo-a')).version, 2);
  assert.equal((await mock.api.getAiPersona('demo-b')).version, 1); store.destroy();
});
test('manual weather validates coordinates and updates only simulated location', async () => {
  const store = createDemoStore();
  await assert.rejects(store.updateWeatherLocation({ latitude: 100, longitude: 121 }));
  await store.updateWeatherLocation({ latitude: 22.5431, longitude: 114.0579, timezone: 'Asia/Shanghai' });
  assert.equal(store.getModel().weatherSettings.latitude, 22.5431);
  assert.equal(store.getModel().weather.current.temperatureC, 24.6);
  assert.equal(store.getModel().weather.status, 'FRESH'); store.destroy();
});
