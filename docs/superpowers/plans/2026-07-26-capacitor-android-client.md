# Capacitor Android Enterprise Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing enterprise Vite client as an Android APK with runtime site/cloud endpoints, safe native BLE control, offline local bindings, and reproducible verification.

**Architecture:** Keep the existing UI and store as the shared application layer. Add a Capacitor Android shell, a native BLE adapter, one reusable platform adapter created from immutable endpoint profiles, a connection resolver, and partitioned persistence. App access route and device transport remain separate, and reported state changes only from confirmed device/platform data.

**Tech Stack:** Vite 5, Node.js 24, Capacitor 8.4.2, `@capacitor-community/bluetooth-le` 8.2.0, Capacitor Preferences/App/Network plugins, IndexedDB through `idb`, Java 17, Android API 36, Spring Boot 3.2, Node test runner, Playwright, Maven/JUnit.

---

## File Map

### New client files

- `client/capacitor.config.js`: Capacitor application ID, name, web directory, and native HTTP bridge configuration.
- `client/src/js/platform/runtime-config.js`: endpoint profile validation and Preferences-backed selection.
- `client/src/js/platform/platform-adapter-factory.js`: construct an immutable API/realtime platform session.
- `client/src/js/platform/connection-resolver.js`: select `BLE_LOCAL`, `SITE_API`, or `CLOUD_API` before command submission.
- `client/src/js/platform/command-dispatcher.js`: capture one adapter and route per command so endpoint changes cannot resend it.
- `client/src/js/platform/cache-repository.js`: IndexedDB platform cache, local bindings, and local activity.
- `client/src/js/platform/app-lifecycle.js`: Capacitor foreground/background orchestration.
- `client/src/js/adapters/native-ble-adapter.js`: native plugin scan/connect/read/write/notify boundary.
- `client/src/js/adapters/platform-adapter.js`: shared site/cloud platform operations.
- `client/test/capacitor-config.test.js`: package shell configuration contract.
- `client/test/runtime-config.test.js`: endpoint normalization and persistence.
- `client/test/platform-adapter.test.js`: endpoint-bound API/realtime behavior.
- `client/test/connection-resolver.test.js`: deterministic route selection and refusal states.
- `client/test/command-dispatcher.test.js`: one-dispatch behavior across endpoint changes.
- `client/test/cache-repository.test.js`: endpoint/organization cache partitioning and local binding identity.
- `client/test/app-lifecycle.test.js`: pause/resume sequencing.
- `client/test/native-ble-adapter.test.js`: native plugin behavior and command confirmation.
- `client/test/android-config.test.js`: Android manifest and debug cleartext boundaries.
- `client/e2e/mobile-client.spec.js`: mobile navigation, endpoint settings, stale state, and command UI.
- `client/playwright.config.js`: reproducible 390px browser checks.

### Existing client files to modify

- `client/package.json`, `client/package-lock.json`: pinned Capacitor, BLE, storage, and test dependencies.
- `client/src/js/api.js`: accept immutable runtime endpoint configuration without changing URL joining behavior.
- `client/src/js/realtime.js`: continue accepting an explicit WebSocket URL and expose clean session disposal.
- `client/src/js/adapters/connection-adapter.js`: keep the browser adapter contract compatible while focused native/platform adapters are introduced.
- `client/src/js/adapters/lan-mock-adapter.js`: delete after all project imports move to `PlatformAdapter`.
- `client/src/js/adapters/ble-adapter.js`: stop synthesizing BLE acknowledgements and reported state.
- `client/src/js/adapters/ble-profile-registry.js`: declare confirmation mode and decode profile confirmations.
- `client/src/js/command-state.js`: add the terminal `UNCONFIRMED` state.
- `client/src/js/client-flow.js`: represent native local bindings without authoritative organization assignment.
- `client/src/js/store.js`: persist route/stale metadata and accept `UNCONFIRMED` commands.
- `client/src/js/ui.js`: add connection settings, route/transport labels, stale state, and unconfirmed feedback.
- `client/src/main.js`: bootstrap repositories/adapters, switch endpoint sessions, route commands, and attach App lifecycle.

### Generated/modified Android files

- `client/android/`: generated Capacitor Android project, committed except build products and `local.properties`.
- `client/android/app/src/main/AndroidManifest.xml`: BLE/network features and release-safe defaults.
- `client/android/app/src/debug/AndroidManifest.xml`: debug-only cleartext override.
- `client/android/app/src/debug/res/xml/network_security_config.xml`: debug cleartext policy.

### Documentation

- `README.md`: Android prerequisites, environment variables, endpoint setup, APK build/install, and limitations.

## Task 1: Capture the Existing Baseline and Prepare Android Tools

**Files:**
- Track: `.gitignore`, `README.md`, `backend/`, `client/`, `console/`, `frontend/`, existing specs and plans
- External tools: `C:\Program Files\Java\jdk-17`, `C:\Users\Raid\AppData\Local\Android\Sdk`

- [ ] **Step 1: Record the current source baseline without staging generated artifacts**

Run from the project root:

```powershell
git status --short
git add -- .gitignore README.md backend client console frontend docs/superpowers/plans docs/superpowers/specs
git status --short
```

Expected: source, tests, migrations, lockfiles, and documents are staged; `node_modules`, `dist`, `target`, backend data, and `.superpowers` remain ignored.

- [ ] **Step 2: Verify the baseline before committing**

```powershell
git diff --cached --check
git diff --cached --stat
```

Expected: no whitespace errors and no generated dependency/build directories.

- [ ] **Step 3: Commit the baseline**

```powershell
git commit -m "chore: capture existing IoT manager baseline"
```

Expected: one commit containing the previously untracked project sources, with the approved Android design and this plan already preserved.

- [ ] **Step 4: Install Android command-line tools only when `sdkmanager.bat` is absent**

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:ANDROID_SDK_ROOT = 'C:\Users\Raid\AppData\Local\Android\Sdk'
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_SDK_ROOT\platform-tools;$env:ANDROID_SDK_ROOT\cmdline-tools\latest\bin;$env:Path"

$sdkManager = Join-Path $env:ANDROID_SDK_ROOT 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path -LiteralPath $sdkManager)) {
  $zip = Join-Path $env:TEMP 'commandlinetools-win-15859902_latest.zip'
  $unpack = Join-Path $env:TEMP ("android-cli-" + [guid]::NewGuid())
  Invoke-WebRequest -UseBasicParsing `
    'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' `
    -OutFile $zip
  $actualSha1 = (Get-FileHash -Algorithm SHA1 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($actualSha1 -ne 'b9862337a13e2809a5159dc3a08d058091bd59f6') {
    throw "Android command-line tools checksum mismatch: $actualSha1"
  }
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack
  New-Item -ItemType Directory -Force (Join-Path $env:ANDROID_SDK_ROOT 'cmdline-tools\latest') | Out-Null
  Copy-Item -Recurse -Force (Join-Path $unpack 'cmdline-tools\*') (Join-Path $env:ANDROID_SDK_ROOT 'cmdline-tools\latest')
}
```

Expected: `cmdline-tools\latest\bin\sdkmanager.bat` exists. The URL and checksum correspond to official command-line tools 22 at plan creation time.

- [ ] **Step 5: Install the Android SDK packages required by the build**

```powershell
$sdkManager = Join-Path $env:ANDROID_SDK_ROOT 'cmdline-tools\latest\bin\sdkmanager.bat'
1..100 | ForEach-Object { 'y' } | & $sdkManager --sdk_root=$env:ANDROID_SDK_ROOT --licenses
& $sdkManager --sdk_root=$env:ANDROID_SDK_ROOT `
  'platform-tools' `
  'platforms;android-36' `
  'build-tools;36.0.0' `
  'emulator' `
  'system-images;android-36;google_apis_playstore;x86_64'
```

Expected: exit code 0 and installed directories under `platform-tools`, `platforms\android-36`, and `build-tools\36.0.0`.

- [ ] **Step 6: Verify Java and Android tools**

```powershell
& "$env:JAVA_HOME\bin\java.exe" -version
& "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe" version
& $sdkManager --sdk_root=$env:ANDROID_SDK_ROOT --list_installed
```

Expected: Java 17, a working ADB, and API 36/build-tools 36.0.0 listed.

## Task 2: Add the Capacitor Android Shell

**Files:**
- Create: `client/capacitor.config.js`
- Create: `client/test/capacitor-config.test.js`
- Create: `client/android/` through Capacitor CLI
- Modify: `client/package.json`, `client/package-lock.json`

- [ ] **Step 1: Write the failing Capacitor configuration test**

```js
// client/test/capacitor-config.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import config from '../capacitor.config.js';

test('Capacitor packages the existing client build', () => {
  assert.equal(config.appId, 'com.iot.manager.client');
  assert.equal(config.appName, 'IoT Manager');
  assert.equal(config.webDir, 'dist');
  assert.equal(config.plugins.CapacitorHttp.enabled, true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
Set-Location client
node --test test/capacitor-config.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `capacitor.config.js`.

- [ ] **Step 3: Install pinned runtime and test dependencies**

```powershell
npm install --save-exact `
  @capacitor/core@8.4.2 `
  @capacitor/android@8.4.2 `
  @capacitor/app@8.1.1 `
  @capacitor/network@8.0.1 `
  @capacitor/preferences@8.0.1 `
  @capacitor-community/bluetooth-le@8.2.0 `
  idb@8.0.3
npm install --save-dev --save-exact `
  @capacitor/cli@8.4.2 `
  @playwright/test@1.62.0 `
  fake-indexeddb@6.2.5
```

Expected: package files contain exact versions and `npm audit` does not interrupt installation.

- [ ] **Step 4: Create the minimal Capacitor configuration**

```js
// client/capacitor.config.js
const config = {
  appId: 'com.iot.manager.client',
  appName: 'IoT Manager',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: { enabled: true }
  }
};

