import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { OidcSessionManager } from '../../apps/client-glass-next/src/js/auth/oidc-session.js';
import { ApiClient } from '../../apps/client-glass-next/src/js/api.js';

// Explicit opt-in: real account login and one remote Chat through the Backend.
// No browser trust bypass, password grant, client secret or token artifact.
if (process.env.IOT_LIVE_AI_ACCEPTANCE !== 'true') {
  throw new Error('Set IOT_LIVE_AI_ACCEPTANCE=true for the authorized live acceptance.');
}
const root = new URL('../../', import.meta.url);
const configuration = JSON.parse(await readFile(new URL('artifacts/phone-lan-20261003/connection.json', root), 'utf8'));
const origin = new URL(configuration.web).origin;
assert.equal(new URL(origin).protocol, 'https:');
const ca = await readFile(new URL('deploy/.runtime/iot-manager-p0/phone-web/mobile/caddy-root-ca.cer', root));
const password = (await readFile(process.env.IOT_E2E_OWNER_PASSWORD_FILE ??
  new URL('deploy/.runtime/iot-manager-p0/secrets/keycloak_owner_password', root), 'utf8')).trim();
assert.ok(password.length > 0, 'The protected test-account credential is required');
const username = process.env.IOT_E2E_OWNER_USERNAME ?? 'integration-owner';
const runtimeEnvironment = await readFile(new URL('deploy/.runtime/iot-manager-p0/runtime.env', root), 'utf8');
const configuredOwnerSubject = runtimeEnvironment.split(/\r?\n/).map(row => row.trim()).find(
  row => row.startsWith('IOT_BOOTSTRAP_OWNER_SUBJECT='))?.split('=', 2)[1];
const checks = [], sessions = [], tokenDiagnostics = [];
let phase = 'initialization', chatPosts = 0, answerCharacters = 0, conversationId = null, nativeApi = null;
let nativeSiteId = null, chatClientKey = null;
let testConversationRemoved = false;

function transport({ fetchOrigin = origin } = {}) {
  const cookies = new Map();
  async function request(address, { method = 'GET', headers = {}, body, signal } = {}) {
    const url = new URL(address, origin);
    assert.equal(url.origin, origin, 'Requests must remain on the verified project origin');
    const requestHeaders = { ...headers };
    const applicableCookies = [...cookies].filter(([, cookie]) => url.pathname.startsWith(cookie.path));
    if (applicableCookies.length) requestHeaders.Cookie = applicableCookies.map(([key, cookie]) => key + '=' + cookie.value).join('; ');
    if (body !== undefined) requestHeaders['Content-Length'] = Buffer.byteLength(String(body));
    return new Promise((resolve, reject) => {
      const req = httpsRequest(url, { ca, method, headers: requestHeaders, signal, autoSelectFamily: false,
        timeout: url.pathname.endsWith('/chat') ? 95000 : 15000 }, res => {
        for (const header of res.headers['set-cookie'] ?? []) {
          const pair = header.split(';', 1)[0], separator = pair.indexOf('=');
          const key = pair.slice(0, separator), value = pair.slice(separator + 1);
          if (/max-age=0(?:;|$)/i.test(header) || !value) cookies.delete(key);
          else cookies.set(key, { value, path: header.match(/(?:^|;)\s*path=([^;]+)/i)?.[1] ?? '/' });
        }
        const chunks = []; let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) req.destroy(new Error('Unexpected acceptance response size'));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Verified project request timed out')));
      req.on('error', reject);
      req.end(body);
    });
  }
  return { request, clear: () => cookies.clear(),
    async fetch(address, options) {
      const result = await request(address, { ...options, headers: { ...options?.headers, Origin: fetchOrigin } });
      return new Response(result.status === 204 ? null : result.bytes, { status: result.status, headers: result.headers });
    } };
}

function memoryStore() {
  const values = new Map();
  return { async getJson(key) { return values.get(key) ?? null; },
    async setJson(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } };
}
function mark(name) { checks.push(name); console.log('PASS ' + name); }

async function login(redirectUri, label) {
  phase = label + ' PKCE login';
  const http = transport({ fetchOrigin: label.includes('Android') ? 'https://localhost' : origin });
  let navigation;
  const manager = new OidcSessionManager({ config: { issuerUrl: configuration.issuer,
    clientId: configuration.clientId, redirectUri }, tokenStore: memoryStore(),
    fetchImpl: http.fetch, navigate: async url => { navigation = url; } });
  sessions.push({ manager, http });
  const authorization = await manager.beginLogin();
  const form = await http.request(authorization);
  assert.equal(form.status, 200, 'The project authorization form must be available');
  const action = form.bytes.toString('utf8').match(/<form\b[^>]*\bid="kc-form-login"[^>]*\baction="([^"]+)"/i)?.[1];
  assert.ok(action, 'The project account form must provide its authorized submission endpoint');
  const actionUrl = new URL(action.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  assert.equal(actionUrl.origin, origin, 'Credentials may only be sent to the verified local identity provider');
  let result = await http.request(actionUrl.href, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin },
    body: new URLSearchParams({ username, password, credentialId: '' }).toString() });
  let callback;
  for (let redirects = 0; redirects < 6; redirects++) {
    assert.ok([302, 303].includes(result.status), 'The account must complete login without a required-action page');
    const destination = new URL(result.headers.location, origin);
    if (manager.isRedirect(destination.href)) { callback = destination.href; break; }
    assert.equal(destination.origin, origin, 'Identity-provider redirects must remain on the project origin');
    result = await http.request(destination.href);
  }
  assert.ok(callback, 'A PKCE authorization callback is required');
  assert.equal(await manager.completeRedirect(callback), true, 'The actual Glass OIDC manager must validate the callback');
  assert.equal(manager.getState().authenticated, true, 'A verified authenticated session is required');
  const claims = JSON.parse(Buffer.from(manager.getAccessToken().split('.')[1], 'base64url').toString('utf8'));
  tokenDiagnostics.push({ label, platformRolePresent: claims.realm_access?.roles?.some(
    role => ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'].includes(role)) === true,
    configuredOwnerSubjectMatches: claims.sub === configuredOwnerSubject,
    configuredOwnerSubjectAvailable: typeof configuredOwnerSubject === 'string' && configuredOwnerSubject.length === 36,
    subjectIsUuid: typeof claims.sub === 'string' && /^[0-9a-f-]{36}$/i.test(claims.sub),
    subjectMatchesIdToken: claims.sub === JSON.parse(Buffer.from(manager.session.idToken.split('.')[1], 'base64url').toString('utf8')).sub });
  manager.stopAutoRefresh();
  mark(label + ' PKCE callback, nonce and token exchange');
  const api = new ApiClient({ baseUrl: configuration.api, fetchImpl: http.fetch,
    accessTokenProvider: () => manager.ensureAccessToken() });
  phase = label + ' identity API';
  const identity = await api.getCurrentUser();
  assert.ok(identity.subject, 'The Backend must verify the authenticated subject');
  const sites = await api.listSites();
  assert.ok(Array.isArray(sites) && sites.length > 0, 'The account must have an authorized site');
  const site = sites.find(item => item.siteCode === 'primary-site') ?? sites[0];
  assert.ok(site.id && site.siteCode, 'The selected site must have an API identity');
  mark(label + ' authorized identity and site API');
  await manager.refresh();
  manager.stopAutoRefresh();
  assert.ok((await api.getCurrentUser()).subject, 'The refreshed session must remain authorized');
  mark(label + ' refresh and authenticated API');
  return { manager, http, api, site, navigation: () => navigation };
}

