import { defineConfig } from '../../../apps/client-glass-next/node_modules/@playwright/test/index.mjs';
import clientConfig from '../../../apps/client-glass-next/playwright.config.js';
import { fileURLToPath } from 'node:url';
import { requireRuntimePhase } from './phases.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const phase = requireRuntimePhase(process.env.IOT_EIGHT_PHASE);
export default defineConfig({
  ...clientConfig,
  testDir: root,
  testMatch: ['**/apps/client-glass-next/e2e/runtime-auth.spec.js',
    '**/apps/client-glass-next/e2e/runtime-load.spec.js',
    '**/apps/client-glass-next/e2e/rollback-data-compatibility.spec.js',
    '**/scripts/testing/runtime-eight/ai-provider.spec.mjs'],
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: root + '/artifacts/runtime-eight/' + phase + '.json' }]],
  outputDir: root + '/artifacts/runtime-eight/playwright/' + phase,
  use: { ...clientConfig.use, trace: 'off', screenshot: 'off', video: 'off' }
});
