import { Preferences } from '@capacitor/preferences';
import { resolveClientConfig } from '../api.js';

export const ACCESS_ROUTES = Object.freeze({
  BLE_LOCAL: 'BLE_LOCAL',
  SITE_API: 'SITE_API',
  CLOUD_API: 'CLOUD_API'
});

const STORAGE_KEY = 'iot-manager.active-endpoint.v1';
const LEGACY_NATIVE_DEVELOPMENT_HOSTS = new Set(['10.0.2.2']);

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
    organizationCode: String(input.organizationCode ?? '').trim() || null,
    // Kept only as an in-memory development/testing override. Production
    // OAuth tokens are owned by SecureSessionStore and are never written to
    // Capacitor Preferences with the endpoint profile.
    accessToken: String(input.accessToken ?? '').trim() || null,
    oidcIssuerUrl: String(input.oidcIssuerUrl ?? '').trim() || null,
    oidcClientId: String(input.oidcClientId ?? '').trim() || null,
    oidcRedirectUri: String(input.oidcRedirectUri ?? '').trim() || null,
    oidcScope: String(input.oidcScope ?? '').trim() || null
  });
}

function persistedEndpointProfile(profile) {
  const { accessToken: _accessToken, ...safeProfile } = profile;
  return safeProfile;
}

/**
 * Migrates only the Android-emulator development address. A real
 * operator-selected LAN or cloud endpoint is never changed.
 */
export function repairLegacyNativeEndpoint(profile, nativeDefaults) {
  if (!profile || !nativeDefaults?.apiBaseUrl || !nativeDefaults?.wsUrl) return profile;
  try {
    const apiHost = new URL(profile.apiBaseUrl).hostname;
    const wsHost = new URL(profile.wsUrl).hostname;
    if (!LEGACY_NATIVE_DEVELOPMENT_HOSTS.has(apiHost) && !LEGACY_NATIVE_DEVELOPMENT_HOSTS.has(wsHost)) {
      return profile;
    }
    return {
      ...profile,
      apiBaseUrl: nativeDefaults.apiBaseUrl,
      wsUrl: nativeDefaults.wsUrl
    };
  } catch {
    return profile;
  }
}

export class RuntimeConfigRepository {
  constructor({ preferences = Preferences } = {}) {
    this.preferences = preferences;
  }

  async load() {
    const { value } = await this.preferences.get({ key: STORAGE_KEY });
    if (!value) return null;
    const parsed = JSON.parse(value);
    const normalized = normalizeEndpointProfile(parsed);
    // One-way migration for pre-PKCE clients: a token that used to be stored
    // in Preferences is discarded rather than copied into another store.
    if (parsed?.accessToken) {
      await this.preferences.set({ key: STORAGE_KEY, value: JSON.stringify(persistedEndpointProfile(normalized)) });
    }
    return normalized;
  }

  async save(profile) {
    const normalized = normalizeEndpointProfile(profile);
    await this.preferences.set({ key: STORAGE_KEY, value: JSON.stringify(persistedEndpointProfile(normalized)) });
    return normalized;
  }
}
