import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PERSON4_TEST_DATABASE = resolve('.person4-e2e.db');

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 30_000, expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3107', timezoneId: 'Asia/Singapore', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3107',
    url: 'http://localhost:3107', reuseExistingServer: false, timeout: 120_000,
    env: { DEMO_MODE: 'false', DATABASE_PATH: process.env.PERSON4_TEST_DATABASE,
      APP_ORIGIN: 'http://localhost:3107', WEBAUTHN_RP_ID: 'localhost',
      JWT_SECRET: 'person4-test-only-secret-not-for-deployment-0000',
      RP_ID: 'localhost', RP_NAME: 'Daybook Test', RP_ORIGIN: 'http://localhost:3107' },
  },
});