import {fileURLToPath} from 'node:url';
import base from '../../apps/client-glass-next/playwright.config.js';

export default {
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'weather-review.spec.mjs',
  workers: 1,
  reporter: [['list'], ['json', {outputFile: fileURLToPath(new URL('weather-browser-review.json', import.meta.url))}]],
  outputDir: fileURLToPath(new URL('browser-results', import.meta.url)),
  webServer: {...base.webServer, cwd: fileURLToPath(new URL('../../apps/client-glass-next/', import.meta.url))}
};
