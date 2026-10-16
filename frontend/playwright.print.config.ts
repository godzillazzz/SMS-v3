import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const frontendDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  fullyParallel: true,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/print', open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4179',
    // Browser acceptance fixtures own the API contract. Service workers can
    // satisfy fetches without passing through page.route(), which makes a
    // fixture appear installed while the real app receives an unmocked 401.
    // Blocking them keeps interception deterministic without changing app
    // runtime behaviour outside this test harness.
    serviceWorkers: 'block',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4179 --strictPort',
    cwd: frontendDirectory,
    url: 'http://127.0.0.1:4179/e2e/print/fixture.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