async function websocket(token, siteCode) {
  const url = new URL(configuration.ws.replace('wss:', 'https:'));
  assert.equal(url.origin, origin);
  url.searchParams.set('siteCode', siteCode);
  await new Promise((resolve, reject) => {
    const req = httpsRequest(url, { ca, method: 'GET', timeout: 15000, autoSelectFamily: false, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      'Sec-WebSocket-Protocol': 'iot-v1, iot-bearer.' + token, Origin: 'https://localhost'
    } });
    req.once('upgrade', (response, socket) => {
      const accepted = response.statusCode === 101 && response.headers['sec-websocket-protocol'] === 'iot-v1';
      socket.destroy();
      if (accepted) resolve(); else reject(new Error('Authenticated WSS protocol was not accepted'));
    });
    req.once('response', response => { response.resume(); reject(new Error('Authenticated WSS returned HTTP ' + response.statusCode)); });
    req.once('timeout', () => req.destroy(new Error('Authenticated WSS timed out')));
    req.once('error', reject); req.end();
  });
  mark('Android-origin authenticated WSS handshake');
}

async function logout(session, label) {
  phase = label + ' logout';
  const refresh = session.manager.session?.refreshToken;
  const logoutAddress = await session.manager.logout();
  assert.equal(session.manager.getAccessToken(), null, 'Logout must clear local authority');
  const result = await session.http.request(logoutAddress);
  assert.ok([200, 302, 303].includes(result.status), 'The identity-provider logout endpoint must respond');
  const discovery = await session.manager.loadDiscovery();
  const replay = await session.http.request(discovery.token_endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: configuration.clientId, refresh_token: refresh }).toString() });
  assert.equal(replay.status, 400, 'A logged-out refresh token must be rejected');
  session.http.clear();
  mark(label + ' local logout and server refresh-token rejection');
}

