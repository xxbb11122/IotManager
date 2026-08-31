import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const readClientFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android release build is signed only from protected runtime inputs', async () => {
  const gradle = await readClientFile('android/app/build.gradle');
  const packageJson = JSON.parse(await readClientFile('package.json'));

  for (const name of [
    'IOT_RELEASE_STORE_FILE',
    'IOT_RELEASE_STORE_PASSWORD',
    'IOT_RELEASE_KEY_ALIAS',
    'IOT_RELEASE_KEY_PASSWORD'
  ]) {
    assert.match(gradle, new RegExp(`releaseSetting\\('${name}'\\)`));
  }
  assert.match(gradle, /tasks\.register\('validateReleaseSigning'/);
  assert.match(gradle, /task\.name == 'packageRelease'/);
  assert.match(gradle, /task\.name == 'bundleRelease'/);
  assert.match(gradle, /IOT_RELEASE_VERSION_CODE/);
  assert.match(gradle, /IOT_RELEASE_VERSION_NAME/);
  assert.equal(packageJson.scripts['android:release'], 'npm run android:sync && node scripts/android-build.mjs assembleRelease');
  assert.equal(packageJson.scripts['android:bundle'], 'npm run android:sync && node scripts/android-build.mjs bundleRelease');
});

test('Release keeps production transport restrictions while debug owns LAN exceptions', async () => {
  const [gradle, mainManifest, debugManifest, debugNetworkConfig, mainActivity] = await Promise.all([
    readClientFile('android/app/build.gradle'),
    readClientFile('android/app/src/main/AndroidManifest.xml'),
    readClientFile('android/app/src/debug/AndroidManifest.xml'),
    readClientFile('android/app/src/debug/res/xml/network_security_config.xml'),
    readClientFile('android/app/src/main/java/com/iot/manager/client/MainActivity.java')
  ]);

  assert.match(gradle, /release\s*\{[\s\S]*cleartextTrafficPermitted: "false"/);
  assert.match(mainManifest, /android:usesCleartextTraffic="\$\{cleartextTrafficPermitted\}"/);
  assert.match(debugManifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(debugNetworkConfig, /cleartextTrafficPermitted="true"/);
  assert.match(mainActivity, /if \(debuggable && Build\.VERSION\.SDK_INT/);
  assert.match(mainActivity, /if \(debuggable && Build\.VERSION\.SDK_INT[\s\S]*setMixedContentMode\(WebSettings\.MIXED_CONTENT_ALWAYS_ALLOW\)/);
});
