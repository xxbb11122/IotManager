import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Opt-in installed-APK test. Only the external Browser.open boundary is
// replaced: the APK keeps its real PKCE, secure store, HTTP and AI modules.
// Account submission uses verified TLS in this process, then a real Android
// deep-link intent delivers the callback. No live site is opened in a browser.
if (process.env.IOT_LIVE_AI_ACCEPTANCE !== 'true' || !process.env.IOT_E2E_OWNER_PASSWORD_FILE)
  throw new Error('Explicit live acceptance and a protected password file are required');
const serial = process.env.IOT_ANDROID_SERIAL ?? 'emulator-5554';
assert.match(serial, /^emulator-\d+$/, 'This helper accepts a task-owned emulator only');
const adbPath = resolve(process.env.ANDROID_HOME, 'platform-tools/adb.exe');
const output = resolve(process.env.IOT_NATIVE_LIVE_OUTPUT_DIR ?? '../../artifacts/phone-lan-20261003/android-live');
const configuration = JSON.parse(await readFile('../../artifacts/phone-lan-20261003/connection.json', 'utf8'));
const ca = await readFile('../../deploy/.runtime/iot-manager-p0/phone-web/mobile/caddy-root-ca.cer');
const password = (await readFile(process.env.IOT_E2E_OWNER_PASSWORD_FILE, 'utf8')).trim();
const origin = new URL(configuration.web).origin, appId = 'com.iot.manager.glassnext';
const username = process.env.IOT_E2E_OWNER_USERNAME ?? 'integration-owner';
const loginOnly = process.env.IOT_NATIVE_LIVE_LOGIN_ONLY === 'true';
const cookies = new Map(), checks = [];
const originalRotation = adb(['shell', 'settings', 'get', 'system', 'user_rotation']);
const originalAutoRotation = adb(['shell', 'settings', 'get', 'system', 'accelerometer_rotation']);
const testQuestion = '请只用一句话解释温度传感器。（Android 接入验收 ' + randomUUID() + '）';
let browser, page, preferencesXml, preferencesWritten = false, forwarded = false;
let phase = 'initialization', failure = null, answerCharacters = 0, ownConversation = null;
let testConversationRemoved = false, apkSha256 = null, chatPosts = 0;
let nativeSiteId = null;
function adb(args, input) {
  const result = spawnSync(adbPath, ['-s', serial, ...args], {
    input, encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Task-owned emulator command failed');
  return result.stdout.trim();
}
function writePreferences(xml) {
  adb(['shell', 'run-as', appId, 'mkdir', '-p', 'shared_prefs']);
  adb(['shell', 'run-as', appId, 'tee', 'shared_prefs/CapacitorStorage.xml'], xml);
}
function mark(name) { checks.push(name); console.log('PASS ' + name); }
function request(address, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(address, origin);
  assert.equal(url.origin, origin, 'Identity requests must remain on the verified project origin');
  const requestHeaders = { ...headers };
  if (url.pathname.startsWith('/auth/') && cookies.size)
    requestHeaders.Cookie = [...cookies].map(([key, value]) => key + '=' + value).join('; ');
  if (body !== undefined) requestHeaders['Content-Length'] = Buffer.byteLength(body);
  return new Promise((resolveRequest, reject) => {
    const req = httpsRequest(url, { ca, method, headers: requestHeaders, timeout: 15000,
      autoSelectFamily: false }, res => {
      for (const cookie of res.headers['set-cookie'] ?? []) {
        const pair = cookie.split(';', 1)[0], separator = pair.indexOf('=');
        const key = pair.slice(0, separator), value = pair.slice(separator + 1);
        if (!value || /max-age=0(?:;|$)/i.test(cookie)) cookies.delete(key); else cookies.set(key, value);
      }
      let text = '';
      res.setEncoding('utf8'); res.on('data', chunk => { text += chunk;
        if (text.length > 2 * 1024 * 1024) req.destroy(new Error('Unexpected identity response size')); });
      res.on('end', () => resolveRequest({ status: res.statusCode, headers: res.headers, text }));
      res.on('error', reject);
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Verified identity request timed out'))); req.end(body);
  });
}
async function accountCallback(authorization) {
  const form = await request(authorization);
  assert.equal(form.status, 200);
  const action = form.text.match(/<form\b[^>]*\bid="kc-form-login"[^>]*\baction="([^"]+)"/i)?.[1];
  assert.ok(action, 'The real account form must be available');
  const result = await request(action.replace(/&amp;/g, '&'), { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin },
    body: new URLSearchParams({ username, password, credentialId: '' }).toString() });
  assert.ok([302, 303].includes(result.status), 'The real account must complete login');
  const callback = new URL(result.headers.location);
  const expected = new URL(configuration.androidRedirectUri);
  assert.equal(callback.protocol, expected.protocol); assert.equal(callback.host, expected.host);
  assert.equal(callback.pathname, expected.pathname); assert.ok(callback.searchParams.has('code'));
  return callback.href;
}
function deliverCallback(url) {
  // Keep the authorization code out of the Windows process command line and
  // artifacts. Android receives the standard, PKCE-bound deep-link intent.
  const quoted = "'" + url.replace(/'/g, "'\\''") + "'";
  adb(['shell'], 'am start -a android.intent.action.VIEW -d ' + quoted + ' ' + appId + '\n');
}
async function nativeApi(method, suffix, data) {
  return page.evaluate(async ({ method, suffix, data }) => {
    const secure = await window.Capacitor.Plugins.SecureSession.get({ key: 'iot-manager.oidc-session.v1' });
    const token = JSON.parse(secure.value ?? 'null')?.accessToken;
    if (!token) return { status: 0, data: null };
    const profile = JSON.parse((await window.Capacitor.Plugins.Preferences.get({ key: 'iot-manager.active-endpoint.v1' })).value);
    const result = await window.Capacitor.Plugins.CapacitorHttp.request({ method,
      url: profile.apiBaseUrl + suffix, headers: { Authorization: 'Bearer ' + token,
        ...(data ? { 'Content-Type': 'application/json' } : {}) }, data });
    return { status: result.status, data: result.status === 204 || result.data == null || result.data === ''
      ? null : typeof result.data === 'string' ? JSON.parse(result.data) : result.data };
  }, { method, suffix, data });
}
await mkdir(output, { recursive: true });
try {
  phase = 'installed APK identity';
  const packageInfo = adb(['shell', 'dumpsys', 'package', appId]);
  assert.equal(Number(packageInfo.match(/versionCode=(\d+)/)?.[1]), configuration.versionCode);
  assert.equal(packageInfo.match(/versionName=([^\s]+)/)?.[1], configuration.applicationVersion);
  const apkPath = adb(['shell', 'pm', 'path', appId]).replace(/^package:/, '');
  assert.match(apkPath, /^\/data\/app\/[A-Za-z0-9_.~/=+-]+\/base\.apk$/);
  apkSha256 = adb(['shell', 'sha256sum', apkPath]).split(/\s+/)[0].toUpperCase();
  assert.equal(apkSha256, configuration.apkSha256);
  adb(['shell', 'am', 'force-stop', appId]);
  adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
  adb(['shell', 'settings', 'put', 'system', 'user_rotation', '0']);
  adb(['shell', 'wm', 'user-rotation', 'lock', '0']);
  const previous = spawnSync(adbPath, ['-s', serial, 'shell', 'run-as', appId, 'cat', 'shared_prefs/CapacitorStorage.xml'],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (previous.status !== 0 && !/No such file/.test(previous.stderr)) throw new Error('Cannot inspect emulator preferences');
  preferencesXml = previous.status === 0 ? previous.stdout : null;
  const profile = { id: 'phone-live-acceptance', accessRoute: 'SITE_API', apiBaseUrl: configuration.api,
    wsUrl: configuration.ws, oidcIssuerUrl: configuration.issuer, oidcClientId: configuration.clientId,
    oidcRedirectUri: configuration.androidRedirectUri };
  const xmlValue = JSON.stringify(profile).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const entry = '<string name="iot-manager.active-endpoint.v1">' + xmlValue + '</string>';
  const base = preferencesXml ?? '<?xml version="1.0" encoding="utf-8"?><map></map>';
  writePreferences(base.includes('name="iot-manager.active-endpoint.v1"')
    ? base.replace(/<string name="iot-manager\.active-endpoint\.v1">[\s\S]*?<\/string>/, entry) : base.replace('</map>', entry + '</map>'));
  preferencesWritten = true;
  adb(['shell', 'am', 'start', '-n', appId + '/.MainActivity']);
  adb(['shell', 'wm', 'user-rotation', 'lock', '0']);
  let socket;
  for (let attempt = 0; attempt < 40 && !socket; attempt++) {
    const row = adb(['shell', 'ps', '-A']).split('\n').find(line => line.trim().endsWith(' ' + appId));
    const pid = row?.trim().split(/\s+/)[1];
    if (pid) socket = adb(['shell', 'cat', '/proc/net/unix']).split('\n').find(line => line.includes('webview_devtools_remote_' + pid))?.split('@')[1]?.trim();
    if (!socket) await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  assert.ok(socket, 'The installed Debug WebView must be available');
  adb(['forward', 'tcp:9225', 'localabstract:' + socket]); forwarded = true;
  browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  page = browser.contexts().flatMap(context => context.pages()).find(item => item.url() === 'https://localhost/');
  assert.ok(page, 'Only the packaged local WebView is accepted');
  await page.waitForFunction(() => Boolean(window.Capacitor?.nativePromise));
  await expect.poll(() => page.evaluate(() => innerHeight > innerWidth), { timeout: 15000 }).toBe(true);
  assert.equal(await page.evaluate(() => window.Capacitor.isNativePlatform()), true);
  await page.evaluate(() => {
    const original = window.Capacitor.nativePromise.bind(window.Capacitor);
    window.__liveNativeBrowserRequests = [];
    window.Capacitor.nativePromise = (plugin, method, options) => {
      if (plugin === 'Browser' && method === 'open') {
        window.__liveNativeBrowserRequests.push(options.url); return Promise.resolve({});
      }
      return original(plugin, method, options);
    };
  });
  mark('Installed APK hash and real native runtime');
  phase = 'external browser fixture self-check';
  await page.evaluate(() => window.Capacitor.Plugins.Browser.open({ url: 'http://127.0.0.1:18891/browser-fixture-self-check' }));
  assert.equal(await page.evaluate(() => window.__liveNativeBrowserRequests.length), 1,
    'The external browser boundary must be replaced before attempting login');
  await page.evaluate(() => { window.__liveNativeBrowserRequests.length = 0; });
  phase = 'native TLS identity discovery';
  const nativeDiscovery = await page.evaluate(async issuer => {
    const result = await window.Capacitor.Plugins.CapacitorHttp.get({ url: issuer + '/.well-known/openid-configuration',
      connectTimeout: 10000, readTimeout: 10000 });
    const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
    return { status: result.status, issuerMatches: data?.issuer === issuer };
  }, configuration.issuer);
  assert.equal(nativeDiscovery.status, 200); assert.equal(nativeDiscovery.issuerMatches, true);
  mark('Native HTTPS identity discovery validates the embedded CA and issuer');
  phase = 'native sign-in button';
  await page.locator('.app-header [data-action="sign-in"]').click({ timeout: 20000 });
  phase = 'APK authorization URL preparation';
  await expect.poll(() => page.evaluate(() => window.__liveNativeBrowserRequests.length), { timeout: 20000 }).toBe(1);
  const authorization = await page.evaluate(() => window.__liveNativeBrowserRequests[0]);
  phase = 'verified account login and native callback delivery';
  deliverCallback(await accountCallback(authorization));
  phase = 'native callback token exchange and authenticated UI';
  await expect(page.locator('.app-header [data-action="sign-out"]')).toBeVisible({ timeout: 30000 });
  const me = await nativeApi('GET', '/me');
  assert.equal(me.status, 200); assert.ok(me.data?.subject);
  const sites = await nativeApi('GET', '/sites');
  assert.equal(sites.status, 200); assert.ok(sites.data?.length > 0);
  const site = sites.data.find(item => item.siteCode === 'primary-site') ?? sites.data[0];
  nativeSiteId = site.id;
  mark('APK validates real PKCE callback, secure session and authorized API over TLS');
  if (!loginOnly) {
  phase = 'real AI generation in the APK';
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.locator('#ai-question')).toBeEnabled({ timeout: 30000 });
  await page.locator('#ai-question').fill(testQuestion);
  chatPosts++;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.ai-message--assistant')).toBeVisible({ timeout: 95000 });
  answerCharacters = await page.locator('.ai-message--assistant').first().evaluate(element => element.textContent.trim().length);
  assert.ok(answerCharacters > 0, 'The installed APK must render the real remote answer');
  const history = await nativeApi('GET', '/sites/' + site.id + '/ai/conversations');
  assert.equal(history.status, 200);
  ownConversation = history.data.items.find(item => item.title === testQuestion)?.id;
  assert.ok(ownConversation, 'The test conversation must appear in server history');
  mark('Installed APK receives and renders a real Backend/DeepSeek answer');
  const screenshot = spawnSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'],
    { windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  if (screenshot.status === 0) await writeFile(resolve(output, 'native-live-ai.png'), screenshot.stdout);
  phase = 'native stored messages read';
  const messages = await nativeApi('GET', '/sites/' + site.id + '/ai/conversations/' + ownConversation + '/messages');
  assert.equal(messages.status, 200); assert.ok(messages.data.items.some(item => item.role === 'ASSISTANT'));
  phase = 'native test-conversation deletion';
  const removed = await nativeApi('DELETE', '/sites/' + site.id + '/ai/conversations/' + ownConversation);
  assert.equal(removed.status, 204); testConversationRemoved = true;
  mark('Native history and deletion of the test conversation');
  }
  phase = 'reading native refresh token';
  const refreshToken = await page.evaluate(async () => JSON.parse((await window.Capacitor.Plugins.SecureSession.get(
    { key: 'iot-manager.oidc-session.v1' })).value ?? 'null')?.refreshToken);
  assert.ok(typeof refreshToken === 'string' && refreshToken, 'The real native session must have a refresh token');
  phase = 'APK logout click';
  await page.locator('.app-header [data-action="sign-out"]').click();
  phase = 'APK RP logout URL preparation';
  await expect.poll(() => page.evaluate(() => window.__liveNativeBrowserRequests.length), { timeout: 20000 }).toBe(2);
  const endSession = await page.evaluate(() => window.__liveNativeBrowserRequests[1]);
  phase = 'verified RP logout request';
  await request(endSession);
  phase = 'APK logout UI and secure storage';
  // On the signed-out AI screen both the header and the AI prompt expose a
  // login action. Assert the header action explicitly rather than a strict
  // locator which ambiguously matches both valid controls.
  await expect(page.locator('.app-header [data-action="sign-in"]')).toBeVisible({ timeout: 20000 });
  assert.equal(await page.evaluate(async () => (await window.Capacitor.Plugins.SecureSession.get(
    { key: 'iot-manager.oidc-session.v1' })).value ?? null), null);
  phase = 'server refresh rejection after APK logout';
  const refresh = await request(configuration.issuer + '/protocol/openid-connect/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken, client_id: configuration.clientId }).toString() });
  assert.equal(refresh.status, 400, 'The APK must revoke its offline refresh token');
  mark('APK logout clears secure storage and revokes the real refresh token');
} catch (error) {
  const safeHints = ['Unexpected end of JSON input', 'is not valid JSON', 'Cannot read properties of null',
    'Cannot read properties of undefined', 'net::ERR_', 'SSLHandshakeException', 'Invalid URL', 'strict mode violation'];
  failure = { phase, code: error.code ?? error.name ?? 'CHECK_FAILED',
    hint: safeHints.find(hint => String(error.message).includes(hint)) ?? null };
  console.error('FAIL ' + phase + ' (' + failure.code + ')'); process.exitCode = 1;
  if (page && !page.isClosed()) {
    const diagnostic = await page.evaluate(async issuer => {
      const session = JSON.parse((await window.Capacitor.Plugins.SecureSession.get(
        { key: 'iot-manager.oidc-session.v1' })).value ?? 'null');
      return { signInPresent: Boolean(document.querySelector('[data-action="sign-in"]')),
        signOutPresent: Boolean(document.querySelector('[data-action="sign-out"]')),
        sessionPresent: Boolean(session?.accessToken), refreshPresent: Boolean(session?.refreshToken),
        sessionIssuerMatches: session?.issuerUrl === issuer,
        browserFixtureRequests: window.__liveNativeBrowserRequests?.length ?? 0,
        startupOverlayPresent: Boolean(document.querySelector('#startup-overlay:not([hidden])')) };
    }, configuration.issuer).catch(() => ({ diagnosticUnavailable: true }));
    console.error('Safe native diagnostic: ' + JSON.stringify(diagnostic));
  }
} finally {
  if (page && !page.isClosed()) {
    if (!testConversationRemoved && nativeSiteId) {
      const history = await nativeApi('GET', '/sites/' + nativeSiteId + '/ai/conversations').catch(() => null);
      const id = history?.data?.items?.find(item => item.title === testQuestion)?.id;
      if (id) testConversationRemoved = (await nativeApi('DELETE', '/sites/' + nativeSiteId + '/ai/conversations/' + id).catch(() => null))?.status === 204;
    }
    // End any session created by this test without preserving credentials.
    await page.evaluate(async () => {
      const secure = await window.Capacitor.Plugins.SecureSession.get({ key: 'iot-manager.oidc-session.v1' });
      const session = JSON.parse(secure.value ?? 'null');
      const profile = JSON.parse((await window.Capacitor.Plugins.Preferences.get({ key: 'iot-manager.active-endpoint.v1' })).value ?? '{}');
      if (session?.refreshToken && profile.oidcIssuerUrl) await window.Capacitor.Plugins.CapacitorHttp.post({
        url: profile.oidcIssuerUrl + '/protocol/openid-connect/revoke', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({ token: session.refreshToken, token_type_hint: 'refresh_token', client_id: profile.oidcClientId }).toString()
      }).catch(() => {});
      for (const key of ['iot-manager.oidc-session.v1', 'iot-manager.oidc-transaction.v1'])
        await window.Capacitor.Plugins.SecureSession.remove({ key });
    }).catch(() => {});
  }
  adb(['shell', 'am', 'force-stop', appId]);
  if (preferencesWritten) {
    if (preferencesXml !== null) writePreferences(preferencesXml);
    else adb(['shell', 'run-as', appId, 'rm', '-f', 'shared_prefs/CapacitorStorage.xml']);
  }
  if (browser) await browser.close();
  if (forwarded) adb(['forward', '--remove', 'tcp:9225']);
  adb(['shell', 'settings', 'put', 'system', 'user_rotation', originalRotation]);
  adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', originalAutoRotation]);
  cookies.clear();
  const report = { version: configuration.applicationVersion, versionCode: configuration.versionCode,
    scope: loginOnly ? 'native-real-login-logout' : 'native-real-login-chat-history-logout',
    installedApkSha256: apkSha256, checks, passed: failure === null, failure, answerCharacters, chatPosts,
    testConversationRemoved, externalBrowserFixture: true, nativeSystemBrowserTlsVerified: false,
    actualPhoneVerified: false, nativeApkUiBackendChatVerified: answerCharacters > 0, credentialsLogged: false };
  await writeFile(resolve(output, 'native-live-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
