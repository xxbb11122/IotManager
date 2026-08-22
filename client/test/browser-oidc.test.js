import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserOidcSession,
  resolveBrowserOidcConfig
} from '../../shared/browser-oidc.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

function discovery() {
  return {
    issuer: 'https://iot.example.test/auth/realms/iot-manager',
    authorization_endpoint: 'https://iot.example.test/auth/realms/iot-manager/protocol/openid-connect/auth',
    token_endpoint: 'https://iot.example.test/auth/realms/iot-manager/protocol/openid-connect/token',
    end_session_endpoint: 'https://iot.example.test/auth/realms/iot-manager/protocol/openid-connect/logout'
  };
}

test('browser OIDC resolves HTTPS defaults and completes a PKCE callback without a URL token', async () => {
  const config = resolveBrowserOidcConfig({
    env: {},
    location: { protocol: 'https:', origin: 'https://iot.example.test', pathname: '/console/' }
  });
  assert.deepEqual(config, {
    issuerUrl: 'https://iot.example.test/auth/realms/iot-manager',
    clientId: 'iot-web',
    redirectUri: 'https://iot.example.test/console/',
    scope: 'openid profile email'
  });

  const storage = memoryStorage();
  const locationRef = { href: 'https://iot.example.test/console/' };
  let navigationUrl = null;
  const tokenBodies = [];
  const session = new BrowserOidcSession({
    config,
    storage,
    locationRef,
    historyRef: { replaceState() {} },
    navigate: (url) => { navigationUrl = url; },
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('.well-known')) {
        return new Response(JSON.stringify(discovery()), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      tokenBodies.push(init.body);
      return new Response(JSON.stringify({
        access_token: 'browser-access-token', refresh_token: 'browser-refresh-token', expires_in: 300, refresh_expires_in: 600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  await session.beginLogin();
  const authorizationUrl = new URL(navigationUrl);
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorizationUrl.searchParams.has('access_token'), false);

  locationRef.href = `https://iot.example.test/console/?code=one-time-code&state=${encodeURIComponent(authorizationUrl.searchParams.get('state'))}`;
  const state = await session.initialize({ redirectIfUnauthenticated: false });
  assert.equal(state.authenticated, true);
  assert.equal(session.getAccessToken(), 'browser-access-token');
  assert.match(tokenBodies[0], /grant_type=authorization_code/);
  assert.match(tokenBodies[0], /code_verifier=/);
  await session.clear();
});
