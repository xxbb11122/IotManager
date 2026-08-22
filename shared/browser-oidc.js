const SESSION_KEY = 'iot-manager.browser-oidc-session.v1';
const TRANSACTION_KEY = 'iot-manager.browser-oidc-transaction.v1';
const REFRESH_SKEW_MS = 60_000;

export class BrowserOidcError extends Error {
  constructor(message, { code = 'OIDC_ERROR', cause = null } = {}) {
    super(message, { cause });
    this.name = 'BrowserOidcError';
    this.code = code;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function runtimeEnvironment() {
  return import.meta.env ?? {};
}

function isLocalHttp(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function secureUrl(value, label) {
  let url;
  try {
    url = new URL(text(value));
  } catch {
    throw new BrowserOidcError(`${label} 必须是有效 URL`, { code: 'INVALID_CONFIGURATION' });
  }
  if (url.protocol !== 'https:' && !isLocalHttp(url)) {
    throw new BrowserOidcError(`${label} 在 localhost 之外必须使用 HTTPS`, { code: 'INSECURE_CONFIGURATION' });
  }
  return url;
}

/**
 * Resolves a public browser client without embedding secrets. Local HTTP
 * development remains unauthenticated unless an explicit OIDC issuer is set;
 * an HTTPS deployment defaults to its co-hosted Keycloak realm.
 */
export function resolveBrowserOidcConfig({ env = runtimeEnvironment(), location = globalThis.location } = {}) {
  const runtime = globalThis.__IOT_OIDC__ ?? {};
  const explicitIssuer = text(runtime.issuerUrl ?? env.VITE_OIDC_ISSUER_URL);
  const enabledSetting = text(runtime.enabled ?? env.VITE_OIDC_ENABLED).toLowerCase();
  if (['false', '0', 'no'].includes(enabledSetting)) return null;
  const productionDefault = location?.protocol === 'https:';
  if (!explicitIssuer && !productionDefault) return null;
  const realm = text(runtime.realm ?? env.VITE_KEYCLOAK_REALM) || 'iot-manager';
  const issuerUrl = explicitIssuer || `${location.origin}/auth/realms/${encodeURIComponent(realm)}`;
  const clientId = text(runtime.clientId ?? env.VITE_OIDC_CLIENT_ID) || 'iot-web';
  const redirectUri = text(runtime.redirectUri ?? env.VITE_OIDC_REDIRECT_URI)
    || `${location.origin}${location.pathname}`;
  const scope = text(runtime.scope ?? env.VITE_OIDC_SCOPE) || 'openid profile email';
  const issuer = secureUrl(issuerUrl, 'OIDC issuer URL');
  const redirect = secureUrl(redirectUri, 'OIDC 回调地址');
  return Object.freeze({
    issuerUrl: issuer.href.replace(/\/$/, ''),
    clientId,
    redirectUri: redirect.href,
    scope
  });
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesFromBase64Url(value) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomValue(bytes = 32, cryptoRef = globalThis.crypto) {
  if (!cryptoRef?.getRandomValues) {
    throw new BrowserOidcError('当前浏览器不支持安全随机数，无法进行 OIDC 登录', { code: 'CRYPTO_UNAVAILABLE' });
  }
  const value = new Uint8Array(bytes);
  cryptoRef.getRandomValues(value);
  return base64Url(value);
}

async function pkcePair(cryptoRef = globalThis.crypto) {
  const verifier = randomValue(48, cryptoRef);
  if (!cryptoRef?.subtle?.digest || typeof TextEncoder !== 'function') {
    throw new BrowserOidcError('当前浏览器不支持 PKCE 所需加密能力', { code: 'CRYPTO_UNAVAILABLE' });
  }
  const digest = await cryptoRef.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function decodeExpiry(response, now) {
  const expiresIn = Number(response?.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) return now + expiresIn * 1000;
  const parts = text(response?.access_token).split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(parts[1])));
      if (Number.isFinite(Number(payload.exp))) return Number(payload.exp) * 1000;
    } catch {
      // The backend validates the JWT; this value only controls refresh timing.
    }
  }
  return now + 5 * 60 * 1000;
}

function form(values) {
  return new URLSearchParams(Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => [key, String(value)])).toString();
}