export default config;
```

- [ ] **Step 5: Run the configuration test and web build**

```powershell
npm test
npm run build
```

Expected: all client tests pass and `dist/index.html` exists.

- [ ] **Step 6: Generate and synchronize the Android project**

```powershell
npx cap add android
npx cap sync android
```

Expected: `client/android/gradlew.bat`, `client/android/app`, and copied web assets exist; Capacitor reports installed Android plugins.

- [ ] **Step 7: Commit the shell**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/package.json client/package-lock.json client/capacitor.config.js client/test/capacitor-config.test.js client/android
git commit -m "build(client): add Capacitor Android shell"
```

## Task 3: Add Runtime Site and Cloud Endpoint Profiles

**Files:**
- Create: `client/src/js/platform/runtime-config.js`
- Create: `client/test/runtime-config.test.js`
- Modify: `client/src/js/api.js`

- [ ] **Step 1: Write endpoint validation and persistence tests**

```js
// client/test/runtime-config.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCESS_ROUTES,
  RuntimeConfigRepository,
  normalizeEndpointProfile
} from '../src/js/platform/runtime-config.js';

function fakePreferences() {
  const values = new Map();
  return {
    async get({ key }) { return { value: values.get(key) ?? null }; },
    async set({ key, value }) { values.set(key, value); }
  };
}

test('normalizes a site endpoint into immutable API and WebSocket URLs', () => {
  const profile = normalizeEndpointProfile({
    id: 'factory-a',
    accessRoute: ACCESS_ROUTES.SITE_API,
    apiBaseUrl: 'http://10.0.0.8:8080',
    wsUrl: 'ws://10.0.0.8:8080/ws'
  });
  assert.equal(profile.apiBaseUrl, 'http://10.0.0.8:8080/api');
  assert.equal(profile.wsUrl, 'ws://10.0.0.8:8080/ws/devices');
  assert.equal(Object.isFrozen(profile), true);
});

test('persists and reloads the active endpoint profile', async () => {
  const preferences = fakePreferences();
  const repository = new RuntimeConfigRepository({ preferences });
  await repository.save({
    id: 'cloud',
    accessRoute: ACCESS_ROUTES.CLOUD_API,
    apiBaseUrl: 'https://iot.example.test/api',
    wsUrl: 'wss://iot.example.test/ws/devices'
  });
  assert.equal((await repository.load()).id, 'cloud');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```powershell
node --test test/runtime-config.test.js
```

Expected: FAIL because `runtime-config.js` does not exist.

- [ ] **Step 3: Implement immutable endpoint profiles and Preferences persistence**

```js
// client/src/js/platform/runtime-config.js
import { Preferences } from '@capacitor/preferences';
import { resolveClientConfig } from '../api.js';

export const ACCESS_ROUTES = Object.freeze({
  BLE_LOCAL: 'BLE_LOCAL',
  SITE_API: 'SITE_API',
  CLOUD_API: 'CLOUD_API'
});

const STORAGE_KEY = 'iot-manager.active-endpoint.v1';

function endpointId(value) {
  const id = String(value ?? '').trim();
  if (!id) throw new TypeError('Endpoint profile requires id');
  return id;
}

export function normalizeEndpointProfile(input = {}) {
  if (![ACCESS_ROUTES.SITE_API, ACCESS_ROUTES.CLOUD_API].includes(input.accessRoute)) {
    throw new TypeError('Endpoint accessRoute must be SITE_API or CLOUD_API');
  }
  const resolved = resolveClientConfig({ apiBaseUrl: input.apiBaseUrl, wsUrl: input.wsUrl });
  const api = new URL(resolved.apiBaseUrl, globalThis.location?.origin ?? 'http://localhost');
  const ws = new URL(resolved.wsUrl);
  if (!['http:', 'https:'].includes(api.protocol)) throw new TypeError('API URL must use HTTP or HTTPS');
  if (!['ws:', 'wss:'].includes(ws.protocol)) throw new TypeError('WebSocket URL must use WS or WSS');
  return Object.freeze({
    id: endpointId(input.id),
    accessRoute: input.accessRoute,
    apiBaseUrl: api.href.replace(/\/$/, ''),
    wsUrl: ws.href.replace(/\/$/, ''),
    organizationCode: String(input.organizationCode ?? '').trim() || null
  });
}

export class RuntimeConfigRepository {
  constructor({ preferences = Preferences } = {}) {
    this.preferences = preferences;
  }

  async load() {
    const { value } = await this.preferences.get({ key: STORAGE_KEY });
    return value ? normalizeEndpointProfile(JSON.parse(value)) : null;
  }

  async save(profile) {
    const normalized = normalizeEndpointProfile(profile);
    await this.preferences.set({ key: STORAGE_KEY, value: JSON.stringify(normalized) });
    return normalized;
  }
}
```

- [ ] **Step 4: Run endpoint and existing API tests**

```powershell
node --test test/runtime-config.test.js test/api.test.js
```

Expected: PASS, including URL normalization for bare backend origins.

- [ ] **Step 5: Commit runtime configuration**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/src/js/platform/runtime-config.js client/test/runtime-config.test.js client/src/js/api.js
git commit -m "feat(client): add runtime endpoint profiles"
```

## Task 4: Replace Duplicate LAN/Remote Logic with One Platform Adapter

**Files:**
- Create: `client/src/js/adapters/platform-adapter.js`
- Create: `client/src/js/platform/platform-adapter-factory.js`
- Create: `client/test/platform-adapter.test.js`

- [ ] **Step 1: Write the endpoint-bound adapter factory test**

```js
// client/test/platform-adapter.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlatformAdapter } from '../src/js/platform/platform-adapter-factory.js';

test('creates one platform session bound to one immutable endpoint', async () => {
  const requests = [];
  const session = createPlatformAdapter({
    endpointProfile: {
      id: 'site-a',
      accessRoute: 'SITE_API',
      apiBaseUrl: 'http://10.0.0.8:8080/api',
      wsUrl: 'ws://10.0.0.8:8080/ws/devices'
    },
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    webSocketFactory: () => ({ readyState: 3, close() {} })
  });
  await session.adapter.listDevices();
  assert.equal(session.accessRoute, 'SITE_API');
  assert.equal(requests[0], 'http://10.0.0.8:8080/api/devices');
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/platform-adapter.test.js
```

Expected: FAIL because the factory module does not exist.

- [ ] **Step 3: Implement the shared platform adapter**

```js
// client/src/js/adapters/platform-adapter.js
import { createIdempotencyKey } from '../api.js';

export class PlatformAdapter {
  constructor({ api, realtime, accessRoute, idempotencyKeyFactory = () => createIdempotencyKey('platform') }) {
    if (!api || !realtime) throw new TypeError('PlatformAdapter requires API and realtime clients');
    this.api = api;
    this.realtime = realtime;
    this.accessRoute = accessRoute;
    this.idempotencyKeyFactory = idempotencyKeyFactory;
  }

  listDevices(context = {}, options = {}) { return this.api.listDevices(context, options); }
  discoverLan({ siteCode }, options = {}) { return this.api.listLanCandidates(siteCode, options); }
  claimLan(candidate, claim, options = {}) {
    const candidateId = typeof candidate === 'string' ? candidate : candidate?.candidateId;
    if (!candidateId) throw new TypeError('LAN claim requires a candidate');
    return this.api.claimLanCandidate(candidateId, claim, options);
  }
  sendCommand(command, options = {}) {
    if (command?.deviceId === undefined || !command?.type) throw new TypeError('Platform command requires deviceId and type');
    return this.api.submitCommand(command.deviceId, {
      type: command.type,
      parameters: command.parameters ?? {},
      idempotencyKey: command.idempotencyKey ?? this.idempotencyKeyFactory()
    }, options);
  }
  getCommand(commandId, options = {}) { return this.api.getCommand(commandId, options); }
  listActivity(deviceId, options = {}) { return this.api.listActivity(deviceId, options); }
  subscribe(listener) { return this.realtime.subscribe(listener); }
  subscribeStatus(listener, options) { return this.realtime.subscribeStatus(listener, options); }
  connect() { return this.realtime.connect(); }
  disconnect() { this.realtime.disconnect(); }
}
```

