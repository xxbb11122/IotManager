function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function appendPathWhenRoot(value, path) {
  const trimmed = trimTrailingSlash(value);
  if (!trimmed || trimmed === '/') {
    return path;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.pathname === '/' ? `${trimmed}${path}` : trimmed;
  } catch {
    return trimmed;
  }
}

function runtimeEnv() {
  return import.meta.env ?? {};
}

function runtimeLocation() {
  return typeof globalThis.location === 'object' ? globalThis.location : null;
}

function defaultWebSocketUrl(location = runtimeLocation()) {
  if (location?.protocol && location?.host) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws/devices`;
  }
  return 'ws://localhost:8080/ws/devices';
}

function normalizeWebSocketUrl(value) {
  let trimmed = trimTrailingSlash(value);
  if (trimmed.startsWith('http://')) {
    trimmed = `ws://${trimmed.slice('http://'.length)}`;
  } else if (trimmed.startsWith('https://')) {
    trimmed = `wss://${trimmed.slice('https://'.length)}`;
  }
  if (trimmed.endsWith('/ws')) {
    return `${trimmed}/devices`;
  }
  return appendPathWhenRoot(trimmed, '/ws/devices');
}

export function resolveClientConfig(overrides = {}) {
  const env = runtimeEnv();
  const apiBaseUrl = appendPathWhenRoot(overrides.apiBaseUrl ?? env.VITE_API_BASE_URL ?? '/api', '/api') || '/api';
  const wsUrl = normalizeWebSocketUrl(overrides.wsUrl ?? env.VITE_WS_URL ?? defaultWebSocketUrl());
  return Object.freeze({ apiBaseUrl, wsUrl });
}

function joinUrl(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimTrailingSlash(baseUrl)}${normalizedPath}`;
}

async function readResponseBody(response) {
  if (response.status === 204) {
    return null;
  }
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class ApiError extends Error {
  constructor(response, problem) {
    const message = problem?.message ?? problem?.error ?? response.statusText ?? `HTTP ${response.status}`;
    super(message);
    this.name = 'ApiError';
    this.status = response.status;
    this.problem = problem ?? null;
  }
}

export class ApiClient {
  constructor({ baseUrl = resolveClientConfig().apiBaseUrl, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('ApiClient requires a fetch implementation');
    }
    this.baseUrl = trimTrailingSlash(baseUrl);
    // Native Window.fetch needs Window as its receiver in Chromium.
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  async request(path, { method = 'GET', body, headers = {}, signal } = {}) {
    const hasBody = body !== undefined;
    const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
      method,
      signal,
      headers: {
        accept: 'application/json',
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...headers
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {})
    });
    const payload = await readResponseBody(response);
    if (!response.ok) {
      throw new ApiError(response, payload);
    }
    return payload;
  }

  listDevices(query = {}, options = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, value);
      }
    }
    const suffix = params.size > 0 ? `?${params}` : '';
    return this.request(`/devices${suffix}`, options);
  }

  getDevice(deviceId, options = {}) {
    return this.request(`/devices/${encodeURIComponent(deviceId)}`, options);
  }

  listLanCandidates(siteCode, options = {}) {
    const params = new URLSearchParams({ siteCode: String(siteCode ?? '') });
    return this.request(`/discovery/lan?${params}`, options);
  }

  claimLanCandidate(candidateId, claim, options = {}) {
    return this.request(`/discovery/lan/${encodeURIComponent(candidateId)}/claim`, {
      ...options,
      method: 'POST',
      body: claim
    });
  }

  submitCommand(deviceId, command, options = {}) {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/commands`, {
      ...options,
      method: 'POST',
      body: {
        type: command?.type,
        idempotencyKey: command?.idempotencyKey,
        parameters: command?.parameters ?? {}
      }
    });
  }

  getCommand(commandId, options = {}) {
    return this.request(`/commands/${encodeURIComponent(commandId)}`, options);
  }

  listActivity(deviceId, options = {}) {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/activity`, options);
  }

  getSiteWeather(siteCode, options = {}) {
    return this.request(`/sites/${encodeURIComponent(siteCode)}/weather`, options);
  }

  getSiteWeatherForecast(siteCode, { hours = 24, days = 7 } = {}, options = {}) {
    const params = new URLSearchParams({ hours: String(hours), days: String(days) });
    return this.request(`/sites/${encodeURIComponent(siteCode)}/weather/forecast?${params}`, options);
  }

  getSiteWeatherSettings(siteCode, options = {}) {
    return this.request(`/sites/${encodeURIComponent(siteCode)}/weather-settings`, options);
  }

  updateSiteWeatherLocation(siteCode, location, options = {}) {
    return this.request(`/sites/${encodeURIComponent(siteCode)}/weather/location`, {
      ...options,
      method: 'POST',
      body: location
    });
  }

  refreshSiteWeather(siteCode, options = {}) {
    return this.request(`/sites/${encodeURIComponent(siteCode)}/weather/refresh`, {
      ...options,
      method: 'POST'
    });
  }
}

export function createIdempotencyKey(prefix = 'client') {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `${prefix}-${randomUuid}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
