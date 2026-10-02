import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  timeout: 20000, expect: { timeout: 6000 },
  use: { baseURL: 'http://127.0.0.1:5188', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'verification/e2e-results.json' }], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5188', reuseExistingServer: !process.env.CI, timeout: 20000 }
});
