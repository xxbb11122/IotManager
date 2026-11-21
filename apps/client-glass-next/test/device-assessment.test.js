import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceAssessmentController } from '../src/js/assessment/assessment-controller.js';
import { BLE_SETUP_KEY, readBleEvidence } from '../src/js/assessment/ble-evidence.js';
import { makeRepairPlan, verifyRepair } from '../src/js/assessment/device-repair.js';
import { ApiClient } from '../src/js/api.js';

const at = Date.parse('2026-11-21T01:00:00Z');
const platform = (parts = {}) => ({
  key: 'site:valve', source: 'PLATFORM', publicId: 'valve', name: '测试设备',
  asOf: at, linkState: 'RECENT', lastCommunicationAt: at, fields: [], ...parts
});
const field = (validity, samples = []) => ({ key: 'temperature', unit: 'C', validity, samples });
const sample = (offset, bucket, parts = {}) => ({
  value: 0, observedAt: at + offset - 100, receivedAt: at + offset, bucketStart: at + bucket,
  timeTrust: 'TRUSTED', source: 'EDGE_AGENT', ...parts
});

test('read-only overview is explicit, paged, and does not repeat the BLE probe on page two', async () => {
  const calls = [];
  const api = { async getDeviceStatusOverview(siteId, { cursor }) {
    calls.push([siteId, cursor]); return {
      siteId, total: 4, asOf: at, items: cursor ? ['c', 'd'].map(publicId => platform({ publicId }))
        : ['a', 'b'].map(publicId => platform({ publicId })), nextCursor: cursor ? null : '1:4:2'
    };
  } };
  const controller = createDeviceAssessmentController({
    contextProvider: () => ({ scopeKey: 'member', siteId: 1, api }),
    observeBle: async () => { calls.push('ble'); return { items: [], asOf: at }; }
  });
  assert.deepEqual(calls, []);
  const initial = controller.load();
  assert.equal(await controller.load(), false);
  await initial;
  await controller.load(true);
  assert.deepEqual(controller.getState().platform.items.map(row => row.publicId), ['a', 'b', 'c', 'd']);
  assert.equal(controller.getState().platform.total, 4);
  assert.deepEqual(calls, [[1, null], 'ble', [1, '1:4:2']]);
});

test('a switched site does not receive a late overview or the old page cursor', async () => {
  let resolve;
  let siteId = 1;
  const calls = [];
  const api = { getDeviceStatusOverview: (id) => {
    calls.push(id);
    return new Promise(done => { resolve = done; });
  } };
  const controller = createDeviceAssessmentController({
    contextProvider: () => ({ scopeKey: String(siteId), siteId, api }),
    observeBle: async () => ({ items: [] })
  });
  const request = controller.load();
  siteId = 2;
  controller.reset();
  resolve({ siteId: 1, items: [platform()], nextCursor: '1:2:1' });
  assert.equal(await request, false);
  assert.equal(await controller.load(true), false);
  assert.equal(controller.getState().platform, null);
  assert.deepEqual(calls, [1]);
});

test('network failures show cached rows without live labels; forbidden removes cache', async () => {
  let unauthorized = false;
  const api = { async getDeviceStatusOverview() {
    throw Object.assign(new Error('failed'), { status: unauthorized ? 403 : 503 });
  } };
  const controller = createDeviceAssessmentController({
    contextProvider: () => ({ scopeKey: 'member', siteId: 1, api, cachedPlatform: { items: [platform()], asOf: at } }),
    observeBle: async () => ({ items: [], asOf: at })
  });
  await controller.load();
  assert.equal(controller.getState().platform.cached, true);
  assert.equal(controller.getState().platform.items[0].linkState, 'UNKNOWN');
  unauthorized = true;
  await controller.load();
  assert.equal(controller.getState().platform, null);
  assert.match(controller.getState().notice, /权限/);
});