- [ ] **Step 4: Implement the immutable session factory**

```js
// client/src/js/platform/platform-adapter-factory.js
import { ApiClient } from '../api.js';
import { RealtimeClient } from '../realtime.js';
import { PlatformAdapter } from '../adapters/platform-adapter.js';
import { normalizeEndpointProfile } from './runtime-config.js';

export function createPlatformAdapter({ endpointProfile, fetchImpl, webSocketFactory } = {}) {
  const profile = normalizeEndpointProfile(endpointProfile);
  const api = new ApiClient({ baseUrl: profile.apiBaseUrl, fetchImpl });
  const realtime = new RealtimeClient({ url: profile.wsUrl, webSocketFactory });
  return Object.freeze({
    endpointProfile: profile,
    accessRoute: profile.accessRoute,
    adapter: new PlatformAdapter({ api, realtime, accessRoute: profile.accessRoute })
  });
}
```

- [ ] **Step 5: Run adapter/API/realtime tests**

```powershell
node --test test/platform-adapter.test.js test/api.test.js test/realtime.test.js test/lan-mock-adapter.test.js
```

Expected: PASS. The existing `LanMockAdapter` remains untouched until `main.js` is migrated in Task 9, so every intermediate commit remains buildable.

- [ ] **Step 6: Commit the platform session boundary**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/src/js/adapters/platform-adapter.js client/src/js/platform/platform-adapter-factory.js client/test/platform-adapter.test.js
git commit -m "refactor(client): share platform adapter across endpoints"
```

## Task 5: Add Route Resolution and Safe Command States

**Files:**
- Create: `client/src/js/platform/connection-resolver.js`
- Create: `client/test/connection-resolver.test.js`
- Modify: `client/src/js/command-state.js`
- Modify: `client/test/command-state.test.js`
- Modify: `client/src/js/adapters/ble-profile-registry.js`
- Modify: `client/test/ble-profile-registry.test.js`
- Modify: `client/src/js/adapters/ble-adapter.js`

- [ ] **Step 1: Write failing resolver and unconfirmed-state tests**

```js
// client/test/connection-resolver.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConnectionRoute } from '../src/js/platform/connection-resolver.js';

test('routes local bindings only through a connected BLE adapter', () => {
  assert.equal(resolveConnectionRoute({ device: { localOnly: true }, bleConnected: true }).accessRoute, 'BLE_LOCAL');
  assert.throws(() => resolveConnectionRoute({ device: { localOnly: true }, bleConnected: false }), /reconnect/i);
});

test('keeps endpoint access route separate from device transport', () => {
  const route = resolveConnectionRoute({
    device: { connections: [{ transport: 'LAN_AGENT' }] },
    endpointProfile: { accessRoute: 'CLOUD_API' }
  });
  assert.deepEqual(route, { accessRoute: 'CLOUD_API', deviceTransport: 'LAN_AGENT' });
});
```

Change the existing import in `client/test/command-state.test.js`, then append the test:

```js
import { isTerminalCommandStatus, transitionCommand } from '../src/js/command-state.js';

