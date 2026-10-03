import { defineConfig, devices } from '@playwright/test';

const loopbackBaseUrl = 'http://127.0.0.1:5190';
const runtimeBaseUrl = String(process.env.IOT_RUNTIME_BASE_URL ?? '').trim();

export default defineConfig({
  testDir: './e2e',
  workers: 2,
  reporter: [['list'], ['json', { outputFile: 'verification/e2e-results.json' }]],
  outputDir: process.env.IOT_PLAYWRIGHT_OUTPUT_DIR || './test-results',
  webServer: runtimeBaseUrl ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1',
    url: loopbackBaseUrl,
    reuseExistingServer: !process.env.CI,
    // Local .env files may hold a real OIDC public client. Browser tests use
    // isolated fixtures, so never let a developer's identity provider gate
    // their intercepted API requests or send sign-in traffic during E2E.
    env: {
      // Prevent a developer's LAN or cloud endpoint from receiving requests.
      IOT_DEV_API_TARGET: 'http://127.0.0.1:9',
      IOT_DEV_CA_FILE: '',
      VITE_API_BASE_URL: '/api/v1',
      VITE_WS_URL: 'ws://127.0.0.1:5190/ws/devices',
      VITE_OIDC_ISSUER_URL: '',
      VITE_OIDC_CLIENT_ID: '',
      VITE_OIDC_REDIRECT_URI: '',
      VITE_OIDC_SCOPE: ''
    }
  },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    baseURL: runtimeBaseUrl || loopbackBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
