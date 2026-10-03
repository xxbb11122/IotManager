import './css/style.css';
import './css/ai.css';

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Preferences } from '@capacitor/preferences';
import { resolveClientConfig } from './js/api.js';
import { createAiController } from './js/ai/ai-controller.js';
import { createAiRecoveryStore } from './js/ai/ai-state.js';
import { OidcSessionManager, normalizeOidcConfig } from './js/auth/oidc-session.js';
import { createLocalBleDevice, decorateLanDevice, mergePlatformAndLocalDevices } from './js/client-flow.js';
import { isTerminalCommandStatus } from './js/command-state.js';
import { BleAdapter } from './js/adapters/ble-adapter.js';
import { NativeBleAdapter } from './js/adapters/native-ble-adapter.js';
import { attachAppLifecycle } from './js/platform/app-lifecycle.js';
import { CacheRepository } from './js/platform/cache-repository.js';
import { createCommandDispatcher } from './js/platform/command-dispatcher.js';
import { deviceLocationErrorMessage, getCurrentDeviceLocation } from './js/platform/device-location.js';
import { friendlyEndpointError, probeEndpoint } from './js/platform/endpoint-probe.js';
import { createPlatformAdapter } from './js/platform/platform-adapter-factory.js';
import { ACCESS_ROUTES, normalizeEndpointProfile, repairLegacyNativeEndpoint, RuntimeConfigRepository } from './js/platform/runtime-config.js';
import { browserWeatherTimezone } from './js/platform/weather-timezone.js';
import { CHANGE_DOMAIN, store } from './js/store.js';
import { createRenderCoordinator } from './js/render-coordinator.js';
import { createRenderMetrics } from './js/render-metrics.js';
import { valueEqual } from './js/value-equality.js';
import { createSnapshotRefreshGate } from './js/snapshot-refresh-gate.js';
import { createStartupTransition } from './js/platform/startup-transition.js';
import { createNativeStartupVisual } from './js/platform/native-startup-visual.js';
import { createClientUi } from './js/ui.js';
import { createWeatherRefreshCooldown } from './js/weather-refresh-cooldown.js';
import { resourceState, beginResource, resolveResource, rejectResource, createRuntimeTaskRegistry, parseWeatherCoordinates, refreshPresentation } from './js/runtime-resource-state.js';

const DEMO_CONTEXT = Object.freeze({
  siteId: null,
  organizationName: '演示组织',
  organizationCode: 'demo-org',
  siteName: '演示站点',
  siteCode: 'demo-site',
  spaceName: '现场空间',
  spacePath: '/operations/field'
});

// A public checkout starts with the Android-emulator endpoint. A physical
// Android/PDA build may supply only public endpoint and OIDC client metadata
// through VITE_NATIVE_* variables in client/.env.local. Credentials are never
// build-time variables; OIDC owns them in the secure runtime session store.
const nativeBuildEnv = import.meta.env ?? {};
function defaultOidcFields({ native = false } = {}) {
  const issuerValue = native
    ? nativeBuildEnv.VITE_NATIVE_OIDC_ISSUER_URL ?? nativeBuildEnv.VITE_OIDC_ISSUER_URL
    : nativeBuildEnv.VITE_OIDC_ISSUER_URL;
  const issuerUrl = !native && String(issuerValue ?? '').startsWith('/') && !String(issuerValue).startsWith('//')
    ? new URL(issuerValue, globalThis.location.origin).href : issuerValue;
  const clientId = native
    ? nativeBuildEnv.VITE_NATIVE_OIDC_CLIENT_ID ?? nativeBuildEnv.VITE_OIDC_CLIENT_ID
    : nativeBuildEnv.VITE_OIDC_CLIENT_ID;
  if (!issuerUrl && !clientId) return {};
  const configuredRedirect = native
    ? nativeBuildEnv.VITE_NATIVE_OIDC_REDIRECT_URI ?? nativeBuildEnv.VITE_OIDC_REDIRECT_URI
    : nativeBuildEnv.VITE_OIDC_REDIRECT_URI;
  const browserRedirect = globalThis.location?.origin
    ? `${globalThis.location.origin}${globalThis.location.pathname}`
    : null;
  return {
    oidcIssuerUrl: issuerUrl ?? null,
    oidcClientId: clientId ?? null,
    oidcRedirectUri: configuredRedirect ?? (native ? 'com.iot.manager.client://oauth/callback' : browserRedirect),
    oidcScope: nativeBuildEnv.VITE_OIDC_SCOPE ?? null
  };
}

const DEFAULT_NATIVE_ENDPOINT = Object.freeze({
  apiBaseUrl: nativeBuildEnv.VITE_NATIVE_API_BASE_URL ?? 'http://10.0.2.2:8080/api/v1',
  wsUrl: nativeBuildEnv.VITE_NATIVE_WS_URL ?? 'ws://10.0.2.2:8080/ws/devices',
  ...defaultOidcFields({ native: true })
});
const WEATHER_READ_CACHE_MS = 10 * 60 * 1000;
const WEATHER_FORECAST_CACHE_MS = 30 * 60 * 1000;
const FOREGROUND_RESYNC_AFTER_MS = 5 * 60 * 1000;
const REALTIME_RESYNC_COOLDOWN_MS = 2 * 60 * 1000;
const PULL_REFRESH_COOLDOWN_MS = 60 * 1000;
const PENDING_WEATHER_LOCATION_KEY = 'iot-manager.pending-weather-location.v1';
const SELECTED_SITE_KEY = 'iot-manager.selected-site.v1';
const PARTIAL_RENDER_ENABLED = import.meta.env.VITE_PARTIAL_RENDER_ENABLED !== 'false';

const nativeRuntime = Capacitor.isNativePlatform();
const runtimeConfigRepository = new RuntimeConfigRepository();
const cacheRepository = new CacheRepository();
let platformSession = null;
let platform = null;
let endpointProfile = null;
let authSession = null;
let authUrlListener = null;
let browserFinishedListener = null;
let browserCloseTimer = null;
let nativeBackListener = null;
let ble = nativeRuntime ? new NativeBleAdapter() : new BleAdapter();
let platformUnsubscribers = [];
let lifecycleHandle = null;
let appInstallId = null;
let weatherRefreshPromise = null;
let lastWeatherReadAt = 0;
let lastForecastReadAt = 0;
let lastPullRefreshAt = 0;
let appBackgroundedAt = null;
let realtimeState = 'idle';
let weatherCooldownDirty = false;
let weatherCooldownFallbackUsed = false;
let sessionRevision = 0;
let endpointActivationRevision = 0;
let bleScanRevision = 0;
let bleConnectionIntent = null;
const runtimeTasks = createRuntimeTaskRegistry(() => JSON.stringify([
  endpointProfile?.id, endpointProfile?.apiBaseUrl, clientState.context.organizationCode,
  clientState.context.siteCode, sessionRevision
]));

let clientState = {
  context: DEMO_CONTEXT,
  endpointProfile: null,
  sites: [],
  lanCandidates: [],
  ble: {
    availability: ble.availability().available,
    reason: ble.availability().reason ?? null,
    candidates: [],
    selectedCandidateId: null,
    candidate: null,
    connection: null,
    errorCode: null,
    scanning: false,
    native: nativeRuntime
  },
  loading: {},
  resources: Object.fromEntries(['devices', 'sites', 'activity', 'lanDiscovery', 'weather', 'weatherForecast'].map((key) => [key, resourceState()])),
  startup: { phase: 'loading', error: null },
  notices: [],
  commandObservation: {},
  weatherSettings: null,
  pendingWeatherLocation: null,
  weatherRefreshRetryAt: null,
  auth: { configured: false, authenticated: false, status: 'not_configured', expiresAt: null, error: null },
  error: null
};

const startupTransition = createStartupTransition({ nativeVisual: createNativeStartupVisual() });
const renderMetrics = createRenderMetrics();
const deviceSnapshotGate = createSnapshotRefreshGate({ cooldownMs: REALTIME_RESYNC_COOLDOWN_MS, metrics: renderMetrics });
const ui = createClientUi(document.getElementById('app'), {
  setTab: () => {},
  screenChanged: (screen) => { void ai.setScreen(screen); },
  aiAction,
  aiInput: ({ field, value }) => {
    if (field === 'ai-question') ai.setDraft(value);
    else ai.setPersonaDraft(field === 'ai-persona-name' ? 'name' : 'instructions', value);
  },
  openAddDevice: () => setClientState({ error: null }),
  chooseAddPath: () => setClientState({ error: null }),
  openWeather,
  refreshWeather: forceRefreshWeather,
  pullRefresh,
  updateWeatherFromDeviceLocation,
  updateWeatherFromManualLocation,
  retryPendingWeatherLocation,
  requestBle,
  stopBleScan,
  selectBleCandidate,
  connectBle,
  disconnectBle,
  forgetBle,
  discoverLan,
  selectLanCandidate: () => {},
  claimLan,
  openDevice,
  sendCommand,
  retryCommand,
  reconnectRealtime,
  switchSite,
  switchEndpoint,
  signIn,
  signOut,
  testEndpoint: (draft) => probeEndpoint({
    accessRoute: draft?.accessRoute,
    apiBaseUrl: draft?.apiBaseUrl,
    wsUrl: draft?.wsUrl,
    organizationCode: clientState.context.organizationCode,
    siteCode: clientState.context.siteCode,
    accessToken: draft?.accessToken,
    oidcIssuerUrl: draft?.oidcIssuerUrl,
    oidcClientId: draft?.oidcClientId,
    oidcRedirectUri: draft?.oidcRedirectUri,
    verifyWebSocket: true
  }),
  openBleAppSettings: () => ble.openAppSettings?.(),
  openBluetoothSettings: () => ble.openBluetoothSettings?.(),
  dismissError: () => setClientState({ error: null })
}, { metrics: renderMetrics });
const ai = createAiController({
  contextProvider: () => ({
    api: platform?.api ?? null, siteId: clientState.context.siteId,
    auth: clientState.auth, endpoint: endpointProfile, organization: clientState.context.organizationCode
  }),
  recovery: createAiRecoveryStore(Preferences),
  onChange: (state) => {
    clientState = { ...clientState, ai: state };
    ui.patchAi(viewModel());
  }
});
const renderCoordinator = createRenderCoordinator({
  fullRender: (snapshot) => ui.renderFull(snapshot),
  patchDevices: (references, snapshot) => ui.patchDevices(references, snapshot),
  patchWeather: (snapshot, options) => ui.patchWeather(snapshot, options),
  patchForecast: (snapshot) => ui.patchWeatherForecast(snapshot),
  patchWeatherSettings: (snapshot) => ui.patchWeatherSettings(snapshot),
  patchRuntime: (snapshot, options) => ui.patchRuntime(snapshot, options),
  patchScreen: (snapshot) => ui.patchScreen(snapshot),
  patchCommands: (references, snapshot, options) => ui.patchCommands(references, snapshot, options),
  patchActivity: (references, snapshot) => ui.patchActivity(references, snapshot),
  patchAlerts: (references, snapshot) => ui.patchAlerts(references, snapshot),
  scheduler: window,
  metrics: renderMetrics,
  batchWindowMs: 150
});

