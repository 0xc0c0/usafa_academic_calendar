import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'npm run build && npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --compatibility-date 2026-07-01',
    url: 'http://127.0.0.1:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