test('historical bindings, nearby candidates and an unrelated native GATT link do not count as active', async () => {
  const link = { deviceId: 'active', session: 1, status: 'CONNECTED', name: 'Verified app link',
    profileId: 'reference', reportedState: { power: false }, reportedAt: at - 20 };
  let probes = 0;
  const adapter = { assessmentConnection: () => link, verifyConnection: async () => { probes++; return true; },
    getCandidates: () => [{ id: 'nearby' }], scan: () => assert.fail('Unexpected scan'),
    sendCommand: () => assert.fail('Unexpected write') };
  const result = await readBleEvidence({ adapter, now: () => at, getStore: () => ({
    devices: [{ id: 'binding', deviceId: 'old', name: 'Old', status: 'ONLINE', localOnly: true },
      { publicId: 'site-device', name: 'Platform row' }]
  }) });
  assert.equal(probes, 1);
  assert.deepEqual(result.items.map(row => [row.key, row.linkState]), [['ble:old', 'BOUND'], ['ble:active', 'CONNECTED']]);
  assert.equal(result.items[1].fields[0].validity, 'RECEIPT_ONLY');
  assert.equal(result.items[1].fields[0].samples[0].value, false);
});

test('a BLE link changed during verification is not confirmed by the previous result', async () => {
  let link = { deviceId: 'a', session: 1, status: 'CONNECTED' };
  const result = await readBleEvidence({ now: () => at, getStore: () => ({ devices: [
    { deviceId: 'a', localOnly: true }, { deviceId: 'b', localOnly: true }
  ] }), adapter: { assessmentConnection: () => link, async verifyConnection() {
    link = { deviceId: 'b', session: 2, status: 'CONNECTED' }; return true;
  } } });
  assert.equal(result.items.some(device => device.linkState === 'CONNECTED'), false);
});

test('five repair paths prescribe actions and truthful checks', () => {
  const ble = platform({ source: 'MOBILE_BLE', key: 'ble:test', linkState: 'UNKNOWN', errorCode: 'BLE_PERMISSION_DENIED' });
  const cases = [
    [ble, 'BLE_CONNECT', 'BLE_LINK'],
    [{ ...ble, linkState: 'CONNECTED' }, 'BLE_NO_DATA', 'NONE'],
    [platform({ fields: [field('STALE')] }), 'FIELD_STALE', 'PLATFORM_FIELD'],
    [platform({ source: 'EDGE_AGENT', fields: [field('NO_SAMPLE')] }), 'EDGE_DELIVERY', 'PLATFORM_FIELD'],
    [platform({ command: { state: 'UNCONFIRMED', id: 'original' } }), 'COMMAND_UNCONFIRMED', 'COMMAND']
  ];
  for (const [value, issue, verification] of cases) {
    const plan = makeRepairPlan(value);
    assert.equal(plan.issue, issue);
    assert.equal(plan.verification, verification);
    assert.ok(plan.steps.length >= 2 && plan.check && plan.escalation);
  }
});

test('telemetry recovery requires two distinct buckets with new trusted observed times', () => {
  const plan = makeRepairPlan(platform({ fields: [field('STALE')] }));
  const latest = (samples, parts = {}) => platform({ asOf: at + 181_000, fields: [field('FRESH', samples)], ...parts });
  const a = sample(61_000, 60_000);
  const b = sample(121_000, 120_000);
  assert.equal(verifyRepair(plan, latest([b, a])).state, 'RECOVERED');
  assert.equal(verifyRepair(plan, latest([b, { ...a, bucketStart: b.bucketStart }])).state, 'NOT_VERIFIED');
  assert.equal(verifyRepair(plan, latest([b, { ...a, observedAt: at - 1 }])).state, 'NOT_VERIFIED');
  assert.equal(verifyRepair(plan, latest([b, { ...a, timeTrust: 'SKEWED' }])).state, 'NOT_VERIFIED');
  assert.equal(verifyRepair(plan, latest([b, a], { fields: [field('AGE_UNVERIFIED', [b, a])] })).state, 'NOT_VERIFIED');
  assert.equal(verifyRepair(plan, latest([b, a], { linkState: 'NOT_SEEN' })).state, 'STILL_FAULTY');
  assert.equal(verifyRepair(plan, latest([b, a], { cached: true })).state, 'NOT_VERIFIED');
  assert.equal(verifyRepair(plan, latest([b, a], { key: 'site:other' })).state, 'NOT_VERIFIED');
});