const weatherRefreshCooldown = createWeatherRefreshCooldown({
  scheduler: window,
  onDeadlineChange: (retryAt) => {
    clientState = { ...clientState, weatherRefreshRetryAt: retryAt };
  },
  onTick: ({ retryAt, now }) => {
    if (document.visibilityState === 'hidden') {
      weatherCooldownDirty = true;
      return;
    }
    const patched = ui.patchWeatherCooldown({ retryAt, now });
    if (patched) {
      renderMetrics.increment('countdownPatchCount');
      weatherCooldownFallbackUsed = false;
      return;
    }
    if (!weatherCooldownFallbackUsed) {
      weatherCooldownFallbackUsed = true;
      renderCoordinator.forceFull('weather_cooldown_patch_missing', viewModel());
    }
  }
});

store.subscribe((_state, metadata) => {
  if (!PARTIAL_RENDER_ENABLED) {
    renderCoordinator.forceFull('partial_render_disabled', viewModel());
    return;
  }
  renderCoordinator.enqueue(viewModel(), metadata);
}, { emitCurrent: true });

const unsubscribeBle = ble.subscribe((event) => {
  if (event.type !== 'connection_update') {
    store.applyRealtimeEvent(event);
    return;
  }

  const rawConnection = event.payload ?? {};
  const pluginDeviceId = rawConnection.deviceId ?? rawConnection.id ?? clientState.ble.candidate?.deviceId ?? clientState.ble.candidate?.id;
  const connection = {
    ...rawConnection,
    deviceId: pluginDeviceId,
    capabilities: rawConnection.capabilities ?? ble.getCapabilities?.() ?? { controls: [] }
  };
  setClientState({ ble: { connection, errorCode: null } });
  store.setActiveConnection(connection);

  const existing = store.selectDevice(pluginDeviceId);
  const candidate = clientState.ble.candidates.find((item) => bleCandidateId(item) === String(pluginDeviceId))
    ?? (bleCandidateId(bleConnectionIntent?.candidate) === String(pluginDeviceId) ? bleConnectionIntent.candidate : null)
    ?? (bleCandidateId(clientState.ble.candidate) === String(pluginDeviceId) ? clientState.ble.candidate : null)
    ?? (existing ? { ...existing, id: pluginDeviceId, deviceId: pluginDeviceId } : null)
    ?? { deviceId: pluginDeviceId, name: connection.name };
  if (pluginDeviceId) {
    const sourceContext = bleCandidateId(bleConnectionIntent?.candidate) === String(pluginDeviceId)
      ? bleConnectionIntent.context : existing?.pendingOrganizationContext ?? clientState.context;
    const device = createLocalBleDevice(candidate, connection, sourceContext);
    store.upsertDevice(device);
    void persistBleBinding(device, connection).catch(() => storageNotice('蓝牙连接状态已更新，但本机绑定保存失败。', 'ble-binding'));
  }
});

// Late receipts remain associated with the session which actually sent them.
// Backend command history remains authoritative; this in-memory journal is not
// presented as durable storage and never reapplies an old receipt to a new site.
const commandReceiptsByScope = new Map();

function createScopedCommandDispatch(device) {
  const adapter = platform;
  const profile = endpointProfile;
  const revision = sessionRevision;
  const scope = Object.freeze({ ...platformCacheScope(), sessionRevision: revision });
  const pluginDeviceId = clientState.ble.connection?.deviceId;
  const bindingKey = pluginDeviceId && appInstallId ? `${appInstallId}:${pluginDeviceId}` : null;
  const record = (command) => {
    const local = device?.localOnly === true || command.accessRoute === 'BLE_LOCAL';
    const scopeKey = local ? `ble:${bindingKey}` : JSON.stringify(scope);
    const commands = commandReceiptsByScope.get(scopeKey) ?? new Map();
    const receipt = { ...commands.get(command.commandId), ...command, sourceContext: scope };
    commands.set(command.commandId, receipt);
    commandReceiptsByScope.set(scopeKey, commands);
    if (local || sessionRevision === revision) store.upsertCommand(receipt);
    if (local && bindingKey && isTerminalCommandStatus(command.status)) {
      void persistLocalCommandActivity(bindingKey, receipt).catch(() => {
        storageNotice('蓝牙命令结果已收到，但本机活动记录保存失败。', 'ble-activity');
      });
    }
  };
  return {
    adapter, revision, record,
    dispatch: createCommandDispatcher({
      getPlatform: () => adapter, getEndpointProfile: () => profile,
      getBleAdapter: () => ble,
      getBleConnected: () => clientState.ble.connection?.status === 'CONNECTED',
      isPlatformStale: () => store.getState().runtime.stale,
      onCommand: record
    })
  };
}

function viewModel() {
  const state = store.getState();
  return { ...state, ...clientState, runtime: { ...state.runtime, sessionRevision }, endpointProfile };
}

async function aiAction({ action, id }) {
  switch (action) {
    case 'ai-send': return ai.send();
    case 'ai-new': return ai.newConversation();
    case 'ai-recover': return ai.recover();
    case 'ai-cancel': return ai.cancelWait();
    case 'ai-retry':
      if (ai.getState().pending?.state === 'UNKNOWN' && !window.confirm('原请求结果及费用无法确认，再次生成可能重复计费。确定重新提问？')) return;
      return ai.retry();
    case 'ai-reload': return ai.reload();
    case 'ai-suggest': return ai.setDraft(String(id ?? ''));
    case 'ai-history-more': return ai.loadHistory(true);
    case 'ai-messages-more': return ai.loadMessages(true);
    case 'ai-select':
      await ai.selectConversation(id);
      ui.navigate('ai', { kind: 'push' }); render('ai_conversation_selected');
      return;
    case 'ai-delete':
      if (window.confirm('删除此会话及消息？删除后无法恢复。')) return ai.deleteConversation(id);
      return;
    case 'ai-persona-save': return ai.savePersona();
    case 'ai-persona-activate': return ai.activatePersona(Number(id));
    case 'ai-copy': {
      const row = ai.getState().messages.find((message) => message.id === id && message.role === 'ASSISTANT');
      if (!row) return;
      try { await navigator.clipboard.writeText(row.content); ui.notify('回答已复制。', 'success'); }
      catch { ui.notify('复制失败，请手动选择回答文本。', 'warning'); }
      return;
    }
  }
}

function render(reason = 'explicit_render') {
  renderCoordinator.forceFull(reason, viewModel());
}

function normalizeClientStateMetadata(patch = {}, metadata = {}) {
  const explicitDomains = Array.isArray(metadata.domains) ? metadata.domains : null;
  if (metadata.structural || explicitDomains) {
    return {
      origin: metadata.origin ?? 'local',
      domains: explicitDomains ?? [CHANGE_DOMAIN.STRUCTURE],
      entityRefs: metadata.entityRefs,
      structural: metadata.structural === true,
      reason: metadata.reason ?? 'client_state_explicit'
    };
  }

  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  if (has('context') || has('endpointProfile') || has('sites')) {
    return { origin: 'local', domains: [CHANGE_DOMAIN.STRUCTURE], structural: true, reason: 'client_state_structural' };
  }
  if (has('weatherSettings') || has('pendingWeatherLocation')) {
    return { origin: 'local', domains: [CHANGE_DOMAIN.WEATHER_SETTINGS], structural: false, reason: 'client_state_weather_settings' };
  }
  if (has('weatherRefreshRetryAt')) {
    return { origin: 'local', domains: [CHANGE_DOMAIN.WEATHER], structural: false, reason: 'client_state_weather' };
  }
  if (has('auth')) {
    return { origin: 'local', domains: [CHANGE_DOMAIN.RUNTIME], structural: false, reason: 'client_state_auth' };
  }
  if (has('resources')) {
    const keys = Object.keys(patch.resources ?? {});
    if (keys.length === 1 && keys[0] === 'weatherForecast') {
      return { origin: 'local', domains: [CHANGE_DOMAIN.WEATHER_FORECAST], structural: false, reason: 'resource_forecast' };
    }
    if (keys.length === 1 && keys[0] === 'weather') {
      return { origin: 'local', domains: [CHANGE_DOMAIN.WEATHER], structural: false, reason: 'resource_weather' };
    }
    return { origin: 'local', domains: [CHANGE_DOMAIN.SCREEN], structural: false, reason: 'resource_screen' };
  }
  if (has('commandObservation')) {
    return { origin: 'local', domains: [CHANGE_DOMAIN.COMMANDS], structural: false, reason: 'command_observation' };
  }
  if (has('loading')) {
    const loadingKeys = Object.keys(patch.loading ?? {});
    if (loadingKeys.length === 1 && loadingKeys[0] === 'weatherForecast') {
      return { origin: 'local', domains: [CHANGE_DOMAIN.WEATHER_FORECAST], structural: false, reason: 'client_state_forecast_loading' };
    }
    return { origin: 'local', domains: [CHANGE_DOMAIN.SCREEN], structural: false, reason: 'client_state_loading' };
  }
  if (has('lanCandidates') || has('ble') || has('error')) {
    return { origin: 'local', domains: [CHANGE_DOMAIN.SCREEN], structural: false, reason: 'client_state_screen' };
  }
  return { origin: 'local', domains: [CHANGE_DOMAIN.STRUCTURE], structural: true, reason: 'client_state_unknown' };
}

