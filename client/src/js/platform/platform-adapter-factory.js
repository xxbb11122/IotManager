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
