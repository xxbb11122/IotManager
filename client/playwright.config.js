import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: { command: 'npm run dev', port: 5175, reuseExistingServer: true },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    baseURL: 'http://127.0.0.1:5175'
  }
});
