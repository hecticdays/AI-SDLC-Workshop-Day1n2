import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 3001',
    url: 'http://localhost:3001/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_PATH: 'data/e2e.db',
      SESSION_SECRET: 'playwright-test-session-secret-32-chars-minimum',
      RP_ID: 'localhost',
      RP_ORIGIN: 'http://localhost:3001',
    },
  },
});