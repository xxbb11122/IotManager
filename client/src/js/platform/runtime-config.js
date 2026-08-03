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