test('desired state or a new command cannot confirm the original; observed state is reported separately', () => {
  const plan = makeRepairPlan(platform({ command: { id: 'one', state: 'UNCONFIRMED', requestedPower: true } }));
  const evidence = platform({ asOf: at + 1000,
    command: { id: 'other', state: 'ACKNOWLEDGED', completedAt: at + 990 } });
  assert.equal(verifyRepair(plan, evidence).state, 'NOT_VERIFIED');
  evidence.command = { id: 'one', state: 'UNCONFIRMED' };
  evidence.fields = [{ key: 'power', samples: [sample(900, 0, { value: true })] }];
  assert.match(verifyRepair(plan, evidence).message, /原命令仍未确认/);
  evidence.command = { id: 'one', state: 'ACKNOWLEDGED', completedAt: at + 950 };
  assert.equal(verifyRepair(plan, evidence).state, 'RECOVERED');
});

test('platform verify rereads only the selected device and pins the original command id', async () => {
  const calls = [];
  let afterRepair = false;
  const initial = platform({ command: { id: 'original', state: 'UNCONFIRMED' } });
  const api = {
    async getDeviceStatusOverview(siteId) { return { siteId, items: [initial], total: 1 }; },
    async getDeviceStatusEvidence(site, target, { commandId }) {
      calls.push([site, target, commandId]);
      return afterRepair ? { ...initial, asOf: at + 2, command: { id: 'original', state: 'ACKNOWLEDGED', completedAt: at + 1 } } : initial;
    },
    sendCommand: () => assert.fail('Unexpected command')
  };
  const controller = createDeviceAssessmentController({
    contextProvider: () => ({ scopeKey: 'member', siteId: 1, api }),
    observeBle: async () => ({ items: [] })
  });
  await controller.load();
  await controller.diagnose('site:valve');
  afterRepair = true;
  await controller.verify();
  assert.deepEqual(calls, [[1, 'valve', null], [1, 'valve', 'original']]);
  assert.equal(controller.getState().result.state, 'RECOVERED');
});

test('sending a BLE explanation supplies only allowlisted, one-turn observations', async () => {
  const fakeLocal = { key: BLE_SETUP_KEY, name: 'Private name', source: 'MOBILE_BLE',
    asOf: at, linkState: 'UNKNOWN', fields: [], errorCode: 'BLE_DISABLED' };
  const controller = createDeviceAssessmentController({
    contextProvider: () => ({ scopeKey: 'mobile', siteId: 1 }),
    observeBle: async () => ({ setup: fakeLocal, items: [] })
  });
  await controller.load();
  await controller.diagnose(BLE_SETUP_KEY);
  const context = controller.explanation();
  assert.equal(context.source, 'MOBILE_BLE');
  assert.equal(context.observation.errorCode, 'BLE_DISABLED');
  assert.doesNotMatch(JSON.stringify(context), /Private name|ble-setup|publicId/);
  const sent = [];
  const client = new ApiClient({ baseUrl: 'https://example.test/api/v1', fetchImpl: async (url, options) => {
    sent.push({ url, options });
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  } });
  await client.askAi(1, 'old', null);
  await client.askAi(1, 'new', null, { deviceDiagnosis: context, headers: { 'Idempotency-Key': 'fixture' } });
  assert.deepEqual(JSON.parse(sent[0].options.body), { question: 'old', conversationId: null });
  assert.deepEqual(JSON.parse(sent[1].options.body).deviceDiagnosis, context);
  assert.equal(sent[1].options.headers['Idempotency-Key'], 'fixture');
});
