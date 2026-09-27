import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OIDC_STORAGE_KEYS,
  OidcSessionManager,
  normalizeOidcConfig
} from '../src/js/auth/oidc-session.js';
import { SecureSessionStore } from '../src/js/auth/secure-session-store.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

function discoveryResponse() {
  return {
    issuer: 'https://identity.example.test/realms/iot-manager',
    authorization_endpoint: 'https://identity.example.test/realms/iot-manager/protocol/openid-connect/auth',
    token_endpoint: 'https://identity.example.test/realms/iot-manager/protocol/openid-connect/token',
    end_session_endpoint: 'https://identity.example.test/realms/iot-manager/protocol/openid-connect/logout'
  };
}

function oidcManager({ fetchImpl, navigate = () => {}, now = () => 1_000_000 } = {}) {
  const browserStorage = memoryStorage();
  const store = new SecureSessionStore({ nativeRuntime: false, browserStorage });
  const manager = new OidcSessionManager({
    config: {
      issuerUrl: 'https://identity.example.test/realms/iot-manager',
      clientId: 'iot-mobile',
      redirectUri: 'com.iot.manager.client://oauth/callback'
    },
    tokenStore: store,
    fetchImpl,
    navigate,
    now
  });
  return { manager, store };
}

test('OIDC configuration requires a complete public-client tuple', () => {
  assert.throws(() => normalizeOidcConfig({ issuerUrl: 'https://identity.example.test/realm' }), /configured together/);
  assert.deepEqual(normalizeOidcConfig({
    issuerUrl: 'https://identity.example.test/realm/',
    clientId: 'iot-web',
    redirectUri: 'https://iot.example.test/'
  }), {
    issuerUrl: 'https://identity.example.test/realm',
    clientId: 'iot-web',
    redirectUri: 'https://iot.example.test/',
    scope: 'openid profile email offline_access'
  });
});

test('PKCE login persists only the transaction and builds an authorization-code request', async () => {
  let navigationUrl = null;
  const { manager, store } = oidcManager({
    fetchImpl: async () => new Response(JSON.stringify(discoveryResponse()), { status: 200 }),
    navigate: (url) => { navigationUrl = url; }
  });
  try {
    await manager.beginLogin();
    const url = new URL(navigationUrl);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'iot-mobile');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'));
    const transaction = await store.getJson(OIDC_STORAGE_KEYS.TRANSACTION_KEY);
    assert.ok(transaction.codeVerifier);
    assert.equal(transaction.state, url.searchParams.get('state'));
    assert.equal(await store.getJson(OIDC_STORAGE_KEYS.SESSION_KEY), null);
  } finally {
    manager.stopAutoRefresh();
  }
});

test('OIDC callback exchanges PKCE code, rotates session storage, and refreshes on demand', async () => {
  const requests = [];
  let tokenCall = 0;
  const { manager, store } = oidcManager({
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).includes('.well-known')) {
        return new Response(JSON.stringify(discoveryResponse()), { status: 200 });
      }
      tokenCall += 1;
      return new Response(JSON.stringify(tokenCall === 1 ? {
        access_token: 'access-initial',
        refresh_token: 'refresh-initial',
        id_token: 'id-token',
        expires_in: 300,
        refresh_expires_in: 600
      } : {
        access_token: 'access-rotated',
        refresh_token: 'refresh-rotated',
        expires_in: 300,
        refresh_expires_in: 600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  try {
    const authUrl = await manager.beginLogin();
    const state = new URL(authUrl).searchParams.get('state');
    await manager.completeRedirect(`com.iot.manager.client://oauth/callback?code=code-1&state=${encodeURIComponent(state)}`);
    assert.equal(manager.getAccessToken(), 'access-initial');
    const partition = manager.session.cachePartition;
    assert.equal(typeof partition, 'string');
    assert.match(requests[1].init.body, /grant_type=authorization_code/);
    assert.match(requests[1].init.body, /code_verifier=/);
    await manager.refresh();
    assert.equal(manager.getAccessToken(), 'access-rotated');
    assert.equal(manager.session.cachePartition, partition);
    assert.equal(manager.session.issuerUrl, manager.config.issuerUrl);
    assert.equal((await store.getJson(OIDC_STORAGE_KEYS.SESSION_KEY)).refreshToken, 'refresh-rotated');
  } finally {
    manager.stopAutoRefresh();
  }
});

test('restoring another issuer or an unbound legacy session requires fresh authentication', async () => {
  const { manager, store } = oidcManager({ fetchImpl: async () => { throw new Error('must not use the wrong refresh token'); } });
  await store.setJson(OIDC_STORAGE_KEYS.SESSION_KEY, { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: Date.now() + 3600000, issuerUrl: 'https://other.invalid', clientId: manager.config.clientId });
  await manager.restore();
  assert.equal(manager.getAccessToken(), null);
  assert.equal(await store.getJson(OIDC_STORAGE_KEYS.SESSION_KEY), null);
  manager.stopAutoRefresh();
});

test('OIDC callback rejects a state mismatch without leaving a usable session', async () => {
  const { manager, store } = oidcManager({
    fetchImpl: async () => new Response(JSON.stringify(discoveryResponse()), { status: 200 })
  });
  try {
    await manager.beginLogin();
    await assert.rejects(
      () => manager.completeRedirect('com.iot.manager.client://oauth/callback?code=code-1&state=wrong-state'),
      /could not be validated/
    );
    assert.equal(manager.getAccessToken(), null);
    assert.equal(await store.getJson(OIDC_STORAGE_KEYS.SESSION_KEY), null);
    assert.equal(await store.getJson(OIDC_STORAGE_KEYS.TRANSACTION_KEY), null);
  } finally {
    manager.stopAutoRefresh();
  }
});

test('local logout revokes access before a slow identity-provider discovery finishes', async () => {
  let finishDiscovery;
  const { manager, store } = oidcManager({ fetchImpl: () => new Promise(resolve => { finishDiscovery = resolve; }) });
  await manager.saveSession({ access_token: 'active', expires_in: 300 });
  const pending = manager.logout({ navigate: false });
  assert.equal(manager.getAccessToken(), null);
  while (!finishDiscovery) await new Promise(resolve => setImmediate(resolve));
  assert.equal(await store.getJson(OIDC_STORAGE_KEYS.SESSION_KEY), null);
  finishDiscovery(new Response(JSON.stringify(discoveryResponse()), { status: 200 }));
  await pending;
  manager.stopAutoRefresh();
});

test('a refresh response arriving after logout cannot recreate the old session', async () => {
  let finishToken;
  const { manager, store } = oidcManager({ fetchImpl: () => new Promise(resolve => { finishToken = resolve; }) });
  manager.discovery = discoveryResponse();
  await manager.saveSession({ access_token: 'old', refresh_token: 'refresh', expires_in: 300 });
  try {
    const pending = manager.refresh();
    while (!finishToken) await new Promise(resolve => setImmediate(resolve));
    await manager.logout({ navigate: false });
    finishToken(new Response(JSON.stringify({ access_token: 'late', expires_in: 300 }), { status: 200 }));
    assert.equal(await pending, null);
    assert.equal(manager.getAccessToken(), null);
    assert.equal(await store.getJson(OIDC_STORAGE_KEYS.SESSION_KEY), null);
  } finally { manager.stopAutoRefresh(); }
});
