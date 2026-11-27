import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /tier1-admin-web-harness\.spec\.ts/,
  timeout: 60_000,
  use: {
    baseURL: process.env.ADMIN_WEB_BASE_URL || 'http://localhost:5173',
    headless: true,
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-tier1' }]],
});
