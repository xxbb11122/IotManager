import './css/style.css';

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { resolveClientConfig } from './js/api.js';
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
import { ACCESS_ROUTES, repairLegacyNativeEndpoint, RuntimeConfigRepository } from './js/platform/runtime-config.js';
import { browserWeatherTimezone } from './js/platform/weather-timezone.js';
import { CHANGE_DOMAIN, store } from './js/store.js';
import { createRenderCoordinator } from './js/render-coordinator.js';
import { createRenderMetrics } from './js/render-metrics.js';
import { createClientUi } from './js/ui.js';
import { createWeatherRefreshCooldown } from './js/weather-refresh-cooldown.js';

const DEMO_CONTEXT = Object.freeze({
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
  const issuerUrl = native
    ? nativeBuildEnv.VITE_NATIVE_OIDC_ISSUER_URL ?? nativeBuildEnv.VITE_OIDC_ISSUER_URL
    : nativeBuildEnv.VITE_OIDC_ISSUER_URL;
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
let ble = nativeRuntime ? new NativeBleAdapter() : new BleAdapter();
let platformUnsubscribers = [];
let lifecycleHandle = null;
let appInstallId = null;
let deviceResyncPromise = null;
let lastWeatherReadAt = 0;
let lastForecastReadAt = 0;
let lastDeviceResyncAt = 0;
let lastPullRefreshAt = 0;
let appBackgroundedAt = null;
let realtimeState = 'idle';
let weatherCooldownDirty = false;
let weatherCooldownFallbackUsed = false;

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
  weatherSettings: null,
  pendingWeatherLocation: null,
  weatherRefreshRetryAt: null,
  auth: { configured: false, authenticated: false, status: 'not_configured', expiresAt: null, error: null },
  error: null
};

const ui = createClientUi(document.getElementById('app'), {
  setTab: () => {},
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
    verifyWebSocket: true
  }),
  openBleAppSettings: () => ble.openAppSettings?.(),
  openBluetoothSettings: () => ble.openBluetoothSettings?.(),
  dismissError: () => setClientState({ error: null })
});

const renderMetrics = createRenderMetrics();
const renderCoordinator = createRenderCoordinator({
  fullRender: (snapshot) => ui.renderFull(snapshot),
  patchDevices: (references, snapshot) => ui.patchDevices(references, snapshot),
  patchWeather: (snapshot) => ui.patchWeather(snapshot),
  patchForecast: (snapshot) => ui.patchWeatherForecast(snapshot),
  patchWeatherSettings: (snapshot) => ui.patchWeatherSettings(snapshot),
  patchRuntime: (snapshot) => ui.patchRuntime(snapshot),
  patchScreen: (snapshot) => ui.patchScreen(snapshot),
  patchCommands: (references, snapshot) => ui.patchCommands(references, snapshot),
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
    ?? clientState.ble.candidate
    ?? existing
    ?? { deviceId: pluginDeviceId, name: connection.name };
  if (pluginDeviceId) {
    const device = createLocalBleDevice(candidate, connection, clientState.context);
    store.upsertDevice(device);
    void persistBleBinding(device, connection);
  }
});

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
      if (pluginDeviceId && appInstallId) {
        void persistLocalCommandActivity(`${appInstallId}:${pluginDeviceId}`, command);
      }
    }
  }
});

function viewModel() {
  return { ...store.getState(), ...clientState, endpointProfile };
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
  clientState = {
    ...clientState,
    ...patch,
    context: { ...clientState.context, ...(patch.context ?? {}) },
    loading: { ...clientState.loading, ...(patch.loading ?? {}) },
    ble: { ...clientState.ble, ...(patch.ble ?? {}) }
  };
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
    organizationCode: endpointProfile?.organizationCode ?? clientState.context.organizationCode,
    siteCode: clientState.context.siteCode
  };
}

