import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import config from '../capacitor.config.js';

const require = createRequire(import.meta.url);

test('Capacitor packages the existing client build', () => {
  assert.equal(config.appId, 'com.iot.manager.client');
  assert.equal(config.appName, 'IoT Manager');
  assert.equal(config.webDir, 'dist');
  assert.equal(config.plugins.CapacitorHttp.enabled, true);
});

test('Capacitor CLI can require the config from an ESM package', () => {
  const cliConfig = require('../capacitor.config.js');

  assert.equal(cliConfig.appId, 'com.iot.manager.client');
  assert.equal(cliConfig.appName, 'IoT Manager');
  assert.equal(cliConfig.webDir, 'dist');
});