function setClientState(patch = {}, metadata = {}) {
  const next = {
    ...clientState,
    ...patch,
    context: { ...clientState.context, ...(patch.context ?? {}) },
    loading: { ...clientState.loading, ...(patch.loading ?? {}) },
    resources: { ...clientState.resources, ...(patch.resources ?? {}) },
    commandObservation: { ...clientState.commandObservation, ...(patch.commandObservation ?? {}) },
    ble: { ...clientState.ble, ...(patch.ble ?? {}) }
  };
  if (valueEqual(clientState, next)) {
    renderMetrics.increment('localStateSuppressedCount');
    return;
  }
  clientState = next;
  const change = normalizeClientStateMetadata(patch, metadata);
  if (!PARTIAL_RENDER_ENABLED) {
    render('partial_render_disabled');
    return;
  }
  renderCoordinator.enqueue(viewModel(), change);
}

function setLoading(key, value) {
  setClientState({ loading: { [key]: value } });
}

function setResource(key, value) {
  setClientState({ resources: { [key]: value } });
}

function storageNotice(message, id = 'storage') {
  setClientState({ notices: [...clientState.notices.filter((item) => item.id !== id), { id, tone: 'warning', message }] });
}

function invalidateRuntimeContext({ preserveSites = false } = {}) {
  ai.reset();
  sessionRevision += 1;
  runtimeTasks.invalidate();
  lastWeatherReadAt = 0;
  lastForecastReadAt = 0;
  deviceSnapshotGate.reset();
  lastPullRefreshAt = 0;
  weatherRefreshPromise = null;
  setWeatherRefreshCooldown(0);
  clientState = {
    ...clientState,
    resources: Object.fromEntries(Object.keys(clientState.resources).map((key) => [key, resourceState()])),
    loading: { ...clientState.loading, lanDiscovery: false, lanClaim: false, weatherForecast: false, weatherLocationPhase: null },
    sites: preserveSites ? clientState.sites : [],
    weatherSettings: null, pendingWeatherLocation: null, error: null,
    lanCandidates: [], notices: clientState.notices.filter((notice) => notice.id === 'startup-storage'), commandObservation: {}
  };
  store.clearPlatformData();
}

function weatherRefreshCooldownSeconds() {
  const retryAt = Number(clientState.weatherRefreshRetryAt);
  if (!Number.isFinite(retryAt) || retryAt <= Date.now()) return 0;
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}

function setWeatherRefreshCooldown(seconds) {
  weatherCooldownFallbackUsed = false;
  weatherRefreshCooldown.set(seconds);
}

function describeError(error) {
  if (nativeRuntime && endpointProfile?.apiBaseUrl?.includes('://10.0.2.2')) {
    return '当前地址 10.0.2.2 仅适用于 Android 模拟器；真机请在连接设置填写电脑的局域网地址，例如 http://192.168.1.100:8080/api/v1。';
  }
  if (error?.message === 'Failed to fetch' || /network request failed|connection refused|load failed/i.test(String(error?.message ?? ''))) {
    return '后台不可达：请确认电脑上的后端已启动，手机填写的是电脑局域网地址，且两者连接同一 Wi‑Fi。';
  }
  if (error?.name === 'TypeError') return friendlyEndpointError(error);
  return error?.message || '操作未完成，请检查服务连接后重试。';
}

function isBlePickerCancellation(error) {
  return error?.name === 'NotFoundError' || error?.name === 'AbortError';
}

function platformCacheScope() {
  return {
    endpointId: endpointProfile?.id,
    apiBaseUrl: endpointProfile?.apiBaseUrl ?? '',
    authPartition: clientState.auth.configured ? clientState.auth.cachePartition ?? `unrestored-${sessionRevision}` : 'public',
    organizationCode: endpointProfile?.organizationCode ?? clientState.context.organizationCode,
    siteCode: clientState.context.siteCode
  };
}

function bindPlatformEvents(adapter) {
  const revision = sessionRevision;
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  platformUnsubscribers = [
    adapter.subscribe((event) => {
      if (adapter !== platform || revision !== sessionRevision) return;
      if (event?.payload?.siteCode && String(event.payload.siteCode) !== String(clientState.context.siteCode)) return;
      const applied = store.applyRealtimeEvent(event);
      if (applied && event?.type === 'weather_update') {
        void cacheRepository.putPlatformWeather(platformCacheScope(), event.payload).catch(() => {
          if (revision === sessionRevision) storageNotice('实时天气已收到，但本机缓存保存失败。', 'weather-cache');
        });
        lastWeatherReadAt = Date.now();
      }
    }),
    adapter.subscribeStatus((health) => {
      if (adapter !== platform || revision !== sessionRevision) return;
      const justConnected = health.state === 'connected' && realtimeState !== 'connected';
      realtimeState = health.state;
      store.setConnectionHealth(health);
      if (justConnected) void resyncAfterRealtimeConnect();
    }, { emitCurrent: true })
  ];
}

function currentUrl() {
  return typeof globalThis.location?.href === 'string' ? globalThis.location.href : null;
}