test('unconfirmed BLE delivery never changes reported state', () => {
  const next = transitionCommand(
    { desiredState: { power: false }, reportedState: { power: false } },
    { commandId: 'ble-1', type: 'set_power', parameters: { on: true }, status: 'UNCONFIRMED' }
  );
  assert.deepEqual(next.reportedState, { power: false });
  assert.equal(next.commandStatus, 'UNCONFIRMED');
  assert.equal(isTerminalCommandStatus(next.commandStatus), true);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```powershell
node --test test/connection-resolver.test.js test/command-state.test.js
```

Expected: missing resolver module and `UNCONFIRMED` is not terminal.

- [ ] **Step 3: Implement deterministic route resolution**

```js
// client/src/js/platform/connection-resolver.js
function deviceTransport(device = {}) {
  return device.connections?.find((connection) => connection?.status === 'CONNECTED')?.transport
    ?? device.connections?.[0]?.transport
    ?? 'UNKNOWN';
}

export function resolveConnectionRoute({ device, bleConnected = false, endpointProfile = null } = {}) {
  if (!device) throw new TypeError('Connection route requires a device');
  if (device.localOnly === true) {
    if (!bleConnected) throw new Error('BLE device is disconnected; reconnect before control');
    return { accessRoute: 'BLE_LOCAL', deviceTransport: 'BLE_DIRECT' };
  }
  if (!endpointProfile?.accessRoute) throw new Error('Platform endpoint is unavailable');
  return { accessRoute: endpointProfile.accessRoute, deviceTransport: deviceTransport(device) };
}
```

- [ ] **Step 4: Extend command state without synthesizing reported state**

In `client/src/js/command-state.js`, keep reported-state mutation restricted to `ACKNOWLEDGED` and change the terminal predicate:

```js
export function isTerminalCommandStatus(status) {
  return status === 'ACKNOWLEDGED' || status === 'UNCONFIRMED' || status === 'FAILED';
}
```

Change browser BLE write completion in `client/src/js/adapters/ble-adapter.js` to return:

```js
const result = {
  commandId: command?.commandId ?? null,
  deviceId: this.activeConnection?.id ?? null,
  type: command?.type,
  status: operation.confirmation?.type === 'none' ? 'UNCONFIRMED' : 'SENT',
  reportedState: this.activeConnection?.reportedState ?? {}
};
```

Remove `reportedStateFromCommand`; it is no longer valid evidence of device state.

- [ ] **Step 5: Declare confirmation behavior in the BLE profile registry**

Extend the demo profile command operation:

```js
set_power: (parameters) => ({
  serviceUuid: DEMO_SWITCH_SERVICE,
  characteristicUuid: DEMO_SWITCH_WRITE_CHARACTERISTIC,
  value: new Uint8Array([parameters?.on === true ? 1 : 0]),
  withResponse: true,
  confirmation: { type: 'none' }
})
```

Have `encodeCommand` copy and validate `confirmation` so each operation returns one of `none`, `read`, or `notification`; reject other values with `TypeError`.

Use this validation before returning the encoded operation:

```js
const confirmation = operation.confirmation ?? { type: 'none' };
if (!['none', 'read', 'notification'].includes(confirmation.type)) {
  throw new TypeError(`BLE profile '${profileId}' returned an invalid confirmation type`);
}
if (confirmation.type !== 'none' && (!confirmation.serviceUuid || !confirmation.characteristicUuid || typeof confirmation.decode !== 'function')) {
  throw new TypeError(`BLE profile '${profileId}' requires confirmation UUIDs and decoder`);
}
return {
  serviceUuid: operation.serviceUuid,
  characteristicUuid: operation.characteristicUuid,
  value: new Uint8Array(operation.value),
  withResponse: operation.withResponse !== false,
  confirmation
};
```

- [ ] **Step 6: Run command, registry, browser BLE, and resolver tests**

```powershell
node --test test/connection-resolver.test.js test/command-state.test.js test/ble-profile-registry.test.js test/ble-adapter.test.js
```

Expected: PASS; no test expects a successful write to update reported state.

- [ ] **Step 7: Commit command correctness**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/src/js/platform/connection-resolver.js client/test/connection-resolver.test.js client/src/js/command-state.js client/test/command-state.test.js client/src/js/adapters/ble-profile-registry.js client/test/ble-profile-registry.test.js client/src/js/adapters/ble-adapter.js client/test/ble-adapter.test.js
git commit -m "fix(client): separate delivery from device acknowledgement"
```

## Task 6: Add Partitioned Offline Persistence

**Files:**
- Create: `client/src/js/platform/cache-repository.js`
- Create: `client/test/cache-repository.test.js`
- Modify: `client/src/js/client-flow.js`
- Modify: `client/test/client-flow.test.js`

- [ ] **Step 1: Write cache partition and local binding tests**

```js
// client/test/cache-repository.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { CacheRepository } from '../src/js/platform/cache-repository.js';

test('platform snapshots are partitioned by endpoint and organization', async () => {
  const cache = new CacheRepository({ databaseName: `iot-test-${Date.now()}` });
  await cache.replacePlatformDevices({ endpointId: 'site', organizationCode: 'org-a', devices: [{ id: 1 }] });
  const snapshot = await cache.getPlatformSnapshot({ endpointId: 'site', organizationCode: 'org-a' });
  assert.deepEqual(snapshot.devices, [{ id: 1 }]);
  assert.equal(typeof snapshot.cachedAt, 'number');
  assert.deepEqual(await cache.listPlatformDevices({ endpointId: 'cloud', organizationCode: 'org-a' }), []);
});

test('local BLE bindings use install and plugin identities without becoming platform devices', async () => {
  const cache = new CacheRepository({ databaseName: `iot-test-${Date.now()}-ble` });
  const binding = await cache.putLocalBinding({ appInstallId: 'install-1', pluginDeviceId: 'ble-1', displayName: 'Switch' });
  assert.equal(binding.key, 'install-1:ble-1');
  assert.equal(binding.localOnly, true);
  assert.equal(binding.organizationCode, undefined);
  await cache.addLocalActivity({ id: 'event-1', bindingKey: binding.key, eventType: 'command_unconfirmed' });
  assert.deepEqual((await cache.listLocalActivity(binding.key)).map((event) => event.id), ['event-1']);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/cache-repository.test.js
```

Expected: FAIL because `CacheRepository` does not exist.

- [ ] **Step 3: Implement the IndexedDB repository**

```js
// client/src/js/platform/cache-repository.js
import { openDB } from 'idb';

function scopeKey({ endpointId, organizationCode }) {
  if (!endpointId || !organizationCode) throw new TypeError('Platform cache requires endpoint and organization');
  return `${endpointId}:${organizationCode}`;
}

export class CacheRepository {
  constructor({ databaseName = 'iot-manager-client-v1' } = {}) {
    this.databaseName = databaseName;
    this.dbPromise = null;
  }

  db() {
    this.dbPromise ??= openDB(this.databaseName, 1, {
      upgrade(db) {
        const devices = db.createObjectStore('platformDevices', { keyPath: 'key' });
        devices.createIndex('scopeKey', 'scopeKey');
        db.createObjectStore('localBindings', { keyPath: 'key' });
        const activity = db.createObjectStore('localActivity', { keyPath: 'id' });
        activity.createIndex('bindingKey', 'bindingKey');
      }
    });
    return this.dbPromise;
  }

  async replacePlatformDevices(scope, devices = scope.devices ?? []) {
    const key = scopeKey(scope);
    const cachedAt = Date.now();
    const db = await this.db();
    const tx = db.transaction('platformDevices', 'readwrite');
    for (const stored of await tx.store.index('scopeKey').getAll(key)) await tx.store.delete(stored.key);
    for (const device of devices) await tx.store.put({ key: `${key}:${device.id}`, scopeKey: key, device, cachedAt });
    await tx.done;
  }

  async listPlatformDevices(scope) {
    return (await this.getPlatformSnapshot(scope)).devices;
  }

  async getPlatformSnapshot(scope) {
    const db = await this.db();
    const records = await db.getAllFromIndex('platformDevices', 'scopeKey', scopeKey(scope));
    return {
      devices: records.map((item) => item.device),
      cachedAt: records.reduce((latest, item) => Math.max(latest, item.cachedAt ?? 0), 0) || null
    };
  }

  async putLocalBinding(binding) {
    if (!binding.appInstallId || !binding.pluginDeviceId) throw new TypeError('Local binding requires install and plugin ids');
    const value = { ...binding, key: `${binding.appInstallId}:${binding.pluginDeviceId}`, localOnly: true };
    delete value.organizationCode;
    await (await this.db()).put('localBindings', value);
    return value;
  }

  async listLocalBindings() {
    return (await this.db()).getAll('localBindings');
  }

  async addLocalActivity(activity) {
    if (!activity?.id || !activity?.bindingKey) throw new TypeError('Local activity requires id and bindingKey');
    const value = { ...activity, occurredAt: activity.occurredAt ?? new Date().toISOString() };
    await (await this.db()).put('localActivity', value);
    return value;
  }

  async listLocalActivity(bindingKey) {
    return (await this.db()).getAllFromIndex('localActivity', 'bindingKey', bindingKey);
  }
}
```

- [ ] **Step 4: Update local device creation to use non-authoritative pending context**

In `client/src/js/client-flow.js`, replace authoritative local organization fields with:

```js
pendingOrganizationContext: {
  organizationCode: context.organizationCode ?? null,
  siteCode: context.siteCode ?? null,
  spacePath: context.spacePath ?? null
},
localOnly: true
```

Update `client-flow.test.js` to assert `organizationCode` is absent and `pendingOrganizationContext` contains the cached display context.

```js
assert.equal(device.organizationCode, undefined);
assert.deepEqual(device.pendingOrganizationContext, {
  organizationCode: 'demo-org',
  siteCode: 'demo-site',
  spacePath: '/operations/field'
});
```

- [ ] **Step 5: Run cache and client-flow tests**

```powershell
node --test test/cache-repository.test.js test/client-flow.test.js
```

Expected: PASS; cache scopes do not leak and local bindings remain local-only.

- [ ] **Step 6: Commit persistence**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/src/js/platform/cache-repository.js client/test/cache-repository.test.js client/src/js/client-flow.js client/test/client-flow.test.js client/package.json client/package-lock.json
git commit -m "feat(client): add partitioned offline cache"
```

## Task 7: Add Capacitor App Lifecycle Orchestration

**Files:**
- Create: `client/src/js/platform/app-lifecycle.js`
- Create: `client/test/app-lifecycle.test.js`

- [ ] **Step 1: Write the lifecycle sequencing test**

```js
// client/test/app-lifecycle.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { attachAppLifecycle } from '../src/js/platform/app-lifecycle.js';

test('background stops scanning and foreground resynchronizes before controls resume', async () => {
  let listener;
  const calls = [];
  const handle = await attachAppLifecycle({
    appPlugin: { async addListener(_name, callback) { listener = callback; return { remove: async () => calls.push('remove') }; } },
    onBackground: async () => calls.push('background'),
    onForeground: async () => { calls.push('foreground'); }
  });
  await listener({ isActive: false });
  await listener({ isActive: true });
  await handle.remove();
  assert.deepEqual(calls, ['background', 'foreground', 'remove']);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/app-lifecycle.test.js
```

Expected: missing lifecycle module.

- [ ] **Step 3: Implement a small lifecycle bridge**

```js
// client/src/js/platform/app-lifecycle.js
import { App } from '@capacitor/app';

export async function attachAppLifecycle({ appPlugin = App, onBackground, onForeground } = {}) {
  if (typeof onBackground !== 'function' || typeof onForeground !== 'function') {
    throw new TypeError('App lifecycle requires background and foreground handlers');
  }
  let transition = Promise.resolve();
  return appPlugin.addListener('appStateChange', ({ isActive }) => {
    transition = transition.then(() => isActive ? onForeground() : onBackground());
    return transition;
  });
}
```

- [ ] **Step 4: Run the lifecycle test**

```powershell
node --test test/app-lifecycle.test.js
```

Expected: PASS with serialized background/foreground callbacks.

- [ ] **Step 5: Commit lifecycle integration**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/src/js/platform/app-lifecycle.js client/test/app-lifecycle.test.js
git commit -m "feat(client): add native app lifecycle bridge"
```

## Task 8: Implement the Native BLE Adapter

**Files:**
- Create: `client/src/js/adapters/native-ble-adapter.js`
- Create: `client/test/native-ble-adapter.test.js`
- Modify: `client/src/js/adapters/ble-profile-registry.js`

- [ ] **Step 1: Write native scan, connect, and unconfirmed-write tests**

```js
// client/test/native-ble-adapter.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeBleAdapter } from '../src/js/adapters/native-ble-adapter.js';

test('native BLE scans, connects, and leaves write-only commands unconfirmed', async () => {
  const calls = [];
  const plugin = {
    async initialize() { calls.push('initialize'); },
    async isEnabled() { return true; },
    async requestLEScan(_options, callback) { callback({ device: { deviceId: 'ble-1', name: 'Switch' }, rssi: -48 }); },
    async stopLEScan() { calls.push('stop'); },
    async connect(id) { calls.push(['connect', id]); },
    async getServices() { return [{ uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e' }]; },
    async getConnectedDevices() { return [{ deviceId: 'ble-1', name: 'Switch' }]; },
    async write(id) { calls.push(['write', id]); },
    async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin });
  const candidates = [];
  await adapter.scan((candidate) => candidates.push(candidate));
  await adapter.stopScan();
  await adapter.connect(candidates[0]);
  assert.equal(await adapter.verifyConnection(), true);
  const command = await adapter.sendCommand({ commandId: 'ble-command-1', type: 'set_power', parameters: { on: true } });
  assert.equal(command.status, 'UNCONFIRMED');
  assert.deepEqual(command.reportedState, {});
});

test('native BLE exposes permission and disabled-Bluetooth failures', async () => {
  const adapter = new NativeBleAdapter({
    bleClient: {
      async initialize() { throw new Error('permission denied'); },
      async isEnabled() { return false; }
    }
  });
  await assert.rejects(() => adapter.scan(() => {}), /permission denied/);

  const disabled = new NativeBleAdapter({
    bleClient: { async initialize() {}, async isEnabled() { return false; } }
  });
  await assert.rejects(() => disabled.scan(() => {}), /disabled/);
});

test('profile read-back is the only source of acknowledged reported state', async () => {
  const registry = {
    matchDiscoveredServices: () => ({ id: 'confirmed' }),
    getCapabilities: () => ({ known: true, controls: [{ id: 'power' }] }),
    encodeCommand: () => ({
      serviceUuid: 'service', characteristicUuid: 'write', value: new Uint8Array([1]),
      confirmation: { type: 'read', serviceUuid: 'service', characteristicUuid: 'state', decode: (value) => ({ power: value.getUint8(0) === 1 }) }
    })
  };
  const plugin = {
    async connect() {}, async getServices() { return [{ uuid: 'service' }]; }, async write() {},
    async read() { return new DataView(new Uint8Array([1]).buffer); }, async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin, registry });
  await adapter.connect({ deviceId: 'ble-2', name: 'Confirmed switch' });
  const result = await adapter.sendCommand({ commandId: 'c2', type: 'set_power', parameters: { on: true } });
  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.deepEqual(result.reportedState, { power: true });
});

test('notification timeout fails without changing reported state', async () => {
  let stopped = false;
  const registry = {
    matchDiscoveredServices: () => ({ id: 'notify' }), getCapabilities: () => ({ known: true, controls: [] }),
    encodeCommand: () => ({
      serviceUuid: 'service', characteristicUuid: 'write', value: new Uint8Array([1]),
      confirmation: { type: 'notification', serviceUuid: 'service', characteristicUuid: 'notify', decode: () => ({ power: true }) }
    })
  };
  const plugin = {
    async connect() {}, async getServices() { return [{ uuid: 'service' }]; }, async write() {},
    async startNotifications() {}, async stopNotifications() { stopped = true; }, async disconnect() {}
  };
  const adapter = new NativeBleAdapter({ bleClient: plugin, registry, confirmationTimeoutMs: 1 });
  await adapter.connect({ deviceId: 'ble-3' });
  await assert.rejects(() => adapter.sendCommand({ commandId: 'c3', type: 'set_power', parameters: { on: true } }), /timed out/);
  assert.equal(stopped, true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/native-ble-adapter.test.js
```

Expected: missing native adapter module.

- [ ] **Step 3: Implement native initialization, scan, connect, disconnect, and event subscription**

```js
// client/src/js/adapters/native-ble-adapter.js
import { BleClient } from '@capacitor-community/bluetooth-le';
import { defaultBleProfileRegistry } from './ble-profile-registry.js';

export class NativeBlePermissionError extends Error {
  constructor(cause) {
    super(`BLE permission denied: ${cause?.message ?? cause}`);
    this.name = 'NativeBlePermissionError';
    this.code = 'BLE_PERMISSION_DENIED';
  }
}

export class BluetoothDisabledError extends Error {
  constructor() {
    super('Bluetooth is disabled');
    this.name = 'BluetoothDisabledError';
    this.code = 'BLE_DISABLED';
  }
}

export class NativeBleAdapter {
  constructor({ bleClient = BleClient, registry = defaultBleProfileRegistry, confirmationTimeoutMs = 5000 } = {}) {
    this.bleClient = bleClient;
    this.registry = registry;
    this.listeners = new Set();
    this.candidates = new Map();
    this.connection = null;
    this.profile = null;
    this.confirmationTimeoutMs = confirmationTimeoutMs;
  }

  availability() {
    return { available: true, transport: 'BLE_DIRECT' };
  }

  async requestPermissions() {
    try {
      await this.bleClient.initialize({ androidNeverForLocation: true });
    } catch (error) {
      throw new NativeBlePermissionError(error);
    }
    const enabled = await this.bleClient.isEnabled();
    if (!enabled) throw new BluetoothDisabledError();
    return true;
  }

  async scan(listener) {
    if (typeof listener !== 'function') throw new TypeError('BLE scan requires a listener');
    await this.requestPermissions();
    await this.bleClient.requestLEScan({}, (result) => {
      const candidate = { ...result.device, rssi: result.rssi, transport: 'BLE_DIRECT', identityScope: 'app_local' };
      this.candidates.set(candidate.deviceId, candidate);
      listener(candidate);
    });
  }

  stopScan() { return this.bleClient.stopLEScan(); }

  async connect(candidate) {
    const deviceId = candidate?.deviceId;
    if (!deviceId) throw new TypeError('BLE connection requires deviceId');
    await this.bleClient.connect(deviceId, () => this.handleDisconnect(deviceId));
    const services = await this.bleClient.getServices(deviceId);
    this.profile = this.registry.matchDiscoveredServices(services.map((service) => service.uuid));
    this.connection = { deviceId, name: candidate.name ?? 'Unnamed BLE device', transport: 'BLE_DIRECT', status: 'CONNECTED', profileId: this.profile?.id ?? null, reportedState: {} };
    this.emit('connection_update', this.connection);
    return this.connection;
  }

  getCapabilities() { return this.registry.getCapabilities(this.profile?.id ?? null); }
  openAppSettings() { return this.bleClient.openAppSettings(); }
  openBluetoothSettings() { return this.bleClient.openBluetoothSettings(); }

  async verifyConnection() {
    if (this.connection?.status !== 'CONNECTED') return false;
    if (typeof this.bleClient.getConnectedDevices !== 'function') return true;
    const connected = await this.bleClient.getConnectedDevices([]);
    const present = connected.some((device) => device.deviceId === this.connection.deviceId);
    if (!present) this.handleDisconnect(this.connection.deviceId);
    return present;
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async disconnect() {
    if (this.connection?.deviceId) await this.bleClient.disconnect(this.connection.deviceId);
    this.handleDisconnect(this.connection?.deviceId);
  }

  handleDisconnect(deviceId) {
    if (!this.connection || this.connection.status === 'DISCONNECTED') return;
    this.connection = { ...this.connection, deviceId, status: 'DISCONNECTED' };
    this.emit('connection_update', this.connection);
  }

  emit(type, payload) {
    const event = { type, payload, timestamp: Date.now(), version: 1 };
    for (const listener of this.listeners) listener(event);
  }
}
```

- [ ] **Step 4: Add write and confirmation handling**

Add `sendCommand` to `NativeBleAdapter`:

```js
async sendCommand(command) {
  if (this.connection?.status !== 'CONNECTED') throw new Error('BLE device is not connected');
  const operation = this.registry.encodeCommand(this.profile?.id ?? null, command);
  const bytes = new Uint8Array(operation.value);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  await this.bleClient.write(this.connection.deviceId, operation.serviceUuid, operation.characteristicUuid, view);

  if (operation.confirmation.type === 'none') {
    return { ...command, deviceId: this.connection.deviceId, status: 'UNCONFIRMED', reportedState: this.connection.reportedState ?? {} };
  }
  if (operation.confirmation.type === 'read') {
    const value = await this.bleClient.read(this.connection.deviceId, operation.confirmation.serviceUuid, operation.confirmation.characteristicUuid);
    const reportedState = operation.confirmation.decode(value);
    this.connection = { ...this.connection, reportedState };
    return { ...command, deviceId: this.connection.deviceId, status: 'ACKNOWLEDGED', reportedState };
  }
  return this.waitForNotification(command, operation.confirmation);
}
```

Add the complete notification confirmation method:

```js
async waitForNotification(command, confirmation) {
  const deviceId = this.connection.deviceId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = async (result, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await this.bleClient.stopNotifications(deviceId, confirmation.serviceUuid, confirmation.characteristicUuid);
      } catch {
        // The command result still owns the outcome when notification cleanup fails.
      }
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      void finish(null, new Error('BLE confirmation timed out'));
    }, this.confirmationTimeoutMs);

    this.bleClient.startNotifications(
      deviceId,
      confirmation.serviceUuid,
      confirmation.characteristicUuid,
      (value) => {
        try {
          const reportedState = confirmation.decode(value);
          this.connection = { ...this.connection, reportedState };
          void finish({ ...command, deviceId, status: 'ACKNOWLEDGED', reportedState });
        } catch (error) {
          void finish(null, error);
        }
      }
    ).catch((error) => void finish(null, error));
  });
}
```

The caller catches timeout/notification errors and records `FAILED`; this method never invents a reported state.

- [ ] **Step 5: Run native and browser BLE tests**

```powershell
node --test test/native-ble-adapter.test.js test/ble-adapter.test.js test/ble-profile-registry.test.js
```

Expected: PASS for scan/connect/disconnect, unknown profile rejection, unconfirmed write, and confirmed read/notification fixtures.

- [ ] **Step 6: Commit native BLE**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/src/js/adapters/native-ble-adapter.js client/test/native-ble-adapter.test.js client/src/js/adapters/ble-profile-registry.js client/test/ble-profile-registry.test.js
git commit -m "feat(client): add native Android BLE adapter"
```

## Task 9: Integrate Runtime Sessions, Persistence, and Mobile UI

**Files:**
- Create: `client/src/js/platform/command-dispatcher.js`
- Create: `client/test/command-dispatcher.test.js`
- Modify: `client/src/main.js`
- Modify: `client/src/js/store.js`
- Modify: `client/src/js/ui.js`
- Modify: `client/src/css/style.css`
- Modify: `client/test/store.test.js`
- Modify: `client/test/ui-state.test.js`
- Delete: `client/src/js/adapters/lan-mock-adapter.js`
- Delete: `client/test/lan-mock-adapter.test.js`
- Create: `client/e2e/mobile-client.spec.js`
- Create: `client/playwright.config.js`

- [ ] **Step 1: Add failing store tests for route, transport, and stale state**

Append to `client/test/store.test.js`:

```js
test('stores access route separately from device transport and stale state', () => {
  const store = createStore();
  store.setRuntimeContext({ accessRoute: 'CLOUD_API', endpointId: 'cloud', stale: true, lastSyncedAt: 10 });
  store.setDevices([{ id: 7, connections: [{ transport: 'LAN_AGENT', status: 'CONNECTED' }] }]);
  assert.equal(store.getState().runtime.accessRoute, 'CLOUD_API');
  assert.equal(store.getState().devices[0].connections[0].transport, 'LAN_AGENT');
  assert.equal(store.getState().runtime.stale, true);
});
```

Append to `client/test/ui-state.test.js`:

```js
test('stale platform state disables controls without hiding capabilities', () => {
  const screen = deviceScreenState({
    connections: [{ transport: 'LAN_AGENT', profileId: 'lan-agent-v1' }],
    capabilities: [{ id: 'power', writable: true }]
  }, { accessRoute: 'CLOUD_API', stale: true });
  assert.equal(screen.showControls, false);
  assert.equal(screen.controls.length, 1);
  assert.match(screen.notice, /缓存|同步/);
});
```

- [ ] **Step 2: Run the store test and verify it fails**

```powershell
node --test test/store.test.js
```

Expected: FAIL because `setRuntimeContext` is not defined.

- [ ] **Step 3: Add runtime context to the store**

Extend initial state and the returned store API in `client/src/js/store.js`:

```js
runtime: {
  accessRoute: null,
  endpointId: null,
  stale: true,
  lastSyncedAt: null
}
```

```js
function setRuntimeContext(patch = {}) {
  const next = publish({
    ...currentState,
    runtime: { ...currentState.runtime, ...copyValue(patch) }
  });
  return next.runtime;
}
```

Expose `setRuntimeContext` from the store return object.

Change the helper signature to `deviceScreenState(device = {}, runtime = {})`, pass `this.model.runtime` from the detail/control renderer, and add this check after `controlCapabilities` is calculated:

```js
if (runtime.stale === true && runtime.accessRoute !== 'BLE_LOCAL') {
  return {
    showControls: false,
    controls: controlCapabilities,
    unknownBleProfile: false,
    notice: '当前显示缓存状态，请等待平台同步后再控制。'
  };
}
```

- [ ] **Step 4: Write a failing no-resend command dispatcher test**

```js
// client/test/command-dispatcher.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandDispatcher } from '../src/js/platform/command-dispatcher.js';

test('an in-flight command remains on its original endpoint after a profile switch', async () => {
  let completeFirst;
  const calls = { site: 0, cloud: 0 };
  const site = { sendCommand: () => { calls.site += 1; return new Promise((resolve) => { completeFirst = resolve; }); } };
  const cloud = { async sendCommand() { calls.cloud += 1; return {}; } };
  let platform = site;
  let profile = { accessRoute: 'SITE_API' };
  const events = [];
  const dispatch = createCommandDispatcher({
    getPlatform: () => platform,
    getEndpointProfile: () => profile,
    getBleConnected: () => false,
    isPlatformStale: () => false,
    idFactory: () => 'command-1',
    onCommand: (command) => events.push(command)
  });
  const pending = dispatch({ device: { id: 7, connections: [{ transport: 'LAN_AGENT' }] }, type: 'set_power', parameters: { on: true } });
  platform = cloud;
  profile = { accessRoute: 'CLOUD_API' };
  completeFirst({ commandId: 'command-1', status: 'PENDING' });
  const result = await pending;
  assert.equal(result.accessRoute, 'SITE_API');
  assert.deepEqual(calls, { site: 1, cloud: 0 });
  assert.deepEqual(events.map((command) => command.status), ['PENDING']);
});
```

- [ ] **Step 5: Run the dispatcher test and verify it fails**

```powershell
Set-Location client
node --test test/command-dispatcher.test.js
```

Expected: missing command dispatcher module.

- [ ] **Step 6: Implement single-route command dispatch**

```js
// client/src/js/platform/command-dispatcher.js
import { createIdempotencyKey } from '../api.js';
import { resolveConnectionRoute } from './connection-resolver.js';

export function createCommandDispatcher({
  getPlatform,
  getEndpointProfile,
  getBleAdapter,
  getBleConnected,
  isPlatformStale,
  onCommand = () => {},
  idFactory = () => createIdempotencyKey('mobile-command')
} = {}) {
  return async function dispatch({ device, type, parameters = {} }) {
    const endpointProfile = getEndpointProfile?.() ?? null;
    const route = resolveConnectionRoute({ device, bleConnected: getBleConnected?.() === true, endpointProfile });
    const commandId = idFactory(route.accessRoute);
    const command = { commandId, idempotencyKey: commandId, deviceId: device.id, type, parameters };

    try {
      let result;
      if (route.accessRoute === 'BLE_LOCAL') {
        const adapter = getBleAdapter?.();
        if (!adapter) throw new Error('BLE adapter is unavailable');
        onCommand({ ...command, status: 'PENDING', ...route });
        result = await adapter.sendCommand(command);
      } else {
        if (isPlatformStale?.()) throw new Error('平台状态尚未同步，暂时不能发送控制命令');
        const adapter = getPlatform?.();
        if (!adapter) throw new Error('Platform endpoint is unavailable');
        result = await adapter.sendCommand(command);
      }
      const completed = { ...command, ...result, ...route };
      onCommand(completed);
      return completed;
    } catch (error) {
      onCommand({ ...command, status: 'FAILED', error: error?.message ?? String(error), ...route });
      throw error;
    }
  };
}
```

- [ ] **Step 7: Bootstrap an immutable platform session and native/browser BLE adapter in `main.js`**

Replace top-level fixed `ApiClient`, `RealtimeClient`, and `LanMockAdapter` construction with:

```js
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { ACCESS_ROUTES, RuntimeConfigRepository } from './js/platform/runtime-config.js';
import { createPlatformAdapter } from './js/platform/platform-adapter-factory.js';
import { createCommandDispatcher } from './js/platform/command-dispatcher.js';
import { CacheRepository } from './js/platform/cache-repository.js';
import { attachAppLifecycle } from './js/platform/app-lifecycle.js';
import { NativeBleAdapter } from './js/adapters/native-ble-adapter.js';

const runtimeConfigRepository = new RuntimeConfigRepository();
const cacheRepository = new CacheRepository();
let platformSession = null;
let platform = null;
let endpointProfile = null;
let ble = Capacitor.isNativePlatform() ? new NativeBleAdapter() : new BleAdapter();
let platformUnsubscribers = [];

function bindPlatformEvents(adapter) {
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  platformUnsubscribers = [
    adapter.subscribe((event) => store.applyRealtimeEvent(event)),
    adapter.subscribeStatus((health) => {
      store.setConnectionHealth(health);
      if (health.state === 'connected') void refreshDevices();
    }, { emitCurrent: true })
  ];
}

async function activateEndpoint(profile) {
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  platformUnsubscribers = [];
  platform?.disconnect();
  endpointProfile = await runtimeConfigRepository.save(profile);
  platformSession = createPlatformAdapter({ endpointProfile });
  platform = platformSession.adapter;
  bindPlatformEvents(platform);
  store.setRuntimeContext({ accessRoute: endpointProfile.accessRoute, endpointId: endpointProfile.id, stale: true });
  await refreshDevices();
  platform.connect();
}

async function bootstrapRuntime() {
  const saved = await runtimeConfigRepository.load();
  const defaults = resolveClientConfig();
  const profile = saved ?? {
    id: 'local-site',
    accessRoute: ACCESS_ROUTES.SITE_API,
    apiBaseUrl: defaults.apiBaseUrl,
    wsUrl: defaults.wsUrl,
    organizationCode: clientState.context.organizationCode
  };
  await activateEndpoint(profile);
}
```

Replace the old calls using this exact mapping; no function may keep a reference to the old top-level `api`, `realtime`, or `lan` objects:

```js
const devices = await platform.listDevices();
const activity = await platform.listActivity(device.id);
const candidates = await platform.discoverLan({ siteCode: scopedSiteCode });
const device = await platform.claimLan(candidate, { displayName, siteCode, spacePath });
const command = await platform.getCommand(commandId);
```

- [ ] **Step 8: Route every command through the tested dispatcher**

Replace transport guessing in `sendCommand` with:

```js
const dispatchCommand = createCommandDispatcher({
  getPlatform: () => platform,
  getEndpointProfile: () => endpointProfile,
  getBleAdapter: () => ble,
  getBleConnected: () => clientState.ble.connection?.status === 'CONNECTED',
  isPlatformStale: () => store.getState().runtime.stale,
  onCommand: (command) => {
    store.upsertCommand(command);
    if (command.accessRoute === 'BLE_LOCAL' && isTerminalCommandStatus(command.status)) {
      const pluginDeviceId = clientState.ble.connection?.deviceId;
      if (pluginDeviceId) void persistLocalCommandActivity(`${appInstallId}:${pluginDeviceId}`, command);
    }
  }
});

const command = await dispatchCommand({ device, type, parameters });
if (command.accessRoute !== 'BLE_LOCAL' && !isTerminalCommandStatus(command.status)) {
  void pollCommand(command.commandId);
}
return command;
```

Do not retry a command from lifecycle or endpoint-switch handlers.

- [ ] **Step 9: Load cache on network failure and persist successful refreshes**

After a successful platform refresh, call:

```js
await cacheRepository.replacePlatformDevices({
  endpointId: endpointProfile.id,
  organizationCode: endpointProfile.organizationCode ?? clientState.context.organizationCode,
  devices
});
store.setRuntimeContext({ stale: false, lastSyncedAt: Date.now() });
```

On refresh failure, load the same scope, set devices from cache, and set `stale: true`. Never enable platform commands while stale.

- [ ] **Step 10: Restore and persist local BLE bindings and activity**

Add these helpers in `main.js` and call `restoreLocalBindings` during bootstrap:

```js
async function restoreLocalBindings() {
  for (const binding of await cacheRepository.listLocalBindings()) {
    store.upsertDevice({
      id: `ble:${binding.pluginDeviceId}`,
      deviceId: binding.pluginDeviceId,
      name: binding.displayName,
      localOnly: true,
      status: binding.lastConnectionState === 'CONNECTED' ? 'ONLINE' : 'OFFLINE',
      reportedState: binding.lastReportedState ?? {},
      desiredState: binding.lastReportedState ?? {},
      pendingOrganizationContext: binding.pendingOrganizationContext ?? {},
      connections: [{ transport: 'BLE_DIRECT', status: binding.lastConnectionState ?? 'DISCONNECTED', profileId: binding.profileId ?? null }]
    });
  }
}

async function persistBleBinding(device, connection) {
  return cacheRepository.putLocalBinding({
    appInstallId,
    pluginDeviceId: connection.deviceId,
    profileId: connection.profileId,
    displayName: device.name,
    lastConnectionState: connection.status,
    lastReportedState: device.reportedState ?? {},
    pendingOrganizationContext: device.pendingOrganizationContext ?? {}
  });
}

async function persistLocalCommandActivity(bindingKey, command) {
  return cacheRepository.addLocalActivity({
    id: `ble:${command.commandId}`,
    bindingKey,
    eventType: command.status === 'ACKNOWLEDGED' ? 'command_acknowledged' : 'command_unconfirmed',
    detail: command.status,
    payload: command
  });
}
```

Generate and persist `appInstallId` through Capacitor Preferences once per installation. Call `persistBleBinding` after connect/disconnect and `persistLocalCommandActivity` after a local command reaches `ACKNOWLEDGED`, `UNCONFIRMED`, or `FAILED`.

Use this exact helper during bootstrap:

```js
async function loadAppInstallId(preferences = Preferences) {
  const key = 'iot-manager.app-install-id.v1';
  const existing = await preferences.get({ key });
  if (existing.value) return existing.value;
  const value = globalThis.crypto?.randomUUID?.() ?? `install-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await preferences.set({ key, value });
  return value;
}

let appInstallId = null;
// In bootstrapRuntime, before restoring local bindings:
appInstallId = await loadAppInstallId();
await restoreLocalBindings();
```

- [ ] **Step 11: Add the connection settings screen and truthful status labels**

In `client/src/js/ui.js`:

- Add a `connections` screen opened from the connection-health control.
- Use a segmented selection for `SITE_API` and `CLOUD_API`.
- Add API and WebSocket URL inputs plus one `保存并切换` command.
- Display `BLE 本地`, `现场 LAN`, or `互联网远程` from `model.runtime.accessRoute`.
- Display device transport separately from the device connection.
- Show `缓存状态，最后同步 ...` and disable platform controls when `model.runtime.stale` is true.
- Add the label `已发送，设备未提供确认` for `UNCONFIRMED`.

Wire a `switchEndpoint` action through `createClientUi` to `activateEndpoint`.

Add an endpoint draft to local UI state and a concrete screen builder:

```js
this.local.endpointDraft = {
  accessRoute: this.model.runtime?.accessRoute ?? 'SITE_API',
  apiBaseUrl: this.model.endpointProfile?.apiBaseUrl ?? '',
  wsUrl: this.model.endpointProfile?.wsUrl ?? ''
};
```

```js
buildConnectionSettingsScreen() {
  const fragment = document.createDocumentFragment();
  fragment.append(screenHeading('连接设置', '切换现场或互联网平台连接。', backButton('devices')));
  const surface = element('section', 'surface surface--padded');
  const modes = element('div', 'segmented-control', { role: 'group', ariaLabel: '平台连接方式' });
  for (const [route, label] of [['SITE_API', '现场 LAN'], ['CLOUD_API', '互联网远程']]) {
    modes.append(actionButton(label, 'choose-endpoint-route', {
      className: `segment${this.local.endpointDraft.accessRoute === route ? ' segment--active' : ''}`,
      data: { route }
    }));
  }
  surface.append(modes);
  surface.append(this.textField('API 地址', 'endpoint-api-url', this.local.endpointDraft.apiBaseUrl, '例如：http://10.0.0.8:8080/api', 'endpointApiUrl'));
  surface.append(this.textField('WebSocket 地址', 'endpoint-ws-url', this.local.endpointDraft.wsUrl, '例如：ws://10.0.0.8:8080/ws/devices', 'endpointWsUrl'));
  surface.append(actionButton('保存并切换', 'save-endpoint', { className: 'button button--primary' }));
  fragment.append(surface);
  return fragment;
}
```

Add this branch to `buildCurrentScreen`:

```js
case 'connections':
  screen.append(this.buildConnectionSettingsScreen());
  break;
```

Add click cases for `open-connection-settings`, `choose-endpoint-route`, and `save-endpoint`; the save action invokes:

```js
case 'open-connection-settings':
  this.local.screen = 'connections';
  this.render(this.model);
  break;
case 'choose-endpoint-route':
  this.local.endpointDraft.accessRoute = target.dataset.route;
  this.render(this.model);
  break;
case 'save-endpoint':
this.invoke('switchEndpoint', {
  id: this.local.endpointDraft.accessRoute === 'SITE_API' ? 'site' : 'cloud',
  accessRoute: this.local.endpointDraft.accessRoute,
  apiBaseUrl: this.local.endpointDraft.apiBaseUrl,
  wsUrl: this.local.endpointDraft.wsUrl,
  organizationCode: this.model.context.organizationCode
}, { busy: 'switch-endpoint' });
  break;
```

Update `onInput` with:

```js
if (target.dataset.field === 'endpointApiUrl') this.local.endpointDraft.apiBaseUrl = target.value;
if (target.dataset.field === 'endpointWsUrl') this.local.endpointDraft.wsUrl = target.value;
```

Add a labeled connection-settings button to the header so Playwright can locate it by `连接设置`.

When `requestBle` or native scan catches an error, store `error.code` in `clientState.ble.errorCode`. In the BLE screen, render `前往应用设置` for `BLE_PERMISSION_DENIED` and `打开蓝牙设置` for `BLE_DISABLED`. Wire the actions exactly as:

```js
case 'open-app-settings':
  this.invoke('openBleAppSettings');
  break;
case 'open-bluetooth-settings':
  this.invoke('openBluetoothSettings');
  break;
```

Pass `openBleAppSettings: () => ble.openAppSettings?.()` and `openBluetoothSettings: () => ble.openBluetoothSettings?.()` to `createClientUi`.

Render the BLE recovery commands with the existing `actionButton` helper:

```js
if (this.model.ble.errorCode === 'BLE_PERMISSION_DENIED') {
  surface.append(actionButton('前往应用设置', 'open-app-settings', { className: 'button button--secondary' }));
}
if (this.model.ble.errorCode === 'BLE_DISABLED') {
  surface.append(actionButton('打开蓝牙设置', 'open-bluetooth-settings', { className: 'button button--secondary' }));
}
```

Use exact label helpers rather than deriving one from the other:

```js
function accessRouteLabel(value) {
  return ({ BLE_LOCAL: 'BLE 本地', SITE_API: '现场 LAN', CLOUD_API: '互联网远程' })[value] ?? '连接未配置';
}

function deviceTransportLabel(value) {
  return ({ BLE_DIRECT: 'BLE 直连', LAN_AGENT: '局域网代理' })[value] ?? '设备链路未知';
}
```

- [ ] **Step 12: Attach App lifecycle handlers**

```js
const lifecycleHandle = await attachAppLifecycle({
  onBackground: async () => {
    await ble.stopScan?.();
    platform?.disconnect();
    store.setRuntimeContext({ stale: true });
  },
  onForeground: async () => {
    await ble.availability();
    await ble.verifyConnection?.();
    await refreshDevices();
    platform?.connect();
  }
});
```

Remove reliance on `beforeunload` as the only cleanup path, but keep browser cleanup for the web build. Remove `lifecycleHandle` during browser unload when present.

- [ ] **Step 13: Remove the obsolete LAN adapter after all imports move**

Delete `client/src/js/adapters/lan-mock-adapter.js` and `client/test/lan-mock-adapter.test.js`. Confirm no imports remain:

```powershell
rg -n "LanMockAdapter|lan-mock-adapter" client/src client/test
```

Expected: no matches.

- [ ] **Step 14: Add reproducible mobile Playwright coverage**

```js
// client/playwright.config.js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: { command: 'npm run dev', port: 5175, reuseExistingServer: true },
  use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, baseURL: 'http://127.0.0.1:5175' }
});
```

```js
// client/e2e/mobile-client.spec.js
import { expect, test } from '@playwright/test';

test('mobile client exposes devices, activity, add, and connection settings without overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByText('我的设备')).toBeVisible();
  await expect(page.getByRole('button', { name: /添加/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '连接设置' }).click();
  await expect(page.getByRole('heading', { name: '连接设置' })).toBeVisible();
  await expect(page.getByRole('button', { name: '现场 LAN' })).toBeVisible();
  await expect(page.getByRole('button', { name: '互联网远程' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
```

- [ ] **Step 15: Run unit and browser tests**

```powershell
npm test
npx playwright install chromium
npx playwright test
```

Expected: unit tests pass; 390x844 test has no horizontal overflow and navigation remains visible.

- [ ] **Step 16: Commit application integration**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/src/main.js client/src/js/store.js client/src/js/ui.js client/src/css/style.css client/src/js/platform/command-dispatcher.js client/test/command-dispatcher.test.js client/test/store.test.js client/test/ui-state.test.js client/e2e/mobile-client.spec.js client/playwright.config.js
git rm client/src/js/adapters/lan-mock-adapter.js client/test/lan-mock-adapter.test.js
git commit -m "feat(client): integrate mobile runtime and endpoint switching"
```

## Task 10: Configure Android Permissions and Debug Networking

**Files:**
- Create: `client/test/android-config.test.js`
- Modify: `client/android/app/src/main/AndroidManifest.xml`
- Create: `client/android/app/src/debug/AndroidManifest.xml`
- Create: `client/android/app/src/debug/res/xml/network_security_config.xml`

- [ ] **Step 1: Write the Android configuration contract test**

```js
// client/test/android-config.test.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('release manifest declares BLE/network access without global cleartext', async () => {
  const xml = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(xml, /android.permission.BLUETOOTH_SCAN/);
  assert.match(xml, /android.permission.BLUETOOTH_CONNECT/);
  assert.match(xml, /android.permission.INTERNET/);
  assert.doesNotMatch(xml, /usesCleartextTraffic="true"/);
});

test('debug variant alone enables cleartext development endpoints', async () => {
  const xml = await readFile(new URL('../android/app/src/debug/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(xml, /usesCleartextTraffic="true"/);
  assert.match(xml, /networkSecurityConfig="@xml\/network_security_config"/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
node --test test/android-config.test.js
```

Expected: missing permissions and missing debug manifest.

- [ ] **Step 3: Add the main manifest permissions**

Add above `<application>` in `client/android/app/src/main/AndroidManifest.xml`:

```xml
<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
```

Do not add unrestricted cleartext settings to the main manifest.

- [ ] **Step 4: Add debug-only cleartext configuration**

```xml
<!-- client/android/app/src/debug/AndroidManifest.xml -->
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application
    android:usesCleartextTraffic="true"
    android:networkSecurityConfig="@xml/network_security_config" />
</manifest>
```

```xml
<!-- client/android/app/src/debug/res/xml/network_security_config.xml -->
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
```

- [ ] **Step 5: Run config tests and synchronize plugins**

```powershell
node --test test/android-config.test.js
npm run build
npx cap sync android
```

Expected: tests pass and Capacitor reports BLE, Preferences, App, and Network plugins.

- [ ] **Step 6: Build the debug APK**

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:ANDROID_SDK_ROOT = 'C:\Users\Raid\AppData\Local\Android\Sdk'
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
Set-Location android
.\gradlew.bat assembleDebug
```

Expected: `client/android/app/build/outputs/apk/debug/app-debug.apk` exists and Gradle reports `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit Android policy**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add client/android/app/src/main/AndroidManifest.xml client/android/app/src/debug client/test/android-config.test.js
git commit -m "feat(android): configure BLE and debug networking"
```

## Task 11: Verify the Complete Delivery and Document Operation

**Files:**
- Modify: `README.md`
- Verify: all applications, backend tests, Android APK, emulator, physical device

- [ ] **Step 1: Run all client tests and build**

```powershell
Set-Location client
npm test
npm run build
npx playwright test
npx cap sync android
```

Expected: all unit/E2E tests pass, Vite build succeeds, and Android sync is clean.

- [ ] **Step 2: Run backend lifecycle and idempotency tests with Java 17**

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location ..\backend
mvn -q '-Dtest=DeviceLifecycleIntegrationTest,CommandServiceTest,DeviceCommandRepositoryTest' test
```

Expected: exit code 0 with discovery, claim, command lifecycle, and unique idempotency tests passing.

- [ ] **Step 3: Verify the existing frontend and console builds**

```powershell
Set-Location ..\frontend
npm run build
Set-Location ..\console
npm run build
```

Expected: both existing Vite applications build without regressions.

- [ ] **Step 4: Create and boot an API 36 emulator when no emulator is running**

```powershell
$sdk = 'C:\Users\Raid\AppData\Local\Android\Sdk'
$avdManager = Join-Path $sdk 'cmdline-tools\latest\bin\avdmanager.bat'
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
& $avdManager list avd
if (-not (& $avdManager list avd | Select-String 'Name: IotManagerApi36')) {
  'no' | & $avdManager create avd -n IotManagerApi36 -k 'system-images;android-36;google_apis_playstore;x86_64' --device 'pixel_6'
}
Start-Process -FilePath $emulator -ArgumentList @('-avd','IotManagerApi36','-no-snapshot-load') -WindowStyle Hidden
& $adb wait-for-device
```

Expected: `adb devices` shows one emulator in `device` state.

- [ ] **Step 5: Install and launch the APK on the emulator**

```powershell
Set-Location ..\client\android
.\gradlew.bat assembleDebug
$adb = 'C:\Users\Raid\AppData\Local\Android\Sdk\platform-tools\adb.exe'
& $adb install -r '.\app\build\outputs\apk\debug\app-debug.apk'
& $adb shell am start -n 'com.iot.manager.client/.MainActivity'
& $adb logcat -d -t 300 | Select-String 'FATAL EXCEPTION|Capacitor|IoT Manager'
```

Expected: install success, MainActivity starts, and no fatal exception appears. Verify device list, Add, Dynamic, and endpoint settings screens manually.

- [ ] **Step 6: Perform the physical BLE smoke check**

On a physical Android phone/PDA with developer mode enabled:

```powershell
& $adb devices
& $adb install -r '.\app\build\outputs\apk\debug\app-debug.apk'
& $adb shell am start -n 'com.iot.manager.client/.MainActivity'
```

Verify in this order: permission prompt, Bluetooth-disabled guidance, scan results, connect, generic metadata, disconnect, reconnect, unknown-profile read-only behavior, and a known-profile command. A write-only demo profile must display `已发送，设备未提供确认`; only a profile notification/read-back may display `已确认` and update reported state.

- [ ] **Step 7: Update the root runbook**

Append this section to `README.md`:

````markdown
## Android enterprise client

The Android App packages the existing `client` application with Capacitor. It requires Node.js 22+, Java 17, Android SDK Platform 36, Build Tools 36.0.0, and platform tools.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:ANDROID_SDK_ROOT = 'C:\Users\Raid\AppData\Local\Android\Sdk'
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
Set-Location client
npm ci
npm run build
npx cap sync android
Set-Location android
.\gradlew.bat assembleDebug
```

The debug APK is `client/android/app/build/outputs/apk/debug/app-debug.apk`.

```powershell
& "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe" install -r '.\app\build\outputs\apk\debug\app-debug.apk'
```

Use **连接设置** inside the App to select a site API or cloud API profile. Plain HTTP and WS are allowed only in the debug Android variant for controlled local development. Platform state is read-only while stale or offline; platform commands are never queued. A connected known BLE profile can work offline, but a characteristic write does not update reported state unless the profile defines notification or read-back confirmation. Write-only profiles end as `UNCONFIRMED`.

Authentication, RBAC, production HTTPS/WSS, background BLE, Edge Agent delivery, mini-program delivery, release signing, and managed distribution remain deferred milestones.
````

- [ ] **Step 8: Run final clean verification**

```powershell
Set-Location client
npm ci
npm test
npm run build
npx playwright install chromium
npx playwright test
npx cap sync android
Set-Location android
.\gradlew.bat clean assembleDebug
```

Expected: every command exits 0 and recreates `app-debug.apk` from a clean dependency/build state.

- [ ] **Step 9: Commit delivery documentation**

```powershell
Set-Location 'E:\CC_testP\iot-manager'
git add README.md client/package-lock.json client/android
git commit -m "docs: add Android client build and verification runbook"
git status --short
```

Expected: clean worktree. If physical BLE hardware was unavailable, record that single unverified acceptance item in the handoff instead of claiming it passed.
