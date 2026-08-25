import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4199', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command:
      'npm run db:migrate:local && npm run build && wrangler dev --local --port 4199 --var ENVIRONMENT:development --var PUBLIC_APP_URL:http://127.0.0.1:4199 --var JUDGE_PROVIDER:mock',
    url: 'http://127.0.0.1:4199/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
