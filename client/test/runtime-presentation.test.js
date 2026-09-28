import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createClientStore, CHANGE_DOMAIN } from '../src/js/store.js';
import { createCommandDispatcher } from '../src/js/platform/command-dispatcher.js';
import { isTerminalCommandStatus } from '../src/js/command-state.js';
import { createLocalBleDevice, decorateLanDevice, mergePlatformAndLocalDevices } from '../src/js/client-flow.js';
import * as resources from '../src/js/runtime-resource-state.js';
import { valueEqual } from '../src/js/value-equality.js';
import { createSnapshotRefreshGate } from '../src/js/snapshot-refresh-gate.js';

// Execute the actual main.js function bodies with inert platform boundaries.
// No network, BLE, geolocation, DOM implementation or application bootstrap runs.
const source = (await readFile(new URL('../src/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .replaceAll('import.meta.env', 'testEnv')
  .replace(/void bootstrapRuntime\(\)\.catch\([\s\S]*$/, '');

function fixture(adapter = {}, cacheOverrides = {}) {
  const store = createClientStore();
  const notifications = [];
  const cache = {
    replacePlatformDevices: async () => {}, getPlatformSnapshot: async () => ({ devices: [], cachedAt: null }),
    putPlatformWeather: async () => {}, getPlatformWeather: async () => null,
    ...cacheOverrides
  };
  const noOp = () => {};
  const ui = new Proxy({ notify: (...args) => notifications.push(args) }, { get: (target, key) => target[key] ?? noOp });
  const context = vm.createContext({
    ...resources, store, CHANGE_DOMAIN, createCommandDispatcher, isTerminalCommandStatus, valueEqual, createSnapshotRefreshGate,
    createLocalBleDevice, decorateLanDevice, mergePlatformAndLocalDevices,
    testEnv: { DEV: false }, Capacitor: { isNativePlatform: () => false },
    RuntimeConfigRepository: class {}, CacheRepository: class { constructor() { return cache; } },
    BleAdapter: class { availability() { return { available: false }; } subscribe() { return noOp; } },
    createClientUi: () => ui, createRenderMetrics: () => ({ increment: noOp }),
    createRenderCoordinator: () => ({ forceFull: noOp, enqueue: noOp, setVisibility: noOp }),
    createWeatherRefreshCooldown: ({ onDeadlineChange }) => ({ set: (seconds) => onDeadlineChange(seconds ? Date.now() + seconds * 1000 : null) }),
    document: { getElementById: noOp, visibilityState: 'visible', addEventListener: noOp },
    window: { addEventListener: noOp, setTimeout: (callback) => { callback(); return 1; } },
    Preferences: { set: async () => {}, remove: async () => {} },
    browserWeatherTimezone: () => 'Asia/Shanghai',
    friendlyEndpointError: (error) => error.message,
    getCurrentDeviceLocation: async () => ({ latitude: 0, longitude: 0 }),
    Date, JSON, Promise, Error, TypeError, URL, console,
    adapter, notifications
  });
  vm.runInContext(`${source}\nplatform = adapter; endpointProfile = { id: 'endpoint-a', apiBaseUrl: 'https://a.invalid', organizationCode: 'demo-org', accessRoute: 'SITE_API' };`, context);
  return { context, store, notifications, run: (expression) => vm.runInContext(expression, context) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('runtime devices distinguish first failure/empty/cache and preserve network success when cache write fails', async () => {
  const f = fixture({ listDevices: async () => [] });
  await f.run('refreshDevices()');
  assert.equal(f.run('clientState.resources.devices.phase'), 'empty');
  const cached = fixture({ listDevices: async () => { throw new Error('offline'); } }, {
    getPlatformSnapshot: async () => ({ devices: [{ id: 1 }], cachedAt: 5 })
  });
  await cached.run('refreshDevices()');
  assert.equal(cached.run('clientState.resources.devices.source'), 'cache');
  assert.equal(cached.run('clientState.resources.devices.phase'), 'ready');
  assert.equal(cached.store.getState().runtime.stale, true);
  const partial = fixture({ listDevices: async () => [{ id: 2 }] }, {
    replacePlatformDevices: async () => { throw new Error('quota'); }
  });
  await partial.run('refreshDevices()');
  assert.equal(partial.store.getState().devices[0].id, 2);
  assert.equal(partial.store.getState().runtime.stale, false);
  assert.equal(partial.run('clientState.resources.devices.freshness'), 'fresh');
  assert.match(partial.run('clientState.notices[0].message'), /缓存保存失败/);
});

test('device reads share one request and late results cannot replace switched-context data', async () => {
  const pending = deferred();
  let calls = 0;
  const f = fixture({ listDevices: () => ++calls === 1 ? pending.promise : Promise.resolve([{ id: 2 }]) });
  const old = f.run('refreshDevices()');
  const joined = f.run('refreshDevices()');
  assert.equal(joined, old);
  assert.equal(calls, 1);
  pending.resolve([{ id: 1 }]);
  await Promise.all([old, joined]);
  assert.equal(f.store.getState().devices[0].id, 1);
  await f.run('refreshDevices()');
  assert.equal(f.store.getState().devices[0].id, 2);
  const other = deferred();
  const g = fixture({ listDevices: () => other.promise });
  const request = g.run('refreshDevices()');
  g.run('invalidateRuntimeContext(); clientState.context.siteCode = "new-site";');
  other.resolve([{ id: 3 }]);
  await request;
  assert.equal(g.store.getState().devices.length, 0);
});

test('initial REST failure and repeated WS reconnects share the attempt cooldown without marking data fresh', async () => {
  let reads = 0;
  const f = fixture({ listDevices: async () => { reads++; throw new Error('offline'); } });
  await f.run('refreshDevices()');
  for (let i = 0; i < 5; i++) await f.run('resyncAfterRealtimeConnect()');
  assert.equal(reads, 1);
  assert.equal(f.store.getState().runtime.stale, true);
  assert.equal(f.run('clientState.resources.devices.phase'), 'error');
  await f.run('refreshDevices()');
  assert.equal(reads, 2);
  f.run('invalidateRuntimeContext()');
  await f.run('resyncAfterRealtimeConnect()');
  assert.equal(reads, 3);
});

test('identity invalidation removes old site and location presentation, including cooldown', () => {
  const f = fixture();
  f.run(`clientState.sites = [{ siteCode: 'old-site' }];
    clientState.weatherSettings = { latitude: 10 };
    clientState.pendingWeatherLocation = { latitude: 11 };
    clientState.error = 'old account error';
    setWeatherRefreshCooldown(120);
    invalidateRuntimeContext();`);
  assert.equal(f.run('clientState.sites.length'), 0);
  assert.equal(f.run('clientState.weatherSettings'), null);
  assert.equal(f.run('clientState.pendingWeatherLocation'), null);
  assert.equal(f.run('clientState.error'), null);
  assert.equal(f.run('weatherRefreshCooldownSeconds()'), 0);
  f.run(`clientState.sites = [{ siteCode: 'allowed-site' }]; invalidateRuntimeContext({ preserveSites: true });`);
  assert.equal(f.run('clientState.sites[0].siteCode'), 'allowed-site');
});

test('sites preserve true empty and error instead of inventing a successful fallback site', async () => {
  const empty = fixture({ listSites: async () => [] });
  await empty.run('loadSites()');
  assert.equal(empty.run('clientState.resources.sites.phase'), 'empty');
  const failed = fixture({ listSites: async () => { throw new Error('offline'); } });
  await failed.run('loadSites()');
  assert.equal(failed.run('clientState.resources.sites.phase'), 'error');
  assert.equal(failed.run('clientState.sites.length'), 0);
});

test('LAN discovery keeps existing candidates while waiting and after failure', async () => {
  const pending = deferred();
  const f = fixture({ discoverLan: () => pending.promise });
  f.run('clientState.lanCandidates = [{ candidateId: "a" }];');
  const request = f.run('discoverLan()');
  assert.equal(f.run('clientState.resources.lanDiscovery.refreshing'), true);
  assert.equal(f.run('clientState.lanCandidates.length'), 1);
  pending.resolve([{ candidateId: 'b' }]);
  await request;
  assert.equal(f.run('clientState.loading.lanDiscovery'), false);
});

test('LAN claim remains successful when supplementary activity read fails', async () => {
  const f = fixture({ claimLan: async () => ({ id: 9, name: 'Claimed' }), listActivity: async () => { throw new Error('activity offline'); } });
  f.run('clientState.lanCandidates = [{ candidateId: "a" }];');
  const result = await f.run('claimLan({ candidateId: "a", displayName: "Claimed" })');
  assert.equal(result.presentation.status, 'partial');
  assert.equal(f.store.getState().devices[0].id, 9);
  assert.equal(f.run('clientState.loading.lanClaim'), false);
});

test('weather cooldown never reports updated and never repeats the remote write', async () => {
  let writes = 0;
  const f = fixture({ refreshSiteWeather: async () => { writes += 1; return { status: 'FRESH', current: {} }; }, getSiteWeatherSettings: async () => ({}), getSiteWeatherForecast: async () => ({ hourly: [], daily: [] }) });
  assert.equal((await f.run('forceRefreshWeather()')).status, 'updated');
  assert.equal((await f.run('forceRefreshWeather()')).status, 'cooldown');
  assert.equal(writes, 1);
});

test('simultaneous weather refresh entries share one in-flight remote write', async () => {
  const pending = deferred();
  let writes = 0;
  const f = fixture({ refreshSiteWeather: () => { writes += 1; return pending.promise; }, getSiteWeatherSettings: async () => ({}), getSiteWeatherForecast: async () => ({ hourly: [], daily: [] }) });
  const first = f.run('forceRefreshWeather()');
  const second = f.run('forceRefreshWeather()');
  assert.equal(first, second);
  pending.resolve({ status: 'FRESH', current: {} });
  await Promise.all([first, second]);
  assert.equal(writes, 1);
});

test('weather auxiliary failure is partial and forecast has its own error', async () => {
  const f = fixture({ refreshSiteWeather: async () => ({ status: 'FRESH', current: {} }), getSiteWeatherSettings: async () => ({}), getSiteWeatherForecast: async () => { throw new Error('forecast offline'); } }, { putPlatformWeather: async () => { throw new Error('quota'); } });
  assert.equal((await f.run('forceRefreshWeather()')).status, 'partial');
  assert.equal(f.store.getState().weather.status, 'FRESH');
  assert.equal(f.run('clientState.resources.weatherForecast.phase'), 'error');
  assert.equal(f.run('clientState.loading.weatherForecast'), false);
});

test('empty coordinates reject before a write, valid zero succeeds even if cache fails', async () => {
  let writes = 0;
  const f = fixture({ updateSiteWeatherLocation: async () => { writes += 1; return { current: {}, status: 'FRESH' }; }, getSiteWeatherSettings: async () => ({}), getSiteWeatherForecast: async () => ({ hourly: [], daily: [] }) }, { putPlatformWeather: async () => { throw new Error('quota'); } });
  await assert.rejects(f.run('updateWeatherFromManualLocation({ latitude: "", longitude: 0 })'));
  assert.equal(writes, 0);
  const result = await f.run('updateWeatherFromManualLocation({ latitude: 0, longitude: 0 })');
  assert.equal(result.presentation.status, 'partial');
  assert.equal(writes, 1);
  assert.equal(f.run('clientState.loading.weatherLocationPhase'), null);
});

test('poll exhaustion stops waiting without inventing FAILED or retrying a command', async () => {
  let reads = 0;
  const f = fixture({ getCommand: async () => { reads += 1; return { commandId: 'c1', deviceId: 1, status: 'SENT' }; } });
  await f.run('pollCommand("c1", platform, 2, 0)');
  assert.equal(reads, 2);
  assert.equal(f.store.getState().commandsById.c1.status, 'SENT');
  assert.equal(f.run('clientState.commandObservation.c1.phase'), 'exhausted');
});

test('late command receipt stays journaled in original context without modifying current device', async () => {
  const pending = deferred();
  let writes = 0;
  const f = fixture({ sendCommand: () => { writes += 1; return pending.promise; } });
  f.store.setDevices([{ id: 1, reportedState: { power: false } }]);
  f.store.setRuntimeContext({ stale: false });
  const request = f.run('sendCommand({ deviceId: 1, type: "set_power", parameters: { power: true } })');
  f.run('invalidateRuntimeContext(); clientState.context.siteCode = "other-site";');
  f.store.setDevices([{ id: 1, reportedState: { power: false } }]);
  pending.resolve({ commandId: 'late', deviceId: 1, status: 'ACKNOWLEDGED', reportedState: { power: true } });
  await request;
  assert.equal(writes, 1);
  assert.equal(f.store.getState().devices[0].reportedState.power, false);
  assert.equal(f.store.getState().commandsById.late, undefined);
  assert.equal(f.run('Array.from(commandReceiptsByScope.values())[0].get("late").sourceContext.siteCode'), 'demo-site');
});

test('old forecast finally cannot clear the new scope loading indicator', async () => {
  const older = deferred();
  const newer = deferred();
  let calls = 0;
  const f = fixture({ getSiteWeatherForecast: () => ++calls === 1 ? older.promise : newer.promise });
  const first = f.run('loadWeatherForecast({ forceRead: true })');
  f.run('invalidateRuntimeContext(); clientState.context.siteCode = "other-site";');
  const second = f.run('loadWeatherForecast({ forceRead: true })');
  older.resolve({ hourly: [{ old: true }], daily: [] });
  await first;
  assert.equal(f.run('clientState.loading.weatherForecast'), true);
  assert.equal(f.store.getState().weatherForecast, null);
  newer.resolve({ hourly: [{ new: true }], daily: [] });
  await second;
  assert.equal(f.run('clientState.loading.weatherForecast'), false);
  assert.equal(f.store.getState().weatherForecast.hourly[0].new, true);
});

test('new BLE advertisements do not change the operator-selected candidate', () => {
  const f = fixture();
  f.run(`updateBleCandidates([{ deviceId: 'a' }]); updateBleCandidates([{ deviceId: 'b' }]);`);
  assert.equal(f.run('clientState.ble.selectedCandidateId'), 'a');
  assert.equal(f.run('clientState.ble.candidates.length'), 2);
});

test('BLE connect captures identity and treats binding-storage failure as partial success', async () => {
  const pending = deferred();
  let target;
  const f = fixture({}, { putLocalBinding: async () => { throw new Error('quota'); } });
  f.context.testBle = { stopScan: async () => {}, connect: candidate => { target = candidate.deviceId; return pending.promise; }, getCapabilities: () => ({ controls: [] }) };
  f.run(`ble = testBle; appInstallId = 'fixture'; clientState.ble.candidate = { deviceId: 'a', name: 'A' };`);
  const connection = f.run('connectBle()');
  f.run(`clientState.ble.candidate = { deviceId: 'b', name: 'B' };`);
  pending.resolve({ deviceId: 'a', status: 'CONNECTED', transport: 'BLE_DIRECT' });
  const result = await connection;
  assert.equal(target, 'a');
  assert.equal(result.presentation.status, 'partial');
  assert.equal(f.store.selectDevice('a').name, 'A');
  assert.equal(f.store.selectDevice('b'), null);
  assert.equal(f.run('clientState.loading.bleConnect'), false);
  assert.match(f.run('clientState.notices[0].message'), /保存失败/);
});

test('runtime scan-stop failure is not shown as a successful stop', async () => {
  const f = fixture();
  f.context.testBle = { stopScan: async () => { throw new Error('stop failed'); } };
  f.run(`ble = testBle; clientState.ble.scanning = true;`);
  await assert.rejects(f.run('stopBleScan()'), /stop failed/);
  assert.equal(f.run('clientState.ble.scanning'), true);
  assert.equal(f.run('clientState.ble.errorCode'), 'SCAN_STOP_FAILED');
});

test('restored BLE bindings retain data but never pretend a cached GATT link is live', async () => {
  const f = fixture({}, {
    listLocalBindings: async () => [{ key: 'local:a', pluginDeviceId: 'a', displayName: 'Cached', lastConnectionState: 'CONNECTED', lastReportedState: { on: true } }],
    listLocalActivity: async () => []
  });
  await f.run('restoreLocalBindings()');
  assert.equal(f.store.selectDevice('a').status, 'OFFLINE');
  assert.equal(f.store.selectDevice('a').connections[0].status, 'DISCONNECTED');
  assert.equal(f.store.selectDevice('a').reportedState.on, true);
});
