import { SecureSessionStore } from './secure-session-store.js';

const SESSION_KEY = 'iot-manager.oidc-session.v1';
const TRANSACTION_KEY = 'iot-manager.oidc-transaction.v1';
const DEFAULT_SCOPE = 'openid profile email offline_access';
const REFRESH_SKEW_MS = 60_000;

export class OidcError extends Error {
  constructor(message, { code = 'OIDC_ERROR', cause = null } = {}) {
    super(message, { cause });
    this.name = 'OidcError';
    this.code = code;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function allowInsecureLocalhost(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function validateUrl(value, label, { allowCustomScheme = false } = {}) {
  let parsed;
  try {
    parsed = new URL(text(value));
  } catch {
    throw new OidcError(`${label} must be a valid URL`, { code: 'INVALID_CONFIGURATION' });
  }
  if (allowCustomScheme && !['http:', 'https:'].includes(parsed.protocol)) return parsed;
  if (parsed.protocol !== 'https:' && !allowInsecureLocalhost(parsed)) {
    throw new OidcError(`${label} must use HTTPS outside localhost`, { code: 'INSECURE_CONFIGURATION' });
  }
  return parsed;
}

/**
 * A profile either has no OIDC details (R0/local compatibility) or a complete
 * public-client configuration.  Client IDs and redirect URLs are intentionally
 * persisted because they are not credentials; tokens are never persisted here.
 */
export function normalizeOidcConfig(input = {}) {
  const issuerUrl = text(input.issuerUrl ?? input.oidcIssuerUrl);
  const clientId = text(input.clientId ?? input.oidcClientId);
  const redirectUri = text(input.redirectUri ?? input.oidcRedirectUri);
  const scope = text(input.scope ?? input.oidcScope) || DEFAULT_SCOPE;
  if (!issuerUrl && !clientId && !redirectUri) return null;
  if (!issuerUrl || !clientId || !redirectUri) {
    throw new OidcError('OIDC issuer URL, client ID, and redirect URI must be configured together', {
      code: 'INCOMPLETE_CONFIGURATION'
    });
  }
  const issuer = validateUrl(issuerUrl, 'OIDC issuer URL');
  const redirect = validateUrl(redirectUri, 'OIDC redirect URI', { allowCustomScheme: true });
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
  const encoded = typeof globalThis.btoa === 'function'
    ? globalThis.btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function secureRandom(bytes = 32, cryptoRef = globalThis.crypto) {
  if (!cryptoRef?.getRandomValues) {
    throw new OidcError('Secure random generation is unavailable in this runtime', { code: 'CRYPTO_UNAVAILABLE' });
  }
  const output = new Uint8Array(bytes);
  cryptoRef.getRandomValues(output);
  return base64Url(output);
}

export async function createPkcePair({ cryptoRef = globalThis.crypto } = {}) {
  const verifier = secureRandom(48, cryptoRef);
  if (!cryptoRef?.subtle?.digest || typeof globalThis.TextEncoder !== 'function') {
    throw new OidcError('PKCE SHA-256 support is unavailable in this runtime', { code: 'CRYPTO_UNAVAILABLE' });
  }
  const digest = await cryptoRef.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Object.freeze({ codeVerifier: verifier, codeChallenge: base64Url(new Uint8Array(digest)) });
}

function parseExpiry(token, now) {
  const seconds = Number(token?.expires_in);
  if (Number.isFinite(seconds) && seconds > 0) return now + seconds * 1000;
  const jwtParts = text(token?.access_token).split('.');
  if (jwtParts.length === 3) {
    try {
      const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(jwtParts[1])));
      if (Number.isFinite(Number(payload.exp))) return Number(payload.exp) * 1000;
    } catch {
      // A resource server validates the JWT. This fallback only schedules a
      // refresh and must never be treated as a signature validation.
    }
  }
  return now + 5 * 60 * 1000;
}

function base64UrlToBytes(value) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = typeof globalThis.atob === 'function'
    ? globalThis.atob(padded)
    : Buffer.from(padded, 'base64').toString('binary');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sanitizeTokenSet(response, previous, now) {
  const accessToken = text(response?.access_token);
  if (!accessToken) throw new OidcError('Token endpoint did not return an access token', { code: 'INVALID_TOKEN_RESPONSE' });
  const refreshToken = text(response?.refresh_token) || text(previous?.refreshToken) || null;
  const refreshExpiresIn = Number(response?.refresh_expires_in);
  return Object.freeze({
    accessToken,
    refreshToken,
    idToken: text(response?.id_token) || text(previous?.idToken) || null,
    tokenType: text(response?.token_type) || 'Bearer',
    scope: text(response?.scope) || text(previous?.scope) || null,
    expiresAt: parseExpiry(response, now),
    refreshExpiresAt: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
      ? now + refreshExpiresIn * 1000
      : previous?.refreshExpiresAt ?? null
  });
}

function endpointFromDiscovery(discovery, key) {
  const value = text(discovery?.[key]);
  if (!value) throw new OidcError(`OIDC discovery does not include ${key}`, { code: 'INVALID_DISCOVERY' });
  return value;
}

function formBody(values) {
  return new URLSearchParams(Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => [key, String(value)])).toString();
}

function authState(configured, session, error = null) {
  const now = Date.now();
  const authenticated = Boolean(session?.accessToken && Number(session.expiresAt) > now);
  return Object.freeze({
    configured,
    authenticated,
    status: configured ? (authenticated ? 'authenticated' : 'signed_out') : 'not_configured',
    expiresAt: authenticated ? Number(session.expiresAt) : null,
    error: error ? String(error.message ?? error) : null
  });
}

/**
 * OAuth 2.1-style public-client session: Authorization Code + PKCE, no client
 * secret, refresh-token rotation support, and one shared refresh request.
 */
export class OidcSessionManager {
  constructor({
    config,
    tokenStore = new SecureSessionStore(),
    // Keep Window as the receiver for the browser's native fetch. Calling an
    // unbound Web IDL fetch function as a manager member fails in Chromium
    // before discovery or token exchange can leave the device.
    fetchImpl = (...args) => globalThis.fetch(...args),
    navigate = (url) => globalThis.location.assign(url),
    now = () => Date.now(),
    cryptoRef = globalThis.crypto,
    onStateChange = () => {}
  } = {}) {
    this.config = normalizeOidcConfig(config ?? {});
    this.tokenStore = tokenStore;
    this.fetchImpl = fetchImpl;
    this.navigate = navigate;
    this.now = now;
    this.cryptoRef = cryptoRef;
    this.onStateChange = onStateChange;
    this.discovery = null;
    this.session = null;
    this.refreshPromise = null;
    this.refreshTimer = null;
  }

