import assert from 'node:assert/strict';
import test from 'node:test';
import { OidcSessionManager, oidcErrorMessage } from '../src/js/auth/oidc-session.js';
import { withDefaultOidcFields } from '../src/js/platform/runtime-config.js';

const issuer = 'https://identity.example.test/realm';
const discovery = () => new Response(JSON.stringify({ issuer, authorization_endpoint: issuer + '/auth', token_endpoint: issuer + '/token' }));
function fixture({ fetchImpl = async () => discovery(), navigate = async () => {}, tokenStore, onProgress } = {}) {
  const values = new Map();
  const manager = new OidcSessionManager({
    config: { issuerUrl: issuer, clientId: 'iot-glass-next', redirectUri: 'com.iot.manager.glassnext://oauth/callback' },
    tokenStore: tokenStore ?? { async getJson(key) { return values.get(key); }, async setJson(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } },
    fetchImpl, navigate, onProgress, requestTimeoutMs: 100, bridgeTimeoutMs: 100, loginTimeoutMs: 2000
  });
  return manager;
}
test('a nonsettling discovery is bounded, aborted, visible as a specific error and retryable', async () => {
  let signal, navigations = 0;
  const manager = fixture({ fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); },
    navigate: async () => { navigations++; } });
  await assert.rejects(manager.beginLogin(), error => error.code === 'DISCOVERY_TIMEOUT');
  assert.equal(signal.aborted, true);
  assert.equal(manager.loginInProgress, false);
  assert.equal(navigations, 0);
  assert.match(oidcErrorMessage({ code: 'DISCOVERY_TIMEOUT' }), /超时/);
  manager.fetchImpl = async () => discovery();
  await manager.beginLogin();
  assert.equal(navigations, 1);
  await manager.cancelPendingLogin();
});
test('discovery body parsing is covered by the same deadline', async () => {
  const manager = fixture({ fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  await assert.rejects(manager.beginLogin(), error => error.code === 'DISCOVERY_TIMEOUT');
  assert.equal(manager.loginInProgress, false);
});
test('cancel before the PKCE transaction exists stops discovery and permits a new attempt', async () => {
  const manager = fixture({ fetchImpl: () => new Promise(() => {}) });
  const pending = manager.beginLogin();
  const rejected = assert.rejects(pending, error => error.code === 'LOGIN_CANCELLED');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(await manager.cancelLoginPreparation(), true);
  await rejected;
  assert.equal(manager.loginInProgress, false);
  manager.fetchImpl = async () => discovery();
  await manager.beginLogin();
  await manager.cancelPendingLogin();
});
test('a stuck native browser call times out and cannot keep the login button locked', async () => {
  const manager = fixture({ navigate: () => new Promise(() => {}) });
  await assert.rejects(manager.beginLogin(), error => error.code === 'BROWSER_TIMEOUT');
  assert.equal(manager.loginInProgress, false);
  assert.equal(manager.pendingLoginState, null);
});
test('a stuck secure transaction write fails closed rather than opening a browser or overwriting a new transaction', async () => {
  let navigations = 0;
  const manager = fixture({ tokenStore: { getJson: async () => null, setJson: () => new Promise(() => {}), remove: async () => {} },
    navigate: async () => { navigations++; } });
  await assert.rejects(manager.beginLogin(), error => error.code === 'STORAGE_TIMEOUT');
  assert.equal(navigations, 0);
  await assert.rejects(manager.beginLogin(), error => error.code === 'STORAGE_BUSY');
});
test('normal login reports all preparation phases without logging authorization material', async () => {
  const phases = [];
  const manager = fixture({ onProgress: stage => phases.push(stage) });
  await manager.beginLogin();
  assert.deepEqual(phases, ['discovering', 'saving_transaction', 'opening_browser', 'awaiting_callback']);
  await manager.cancelPendingLogin();
});
test('explicitly cleared OIDC settings survive default resolution and another server cannot inherit old authentication', () => {
  const cleared = { apiBaseUrl: 'https://new.example.test/api/v1', oidcIssuerUrl: null, oidcClientId: null, oidcRedirectUri: null, oidcScope: null };
  const old = { oidcIssuerUrl: issuer, oidcClientId: 'old', oidcRedirectUri: 'old://callback' };
  assert.deepEqual(withDefaultOidcFields(cleared, old), cleared);
  assert.deepEqual(withDefaultOidcFields({ apiBaseUrl: 'https://new.example.test/api/v1' }, old),
    { apiBaseUrl: 'https://new.example.test/api/v1' });
});
