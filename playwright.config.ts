import { defineConfig, devices } from '@playwright/test';

// Runs against a server with seeded demo data. `npm run e2e` starts one on a
// throwaway database; set E2E_BASE_URL to point at an already running server.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node e2e/start-server.mjs',
        url: `${baseURL}/api/health`,
        timeout: 120_000,
        reuseExistingServer: false,
      },
});