  isConfigured() {
    return this.config !== null;
  }

  getAccessToken() {
    if (!this.session?.accessToken || Number(this.session.expiresAt) <= this.now()) return null;
    return this.session.accessToken;
  }

  getState() {
    return authState(this.isConfigured(), this.session);
  }

  emit(error = null) {
    this.onStateChange(authState(this.isConfigured(), this.session, error));
  }

  async restore() {
    if (!this.config) return this.getState();
    this.session = await this.tokenStore.getJson(SESSION_KEY);
    if (!this.session?.accessToken) {
      this.session = null;
      this.emit();
      return this.getState();
    }
    try {
      if (this.needsRefresh()) await this.refresh();
      else this.scheduleRefresh();
      this.emit();
    } catch (error) {
      await this.clear({ emit: false });
      this.emit(error);
    }
    return this.getState();
  }

  needsRefresh(minValidityMs = REFRESH_SKEW_MS) {
    return !this.session?.accessToken || Number(this.session.expiresAt) - this.now() <= minValidityMs;
  }

  async ensureAccessToken() {
    if (!this.config) return null;
    if (this.needsRefresh()) {
      try {
        await this.refresh();
      } catch {
        return null;
      }
    }
    return this.getAccessToken();
  }

  async beginLogin({ prompt = null } = {}) {
    if (!this.config) throw new OidcError('OIDC is not configured for this endpoint', { code: 'NOT_CONFIGURED' });
    const [discovery, pkce] = await Promise.all([this.loadDiscovery(), createPkcePair({ cryptoRef: this.cryptoRef })]);
    const transaction = {
      state: secureRandom(32, this.cryptoRef),
      nonce: secureRandom(32, this.cryptoRef),
      codeVerifier: pkce.codeVerifier,
      redirectUri: this.config.redirectUri,
      createdAt: this.now()
    };
    await this.tokenStore.setJson(TRANSACTION_KEY, transaction);
    const authorizationUrl = new URL(endpointFromDiscovery(discovery, 'authorization_endpoint'));
    authorizationUrl.search = formBody({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope,
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      prompt
    });
    this.navigate(authorizationUrl.toString());
    return authorizationUrl.toString();
  }

  isRedirect(url) {
    if (!this.config || !url) return false;
    try {
      const candidate = new URL(url, this.config.redirectUri);
      const expected = new URL(this.config.redirectUri);
      return candidate.protocol === expected.protocol
        && candidate.host === expected.host
        && candidate.pathname === expected.pathname
        && (candidate.searchParams.has('code') || candidate.searchParams.has('error'));
    } catch {
      return false;
    }
  }

