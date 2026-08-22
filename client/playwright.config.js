import { defineConfig, devices } from '@playwright/test';

const loopbackBaseUrl = 'http://127.0.0.1:5175';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: loopbackBaseUrl,
    reuseExistingServer: !process.env.CI
  },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    baseURL: loopbackBaseUrl
  }
});
