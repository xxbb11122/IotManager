import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('release manifest declares BLE/network access without global cleartext', async () => {
  const xml = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(xml, /android.permission.BLUETOOTH_SCAN/);
  assert.match(xml, /android.permission.BLUETOOTH_CONNECT/);
  assert.match(xml, /android.permission.INTERNET/);
  assert.doesNotMatch(xml, /usesCleartextTraffic="true"/);
});

test('debug variant alone enables cleartext development endpoints', async () => {
  const xml = await readFile(new URL('../android/app/src/debug/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(xml, /usesCleartextTraffic="true"/);
  assert.match(xml, /networkSecurityConfig="@xml\/network_security_config"/);
});