  async completeRedirect(url) {
    if (!this.isRedirect(url)) return false;
    const callback = new URL(url, this.config.redirectUri);
    const providerError = text(callback.searchParams.get('error'));
    if (providerError) {
      await this.tokenStore.remove(TRANSACTION_KEY);
      const detail = text(callback.searchParams.get('error_description'));
      const error = new OidcError(detail || `Sign-in failed: ${providerError}`, { code: 'AUTHORIZATION_ERROR' });
      this.emit(error);
      throw error;
    }
    const code = text(callback.searchParams.get('code'));
    const state = text(callback.searchParams.get('state'));
    const transaction = await this.tokenStore.getJson(TRANSACTION_KEY);
    if (!code || !transaction || state !== transaction.state || transaction.redirectUri !== this.config.redirectUri) {
      await this.tokenStore.remove(TRANSACTION_KEY);
      const error = new OidcError('Sign-in callback could not be validated', { code: 'INVALID_CALLBACK' });
      this.emit(error);
      throw error;
    }
    try {
      const response = await this.requestToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId,
        code_verifier: transaction.codeVerifier
      });
      await this.saveSession(response);
      await this.tokenStore.remove(TRANSACTION_KEY);
      this.emit();
      return true;
    } catch (error) {
      await this.tokenStore.remove(TRANSACTION_KEY);
      this.emit(error);
      throw error;
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
    if (!this.config) throw new OidcError('OIDC is not configured', { code: 'NOT_CONFIGURED' });
    if (this.refreshPromise) return this.refreshPromise;
    const refreshToken = text(this.session?.refreshToken);
    if (!refreshToken || (this.session?.refreshExpiresAt && Number(this.session.refreshExpiresAt) <= this.now())) {
      throw new OidcError('The sign-in session has expired', { code: 'REFRESH_EXPIRED' });
    }
    this.refreshPromise = (async () => {
      try {
        const response = await this.requestToken({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.config.clientId
        });
        await this.saveSession(response);
        this.emit();
        return this.getAccessToken();
      } catch (error) {
        await this.clear({ emit: false });
        this.emit(error);
        throw error;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  async logout({ navigate = true } = {}) {
    const previous = this.session;
    const discovery = this.config ? await this.loadDiscovery().catch(() => null) : null;
    await this.clear();
    const endSessionEndpoint = text(discovery?.end_session_endpoint);
    if (navigate && endSessionEndpoint) {
      const url = new URL(endSessionEndpoint);
      url.search = formBody({
        id_token_hint: previous?.idToken,
        post_logout_redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId
      });
      this.navigate(url.toString());
      return url.toString();
    }
    return null;
  }

  async clear({ emit = true } = {}) {
    this.stopAutoRefresh();
    this.session = null;
    await Promise.all([
      this.tokenStore.remove(SESSION_KEY),
      this.tokenStore.remove(TRANSACTION_KEY)
    ]);
    if (emit) this.emit();
  }

  stopAutoRefresh() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  scheduleRefresh() {
    this.stopAutoRefresh();
    if (!this.session?.refreshToken) return;
    const delay = Math.max(1_000, Number(this.session.expiresAt) - this.now() - REFRESH_SKEW_MS);
    this.refreshTimer = setTimeout(() => {
      this.refresh().catch(() => {
        // State listeners receive the signed-out transition. Do not create an
        // uncontrolled retry loop when Keycloak is unavailable.
      });
    }, delay);
  }

  async loadDiscovery() {
    if (this.discovery) return this.discovery;
    if (!this.config) throw new OidcError('OIDC is not configured', { code: 'NOT_CONFIGURED' });
    const url = `${this.config.issuerUrl}/.well-known/openid-configuration`;
    let response;
    try {
      response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    } catch (error) {
      throw new OidcError('Unable to reach the identity provider', { code: 'DISCOVERY_UNAVAILABLE', cause: error });
    }
    if (!response?.ok) throw new OidcError('Identity-provider discovery failed', { code: 'DISCOVERY_FAILED' });
    const discovery = await response.json();
    const issuer = text(discovery?.issuer).replace(/\/$/, '');
    if (issuer !== this.config.issuerUrl) {
      throw new OidcError('Identity-provider issuer does not match the configured issuer URL', { code: 'INVALID_DISCOVERY' });
    }
    this.discovery = Object.freeze(discovery);
    return this.discovery;
  }

  async requestToken(values) {
    const discovery = await this.loadDiscovery();
    let response;
    try {
      response = await this.fetchImpl(endpointFromDiscovery(discovery, 'token_endpoint'), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: formBody(values)
      });
    } catch (error) {
      throw new OidcError('Unable to reach the identity provider', { code: 'TOKEN_NETWORK_ERROR', cause: error });
    }
    let payload = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      throw new OidcError(text(payload?.error_description) || 'The identity provider rejected the token request', {
        code: text(payload?.error) || 'TOKEN_REQUEST_FAILED'
      });
    }
    return payload;
  }

  async saveSession(tokenResponse) {
    const session = sanitizeTokenSet(tokenResponse, this.session, this.now());
    this.session = session;
    await this.tokenStore.setJson(SESSION_KEY, session);
    this.scheduleRefresh();
    return session;
  }
}

export const OIDC_STORAGE_KEYS = Object.freeze({ SESSION_KEY, TRANSACTION_KEY });