function removeOidcQueryFromBrowser(url) {
  if (url !== currentUrl() || !globalThis.history?.replaceState) return;
  try {
    const cleaned = new URL(url);
    for (const key of ['code', 'state', 'session_state', 'iss', 'error', 'error_description']) {
      cleaned.searchParams.delete(key);
    }
    globalThis.history.replaceState({}, globalThis.document?.title ?? '', `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
  } catch {
    // Callback cleanup must not invalidate an otherwise successful sign-in.
  }
}

function tokenProvider() {
  return authSession?.getAccessToken() ?? endpointProfile?.accessToken ?? null;
}

async function configureAuthSession(profile, { deferRefresh = false } = {}) {
  authSession?.invalidatePendingOperations();
  const config = normalizeOidcConfig(profile);
  if (!config) {
    authSession = null;
    setClientState({ auth: { configured: false, authenticated: false, status: 'not_configured', expiresAt: null, error: null } });
    return null;
  }
  let manager;
  manager = new OidcSessionManager({
    config,
    navigate: (url) => nativeRuntime ? Browser.open({ url }) : globalThis.location.assign(url),
    onStateChange: (auth) => {
      if (authSession !== manager) return;
      if (Boolean(auth.authenticated) !== Boolean(clientState.auth.authenticated)
        || auth.cachePartition !== clientState.auth.cachePartition) invalidateRuntimeContext();
      setClientState({ auth });
      void ai.syncContext();
      if (!auth.authenticated) {
        platform?.disconnect();
        store.setRuntimeContext({ stale: true });
      }
    }
  });
  authSession = manager;
  setClientState({ auth: { ...manager.getState(), status: 'restoring' } });
  await manager.restore({ deferRefresh });
  return manager;
}

async function completeOidcRedirect(url = currentUrl()) {
  if (!authSession?.isRedirect(url)) return false;
  const manager = authSession;
  setClientState({ auth: { ...clientState.auth, status: 'processing_callback', error: null } });
  try {
    const completed = await manager.completeRedirect(url);
    if (completed) removeOidcQueryFromBrowser(url);
    return authSession === manager && completed;
  } catch (error) {
    if (authSession === manager) setClientState({ auth: { ...clientState.auth, error: `登录校验未完成：${error?.message ?? '请重新登录。'}` } });
    throw error;
  }
}

async function synchronizePlatformEndpoint() {
  if (!platform) return null;
  if (authSession?.isConfigured() && !authSession.getAccessToken()) return null;
  const adapter = platform;
  const activation = endpointActivationRevision;
  bindPlatformEvents(adapter);
  await hydrateCachedWeather();
  if (platform !== adapter || activation !== endpointActivationRevision) return null;
  await loadSites();
  if (platform !== adapter || activation !== endpointActivationRevision) return null;
  await refreshDevices();
  if (platform !== adapter || activation !== endpointActivationRevision) return null;
  await refreshWeather({ includeSettings: false });
  if (platform !== adapter || activation !== endpointActivationRevision) return null;
  adapter.connect();
  return endpointProfile;
}

async function activateEndpoint(profile, { startupReady = null, launchUrl = null } = {}) {
  const normalizedProfile = normalizeEndpointProfile(profile);
  const activation = ++endpointActivationRevision;
  setClientState({ loading: { endpointPhase: 'saving' } });
  try {
    invalidateRuntimeContext();
    for (const unsubscribe of platformUnsubscribers) unsubscribe();
    platformUnsubscribers = [];
    platform?.disconnect();
    let savedProfile = normalizedProfile;
    try {
      savedProfile = await runtimeConfigRepository.save(normalizedProfile);
    } catch {
      if (activation === endpointActivationRevision) storageNotice('连接设置已在本次会话生效，但本机保存失败；重启后需要重新填写。', 'endpoint-preference');
    }
    if (activation !== endpointActivationRevision) return null;
    endpointProfile = savedProfile;
    store.setDevices(store.getState().devices.filter((device) => device.localOnly));
    store.setActiveDevice(null);
    store.setWeather(null);
    store.setWeatherForecast(null);
    setClientState({ sites: [], weatherSettings: null, pendingWeatherLocation: null });
    setWeatherRefreshCooldown(0);
    setClientState({ loading: { endpointPhase: 'restoring_auth' } });
    await configureAuthSession(endpointProfile, { deferRefresh: Boolean(startupReady) });
    if (activation !== endpointActivationRevision) return null;
    const endpointAuth = authSession;
    const activatedProfile = endpointProfile;
    platformSession = createPlatformAdapter({
      endpointProfile,
      siteCodeProvider: () => clientState.context.siteCode,
      accessTokenProvider: () => endpointAuth?.getAccessToken() ?? activatedProfile.accessToken ?? null,
      onUnauthorized: () => endpointAuth?.tryRefresh() ?? Promise.resolve(false)
    });
    platform = platformSession.adapter;
    realtimeState = 'idle';
    clientState = { ...clientState, endpointProfile, lanCandidates: [] };
    bindPlatformEvents(platform);
    store.setRuntimeContext({
      accessRoute: endpointProfile.accessRoute,
      endpointId: endpointProfile.id,
      siteCode: clientState.context.siteCode,
      stale: true,
      lastSyncedAt: null
    });
    const redirectUrl = launchUrl ?? currentUrl();
    if (authSession?.isRedirect(redirectUrl)) {
      const completed = await completeOidcRedirect(redirectUrl);
      if (completed && nativeRuntime) await Browser.close().catch(() => {});
    }
    if (activation !== endpointActivationRevision) return null;
    if (startupReady) {
      await startupReady();
      // Restoring a near-expiry session may require a network request. Keep it
      // out of the local first-frame gate, then refresh before remote sync.
      if (authSession?.session?.accessToken && authSession.needsRefresh()) {
        await authSession.tryRefresh();
      }
    }
    setClientState({ loading: { endpointPhase: 'synchronizing' } });
    await synchronizePlatformEndpoint();
    render();
    return endpointProfile;
  } finally {
    if (activation === endpointActivationRevision) setClientState({ loading: { endpointPhase: null } });
  }
}

async function loadSites() {
  if (!platform) return [];
  const adapter = platform;
  const task = runtimeTasks.begin('sites');
  setResource('sites', beginResource(clientState.resources.sites, clientState.sites.length > 0));
  try {
    const response = await adapter.listSites();
    if (!runtimeTasks.current(task)) return [];
    const sites = Array.isArray(response) ? response.filter((site) => site?.siteCode) : [];
    setClientState({ sites, resources: { sites: resolveResource({ hasData: sites.length > 0 }) } });
    if (sites.length > 0) {
      const selected = sites.find((site) => String(site.siteCode) === String(clientState.context.siteCode)) ?? sites[0];
      if (selected && (String(selected.siteCode) !== String(clientState.context.siteCode)
          || String(selected.id) !== String(clientState.context.siteId))) {
        await applySiteContext(selected, { persist: false, reload: false });
        if (platform === adapter && String(clientState.context.siteCode) === String(selected.siteCode)) setResource('sites', resolveResource({ hasData: true }));
      }
    }
    return sites;
  } catch (error) {
    if (!runtimeTasks.current(task)) return [];
    // Keep an older list when available, but never label the demo context as a
    // successfully fetched site. A successful empty response stays empty.
    setResource('sites', rejectResource(clientState.resources.sites, describeError(error), clientState.sites.length > 0));
    return clientState.sites;
  }
}

async function switchSite({ siteCode, siteId } = {}) {
  const selected = clientState.sites.find((site) => siteId != null && String(site.id) === String(siteId))
    || clientState.sites.find((site) => String(site.siteCode) === String(siteCode ?? ''));
  if (!selected) throw new Error('选择的站点不可用，请重新同步站点列表');
  if (String(selected.siteCode) === String(clientState.context.siteCode)
      && String(selected.id) === String(clientState.context.siteId)) return selected;
  await applySiteContext(selected, { persist: true, reload: true });
  return selected;
}

async function applySiteContext(site, { persist = true, reload = true } = {}) {
  const context = {
    ...clientState.context,
    siteId: site.id ?? null,
    organizationCode: site.organizationCode ?? clientState.context.organizationCode,
    organizationName: site.organizationName ?? clientState.context.organizationName,
    siteCode: site.siteCode,
    siteName: site.siteName ?? site.siteCode,
    spaceName: '现场空间',
    spacePath: '/operations/field'
  };
  clientState = { ...clientState, context };
  invalidateRuntimeContext({ preserveSites: true });
  const contextTask = runtimeTasks.begin('siteContext');
  if (persist) {
    try {
      await Preferences.set({ key: SELECTED_SITE_KEY, value: JSON.stringify({
        endpointId: endpointProfile?.id ?? null,
        siteCode: context.siteCode
      }) });
    } catch {
      if (runtimeTasks.current(contextTask)) storageNotice('站点已切换，但本机未能记住此次选择；重启后可能需要重新选择。', 'site-preference');
    }
  }
  if (!runtimeTasks.current(contextTask)) return context;
  store.setDevices(store.getState().devices.filter((device) => device.localOnly));
  store.setActiveDevice(null);
  store.setWeather(null);
  store.setWeatherForecast(null);
  store.setRuntimeContext({ siteCode: context.siteCode, stale: true, lastSyncedAt: null });
  lastWeatherReadAt = 0;
  lastForecastReadAt = 0;
  deviceSnapshotGate.reset();
  setWeatherRefreshCooldown(0);
  setClientState({ context, weatherSettings: null, pendingWeatherLocation: null });
  void ai.syncContext();
  platform?.setSiteCode?.(context.siteCode);
  platform?.disconnect();
  if (platform) bindPlatformEvents(platform);
  if (!reload) return context;
  await Promise.all([
    refreshDevices({ refreshActiveActivity: false }),
    refreshWeather({ forceRead: true, includeSettings: true }),
    loadWeatherForecast({ forceRead: true })
  ]);
  if (runtimeTasks.current(contextTask)) platform?.connect();
  return context;
}

async function switchEndpoint(profile) {
  const oidcConfig = normalizeOidcConfig(profile);
  if (oidcConfig) {
    await activateEndpoint(profile);
    if (!authSession?.getAccessToken()) {
      await signIn();
      return endpointProfile;
    }
    const authenticatedResult = await probeEndpoint({
      accessRoute: endpointProfile.accessRoute,
      apiBaseUrl: endpointProfile.apiBaseUrl,
      wsUrl: endpointProfile.wsUrl,
      organizationCode: clientState.context.organizationCode,
      siteCode: clientState.context.siteCode,
      accessToken: tokenProvider(),
      verifyWebSocket: true
    });
    if (!authenticatedResult.ok) throw new Error(authenticatedResult.message);
    return endpointProfile;
  }
  const result = await probeEndpoint({
    accessRoute: profile?.accessRoute,
    apiBaseUrl: profile?.apiBaseUrl,
    wsUrl: profile?.wsUrl,
    organizationCode: clientState.context.organizationCode,
    siteCode: clientState.context.siteCode,
    accessToken: profile?.accessToken,
    verifyWebSocket: true
  });
  if (!result.ok) throw new Error(result.message);
  return activateEndpoint(profile);
}

async function signIn() {
  if (!authSession?.isConfigured()) {
    throw new Error('当前端点尚未配置登录服务。请在连接设置中填写 Issuer、客户端 ID 和回调地址。');
  }
  const manager = authSession;
  setClientState({ auth: { ...clientState.auth, status: 'redirecting', error: null } });
  try { await manager.beginLogin(); }
  catch (error) {
    if (manager === authSession) setClientState({ auth: { ...manager.getState(), error: `登录准备失败：${error.message}` } });
    throw error;
  }
}

async function signOut() {
  const scope = platformCacheScope();
  const manager = authSession;
  invalidateRuntimeContext();
  setClientState({ auth: { ...clientState.auth, authenticated: false, cachePartition: null, status: 'signing_out' } });
  await ai.reset({ clearMetadata: true });
  void ai.syncContext();
  // Revocation starts immediately; cache cleanup must not delay local logout.
  const logout = manager?.logout();
  logout?.catch(() => {});
  platform?.disconnect();
  setWeatherRefreshCooldown(0);
  store.setDevices(store.getState().devices.filter((device) => device.localOnly));
  store.setActiveDevice(null);
  store.setWeather(null);
  store.setWeatherForecast(null);
  store.setRuntimeContext({ stale: true, lastSyncedAt: null });
  setClientState({ sites: [], weatherSettings: null, pendingWeatherLocation: null, error: null });
  try {
    await cacheRepository.clearPlatformScope(scope);
  } catch {
    // A sign-out must still succeed when no endpoint was configured or local
    // browser storage has already been cleared.
  }
  try { await logout; }
  catch (error) {
    if (manager === authSession) setClientState({ auth: { ...manager.getState(), error: '本机登录状态已退出，外部退出或安全存储清理未完成，请核对后重新登录。' } });
    throw error;
  }
}

function refreshDevices({ refreshActiveActivity = true, automatic = false } = {}) {
  const scopeKey = JSON.stringify([platformCacheScope(), sessionRevision]);
  return deviceSnapshotGate.run(scopeKey, () => readDeviceSnapshot({ refreshActiveActivity }), { automatic });
}

async function readDeviceSnapshot({ refreshActiveActivity = true } = {}) {
  const scope = platformCacheScope();
  const adapter = platform;
  const task = runtimeTasks.begin('devices');
  setResource('devices', beginResource(clientState.resources.devices, store.getState().devices.length > 0));
  let decorated;
  try {
    if (!adapter) throw new Error('Platform endpoint is unavailable');
    const devices = await adapter.listDevices({ siteCode: scope.siteCode });
    if (!runtimeTasks.current(task)) return [];
    decorated = devices.map((device) => decorateLanDevice(device));
    const merged = mergePlatformAndLocalDevices(decorated, store.getState().devices);
    store.setDevices(merged);
    store.setRuntimeContext({ stale: false, lastSyncedAt: Date.now() });
    setClientState({ error: null, resources: { devices: resolveResource({ hasData: merged.length > 0 }) } });
  } catch (error) {
    if (!runtimeTasks.current(task)) return [];
    let snapshot;
    try {
      snapshot = await cacheRepository.getPlatformSnapshot(scope);
    } catch {
      if (runtimeTasks.current(task)) storageNotice('设备缓存读取失败，当前仅保留内存中可用内容。', 'device-cache');
    }
    if (!runtimeTasks.current(task)) return [];
    const retained = snapshot?.devices?.length
      ? mergePlatformAndLocalDevices(snapshot.devices, store.getState().devices)
      : store.getState().devices;
    const merged = retained;
    store.setDevices(retained);
    store.setRuntimeContext({ stale: true, lastSyncedAt: snapshot?.cachedAt ?? store.getState().runtime.lastSyncedAt });
    const resource = rejectResource(clientState.resources.devices, describeError(error), merged.length > 0);
    setClientState({ error: merged.length ? null : describeError(error), resources: { devices: { ...resource, source: merged.length ? 'cache' : null } } });
    return merged;
  }
  // Persistence and ancillary reads do not invalidate an accepted network list.
  try {
    await cacheRepository.replacePlatformDevices({ ...scope, devices: decorated });
  } catch {
    if (runtimeTasks.current(task)) storageNotice('设备数据已更新，但本机缓存保存失败；离线时可能无法恢复此次数据。', 'device-cache');
  }
  if (!runtimeTasks.current(task)) return [];
  const active = store.selectActiveDevice();
  if (refreshActiveActivity && active && !active.localOnly) await loadActivity(active);
  return store.getState().devices;
}

async function loadActivity(device) {
  if (!device || device.localOnly || device.id === null || device.id === undefined || !platform) return [];
  const adapter = platform;
  const task = runtimeTasks.begin('activity');
  const existing = store.getState().activitiesByDeviceId[device.id] ?? [];
  setResource('activity', { ...beginResource(clientState.resources.activity, existing.length > 0), entityId: device.id });
  try {
    const activity = await adapter.listActivity(device.id);
    if (!runtimeTasks.current(task)) return [];
    activity.forEach((entry) => store.addActivity(device.id, entry));
    setResource('activity', { ...resolveResource({ hasData: activity.length > 0 || existing.length > 0 }), entityId: device.id });
    return activity;
  } catch (error) {
    if (runtimeTasks.current(task)) setResource('activity', { ...rejectResource(clientState.resources.activity, describeError(error), existing.length > 0), entityId: device.id });
    return existing;
  }
}

function cacheIsRecent(cachedAt, maxAgeMs) {
  const timestamp = Number(cachedAt);
  return Number.isFinite(timestamp) && timestamp > 0 && Date.now() - timestamp < maxAgeMs;
}

async function hydrateCachedWeather() {
  const task = runtimeTasks.begin('hydrateWeather');
  let cached;
  try {
    cached = await cacheRepository.getPlatformWeather(platformCacheScope());
  } catch {
    if (runtimeTasks.current(task)) storageNotice('天气缓存读取失败，将尝试从后台读取。', 'weather-cache');
    return null;
  }
  if (!runtimeTasks.current(task)) return null;
  if (!cached?.weather) return null;
  const age = Date.now() - Number(cached.cachedAt ?? 0);
  const weather = age > WEATHER_READ_CACHE_MS
    ? { ...cached.weather, status: cached.weather.status === 'EXPIRED' ? 'EXPIRED' : 'STALE' }
    : cached.weather;
  store.setWeather(weather);
  setResource('weather', resolveResource({ hasData: true, source: 'cache', updatedAt: cached.cachedAt }));
  lastWeatherReadAt = Number(cached.cachedAt) || 0;
  return weather;
}

async function refreshWeatherSettings() {
  if (!platform) return null;
  const task = runtimeTasks.begin('weatherSettings');
  const weatherSettings = await platform.getSiteWeatherSettings(clientState.context.siteCode);
  if (!runtimeTasks.current(task)) return null;
  setClientState({ weatherSettings });
  return weatherSettings;
}

async function refreshWeather({ forceRead = false, includeSettings = false } = {}) {
  const scope = platformCacheScope();
  const adapter = platform;
  const existingWeather = store.getState().weather;
  if (!forceRead && cacheIsRecent(lastWeatherReadAt, WEATHER_READ_CACHE_MS)) {
    if (includeSettings && !clientState.weatherSettings) await refreshWeatherSettings().catch(() => null);
    return existingWeather;
  }
  const task = runtimeTasks.begin('weather');
  setResource('weather', beginResource(clientState.resources.weather, Boolean(existingWeather?.current)));
  try {
    if (!adapter) throw new Error('Platform endpoint is unavailable');
    const weather = await adapter.getSiteWeather(scope.siteCode);
    if (!runtimeTasks.current(task)) return null;
    store.setWeather(weather);
    lastWeatherReadAt = Date.now();
    setResource('weather', weather?.status === 'UNAVAILABLE'
      ? rejectResource(clientState.resources.weather, '后台暂无可用天气数据。', false)
      : resolveResource({ hasData: Boolean(weather?.current), source: ['STALE', 'EXPIRED'].includes(weather?.status) ? 'cache' : 'network' }));
    try {
      await cacheRepository.putPlatformWeather(scope, weather);
    } catch {
      if (runtimeTasks.current(task)) storageNotice('天气已读取，但本机缓存保存失败。', 'weather-cache');
    }
    if (runtimeTasks.current(task) && includeSettings) await refreshWeatherSettings().catch(() => null);
    return weather;
  } catch (error) {
    if (!runtimeTasks.current(task)) return null;
    const cached = await cacheRepository.getPlatformWeather(scope).catch(() => null);
    if (!runtimeTasks.current(task)) return null;
    if (cached?.weather) {
      const weather = { ...cached.weather, status: cached.weather.status === 'EXPIRED' ? 'EXPIRED' : 'STALE' };
      store.setWeather(weather);
      setResource('weather', { ...rejectResource(clientState.resources.weather, describeError(error), true), source: 'cache' });
      return weather;
    }
    const unavailable = existingWeather?.current
      ? { ...existingWeather, status: 'STALE' }
      : { siteCode: scope.siteCode, status: 'UNAVAILABLE', current: null };
    store.setWeather(unavailable);
    setResource('weather', rejectResource(clientState.resources.weather, describeError(error), Boolean(existingWeather?.current)));
    return unavailable;
  }
}

async function openWeather() {
  await Promise.all([
    refreshWeather({ includeSettings: true }),
    loadWeatherForecast()
  ]);
}

function clientTimezone() {
  return browserWeatherTimezone();
}

function validPendingWeatherLocation(value) {
  try { parseWeatherCoordinates(value); return true; } catch { return false; }
}

function weatherLocationRequest(location = {}) {
  return {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    accuracyM: Number.isFinite(Number(location.accuracyM)) ? Number(location.accuracyM) : null,
    timezone: String(location.timezone || clientTimezone()).trim() || clientTimezone(),
    source: location.source === 'MANUAL' ? 'MANUAL' : 'MOBILE_GPS'
  };
}

async function loadPendingWeatherLocation() {
  try {
    const { value } = await Preferences.get({ key: PENDING_WEATHER_LOCATION_KEY });
    if (!value) return null;
    const parsed = JSON.parse(value);
    return validPendingWeatherLocation(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function setPendingWeatherLocation(location) {
  const value = validPendingWeatherLocation(location) ? { ...location, scopeKey: JSON.stringify(platformCacheScope()) } : null;
  clientState = { ...clientState, pendingWeatherLocation: value };
  render();
  try {
    if (value) {
      await Preferences.set({ key: PENDING_WEATHER_LOCATION_KEY, value: JSON.stringify(value) });
    } else {
      await Preferences.remove({ key: PENDING_WEATHER_LOCATION_KEY });
    }
  } catch {
    // The in-memory retry remains available if local preference storage is
    // temporarily unavailable. Do not discard a successfully acquired GPS fix.
    storageNotice('当前位置暂仅保存在内存中，本机存储恢复前请勿关闭应用。', 'pending-weather-location');
  }
  return value;
}

async function applyWeatherLocation(location, { retainOnFailure = false, task = runtimeTasks.begin('weatherLocation') } = {}) {
  if (!platform) throw new Error('平台连接不可用，无法更新天气位置。');
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  const siteCode = clientState.context.siteCode;
  const scope = platformCacheScope();
  const adapter = platform;
  setLoading('weatherLocationPhase', 'saving');
  let weather;
  try {
    weather = await adapter.updateSiteWeatherLocation(siteCode, weatherLocationRequest(location));
  } catch (error) {
    if (!runtimeTasks.current(task)) return { status: 'superseded' };
    if (retainOnFailure) await setPendingWeatherLocation(location);
    if (runtimeTasks.current(task)) setLoading('weatherLocationPhase', null);
    throw new Error(`位置已获取，但无法提交到后台：${describeError(error)}`, { cause: error });
  }
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  if (retainOnFailure) await setPendingWeatherLocation(null);
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  store.setWeather(weather);
  setResource('weather', resolveResource({ hasData: Boolean(weather?.current) }));
  lastWeatherReadAt = Date.now();
  let partial = false;
  try {
    await cacheRepository.putPlatformWeather(scope, weather);
  } catch {
    partial = true;
    if (runtimeTasks.current(task)) storageNotice('位置已保存到后台，但本机天气缓存保存失败；不需要重复提交位置。', 'weather-cache');
  }
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  try {
    const weatherSettings = await adapter.getSiteWeatherSettings(siteCode);
    if (!runtimeTasks.current(task)) return { status: 'superseded' };
    setClientState({ weatherSettings, error: null });
  } catch {
    partial = true;
  }
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  await loadWeatherForecast({ forceRead: true });
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  partial ||= Boolean(clientState.resources.weatherForecast.error);
  setLoading('weatherLocationPhase', null);
  return { ...weather, presentation: { status: partial ? 'partial' : 'updated', message: partial ? '位置已保存；缓存或附加天气信息暂不可用，不需要重复提交。' : '天气位置已保存。' } };
}

async function updateWeatherFromDeviceLocation() {
  const task = runtimeTasks.begin('weatherLocation');
  setLoading('weatherLocationPhase', 'locating');
  let location;
  try {
    location = await getCurrentDeviceLocation();
  } catch (error) {
    if (!runtimeTasks.current(task)) return { status: 'superseded' };
    const message = deviceLocationErrorMessage(error);
    setLoading('weatherLocationPhase', null);
    setClientState({ error: message });
    throw new Error(message, { cause: error });
  }
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  return applyWeatherLocation({
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyM: location.accuracyM,
    timezone: clientTimezone(),
    source: 'MOBILE_GPS',
    capturedAt: location.capturedAt,
    precision: location.precision
  }, { retainOnFailure: true, task });
}

async function updateWeatherFromManualLocation({ latitude, longitude, timezone } = {}) {
  const { latitude: parsedLatitude, longitude: parsedLongitude } = parseWeatherCoordinates({ latitude, longitude });
  return applyWeatherLocation({
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    accuracyM: null,
    timezone: String(timezone || clientTimezone()).trim() || clientTimezone(),
    source: 'MANUAL'
  });
}

async function retryPendingWeatherLocation() {
  const pending = clientState.pendingWeatherLocation;
  if (!validPendingWeatherLocation(pending)) {
    throw new Error('没有可保存的位置，请重新使用“我的位置”定位。');
  }
  return applyWeatherLocation(pending, { retainOnFailure: true });
}

function forceRefreshWeather() {
  if (weatherRefreshPromise) return weatherRefreshPromise;
  const pending = performWeatherRefresh().finally(() => {
    if (weatherRefreshPromise === pending) weatherRefreshPromise = null;
  });
  weatherRefreshPromise = pending;
  return pending;
}

async function performWeatherRefresh() {
  if (!platform) throw new Error('平台连接不可用，无法刷新天气。');
  const localCooldown = weatherRefreshCooldownSeconds();
  if (localCooldown > 0) {
    return { status: 'cooldown', message: `刷新请求冷却中，请 ${localCooldown} 秒后再试；当前内容不保证最新。` };
  }
  const task = runtimeTasks.begin('weather');
  const scope = platformCacheScope();
  const adapter = platform;
  setResource('weather', beginResource(clientState.resources.weather, Boolean(store.getState().weather?.current)));
  let weather;
  try {
    weather = await adapter.refreshSiteWeather(scope.siteCode);
  } catch (error) {
    if (!runtimeTasks.current(task)) return { status: 'superseded' };
    setResource('weather', rejectResource(clientState.resources.weather, describeError(error), Boolean(store.getState().weather?.current)));
    if (error?.status === 429) {
      const retryAfterSeconds = Number(error.retryAfterSeconds) || 60;
      setWeatherRefreshCooldown(retryAfterSeconds);
      return { status: 'cooldown', message: `后台限制刷新频率，请 ${retryAfterSeconds} 秒后再试；当前内容不保证最新。` };
    }
    throw new Error(`天气刷新失败：${describeError(error)}`, { cause: error });
  }
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  store.setWeather(weather);
  lastWeatherReadAt = Date.now();
  setWeatherRefreshCooldown(60);
  setResource('weather', weather?.status === 'UNAVAILABLE'
    ? rejectResource(clientState.resources.weather, '后台暂无可用天气数据。', false)
    : resolveResource({ hasData: Boolean(weather?.current), source: ['STALE', 'EXPIRED'].includes(weather?.status) ? 'cache' : 'network' }));
  const auxiliary = await Promise.allSettled([
    cacheRepository.putPlatformWeather(scope, weather), refreshWeatherSettings(), loadWeatherForecast({ forceRead: true })
  ]);
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  const partial = auxiliary.some((item) => item.status === 'rejected') || Boolean(clientState.resources.weatherForecast.error);
  if (auxiliary[0].status === 'rejected') storageNotice('天气已刷新，但本机缓存保存失败。', 'weather-cache');
  return { ...refreshPresentation([clientState.resources.weather]), ...(partial ? { status: 'partial', message: '当前天气已返回，缓存或附加天气读取失败；不需要重复刷新。' } : {}), weather };
}

async function loadWeatherForecast({ forceRead = false } = {}) {
  if (!platform) return null;
  if (!forceRead && cacheIsRecent(lastForecastReadAt, WEATHER_FORECAST_CACHE_MS)
      && store.getState().weatherForecast) {
    return store.getState().weatherForecast;
  }
  const task = runtimeTasks.begin('weatherForecast');
  const adapter = platform;
  const siteCode = clientState.context.siteCode;
  const previous = store.getState().weatherForecast;
  setResource('weatherForecast', beginResource(clientState.resources.weatherForecast, Boolean(previous)));
  setLoading('weatherForecast', true);
  try {
    const forecast = await adapter.getSiteWeatherForecast(siteCode, { hours: 24, days: 7 });
    if (!runtimeTasks.current(task)) return null;
    store.setWeatherForecast(forecast);
    lastForecastReadAt = Date.now();
    const hasData = Boolean(forecast?.hourly?.length || forecast?.daily?.length);
    setResource('weatherForecast', forecast?.status === 'UNAVAILABLE'
      ? rejectResource(clientState.resources.weatherForecast, '后台暂无可用预报。', hasData)
      : resolveResource({ hasData, source: ['STALE', 'EXPIRED'].includes(forecast?.status) ? 'cache' : 'network' }));
    return forecast;
  } catch (error) {
    // Keep the previously rendered forecast. Current weather and device
    // controls remain usable even when this supplementary request fails.
    if (!runtimeTasks.current(task)) return null;
    setResource('weatherForecast', rejectResource(clientState.resources.weatherForecast, describeError(error), Boolean(previous)));
    return previous;
  } finally {
    if (runtimeTasks.current(task)) setLoading('weatherForecast', false);
  }
}

async function resyncAfterRealtimeConnect() {
  return refreshDevices({ refreshActiveActivity: true, automatic: true });
}

async function pullRefresh({ screen } = {}) {
  const now = Date.now();
  if (now - lastPullRefreshAt < PULL_REFRESH_COOLDOWN_MS) {
    return { status: 'cooldown', message: '刷新请求冷却中，已保留当前内容；不代表数据最新。' };
  }
  lastPullRefreshAt = now;
  if (screen === 'weather') return forceRefreshWeather();
  const task = runtimeTasks.begin('pullRefresh');
  const [devices, weather] = await Promise.all([
    refreshDevices({ refreshActiveActivity: false }),
    refreshWeather({ forceRead: true })
  ]);
  if (!runtimeTasks.current(task)) return { status: 'superseded' };
  return { ...refreshPresentation([clientState.resources.devices, clientState.resources.weather]), devices, weather };
}

async function loadAppInstallId(preferences = Preferences) {
  const key = 'iot-manager.app-install-id.v1';
  const existing = await preferences.get({ key });
  if (existing.value) return existing.value;
  const value = globalThis.crypto?.randomUUID?.() ?? `install-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await preferences.set({ key, value });
  return value;
}

async function restoreLocalBindings() {
  for (const binding of await cacheRepository.listLocalBindings()) {
    const device = {
      id: `ble:${binding.pluginDeviceId}`,
      deviceId: binding.pluginDeviceId,
      name: binding.displayName,
      localOnly: true,
      // A cached connection is not a live GATT link after a process restart.
      status: 'OFFLINE',
      reportedState: binding.lastReportedState ?? {},
      desiredState: binding.lastReportedState ?? {},
      pendingOrganizationContext: binding.pendingOrganizationContext ?? {},
      connections: [{
        transport: 'BLE_DIRECT',
        status: 'DISCONNECTED',
        profileId: binding.profileId ?? null
      }]
    };
    store.upsertDevice(device);
    for (const activity of await cacheRepository.listLocalActivity(binding.key)) {
      store.addActivity(device.id, activity);
    }
  }
}

async function persistBleBinding(device, connection) {
  if (!appInstallId || !connection.deviceId) return null;
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
  const activity = {
    id: `ble:${command.commandId}`,
    bindingKey,
    eventType: command.status === 'ACKNOWLEDGED' ? 'command_acknowledged' : command.status === 'FAILED' ? 'command_failed' : 'command_unconfirmed',
    detail: command.status,
    payload: command
  };
  const stored = await cacheRepository.addLocalActivity(activity);
  store.addActivity(command.deviceId, stored);
  return stored;
}

function withDefaultOidcFields(profile, defaults = defaultOidcFields({ native: nativeRuntime })) {
  return {
    ...profile,
    oidcIssuerUrl: profile?.oidcIssuerUrl ?? defaults.oidcIssuerUrl ?? null,
    oidcClientId: profile?.oidcClientId ?? defaults.oidcClientId ?? null,
    oidcRedirectUri: profile?.oidcRedirectUri ?? defaults.oidcRedirectUri ?? null,
    oidcScope: profile?.oidcScope ?? defaults.oidcScope ?? null
  };
}

async function handleNativeOidcRedirect(url) {
  if (authSession?.isRedirect(url) && browserCloseTimer !== null) { clearTimeout(browserCloseTimer); browserCloseTimer = null; }
  try {
    const completed = await completeOidcRedirect(url);
    if (completed) {
      await Browser.close().catch(() => {});
      await synchronizePlatformEndpoint();
    }
  } catch (error) {
    setClientState({ error: `登录未完成：${error?.message ?? '请重试。'}` });
  }
}

async function bootstrapRuntime() {
  try {
    appInstallId = await loadAppInstallId();
    await restoreLocalBindings();
  } catch {
    // Storage is auxiliary to an online session; do not strand the whole app
    // at a startup spinner when IndexedDB or preferences are unavailable.
    appInstallId ??= globalThis.crypto?.randomUUID?.() ?? `temporary-${Date.now()}`;
    storageNotice('本机存储暂不可用：蓝牙绑定或离线数据可能无法恢复；在线功能仍可使用。', 'startup-storage');
  }
  const pendingWeatherLocation = await loadPendingWeatherLocation();
  try {
    const savedSite = await Preferences.get({ key: SELECTED_SITE_KEY });
    if (savedSite.value) {
      const parsed = JSON.parse(savedSite.value);
      if (parsed?.siteCode) {
        clientState = {
          ...clientState,
          context: { ...clientState.context, siteCode: String(parsed.siteCode) }
        };
      }
    }
  } catch {
    // The built-in demo context remains the safe fallback.
  }
  const savedProfile = await runtimeConfigRepository.load().catch(() => {
    storageNotice('本机连接设置读取失败，已使用默认连接；可在连接设置中重新配置。', 'startup-storage');
    return null;
  });
  const defaults = nativeRuntime
    ? DEFAULT_NATIVE_ENDPOINT
    : resolveClientConfig();
  const saved = nativeRuntime ? repairLegacyNativeEndpoint(savedProfile, DEFAULT_NATIVE_ENDPOINT) : savedProfile;
  const profile = withDefaultOidcFields(saved ?? {
    id: 'local-site',
    accessRoute: ACCESS_ROUTES.SITE_API,
    apiBaseUrl: defaults.apiBaseUrl,
    wsUrl: defaults.wsUrl,
    organizationCode: clientState.context.organizationCode,
    accessToken: defaults.accessToken ?? null,
    ...defaultOidcFields({ native: nativeRuntime })
  });
  const launch = nativeRuntime ? await App.getLaunchUrl?.().catch(() => null) : null;
  await activateEndpoint(profile, {
    launchUrl: launch?.url ?? null,
    startupReady: async () => {
      // Pending locations are only restored for their original endpoint/site.
      if (pendingWeatherLocation?.scopeKey === JSON.stringify(platformCacheScope())) {
        setClientState({ pendingWeatherLocation });
      }
      setClientState({ startup: { phase: 'syncing', error: null } });
      render('startup_local_ready');
      await startupTransition.markUiReady();
    }
  });
  setClientState({ startup: { phase: 'ready', error: null } });
  if (nativeRuntime && !authUrlListener) {
    authUrlListener = await App.addListener('appUrlOpen', ({ url }) => handleNativeOidcRedirect(url));
  }
  if (nativeRuntime && !browserFinishedListener) {
    browserFinishedListener = await Browser.addListener('browserFinished', () => {
      const manager = authSession, expectedState = manager?.pendingLoginState;
      if (!expectedState) return;
      if (browserCloseTimer !== null) clearTimeout(browserCloseTimer);
      browserCloseTimer = setTimeout(() => {
        browserCloseTimer = null;
        if (authSession === manager) void manager.cancelPendingLogin(expectedState).catch(() => {
          setClientState({ error: '登录取消后的存储清理失败，请重新登录。' });
        });
      }, 750);
    });
  }
  if (nativeRuntime && !nativeBackListener) {
    nativeBackListener = await App.addListener('backButton', () => {
      // Root-page exit is not inferred from canGoBack. Retain the app at its
      // root; keyboard/system surfaces keep platform-managed behavior.
      ui.back();
    });
  }
  lifecycleHandle = await attachAppLifecycle({
    onBackground: async () => {
      ai.setForeground(false);
      appBackgroundedAt = Date.now();
      try {
        await stopBleScan();
      } catch (error) {
        setClientState({ ble: { errorCode: error?.code ?? 'SCAN_STOP_FAILED' } });
      }
      platform?.disconnect();
      store.setRuntimeContext({ stale: true });
    },
    onForeground: async () => {
      ai.setForeground(true);
      try {
        const availability = ble.availability();
        setClientState({ ble: { availability: availability.available, reason: availability.reason ?? null } });
        await ble.verifyConnection?.();
      } catch (error) {
        setClientState({ ble: { errorCode: error?.code ?? 'CONNECTION_CHECK_FAILED' } });
      }
      const backgroundDuration = appBackgroundedAt == null ? 0 : Date.now() - appBackgroundedAt;
      appBackgroundedAt = null;
      if (backgroundDuration >= FOREGROUND_RESYNC_AFTER_MS) {
        await Promise.all([
          refreshDevices({ refreshActiveActivity: true, automatic: true }),
          refreshWeather({ includeSettings: false })
        ]);
      } else if (clientState.resources.devices.freshness === 'fresh' && !clientState.resources.devices.error) {
        // A short interruption (for example answering a call) should not make
        // the device list jump into a blocking stale state or trigger REST
        // traffic. The WebSocket will reconnect in the background.
        store.setRuntimeContext({ stale: false });
      }
      platform?.connect();
    }
  });
}

async function requestBle() {
  if (clientState.loading.blePicker || clientState.loading.bleConnect) return null;
  const revision = ++bleScanRevision;
  setClientState({ error: null, ble: { errorCode: null } });
  if (nativeRuntime) {
    setLoading('blePicker', true);
    try {
      await ble.clearCandidates?.();
      if (revision !== bleScanRevision) return null;
      setClientState({
        ble: {
          candidates: [],
          selectedCandidateId: null,
          candidate: null,
          scanning: true,
          errorCode: null
        }
      });
      await ble.scan((candidate, candidates) => {
        if (revision !== bleScanRevision) return;
        updateBleCandidates(candidates ?? ble.getCandidates?.() ?? [candidate]);
      });
      return null;
    } catch (error) {
      if (revision === bleScanRevision) setClientState({ ble: { errorCode: error.code ?? null, scanning: false } });
      throw error;
    } finally {
      setLoading('blePicker', false);
    }
  }

  const picker = ble.requestCandidate();
  setLoading('blePicker', true);
  try {
    const candidate = await picker;
    if (revision === bleScanRevision) updateBleCandidates([candidate], candidate);
    return candidate;
  } catch (error) {
    if (isBlePickerCancellation(error)) return null;
    setClientState({ ble: { errorCode: error.code ?? null } });
    throw error;
  } finally {
    setLoading('blePicker', false);
  }
}

function bleCandidateId(candidate = {}) {
  const value = candidate?.deviceId ?? candidate?.id ?? candidate?.externalId ?? candidate?.address;
  return value === null || value === undefined ? '' : String(value);
}

function mergeBleCandidates(previous = [], discovered = []) {
  const candidates = new Map();
  for (const item of previous) {
    const key = bleCandidateId(item);
    if (key) candidates.set(key, item);
  }
  for (const item of discovered) {
    const key = bleCandidateId(item);
    if (!key) continue;
    const prior = candidates.get(key);
    candidates.set(key, {
      ...(prior ?? {}),
      ...item,
      deviceId: item.deviceId ?? prior?.deviceId ?? key,
      firstSeenAt: prior?.firstSeenAt ?? item.firstSeenAt ?? Date.now(),
      lastSeenAt: item.lastSeenAt ?? Date.now()
    });
  }
  return [...candidates.values()];
}

function updateBleCandidates(discovered, preferredCandidate = null) {
  const candidates = mergeBleCandidates(clientState.ble.candidates, Array.isArray(discovered) ? discovered : [discovered]);
  const preferredId = bleCandidateId(preferredCandidate)
    || clientState.ble.selectedCandidateId
    || bleCandidateId(clientState.ble.candidate)
    || bleCandidateId(candidates[0]);
  const candidate = candidates.find((item) => bleCandidateId(item) === preferredId) ?? candidates[0] ?? null;
  setClientState({
    ble: {
      candidates,
      selectedCandidateId: candidate ? bleCandidateId(candidate) : null,
      candidate,
      errorCode: null
    }
  });
  return candidate;
}

function selectBleCandidate({ candidateId } = {}) {
  const candidate = clientState.ble.candidates.find((item) => bleCandidateId(item) === String(candidateId ?? ''));
  if (!candidate) return null;
  setClientState({ ble: { candidate, selectedCandidateId: bleCandidateId(candidate), errorCode: null } });
  return candidate;
}

async function stopBleScan() {
  bleScanRevision += 1;
  try {
    await ble.stopScan?.();
    setClientState({ ble: { scanning: false, errorCode: null } });
  } catch (error) {
    setClientState({ ble: { scanning: true, errorCode: error.code ?? 'SCAN_STOP_FAILED' } });
    throw error;
  }
}

async function connectBle() {
  if (clientState.loading.bleConnect || clientState.loading.bleDisconnect || clientState.loading.bleForget) return null;
  if (!clientState.ble.candidate) throw new Error('请先选择蓝牙设备。');
  const candidate = clientState.ble.candidate;
  const sourceContext = { ...clientState.context };
  const intent = { candidate, context: sourceContext };
  bleConnectionIntent = intent;
  setLoading('bleConnect', true);
  try {
    await stopBleScan();
    const connection = await ble.connect(candidate);
    const normalized = {
      ...connection,
      deviceId: connection.deviceId ?? connection.id ?? candidate.deviceId ?? candidate.id,
      capabilities: ble.getCapabilities()
    };
    const device = createLocalBleDevice(candidate, normalized, sourceContext);
    store.upsertDevice(device);
    store.setActiveConnection(normalized);
    setClientState({ ble: { connection: normalized, errorCode: null, scanning: false }, error: null });
    let presentation = { status: 'updated', message: '蓝牙设备已连接。' };
    try { await persistBleBinding(device, normalized); }
    catch {
      storageNotice('蓝牙设备已连接，但本机绑定保存失败；重启后可能需要重新选择。', 'ble-binding');
      presentation = { status: 'partial', message: '连接已建立，本机绑定尚未保存。' };
    }
    return { ...normalized, presentation };
  } catch (error) {
    setClientState({ ble: { errorCode: error.code ?? null } });
    throw error;
  } finally {
    if (bleConnectionIntent === intent) bleConnectionIntent = null;
    setLoading('bleConnect', false);
  }
}

async function disconnectBle({ deviceId } = {}) {
  const connection = clientState.ble.connection ?? store.getState().activeConnection;
  const activeDeviceId = deviceId ?? connection?.deviceId ?? connection?.id;
  if (!activeDeviceId) return null;
  setLoading('bleDisconnect', true);
  try {
    await ble.disconnect?.();
    const disconnected = {
      ...(connection ?? {}),
      deviceId: connection?.deviceId ?? connection?.id ?? activeDeviceId,
      transport: 'BLE_DIRECT',
      status: 'DISCONNECTED'
    };
    store.setActiveConnection(disconnected);
    const device = store.selectDevice(activeDeviceId);
    if (device) {
      const connections = (device.connections ?? []).map((item) => (
        String(item.transport ?? '').toUpperCase().includes('BLE')
          ? { ...item, status: 'DISCONNECTED' }
          : item
      ));
      const updated = store.patchDevice(activeDeviceId, { status: 'OFFLINE', connections });
      if (updated) await persistBleBinding(updated, disconnected).catch(() => storageNotice('蓝牙已断开，但本机绑定状态保存失败。', 'ble-binding'));
    }
    setClientState({ ble: { connection: disconnected, scanning: false }, error: null });
    return disconnected;
  } finally {
    setLoading('bleDisconnect', false);
  }
}

async function forgetBle({ deviceId } = {}) {
  const device = store.selectDevice(deviceId) ?? store.selectActiveDevice();
  const pluginDeviceId = device?.deviceId
    ?? clientState.ble.connection?.deviceId
    ?? clientState.ble.candidate?.deviceId
    ?? clientState.ble.candidate?.id;
  if (!pluginDeviceId) return false;

  setLoading('bleForget', true);
  try {
    if (clientState.ble.connection?.status === 'CONNECTED'
      && String(clientState.ble.connection.deviceId ?? clientState.ble.connection.id) === String(pluginDeviceId)) {
      await disconnectBle({ deviceId: pluginDeviceId });
    }
    if (appInstallId) await cacheRepository.removeLocalBinding(appInstallId, pluginDeviceId);
    store.removeDevice(device?.id ?? pluginDeviceId);
    const candidates = clientState.ble.candidates.filter((item) => bleCandidateId(item) !== String(pluginDeviceId));
    const candidate = candidates[0] ?? null;
    setClientState({
      ble: {
        candidates,
        candidate,
        selectedCandidateId: candidate ? bleCandidateId(candidate) : null,
        connection: null,
        scanning: false
      },
      error: null
    });
    ui.notify('已在本客户端忘记该蓝牙设备。', 'success');
    return true;
  } finally {
    setLoading('bleForget', false);
  }
}

async function discoverLan({ siteCode } = {}) {
  const scopedSiteCode = siteCode || clientState.context.siteCode;
  const task = runtimeTasks.begin('lanDiscovery');
  const adapter = platform;
  setResource('lanDiscovery', beginResource(clientState.resources.lanDiscovery, clientState.lanCandidates.length > 0));
  setLoading('lanDiscovery', true);
  setClientState({ error: null });
  try {
    const candidates = await adapter.discoverLan({ siteCode: scopedSiteCode });
    if (!runtimeTasks.current(task)) return [];
    setClientState({ lanCandidates: candidates, resources: { lanDiscovery: resolveResource({ hasData: candidates.length > 0 }) } });
    return candidates;
  } catch (error) {
    if (!runtimeTasks.current(task)) return [];
    setResource('lanDiscovery', rejectResource(clientState.resources.lanDiscovery, describeError(error), clientState.lanCandidates.length > 0));
    throw error;
  } finally {
    if (runtimeTasks.current(task)) setLoading('lanDiscovery', false);
  }
}

async function claimLan({ candidateId, displayName, siteCode, spacePath }) {
  const candidate = clientState.lanCandidates.find((item) => String(item.candidateId) === String(candidateId));
  if (!candidate) throw new Error('该候选设备已不存在，请重新发现。');
  const task = runtimeTasks.begin('lanClaim');
  const adapter = platform;
  setLoading('lanClaim', true);
  try {
    const device = await adapter.claimLan(candidate, { displayName, siteCode, spacePath });
    const decorated = decorateLanDevice(device);
    if (!runtimeTasks.current(task)) return { ...decorated, status: 'superseded' };
    if (siteCode && String(siteCode) !== String(clientState.context.siteCode)) {
      setClientState({ lanCandidates: clientState.lanCandidates.filter((item) => item.candidateId !== candidate.candidateId) });
      const message = '设备已认领到指定站点，请切换到该站点查看。';
      ui.notify(message, 'success');
      return { ...decorated, presentation: { status: 'updated', message } };
    }
    store.upsertDevice(decorated);
    store.setActiveDevice(decorated.id);
    setClientState({
      lanCandidates: clientState.lanCandidates.filter((item) => item.candidateId !== candidate.candidateId),
      error: null
    });
    await loadActivity(decorated);
    if (!runtimeTasks.current(task)) return { ...decorated, status: 'superseded' };
    const partial = Boolean(clientState.resources.activity.error);
    const message = partial ? '设备已认领，活动记录暂不可用；不需要重复认领。' : '局域网设备已认领。';
    ui.notify(message, partial ? 'default' : 'success');
    return { ...decorated, presentation: { status: partial ? 'partial' : 'updated', message } };
  } finally {
    if (runtimeTasks.current(task)) setLoading('lanClaim', false);
  }
}

async function openDevice({ deviceId }) {
  const device = store.selectDevice(deviceId);
  if (!device) throw new Error('未找到设备，请先刷新列表。');
  store.setActiveDevice(device.id);
  if (!device.localOnly) {
    try {
      await loadActivity(device);
    } catch (error) {
      setClientState({ error: describeError(error) });
    }
  }
  return device;
}

async function sendCommand({ deviceId, type, parameters, desiredState }) {
  const device = store.selectDevice(deviceId);
  if (!device) throw new Error('未找到待控制设备。');
  const context = createScopedCommandDispatch(device);
  const command = await context.dispatch({ device, type, parameters, desiredState });
  if (command.accessRoute !== 'BLE_LOCAL' && !isTerminalCommandStatus(command.status)) {
    void pollCommand(command.commandId, context.adapter, 24, 500, context);
  }
  return command;
}

async function retryCommand({ commandId, deviceId }) {
  const command = store.getState().commandsById[commandId];
  if (!command) throw new Error('未找到要重试的命令。');
  return sendCommand({
    deviceId: deviceId ?? command.deviceId,
    type: command.type,
    parameters: command.parameters ?? {},
    desiredState: command.desiredState
  });
}

async function pollCommand(commandId, adapter, attempts = 24, delayMs = 500, context = null) {
  if (!adapter) return null;
  const task = runtimeTasks.begin(`command:${commandId}`);
  const ownsPresentation = () => runtimeTasks.current(task) && (!context || context.revision === sessionRevision);
  if (ownsPresentation()) setClientState({ commandObservation: { [commandId]: { phase: 'waiting', message: null } } });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(delayMs);
    try {
      const command = await adapter.getCommand(commandId);
      if (context) context.record(command);
      else if (ownsPresentation()) store.upsertCommand(command);
      if (isTerminalCommandStatus(command.status)) {
        if (ownsPresentation()) setClientState({ commandObservation: { [commandId]: { phase: 'complete', message: null } } });
        return command;
      }
    } catch {
      if (ownsPresentation()) setClientState({ commandObservation: { [commandId]: { phase: 'error', message: '回执暂不可读取，已停止本次查询；结果未知，不会自动重发命令。' } } });
      return null;
    }
  }
  if (ownsPresentation()) setClientState({ commandObservation: { [commandId]: { phase: 'exhausted', message: '本次回执查询已结束，结果仍待核实；不会自动重发命令。' } } });
  return null;
}

function wait(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function reconnectRealtime() {
  platform?.connect();
  return resyncAfterRealtimeConnect();
}

function handleDocumentVisibility() {
  const visible = document.visibilityState !== 'hidden';
  renderCoordinator.setVisibility(visible);
  ai.setForeground(visible);
  if (visible && weatherCooldownDirty) {
    weatherCooldownDirty = false;
    weatherRefreshCooldown.tick();
  }
}

function handleAiNetworkChange() { void ai.networkChanged(); }

renderCoordinator.setVisibility(document.visibilityState !== 'hidden');
document.addEventListener('visibilitychange', handleDocumentVisibility);
window.addEventListener('online', handleAiNetworkChange);
window.addEventListener('offline', handleAiNetworkChange);
if (import.meta.env.DEV) {
  globalThis.__iotUiMetrics = () => ({ ...renderMetrics.snapshot(), store: store.diagnostics() });
}

window.addEventListener('beforeunload', () => {
  ai.destroy();
  if (browserCloseTimer !== null) clearTimeout(browserCloseTimer);
  startupTransition.dispose();
  document.removeEventListener('visibilitychange', handleDocumentVisibility);
  window.removeEventListener('online', handleAiNetworkChange);
  window.removeEventListener('offline', handleAiNetworkChange);
  renderCoordinator.destroy();
  weatherRefreshCooldown.clear();
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  unsubscribeBle();
  void lifecycleHandle?.remove?.();
  void authUrlListener?.remove?.();
  void browserFinishedListener?.remove?.();
  void nativeBackListener?.remove?.();
  authSession?.stopAutoRefresh();
  platform?.disconnect();
  void ble.disconnect?.();
});

void bootstrapRuntime().catch((error) => {
  setClientState({ startup: { phase: 'error', error: describeError(error) }, error: describeError(error) });
});
