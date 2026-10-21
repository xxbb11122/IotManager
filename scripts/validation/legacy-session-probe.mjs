import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import { createClientStore, CHANGE_DOMAIN } from '../../client/src/js/store.js';
import { createCommandDispatcher } from '../../client/src/js/platform/command-dispatcher.js';
import { isTerminalCommandStatus } from '../../client/src/js/command-state.js';
import { createLocalBleDevice, decorateLanDevice, mergePlatformAndLocalDevices } from '../../client/src/js/client-flow.js';
import * as resources from '../../client/src/js/runtime-resource-state.js';
import { valueEqual } from '../../client/src/js/value-equality.js';
import { createSnapshotRefreshGate } from '../../client/src/js/snapshot-refresh-gate.js';
import { boundedStartupRead, readStartupSnapshot } from '../../client/src/js/platform/startup-bootstrap.js';

// Execute the actual main.js function bodies with inert platform boundaries.
// No network, BLE, geolocation, DOM implementation or application bootstrap runs.
const source = (await readFile(new URL('../../client/src/main.js', import.meta.url), 'utf8'))
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
    boundedStartupRead, readStartupSnapshot, AbortController,
    testEnv: { DEV: false }, Capacitor: { isNativePlatform: () => false },
    RuntimeConfigRepository: class {}, CacheRepository: class { constructor() { return cache; } },
    BleAdapter: class { availability() { return { available: false }; } subscribe() { return noOp; } },
    createClientUi: () => ui, createStartupTransition: () => ({ markUiReady: noOp, dispose: noOp }),
    createNativeStartupVisual: () => null,
    createAiRecoveryStore: () => ({}),
    createAiController: () => ({ reset: noOp, syncContext: noOp, destroy: noOp, setForeground: noOp }),
    createRenderMetrics: () => ({ increment: noOp }),
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

import {writeFileSync} from 'node:fs';
import {OidcSessionManager as ActualOidcSessionManager,normalizeOidcConfig} from '../../client/src/js/auth/oidc-session.js';
import {normalizeEndpointProfile} from '../../client/src/js/platform/runtime-config.js';
const results=[];
for(const status of ['fulfilled','rejected']){
 const saved={id:'saved',accessRoute:'SITE_API',apiBaseUrl:'https://saved.invalid/api/v1',wsUrl:'wss://saved.invalid/ws/devices',oidcIssuerUrl:'https://saved.invalid/oidc',oidcClientId:'saved-client',oidcRedirectUri:'https://localhost/callback'};
 const key='iot-manager.oidc-session.v1';
 const values=new Map([[key,{accessToken:'simulation-only',cachePartition:'legacy-simulation',expiresAt:Date.now()+3600000,issuerUrl:saved.oidcIssuerUrl,clientId:saved.oidcClientId}]]);
 const removed=[],written=[];
 const tokenStore={getJson:async key=>values.get(key)??null,remove:async key=>{removed.push(key);values.delete(key);}};
 const f=fixture({disconnect(){}});
 Object.assign(f.context.testEnv,{VITE_OIDC_ISSUER_URL:'https://default.invalid/oidc',VITE_OIDC_CLIENT_ID:'default-client',VITE_OIDC_REDIRECT_URI:'https://localhost/callback'});
 f.context.OidcSessionManager=class extends ActualOidcSessionManager{constructor(options){super({...options,tokenStore,fetchImpl:()=>{throw Error('No network permitted');}});}};
 Object.assign(f.context,{normalizeOidcConfig,normalizeEndpointProfile,saved,probeStatus:status,written});
 f.context.createPlatformAdapter=()=>({adapter:f.context.adapter});
 f.context.resolveClientConfig=()=>({apiBaseUrl:'https://default.invalid/api/v1',wsUrl:'wss://default.invalid/ws/devices'});
 f.context.attachAppLifecycle=async()=>({remove(){}});f.context.ACCESS_ROUTES={SITE_API:'SITE_API'};
 f.context.Preferences.get=async()=>({value:null});
 f.run(`loadAppInstallId=async()=> 'install';restoreLocalBindings=async()=>{};loadPendingWeatherLocation=async()=>null;
   runtimeConfigRepository.load=async()=>{if(probeStatus==='rejected')throw Error('Simulated Preferences I/O rejection');return saved;};
   runtimeConfigRepository.save=async profile=>{written.push(profile);return profile;};
   bindPlatformEvents=()=>{};synchronizePlatformEndpoint=async()=>endpointProfile;startupTransition.markUiReady=async()=>true;`);
 try {
   await f.run('bootstrapRuntime()');
   results.push({readStatus:status,sessionRetained:values.has(key),removedKeys:removed,profileWrites:written.length,
     authenticated:f.run('clientState.auth.authenticated'),authError:f.run('clientState.auth.error')});
 } finally {f.run('authSession?.stopAutoRefresh()');}
}
const report={sourceSha:execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(import.meta.dirname,'../..'),encoding:'utf8',windowsHide:true}).trim(),
  sourceDirty:Boolean(execFileSync('git',['diff','--name-only','HEAD','--','client/src'],{cwd:resolve(import.meta.dirname,'../..'),encoding:'utf8',windowsHide:true}).trim()),
  mainSha256:createHash('sha256').update(await readFile(new URL('../../client/src/main.js',import.meta.url))).digest('hex'),
  app:'legacy-client',cases:results,
  findingConfirmed:results[0].sessionRetained&&!results[1].sessionRetained,
  passed:results[0].sessionRetained && results[0].authenticated && results[1].sessionRetained
    && !results[1].authenticated && results[1].profileWrites === 0 && results[1].removedKeys.length === 0,
  expected:'Failed endpoint read preserves encrypted session without authenticating a fallback identity',
  productionApproved:false,boundaries:['Actual legacy main.js and OIDC manager; inert storage/network platform fixture']};
const args=process.argv.slice(2);
const output=args.includes('--output')?args[args.indexOf('--output')+1]:null;
assert.ok(output,'Use --output for the diagnostic JSON; the script exits 1 while the defect exists');
writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
assert.equal(results[1].sessionRetained,true,'Legacy endpoint read failure must preserve the previous valid encrypted session');
assert.equal(report.passed,true,'Unconfirmed configuration must not write defaults or activate authentication');