function bindPlatformEvents(adapter) {
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  platformUnsubscribers = [
    adapter.subscribe((event) => {
      const applied = store.applyRealtimeEvent(event);
      if (applied && event?.type === 'weather_update') {
        void cacheRepository.putPlatformWeather(platformCacheScope(), event.payload);
        lastWeatherReadAt = Date.now();
      }
    }),
    adapter.subscribeStatus((health) => {
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

async function configureAuthSession(profile) {
  authSession?.stopAutoRefresh();
  const config = normalizeOidcConfig(profile);
  if (!config) {
    authSession = null;
    setClientState({ auth: { configured: false, authenticated: false, status: 'not_configured', expiresAt: null, error: null } });
    return null;
  }
  let manager;
  manager = new OidcSessionManager({
    config,
    onStateChange: (auth) => {
      if (authSession !== manager) return;
      setClientState({ auth });
      if (!auth.authenticated) platform?.disconnect();
    }
  });
  authSession = manager;
  setClientState({ auth: manager.getState() });
  await manager.restore();
  return manager;
}

async function completeOidcRedirect(url = currentUrl()) {
  if (!authSession?.isRedirect(url)) return false;
  const completed = await authSession.completeRedirect(url);
  if (completed) removeOidcQueryFromBrowser(url);
  return completed;
}

async function synchronizePlatformEndpoint() {
  if (!platform) return null;
  if (authSession?.isConfigured() && !authSession.getAccessToken()) return null;
  await hydrateCachedWeather();
  await loadSites();
  await refreshDevices();
  await refreshWeather({ includeSettings: false });
  platform.connect();
  return endpointProfile;
}

async function activateEndpoint(profile) {
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  platformUnsubscribers = [];
  platform?.disconnect();
  endpointProfile = await runtimeConfigRepository.save(profile);
  setWeatherRefreshCooldown(0);
  await configureAuthSession(endpointProfile);
  platformSession = createPlatformAdapter({
    endpointProfile,
    siteCodeProvider: () => clientState.context.siteCode,
    accessTokenProvider: tokenProvider,
    onUnauthorized: () => authSession?.tryRefresh() ?? Promise.resolve(false)
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
  await completeOidcRedirect();
  await synchronizePlatformEndpoint();
  render();
  return endpointProfile;
}

async function loadSites() {
  if (!platform) return [];
  try {
    const response = await platform.listSites();
    const sites = Array.isArray(response) ? response.filter((site) => site?.siteCode) : [];
    if (sites.length > 0) {
      setClientState({ sites });
      const selected = sites.find((site) => String(site.siteCode) === String(clientState.context.siteCode)) ?? sites[0];
      if (selected && String(selected.siteCode) !== String(clientState.context.siteCode)) {
        await applySiteContext(selected, { persist: false, reload: false });
      }
      return sites;
    }
  } catch {
    // Older local backends do not expose the versioned site endpoint yet. Keep
    // the current demo context usable and let the operator upgrade in place.
  }
  setClientState({ sites: clientState.sites.length ? clientState.sites : [siteFromContext(clientState.context)] });
  return clientState.sites;
}

function siteFromContext(context) {
  return {
    id: null,
    organizationCode: context.organizationCode,
    organizationName: context.organizationName,
    siteCode: context.siteCode,
    siteName: context.siteName
  };
}

async function switchSite({ siteCode } = {}) {
  const selected = clientState.sites.find((site) => String(site.siteCode) === String(siteCode ?? ''));
  if (!selected) throw new Error('选择的站点不可用，请重新同步站点列表');
  if (String(selected.siteCode) === String(clientState.context.siteCode)) return selected;
  await applySiteContext(selected, { persist: true, reload: true });
  return selected;
}

async function applySiteContext(site, { persist = true, reload = true } = {}) {
  const context = {
    ...clientState.context,
    organizationCode: site.organizationCode ?? clientState.context.organizationCode,
    organizationName: site.organizationName ?? clientState.context.organizationName,
    siteCode: site.siteCode,
    siteName: site.siteName ?? site.siteCode,
    spaceName: '现场空间',
    spacePath: '/operations/field'
  };
  clientState = { ...clientState, context };
  if (persist) {
    try {
      await Preferences.set({ key: SELECTED_SITE_KEY, value: JSON.stringify({
        endpointId: endpointProfile?.id ?? null,
        siteCode: context.siteCode
      }) });
    } catch {
      // Site selection remains active in memory if preference storage is unavailable.
    }
  }
  store.setActiveDevice(null);
  store.setWeather(null);
  store.setWeatherForecast(null);
  store.setRuntimeContext({ siteCode: context.siteCode, stale: true, lastSyncedAt: null });
  lastWeatherReadAt = 0;
  lastForecastReadAt = 0;
  lastDeviceResyncAt = 0;
  setWeatherRefreshCooldown(0);
  setClientState({ context, weatherSettings: null, pendingWeatherLocation: null });
  platform?.setSiteCode?.(context.siteCode);
  platform?.disconnect();
  if (!reload) return context;
  await Promise.all([
    refreshDevices({ refreshActiveActivity: false }),
    refreshWeather({ forceRead: true, includeSettings: true }),
    loadWeatherForecast({ forceRead: true })
  ]);
  platform?.connect();
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
    throw new Error('当前端点尚未配置 OIDC。请在“互联网远程”连接设置中填写 Keycloak 地址、客户端 ID 和回调地址。');
  }
  await authSession.beginLogin();
}

async function signOut() {
  platform?.disconnect();
  setWeatherRefreshCooldown(0);
  try {
    await cacheRepository.clearPlatformScope(platformCacheScope());
  } catch {
    // A sign-out must still succeed when no endpoint was configured or local
    // browser storage has already been cleared.
  }
  store.setDevices(store.getState().devices.filter((device) => device.localOnly));
  store.setActiveDevice(null);
  store.setWeather(null);
  store.setWeatherForecast(null);
  store.setRuntimeContext({ stale: true, lastSyncedAt: null });
  setClientState({ sites: [], weatherSettings: null, pendingWeatherLocation: null, error: null });
  await authSession?.logout();
}

async function refreshDevices({ refreshActiveActivity = true } = {}) {
  const scope = platformCacheScope();
  try {
    if (!platform) throw new Error('Platform endpoint is unavailable');
    const devices = await platform.listDevices();
    const decorated = devices.map((device) => decorateLanDevice(device));
    const merged = mergePlatformAndLocalDevices(decorated, store.getState().devices);
    store.setDevices(merged);
    await cacheRepository.replacePlatformDevices({ ...scope, devices: decorated });
    lastDeviceResyncAt = Date.now();
    store.setRuntimeContext({ stale: false, lastSyncedAt: Date.now() });
    setClientState({ error: null });

    const active = store.selectActiveDevice();
    if (refreshActiveActivity && active && !active.localOnly) await loadActivity(active);
    return merged;
  } catch (error) {
    const snapshot = await cacheRepository.getPlatformSnapshot(scope);
    const merged = mergePlatformAndLocalDevices(snapshot.devices, store.getState().devices);
    store.setDevices(merged);
    store.setRuntimeContext({ stale: true, lastSyncedAt: snapshot.cachedAt });
    setClientState({ error: snapshot.devices.length ? null : describeError(error) });
    return merged;
  }
}

async function loadActivity(device) {
  if (!device || device.localOnly || device.id === null || device.id === undefined || !platform) return [];
  const activity = await platform.listActivity(device.id);
  activity.forEach((entry) => store.addActivity(device.id, entry));
  return activity;
}

function cacheIsRecent(cachedAt, maxAgeMs) {
  const timestamp = Number(cachedAt);
  return Number.isFinite(timestamp) && timestamp > 0 && Date.now() - timestamp < maxAgeMs;
}

async function hydrateCachedWeather() {
  const cached = await cacheRepository.getPlatformWeather(platformCacheScope());
  if (!cached?.weather) return null;
  const age = Date.now() - Number(cached.cachedAt ?? 0);
  const weather = age > WEATHER_READ_CACHE_MS
    ? { ...cached.weather, status: cached.weather.status === 'EXPIRED' ? 'EXPIRED' : 'STALE' }
    : cached.weather;
  store.setWeather(weather);
  lastWeatherReadAt = Number(cached.cachedAt) || 0;
  return weather;
}

async function refreshWeatherSettings() {
  if (!platform) return null;
  const weatherSettings = await platform.getSiteWeatherSettings(clientState.context.siteCode);
  setClientState({ weatherSettings });
  return weatherSettings;
}

async function refreshWeather({ forceRead = false, includeSettings = false } = {}) {
  const scope = platformCacheScope();
  const existingWeather = store.getState().weather;
  if (!forceRead && cacheIsRecent(lastWeatherReadAt, WEATHER_READ_CACHE_MS)) {
    if (includeSettings && !clientState.weatherSettings) await refreshWeatherSettings();
    return existingWeather;
  }
  try {
    if (!platform) throw new Error('Platform endpoint is unavailable');
    const weather = await platform.getSiteWeather(clientState.context.siteCode);
    store.setWeather(weather);
    await cacheRepository.putPlatformWeather(scope, weather);
    lastWeatherReadAt = Date.now();
    if (includeSettings) await refreshWeatherSettings();
    return weather;
  } catch (error) {
    const cached = await cacheRepository.getPlatformWeather(scope);
    if (cached?.weather) {
      const weather = { ...cached.weather, status: cached.weather.status === 'EXPIRED' ? 'EXPIRED' : 'STALE' };
      store.setWeather(weather);
      return weather;
    }
    const unavailable = { siteCode: clientState.context.siteCode, status: 'UNAVAILABLE', current: null };
    store.setWeather(unavailable);
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
  return value
    && Number.isFinite(Number(value.latitude))
    && Number(value.latitude) >= -90
    && Number(value.latitude) <= 90
    && Number.isFinite(Number(value.longitude))
    && Number(value.longitude) >= -180
    && Number(value.longitude) <= 180;
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
  const value = validPendingWeatherLocation(location) ? { ...location } : null;
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
  }
  return value;
}

async function applyWeatherLocation(location, { retainOnFailure = false } = {}) {
  if (!platform) throw new Error('平台连接不可用，无法更新天气位置。');
  const siteCode = clientState.context.siteCode;
  let weather;
  try {
    weather = await platform.updateSiteWeatherLocation(siteCode, weatherLocationRequest(location));
  } catch (error) {
    if (retainOnFailure) await setPendingWeatherLocation(location);
    throw new Error(`位置已获取，但无法提交到后台：${describeError(error)}`, { cause: error });
  }
  if (retainOnFailure) await setPendingWeatherLocation(null);
  store.setWeather(weather);
  await cacheRepository.putPlatformWeather(platformCacheScope(), weather);
  lastWeatherReadAt = Date.now();
  try {
    const weatherSettings = await platform.getSiteWeatherSettings(siteCode);
    setClientState({ weatherSettings, error: null });
  } catch {
    // The weather response already proves the location was accepted. Do not
    // turn a supplementary settings read into a false location failure.
    setClientState({ error: null });
  }
  await loadWeatherForecast({ forceRead: true });
  return weather;
}

async function updateWeatherFromDeviceLocation() {
  let location;
  try {
    location = await getCurrentDeviceLocation();
  } catch (error) {
    const message = deviceLocationErrorMessage(error);
    setClientState({ error: message });
    throw new Error(message, { cause: error });
  }
  return applyWeatherLocation({
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyM: location.accuracyM,
    timezone: clientTimezone(),
    source: 'MOBILE_GPS',
    capturedAt: location.capturedAt,
    precision: location.precision
  }, { retainOnFailure: true });
}

async function updateWeatherFromManualLocation({ latitude, longitude, timezone } = {}) {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90
    || !Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
    throw new Error('请填写有效的纬度（-90 至 90）和经度（-180 至 180）。');
  }
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

async function forceRefreshWeather() {
  if (!platform) throw new Error('平台连接不可用，无法刷新天气。');
  const localCooldown = weatherRefreshCooldownSeconds();
  if (localCooldown > 0) {
    throw new Error(`天气刚刚已刷新，请 ${localCooldown} 秒后再试。`);
  }
  try {
    const weather = await platform.refreshSiteWeather(clientState.context.siteCode);
    store.setWeather(weather);
    await cacheRepository.putPlatformWeather(platformCacheScope(), weather);
    lastWeatherReadAt = Date.now();
    setWeatherRefreshCooldown(60);
    await Promise.all([refreshWeatherSettings(), loadWeatherForecast({ forceRead: true })]);
    return weather;
  } catch (error) {
    if (error?.status === 429) {
      const retryAfterSeconds = Number(error.retryAfterSeconds) || 60;
      setWeatherRefreshCooldown(retryAfterSeconds);
      throw new Error(`天气刚刚已刷新，请 ${retryAfterSeconds} 秒后再试。`, { cause: error });
    }
    throw new Error(`天气刷新失败：${describeError(error)}`, { cause: error });
  }
}

async function loadWeatherForecast({ forceRead = false } = {}) {
  if (!platform) return null;
  if (!forceRead && cacheIsRecent(lastForecastReadAt, WEATHER_FORECAST_CACHE_MS)
      && store.getState().weatherForecast) {
    return store.getState().weatherForecast;
  }
  setLoading('weatherForecast', true);
  try {
    const forecast = await platform.getSiteWeatherForecast(clientState.context.siteCode, { hours: 24, days: 7 });
    store.setWeatherForecast(forecast);
    lastForecastReadAt = Date.now();
    return forecast;
  } catch {
    // Keep the previously rendered forecast. Current weather and device
    // controls remain usable even when this supplementary request fails.
    return store.getState().weatherForecast;
  } finally {
    setLoading('weatherForecast', false);
  }
}

async function resyncAfterRealtimeConnect() {
  if (Date.now() - lastDeviceResyncAt < REALTIME_RESYNC_COOLDOWN_MS) return null;
  if (deviceResyncPromise) return deviceResyncPromise;
  deviceResyncPromise = refreshDevices({ refreshActiveActivity: true }).finally(() => {
    deviceResyncPromise = null;
  });
  return deviceResyncPromise;
}

async function pullRefresh({ screen } = {}) {
  const now = Date.now();
  if (now - lastPullRefreshAt < PULL_REFRESH_COOLDOWN_MS) {
    ui.notify('刚刚已刷新，已保留当前数据。', 'default');
    return screen === 'weather' ? store.getState().weather : store.getState().devices;
  }
  lastPullRefreshAt = now;
  if (screen === 'weather') return forceRefreshWeather();
  const [devices, weather] = await Promise.all([
    refreshDevices({ refreshActiveActivity: false }),
    refreshWeather({ forceRead: true })
  ]);
  return { devices, weather };
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
      status: binding.lastConnectionState === 'CONNECTED' ? 'ONLINE' : 'OFFLINE',
      reportedState: binding.lastReportedState ?? {},
      desiredState: binding.lastReportedState ?? {},
      pendingOrganizationContext: binding.pendingOrganizationContext ?? {},
      connections: [{
        transport: 'BLE_DIRECT',
        status: binding.lastConnectionState ?? 'DISCONNECTED',
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
  try {
    const completed = await completeOidcRedirect(url);
    if (completed) await synchronizePlatformEndpoint();
  } catch (error) {
    setClientState({ error: `登录未完成：${error?.message ?? '请重试。'}` });
  }
}

async function bootstrapRuntime() {
  appInstallId = await loadAppInstallId();
  await restoreLocalBindings();
  clientState = { ...clientState, pendingWeatherLocation: await loadPendingWeatherLocation() };
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
  const savedProfile = await runtimeConfigRepository.load();
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
  await activateEndpoint(profile);
  if (nativeRuntime && !authUrlListener) {
    authUrlListener = await App.addListener('appUrlOpen', ({ url }) => handleNativeOidcRedirect(url));
  }
  if (nativeRuntime) {
    // An Android custom-scheme callback can cold-start the app before the
    // appUrlOpen listener exists. Read the launch URL once so the PKCE
    // transaction is completed in both warm- and cold-start flows.
    const launch = await App.getLaunchUrl?.();
    if (launch?.url) await handleNativeOidcRedirect(launch.url);
  }
  lifecycleHandle = await attachAppLifecycle({
    onBackground: async () => {
      appBackgroundedAt = Date.now();
      await stopBleScan();
      platform?.disconnect();
      store.setRuntimeContext({ stale: true });
    },
    onForeground: async () => {
      ble.availability();
      await ble.verifyConnection?.();
      const backgroundDuration = appBackgroundedAt == null ? 0 : Date.now() - appBackgroundedAt;
      appBackgroundedAt = null;
      if (backgroundDuration >= FOREGROUND_RESYNC_AFTER_MS) {
        await Promise.all([
          refreshDevices({ refreshActiveActivity: true }),
          refreshWeather({ includeSettings: false })
        ]);
      } else {
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
  setClientState({ error: null, ble: { errorCode: null } });
  if (nativeRuntime) {
    setLoading('blePicker', true);
    try {
      await ble.clearCandidates?.();
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
        updateBleCandidates(candidates ?? ble.getCandidates?.() ?? [candidate], candidate);
      });
      return null;
    } catch (error) {
      setClientState({ ble: { errorCode: error.code ?? null, scanning: false } });
      throw error;
    } finally {
      setLoading('blePicker', false);
    }
  }

  const picker = ble.requestCandidate();
  setLoading('blePicker', true);
  try {
    const candidate = await picker;
    updateBleCandidates([candidate], candidate);
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
  const value = candidate.deviceId ?? candidate.id ?? candidate.externalId ?? candidate.address;
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
  try {
    await ble.stopScan?.();
  } finally {
    setClientState({ ble: { scanning: false } });
  }
}

async function connectBle() {
  if (!clientState.ble.candidate) throw new Error('请先选择蓝牙设备。');
  setLoading('bleConnect', true);
  try {
    await stopBleScan().catch(() => {});
    const connection = await ble.connect(clientState.ble.candidate);
    const normalized = {
      ...connection,
      deviceId: connection.deviceId ?? connection.id ?? clientState.ble.candidate.deviceId ?? clientState.ble.candidate.id,
      capabilities: ble.getCapabilities()
    };
    const device = createLocalBleDevice(clientState.ble.candidate, normalized, clientState.context);
    store.upsertDevice(device);
    store.setActiveConnection(normalized);
    store.setActiveDevice(device.id);
    setClientState({ ble: { connection: normalized, errorCode: null, scanning: false }, error: null });
    await persistBleBinding(device, normalized);
    ui.notify('蓝牙设备已连接。', 'success');
    return normalized;
  } catch (error) {
    setClientState({ ble: { errorCode: error.code ?? null } });
    throw error;
  } finally {
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
      if (updated) await persistBleBinding(updated, disconnected);
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
  setLoading('lanDiscovery', true);
  setClientState({ error: null });
  try {
    const candidates = await platform.discoverLan({ siteCode: scopedSiteCode });
    setClientState({ lanCandidates: candidates });
    return candidates;
  } finally {
    setLoading('lanDiscovery', false);
  }
}

async function claimLan({ candidateId, displayName, siteCode, spacePath }) {
  const candidate = clientState.lanCandidates.find((item) => String(item.candidateId) === String(candidateId));
  if (!candidate) throw new Error('该候选设备已不存在，请重新发现。');
  setLoading('lanClaim', true);
  try {
    const device = await platform.claimLan(candidate, { displayName, siteCode, spacePath });
    const decorated = decorateLanDevice(device);
    store.upsertDevice(decorated);
    store.setActiveDevice(decorated.id);
    setClientState({
      lanCandidates: clientState.lanCandidates.filter((item) => item.candidateId !== candidate.candidateId),
      error: null
    });
    await loadActivity(decorated);
    ui.notify('局域网设备已认领。', 'success');
    return decorated;
  } finally {
    setLoading('lanClaim', false);
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
  const routedPlatform = platform;
  const command = await dispatchCommand({ device, type, parameters, desiredState });
  if (command.accessRoute !== 'BLE_LOCAL' && !isTerminalCommandStatus(command.status)) {
    void pollCommand(command.commandId, routedPlatform);
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

async function pollCommand(commandId, adapter, attempts = 24, delayMs = 500) {
  if (!adapter) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(delayMs);
    try {
      const command = await adapter.getCommand(commandId);
      store.upsertCommand(command);
      if (isTerminalCommandStatus(command.status)) return command;
    } catch {
      return null;
    }
  }
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
  if (visible && weatherCooldownDirty) {
    weatherCooldownDirty = false;
    weatherRefreshCooldown.tick();
  }
}

renderCoordinator.setVisibility(document.visibilityState !== 'hidden');
document.addEventListener('visibilitychange', handleDocumentVisibility);
if (import.meta.env.DEV) {
  globalThis.__iotUiMetrics = () => renderMetrics.snapshot();
}

window.addEventListener('beforeunload', () => {
  document.removeEventListener('visibilitychange', handleDocumentVisibility);
  renderCoordinator.destroy();
  weatherRefreshCooldown.clear();
  for (const unsubscribe of platformUnsubscribers) unsubscribe();
  unsubscribeBle();
  void lifecycleHandle?.remove?.();
  platform?.disconnect();
  void ble.disconnect?.();
});

void bootstrapRuntime().catch((error) => {
  setClientState({ error: describeError(error) });
});
