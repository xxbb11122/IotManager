import { ApiClient } from '../api.js';
import { RealtimeClient } from '../realtime.js';
import { PlatformAdapter } from '../adapters/platform-adapter.js';
import { normalizeEndpointProfile } from './runtime-config.js';

export function createPlatformAdapter({
  endpointProfile,
  fetchImpl,
  webSocketFactory,
  siteCodeProvider,
  accessTokenProvider = null,
  onUnauthorized = null
} = {}) {
  const profile = normalizeEndpointProfile(endpointProfile);
  const tokenProvider = accessTokenProvider ?? (() => profile.accessToken);
  const api = new ApiClient({
    baseUrl: profile.apiBaseUrl,
    fetchImpl,
    accessTokenProvider: tokenProvider,
    onUnauthorized
  });
  const realtime = new RealtimeClient({
    url: profile.wsUrl,
    webSocketFactory,
    accessTokenProvider: tokenProvider,
    siteCodeProvider
  });
  return Object.freeze({
    endpointProfile: profile,
    accessRoute: profile.accessRoute,
    adapter: new PlatformAdapter({ api, realtime, accessRoute: profile.accessRoute })
  });
}