let failure = null;
try {
  const native = await login(configuration.androidRedirectUri, 'Glass Android protocol');
  nativeApi = native.api;
  nativeSiteId = native.site.id;
  phase = 'authenticated WSS';
  await websocket(native.manager.getAccessToken(), native.site.siteCode);
  phase = 'AI capabilities';
  const status = await native.api.getAiStatus(native.site.id);
  assert.equal(status.enabled, true, 'The deployed AI must be enabled');
  assert.equal(status.knowledgeEnabled, false, 'Knowledge must remain disabled');
  const capabilities = await native.api.getAiCapabilities(native.site.id);
  assert.equal(capabilities.contractVersion, 1, 'The deployed AI contract must match the App');
  await native.api.getAiPersona(native.site.id);
  mark('AI status, capabilities and current persona');
  phase = 'remote AI generation through Backend';
  const key = randomUUID();
  chatClientKey = key;
  chatPosts++;
  let reply = await native.api.askAi(native.site.id, '请只用一句话解释温度传感器。', null,
    { headers: { 'Idempotency-Key': key } });
  conversationId = reply.conversationId ?? null;
  for (let polls = 0; !reply.answer && polls < 20; polls++) {
    await delay(3000);
    const pending = await native.api.getAiRequest(native.site.id, key);
    conversationId ??= pending.conversationId ?? null;
    if (pending.state === 'SUCCEEDED') { reply = pending.result; break; }
    assert.equal(pending.state, 'PROCESSING', 'The remote Chat request must remain recoverable');
  }
  assert.ok(typeof reply.answer === 'string' && reply.answer.trim().length > 0, 'The Backend must return a real remote answer');
  assert.ok(reply.conversationId, 'The generated answer must belong to a stored conversation');
  assert.deepEqual(reply.citations, [], 'Knowledge is disabled for this delivery');
  conversationId = reply.conversationId;
  answerCharacters = reply.answer.length;
  mark('One Backend Chat POST returns a nonempty remote answer');
  const recovered = await native.api.getAiRequest(native.site.id, key);
  assert.equal(recovered.state, 'SUCCEEDED', 'GET recovery must obtain the completed request');
  assert.equal(recovered.result.answer, reply.answer, 'GET recovery must return the same answer');
  const messages = await native.api.listAiMessages(native.site.id, conversationId);
  assert.ok(messages.items.some(item => item.role === 'ASSISTANT' && item.content === reply.answer),
    'History must preserve the generated answer');
  const history = await native.api.listAiConversations(native.site.id);
  assert.ok(history.items.some(item => item.id === conversationId), 'The generated conversation must appear in history');
  mark('Conversation history, stored messages and GET recovery');
  await native.api.deleteAiConversation(native.site.id, conversationId);
  testConversationRemoved = true; conversationId = null;
  mark('The isolated live-test conversation is deleted');
  await logout(native, 'Glass Android protocol');
  const web = await login(configuration.web, 'Glass web protocol');
  await logout(web, 'Glass web protocol');
} catch (error) {
  // Keep token responses, credentials, identity/site data and model text private.
  failure = { phase, code: error.code ?? error.status ?? error.name ?? 'CHECK_FAILED',
    causeCode: error.cause?.code ?? error.cause?.name ?? null,
    recognizedBackendReason: ['No active platform membership exists for this user',
      'Identity endpoint requires authenticated security mode', 'Invalid CORS request', 'Access denied', 'Forbidden'].find(
        message => JSON.stringify(error.problem ?? null).includes(message)) ?? null,
    backendProblemKeys: error.problem && typeof error.problem === 'object' ? Object.keys(error.problem) : [] };
  process.exitCode = 1;
  console.error('FAIL ' + phase + ' (' + failure.code + ')');
} finally {
  // Remove only the conversation created by this unique test request, even
  // when a later check fails. Never remove a pre-existing conversation.
  if (!testConversationRemoved && nativeApi && nativeSiteId && chatClientKey) {
    try {
      conversationId ??= (await nativeApi.getAiRequest(nativeSiteId, chatClientKey)).conversationId ?? null;
      if (conversationId) {
        await nativeApi.deleteAiConversation(nativeSiteId, conversationId);
        testConversationRemoved = true;
      }
    } catch { /* The report retains the incomplete-cleanup flag. */ }
  }
  for (const { manager, http } of sessions) {
    manager.stopAutoRefresh();
    if (manager.session) {
      const address = await manager.logout().catch(() => null);
      if (address) await http.request(address).catch(() => {});
    }
    await manager.clear({ emit: false }).catch(() => {}); http.clear();
  }
  const result = { kind: 'verified-tls-live-glass-protocol', origin, clientId: configuration.clientId,
    version: configuration.applicationVersion, passed: failure === null, checks, failure, tokenDiagnostics,
    chatPosts, answerCharacters, testConversationRemoved,
    providerCredentialReadByTest: false, credentialsLogged: false,
    actualPhoneVerified: false, nativeBrowserCallbackVerified: false,
    webUiLoginVerified: false, authenticatedBackendChatVerified: answerCharacters > 0 };
  await writeFile(new URL('artifacts/phone-lan-20261003/live-ai-check.json', root), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
