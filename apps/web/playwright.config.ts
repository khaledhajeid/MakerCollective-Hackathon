import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E against an isolated database (`mc_e2e`) and dedicated ports, so it never touches the dev stack.
 * SMS goes to the demo outbox table; the tests read the code from there (no real SMS, no log scraping).
 */
const WEB_PORT = 5180;
const API_PORT = 3101;
// Playwright re-evaluates this file in every worker. The database is (re)built ONCE, by the main process; workers
// inherit the result through the environment instead of dropping the schema under a running suite.
if (!process.env.E2E_DB_PREPARED) {
  process.env.E2E_DATABASE_URL = execFileSync('node', ['../../scripts/e2e-db.mjs'], {
    encoding: 'utf8',
  }).trim();
  process.env.E2E_DB_PREPARED = '1';
}
const dbUrl = process.env.E2E_DATABASE_URL as string;

const apiEnv = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  LOG_LEVEL: 'warn',
  PUBLIC_ORIGIN: `http://localhost:${WEB_PORT}`,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: randomBytes(32).toString('hex'),
  PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PHONE_HASH_PEPPER: randomBytes(32).toString('hex'),
  SMS_PROVIDER: 'demo-inbox',
  REDIS_URL: '',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'iphone-ar',
      testIgnore: /live\.spec/,
      use: { ...devices['iPhone 14'], browserName: 'chromium', locale: 'ar-JO' },
      metadata: { locale: 'ar' },
    },
    {
      name: 'android-en',
      testIgnore: /live\.spec/,
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 760 }, locale: 'en-GB' },
      metadata: { locale: 'en' },
    },
    {
      // The hall TV: 1080p, Arabic.
      name: 'tv-1080p',
      testMatch: /live\.spec/,
      use: { browserName: 'chromium', viewport: { width: 1920, height: 1080 }, locale: 'ar-JO' },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @mc/api exec tsx --conditions=development src/server.ts',
      cwd: '../..',
      env: apiEnv,
      url: `http://localhost:${API_PORT}/api/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      env: { API_PORT: String(API_PORT) },
      url: `http://localhost:${WEB_PORT}/vote`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
