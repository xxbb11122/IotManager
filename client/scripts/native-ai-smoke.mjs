import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { startNativeAiMock } from './native-ai-mock.mjs';

// Run only on a connected Android emulator with the Debug APK installed.
// The original public endpoint, selection and recovery preferences are restored.
const serial = process.env.IOT_ANDROID_SERIAL ?? 'emulator-5554';
if (!/^emulator-\d+$/.test(serial)) throw new Error('This mock smoke test requires an emulator; physical devices are not supported.');
const adbPath = process.env.IOT_ANDROID_ADB ?? resolve(process.env.ANDROID_HOME ?? '', 'platform-tools/adb.exe');
const output = resolve('../artifacts/android-test-runtime');
const packageVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const gradleSource = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const expectedVersionName = process.env.IOT_RELEASE_VERSION_NAME ?? packageVersion;
const expectedVersionCode = Number(process.env.IOT_RELEASE_VERSION_CODE ?? gradleSource.match(/def resolvedVersionCode = (\d+)/)?.[1]);
assert.ok(Number.isSafeInteger(expectedVersionCode) && expectedVersionCode > 0, 'A valid expected Android version code is required');
const appId = 'com.iot.manager.client', port = 9224, reversePort = 18891;
const results = [];
let browser, page, originalPreferencesXml, mock, originalChromeFlags, browserFixture = false, forwarded = false, reversed = false;
let installedApkSha256 = null;
const adb = (...args) => {
  const value = spawnSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout: 25000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (value.error) throw value.error;
  if (value.status !== 0) throw new Error('ADB command failed: ' + args.slice(0, 3).join(' ') + '\n' + value.stderr);
  return value.stdout.trim();
};
function writePreferencesXml(xml) {
  // Do not echo preferences or save their original contents in public artifacts.
  const value = spawnSync(adbPath, ['-s', serial, 'shell', 'run-as', appId, 'tee', 'shared_prefs/CapacitorStorage.xml'],
    { input: xml, encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (value.error || value.status !== 0) throw new Error('Cannot write emulator test preferences');
}
const escapeXml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const keyboardShown = () => /mInputShown=true/.test(adb('shell', 'dumpsys input_method | grep -m 1 mInputShown'));
async function enableNetwork() {
  adb('shell', 'svc', 'wifi', 'enable');
  adb('shell', 'svc', 'data', 'enable');
  for (let i = 0; i < 20; i++) {
    if (/inet\s+10\.0\.2\./.test(adb('shell', 'ip', '-4', 'addr'))) return;
    await delay(250);
  }
  throw new Error('Emulator network interface did not receive an address');
}
async function connect() {
  if (browser) { await browser.close(); browser = null; }
  let socket;
  for (let i = 0; i < 40 && !socket; i++) {
    const processRow = adb('shell', 'ps', '-A').split('\n').find(line => line.trim().endsWith(' ' + appId));
    const pid = processRow?.trim().split(/\s+/)[1];
    if (pid) socket = adb('shell', 'cat', '/proc/net/unix').split('\n').find(line => line.includes('webview_devtools_remote_' + pid))?.split('@')[1]?.trim();
    if (!socket) await delay(250);
  }
  assert.ok(socket, 'Debug WebView socket must exist');
  adb('forward', 'tcp:' + port, 'localabstract:' + socket);
  forwarded = true;
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  page = browser.contexts().flatMap(context => context.pages()).find(item => item.url() === 'https://localhost/');
  assert.ok(page, 'Only the packaged local App is accepted');
  expect.setTimeout?.(15000);
}
function record(name, details = {}) { results.push({ name, passed: true, ...details }); console.log('PASS ' + name); }
function screenshot(name) {
  const value = spawnSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 10000, windowsHide: true });
  if (value.status !== 0) throw new Error('Native screen capture failed');
  return writeFile(resolve(output, name + '.png'), value.stdout);
}
const wifi = adb('shell', 'settings', 'get', 'global', 'wifi_on');
const data = adb('shell', 'settings', 'get', 'global', 'mobile_data');
const rotation = adb('shell', 'settings', 'get', 'system', 'user_rotation');
const autoRotation = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation');
const debugApp = adb('shell', 'settings', 'get', 'global', 'debug_app');
const waitForDebugger = adb('shell', 'settings', 'get', 'global', 'wait_for_debugger');
await mkdir(output, { recursive: true });
try {
  mock = await startNativeAiMock(); // Fail before connecting if port 8080 is occupied.
  if (adb('reverse', '--list').includes('tcp:' + reversePort)) throw new Error('The emulator mock reverse port is occupied');
  adb('reverse', 'tcp:' + reversePort, 'tcp:8080'); reversed = true;
  adb('shell', 'am', 'force-stop', appId);
  adb('shell', 'svc', 'wifi', 'disable');
  adb('shell', 'svc', 'data', 'disable');
  originalPreferencesXml = adb('shell', 'run-as', appId, 'cat', 'shared_prefs/CapacitorStorage.xml');
  // Use the reserved loopback reverse port so legacy 10.0.2.2 migration cannot
  // replace the fixture with a public endpoint baked into this particular APK.
  const profile = { id: 'native-ai-smoke', accessRoute: 'SITE_API', apiBaseUrl: 'http://127.0.0.1:' + reversePort + '/api/v1',
    wsUrl: 'ws://127.0.0.1:' + reversePort + '/ws/devices', organizationCode: 'native-smoke-org' };
  const entry = '<string name="iot-manager.active-endpoint.v1">' + escapeXml(JSON.stringify(profile)) + '</string>';
  const fixtureXml = originalPreferencesXml.includes('name="iot-manager.active-endpoint.v1"')
    ? originalPreferencesXml.replace(/<string name="iot-manager\.active-endpoint\.v1">[\s\S]*?<\/string>/, entry)
    : originalPreferencesXml.replace('</map>', entry + '</map>');
  assert.notEqual(fixtureXml, originalPreferencesXml, 'The mock profile must replace the previous endpoint');
  writePreferencesXml(fixtureXml);
  await enableNetwork();
  adb('shell', 'am', 'start', '-n', appId + '/.MainActivity');
  await connect();
  await expect.poll(() => page.evaluate(async () => JSON.parse((await window.Capacitor.Plugins.Preferences.get({
    key: 'iot-manager.active-endpoint.v1' })).value).id)).toBe('native-ai-smoke');
  await expect.poll(() => page.evaluate(async () => (await window.Capacitor.Plugins.CapacitorHttp.get({
    url: 'http://127.0.0.1:18891/api/v1/me', connectTimeout: 1500, readTimeout: 1500 })).status).catch(() => 0),
    { timeout: 15000 }).toBe(200);
  await expect.poll(() => page.evaluate(() => navigator.onLine), { timeout: 15000 }).toBe(true);
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.locator('#ai-question')).toBeVisible({ timeout: 20000 });
  assert.equal(await page.evaluate(() => window.Capacitor.isNativePlatform()), true);
  const packageInfo = adb('shell', 'dumpsys', 'package', appId);
  assert.equal(Number(packageInfo.match(/versionCode=(\d+)\b/)?.[1]), expectedVersionCode);
  assert.equal(packageInfo.match(/versionName=([^\s]+)/)?.[1], expectedVersionName);
  const apkPath = adb('shell', 'pm', 'path', appId).replace(/^package:/, '');
  assert.match(apkPath, /^\/data\/app\/[A-Za-z0-9_.~/=+-]+\/base\.apk$/);
  installedApkSha256 = adb('shell', 'sha256sum', apkPath).split(/\s+/)[0].toUpperCase();
  assert.match(installedApkSha256, /^[A-F0-9]{64}$/);
  record('installed Debug APK ' + expectedVersionName + ' uses native platform');

  const nav = page.locator('.bottom-nav');
  await expect(nav.locator('.nav-button')).toHaveCount(4);
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'ai');
  const navGeometry = () => nav.evaluate(element => {
    const indicator = getComputedStyle(element, '::before');
    const track = element.querySelector('.nav-button').getBoundingClientRect().width;
    return { track, width: parseFloat(indicator.width), offset: new DOMMatrix(indicator.transform).m41,
      durations: indicator.transitionDuration.split(',').map(value => value.trim()),
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  await expect.poll(async () => { const row = await navGeometry(); return Math.abs(row.offset - row.track); }).toBeLessThan(1);
  const aiGeometry = await navGeometry();
  assert.ok(Math.abs(aiGeometry.width - aiGeometry.track) < 1);
  assert.equal(aiGeometry.overflow, false);
  const navNode = await nav.elementHandle();
  // Dispatch successive taps without waiting for the preceding visual transition.
  await nav.evaluate(element => {
    for (const screen of ['devices', 'activity', 'add', 'ai']) element.querySelector('[data-screen="' + screen + '"]').click();
  });
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'ai');
  await expect(page.locator('#ai-question')).toBeVisible();
  assert.equal(await navNode.evaluate(element => element === document.querySelector('.bottom-nav')), true);
  await expect.poll(async () => { const row = await navGeometry(); return Math.abs(row.offset - row.track); }).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nav.locator('[data-screen="devices"]').click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'devices');
  const reducedNav = await navGeometry();
  assert.equal(reducedNav.offset, 0);
  assert.ok(reducedNav.durations.every(value => value === '0s'));
  await nav.locator('[data-screen="ai"]').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#ai-question')).toBeVisible();
  assert.equal(mock.calls.filter(row => row.pathname.endsWith('/chat')).length, 0);
  await screenshot('native-ai-bottom-navigation');
  record('native bottom navigation aligns, survives interrupted taps and respects reduced motion');

  await page.locator('#ai-question').fill('MQTT-native');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.ai-message--assistant')).toContainText('原生模拟回答：MQTT-native');
  assert.equal(await page.locator('.ai-messages img').count(), 0);
  assert.equal(await page.evaluate(() => window.nativeAiInjected), undefined);
  assert.equal(mock.calls.filter(row => row.pathname.endsWith('/chat')).length, 1);
  assert.ok(mock.calls.some(row => row.pathname === '/api/v1/me'));
  await screenshot('native-ai-chat');
  record('native HTTP roundtrip, one POST and safe answer text');

  await page.locator('#ai-question').click();
  await expect.poll(keyboardShown).toBe(true);
  await screenshot('native-ai-keyboard');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await expect.poll(keyboardShown).toBe(false);
  await expect(page.getByRole('heading', { name: 'AI 助手', exact: true })).toBeVisible();
  record('Android soft keyboard opens and first Back dismisses it without leaving chat');

  await page.getByRole('button', { name: '历史', exact: true }).click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'ai');
  await expect(page.locator('.ai-history-title')).toHaveText('MQTT-native');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await expect(page.getByRole('heading', { name: 'AI 助手', exact: true })).toBeVisible();
  record('history and Android system Back return to chat');

  await page.getByRole('button', { name: '性格', exact: true }).click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-screen', 'ai');
  const personaTail = 'native-persona-end';
  const instructions = 'a'.repeat(4000 - personaTail.length) + personaTail;
  assert.equal(instructions.length, 4000);
  await page.locator('#ai-persona-name').fill('原生简洁助手');
  await page.locator('#ai-persona-instructions').fill(instructions);
  if (keyboardShown()) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await expect.poll(keyboardShown).toBe(false);
  }
  await page.getByRole('button', { name: '保存新版本' }).click();
  await expect(page.getByRole('button', { name: '启用', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await expect(page.getByRole('heading', { name: '当前启用：原生简洁助手' })).toBeVisible();
  assert.equal(mock.versions[0].instructions, instructions);
  assert.equal(mock.calls.find(row => row.pathname.endsWith('/activate')).body.expectedActiveVersion, 0);
  await screenshot('native-ai-persona');
  record('4000 character persona and guarded activation through native HTTP');
  await page.getByRole('button', { name: '返回聊天' }).click();
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await expect(page.locator('.ai-message')).toHaveCount(0);

  await page.locator('#ai-question').fill('native-recovery-进程重启');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '查询本次结果' })).toBeVisible();
  const metadata = await page.evaluate(async () => JSON.parse((await window.Capacitor.Plugins.Preferences.get({ key: 'iot-manager.ai-recovery.v1' })).value));
  const pending = Object.values(metadata).find(row => row.clientRequestId === [...mock.requests.keys()].at(-1));
  assert.ok(pending);
  assert.deepEqual(Object.keys(pending).sort(), ['clientRequestId', 'conversationId', 'submittedAt']);
  record('native Preferences stores only request IDs and timestamp');
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await delay(300);
  const gets = mock.calls.filter(row => row.pathname.includes('/requests/')).length;
  await delay(3400);
  assert.equal(mock.calls.filter(row => row.pathname.includes('/requests/')).length, gets);
  record('background lifecycle stops recovery polling');
  adb('shell', 'svc', 'wifi', 'disable');
  adb('shell', 'am', 'force-stop', appId);
  mock.completePending();
  await enableNetwork();
  adb('shell', 'am', 'start', '-n', appId + '/.MainActivity');
  await connect();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.locator('.ai-message--assistant')).toContainText('原生模拟回答：native-recovery-进程重启', { timeout: 20000 });
  assert.equal(mock.calls.filter(row => row.pathname.endsWith('/chat')).length, 2);
  assert.equal(await page.locator('.ai-message').count(), 2);
  await screenshot('native-ai-recovered');
  record('process restart obtains saved answer with GET and no repeated POST');

  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
  await expect.poll(() => page.evaluate(() => innerWidth > innerHeight)).toBe(true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const headerSafeArea = await page.evaluate(() => {
    const probe = document.createElement('div'); probe.style.paddingTop = 'var(--safe-top)'; document.body.append(probe);
    const top = parseFloat(getComputedStyle(probe).paddingTop); probe.remove();
    const header = document.querySelector('.app-header');
    return { top, headerTop: header.getBoundingClientRect().top,
      controls: [...header.querySelectorAll('button')].filter(button => button.getBoundingClientRect().height)
        .map(button => button.getBoundingClientRect().top) };
  });
  assert.ok(headerSafeArea.controls.length > 0);
  assert.ok(headerSafeArea.controls.every(top => top >= headerSafeArea.headerTop + headerSafeArea.top), 'Header actions must clear the system safe area');
  await screenshot('native-ai-landscape');
  record('Android rotation preserves chat, safe area and no horizontal overflow', { topInsetCssPixels: headerSafeArea.top });

  // Chromium's documented emulator test flags avoid account onboarding. No
  // browser account, terms dialog, trust setting or security feature is changed.
  const priorFlags = spawnSync(adbPath, ['-s', serial, 'shell', 'cat', '/data/local/tmp/chrome-command-line'], { encoding: 'utf8', windowsHide: true });
  originalChromeFlags = priorFlags.status === 0 ? priorFlags.stdout : null;
  const flagsWrite = spawnSync(adbPath, ['-s', serial, 'shell', 'tee', '/data/local/tmp/chrome-command-line'], {
    input: 'chrome --disable-fre --no-first-run --no-default-browser-check\n', encoding: 'utf8', windowsHide: true });
  if (flagsWrite.status !== 0) throw new Error('Cannot configure the emulator browser fixture');
  browserFixture = true;
  adb('shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome');
  adb('shell', 'am', 'force-stop', 'com.android.chrome');
  await page.evaluate(() => window.Capacitor.Plugins.Browser.open({ url: 'http://127.0.0.1:18891/mock-login' }));
  await expect.poll(() => mock.calls.some(row => row.pathname === '/mock-login'), { timeout: 15000 }).toBe(true);
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await expect.poll(() => adb('shell', 'dumpsys window | grep -m 1 mCurrentFocus').includes(appId),
    { timeout: 10000 }).toBe(true);
  record('native Browser plugin opens isolated page and returns to App');
} catch (error) {
  console.error(error.stack ?? error.message);
  if (page && !page.isClosed()) {
    console.error('Packaged App screen: ' + (await page.locator('body').innerText()).slice(0, 1800));
    console.error('Mock network diagnostic: ' + JSON.stringify(await page.evaluate(async () => {
      const network = await window.Capacitor.Plugins.Network.getStatus();
      const config = JSON.parse((await window.Capacitor.Plugins.Preferences.get({ key: 'iot-manager.active-endpoint.v1' })).value ?? '{}');
      try {
        const response = await window.Capacitor.Plugins.CapacitorHttp.get({ url: 'http://127.0.0.1:18891/api/v1/me', connectTimeout: 1500, readTimeout: 1500 });
        return { network, apiBaseUrl: config.apiBaseUrl, nativeStatus: response.status, online: navigator.onLine };
      } catch (error) { return { network, apiBaseUrl: config.apiBaseUrl, online: navigator.onLine, nativeError: String(error) }; }
    })));
    await screenshot('native-ai-failed').catch(() => {});
  }
  console.error('Mock routes: ' + JSON.stringify(mock?.calls.map(({ method, pathname }) => ({ method, pathname })) ?? []));
  process.exitCode = 1;
} finally {
  try {
    adb('shell', 'svc', 'wifi', 'disable');
    adb('shell', 'svc', 'data', 'disable');
    adb('shell', 'am', 'force-stop', appId);
    if (originalPreferencesXml) writePreferencesXml(originalPreferencesXml);
    if (browserFixture) {
      adb('shell', 'am', 'force-stop', 'com.android.chrome');
      if (originalChromeFlags === null) adb('shell', 'rm', '/data/local/tmp/chrome-command-line');
      else {
        const restored = spawnSync(adbPath, ['-s', serial, 'shell', 'tee', '/data/local/tmp/chrome-command-line'], {
          input: originalChromeFlags, encoding: 'utf8', windowsHide: true });
        if (restored.status !== 0) throw new Error('Cannot restore emulator browser flags');
      }
      if (debugApp === 'null') adb('shell', 'am', 'clear-debug-app');
      else adb('shell', 'settings', 'put', 'global', 'debug_app', debugApp);
      if (waitForDebugger !== 'null') adb('shell', 'settings', 'put', 'global', 'wait_for_debugger', waitForDebugger);
    }
    adb('shell', 'settings', 'put', 'system', 'user_rotation', rotation);
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', autoRotation);
    if (wifi === '1') adb('shell', 'svc', 'wifi', 'enable');
    if (data === '1') adb('shell', 'svc', 'data', 'enable');
    if (forwarded) adb('forward', '--remove', 'tcp:' + port);
    if (reversed) adb('reverse', '--remove', 'tcp:' + reversePort);
  } catch (error) { console.error('Cleanup failed: ' + error.message); process.exitCode = 1; }
  if (browser) await browser.close();
  if (mock) await mock.close();
  await writeFile(resolve(output, 'native-ai-results.json'), JSON.stringify({
    applicationId: appId, versionName: expectedVersionName, versionCode: expectedVersionCode, source: 'installed-debug-apk',
    provider: 'isolated-mock', realProviderCalled: false, installedApkSha256, passed: process.exitCode !== 1,
    results, postCount: mock?.calls.filter(row => row.pathname.endsWith('/chat')).length ?? 0
  }, null, 2));
}