function storageGet(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function storageSet(storage, key, value) {
  try { storage?.setItem(key, value); } catch {
    throw new BrowserOidcError('浏览器会话存储不可用，无法安全完成登录', { code: 'STORAGE_UNAVAILABLE' });
  }
}

function storageRemove(storage, key) {
  try { storage?.removeItem(key); } catch { /* Best effort on sign-out. */ }
}

function readJson(storage, key) {
  const raw = storageGet(storage, key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    storageRemove(storage, key);
    return null;
  }
}

function callbackUrlMatches(config, href) {
  if (!config || !href) return false;
  try {
    const actual = new URL(href);
    const expected = new URL(config.redirectUri);
    return actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname
      && (actual.searchParams.has('code') || actual.searchParams.has('error'));
  } catch {
    return false;
  }
}

export class BrowserOidcSession {
  constructor({
    config = resolveBrowserOidcConfig(),
    storage = globalThis.sessionStorage,
    fetchImpl = globalThis.fetch,
    navigate = (url) => globalThis.location.assign(url),
    historyRef = globalThis.history,
    locationRef = globalThis.location,
    now = () => Date.now(),
    cryptoRef = globalThis.crypto,
    onStateChange = () => {}
  } = {}) {
    this.config = config;
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.navigate = navigate;
    this.historyRef = historyRef;
    this.locationRef = locationRef;
    this.now = now;
    this.cryptoRef = cryptoRef;
    this.onStateChange = onStateChange;
    this.discovery = null;
    this.session = null;
    this.refreshPromise = null;
    this.refreshTimer = null;
  }

  isConfigured() { return this.config !== null; }

  getAccessToken() {
    return this.session?.accessToken && Number(this.session.expiresAt) > this.now() ? this.session.accessToken : null;
  }

  getState() {
    return Object.freeze({
      configured: this.isConfigured(),
      authenticated: Boolean(this.getAccessToken()),
      expiresAt: this.getAccessToken() ? this.session.expiresAt : null
    });
  }

  emit() { this.onStateChange(this.getState()); }

  async initialize({ redirectIfUnauthenticated = true } = {}) {
    if (!this.config) return this.getState();
    const href = this.locationRef?.href;
    if (callbackUrlMatches(this.config, href)) await this.completeCallback(href);
    this.session = readJson(this.storage, SESSION_KEY);
    if (this.session?.accessToken) {
      try {
        if (this.needsRefresh()) await this.refresh();
        else this.scheduleRefresh();
      } catch {
        await this.clear({ emit: false });
      }
    }
    this.emit();
    if (!this.getAccessToken() && redirectIfUnauthenticated) await this.beginLogin();
    return this.getState();
  }

  needsRefresh() {
    return !this.session?.accessToken || Number(this.session.expiresAt) - this.now() <= REFRESH_SKEW_MS;
  }

  async beginLogin() {
    if (!this.config) throw new BrowserOidcError('当前部署未配置 OIDC', { code: 'NOT_CONFIGURED' });
    const [discovery, pkce] = await Promise.all([this.loadDiscovery(), pkcePair(this.cryptoRef)]);
    const transaction = {
      state: randomValue(32, this.cryptoRef),
      verifier: pkce.verifier,
      redirectUri: this.config.redirectUri,
      createdAt: this.now()
    };
    storageSet(this.storage, TRANSACTION_KEY, JSON.stringify(transaction));
    const endpoint = text(discovery.authorization_endpoint);
    if (!endpoint) throw new BrowserOidcError('身份服务未提供授权端点', { code: 'INVALID_DISCOVERY' });
    const url = new URL(endpoint);
    url.search = form({
      response_type: 'code', client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      scope: this.config.scope, state: transaction.state,
      code_challenge: pkce.challenge, code_challenge_method: 'S256'
    });
    this.navigate(url.toString());
  }

  async completeCallback(href) {
    const callback = new URL(href);
    const providerError = text(callback.searchParams.get('error'));
    if (providerError) {
      storageRemove(this.storage, TRANSACTION_KEY);
      throw new BrowserOidcError(text(callback.searchParams.get('error_description')) || `登录失败：${providerError}`, {
        code: 'AUTHORIZATION_ERROR'
      });
    }
    const code = text(callback.searchParams.get('code'));
    const state = text(callback.searchParams.get('state'));
    const transaction = readJson(this.storage, TRANSACTION_KEY);
    if (!code || !transaction || transaction.state !== state || transaction.redirectUri !== this.config.redirectUri) {
      storageRemove(this.storage, TRANSACTION_KEY);
      throw new BrowserOidcError('登录回调校验失败，请重新登录', { code: 'INVALID_CALLBACK' });
    }
    try {
      const tokens = await this.requestToken({
        grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId, code_verifier: transaction.verifier
      });
      await this.saveSession(tokens);
      this.removeCallbackParameters(callback);
    } finally {
      storageRemove(this.storage, TRANSACTION_KEY);
    }
  }

  async tryRefresh() {
    try {
      await this.refresh();
      return Boolean(this.getAccessToken());
    } catch {
      return false;
    }
  }

  async refresh() {
    if (!this.config) return null;
    if (this.refreshPromise) return this.refreshPromise;
    const refreshToken = text(this.session?.refreshToken);
    if (!refreshToken || (this.session?.refreshExpiresAt && Number(this.session.refreshExpiresAt) <= this.now())) {
      throw new BrowserOidcError('登录会话已过期', { code: 'REFRESH_EXPIRED' });
    }
    this.refreshPromise = (async () => {
      try {
        const tokens = await this.requestToken({
          grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.config.clientId
        });
        await this.saveSession(tokens);
        this.emit();
        return this.getAccessToken();
      } catch (error) {
        await this.clear({ emit: false });
        this.emit();
        throw error;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  async logout() {
    const previous = this.session;
    const discovery = await this.loadDiscovery().catch(() => null);
    await this.clear();
    const endpoint = text(discovery?.end_session_endpoint);
    if (!endpoint) return null;
    const url = new URL(endpoint);
    url.search = form({
      id_token_hint: previous?.idToken,
      post_logout_redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId
    });
    this.navigate(url.toString());
    return url.toString();
  }

  async clear({ emit = true } = {}) {
    this.stopRefreshTimer();
    this.session = null;
    storageRemove(this.storage, SESSION_KEY);
    storageRemove(this.storage, TRANSACTION_KEY);
    if (emit) this.emit();
  }

  async loadDiscovery() {
    if (this.discovery) return this.discovery;
    const response = await this.fetchImpl(`${this.config.issuerUrl}/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' }
    }).catch((cause) => {
      throw new BrowserOidcError('无法连接身份服务', { code: 'DISCOVERY_UNAVAILABLE', cause });
    });
    if (!response?.ok) throw new BrowserOidcError('身份服务发现失败', { code: 'DISCOVERY_FAILED' });
    const discovery = await response.json();
    if (text(discovery?.issuer).replace(/\/$/, '') !== this.config.issuerUrl) {
      throw new BrowserOidcError('身份服务 issuer 与配置不匹配', { code: 'INVALID_DISCOVERY' });
    }
    this.discovery = Object.freeze(discovery);
    return this.discovery;
  }

  async requestToken(values) {
    const discovery = await this.loadDiscovery();
    const endpoint = text(discovery.token_endpoint);
    if (!endpoint) throw new BrowserOidcError('身份服务未提供 Token 端点', { code: 'INVALID_DISCOVERY' });
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: form(values)
    }).catch((cause) => {
      throw new BrowserOidcError('无法请求登录令牌', { code: 'TOKEN_NETWORK_ERROR', cause });
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      throw new BrowserOidcError(text(payload?.error_description) || '身份服务拒绝了令牌请求', {
        code: text(payload?.error) || 'TOKEN_REQUEST_FAILED'
      });
    }
    if (!text(payload?.access_token)) {
      throw new BrowserOidcError('身份服务未返回 access token', { code: 'INVALID_TOKEN_RESPONSE' });
    }
    return payload;
  }

  async saveSession(tokens) {
    const now = this.now();
    this.session = {
      accessToken: text(tokens.access_token),
      refreshToken: text(tokens.refresh_token) || this.session?.refreshToken || null,
      idToken: text(tokens.id_token) || this.session?.idToken || null,
      expiresAt: decodeExpiry(tokens, now),
      refreshExpiresAt: Number.isFinite(Number(tokens.refresh_expires_in)) && Number(tokens.refresh_expires_in) > 0
        ? now + Number(tokens.refresh_expires_in) * 1000
        : this.session?.refreshExpiresAt ?? null
    };
    storageSet(this.storage, SESSION_KEY, JSON.stringify(this.session));
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    this.stopRefreshTimer();
    if (!this.session?.refreshToken) return;
    const delay = Math.max(1_000, Number(this.session.expiresAt) - this.now() - REFRESH_SKEW_MS);
    this.refreshTimer = globalThis.setTimeout(() => {
      this.refresh().catch(() => {
        // Do not retry indefinitely; the next protected interaction starts a new login.
      });
    }, delay);
  }

  stopRefreshTimer() {
    if (this.refreshTimer !== null) globalThis.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  removeCallbackParameters(callback) {
    if (!this.historyRef?.replaceState) return;
    for (const key of ['code', 'state', 'session_state', 'iss', 'error', 'error_description']) {
      callback.searchParams.delete(key);
    }
    this.historyRef.replaceState({}, globalThis.document?.title ?? '', `${callback.pathname}${callback.search}${callback.hash}`);
  }
}
