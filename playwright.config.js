const { defineConfig } = require('@playwright/test');

const baseURL = process.env.UAT_BASE_URL || 'https://uat.invalid';
const protectionBypass = process.env.UAT_VERCEL_PROTECTION_BYPASS;

module.exports = defineConfig({
  testDir: './e2e/smoke',
  outputDir: 'test-results/playwright',
  globalSetup: require.resolve('./e2e/global-setup.js'),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/uat-results.json' }],
    [require.resolve('./e2e/uat-reporter.js'), { outputFile: 'test-results/uat-summary.md' }]
  ],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: protectionBypass ? { 'x-vercel-protection-bypass': protectionBypass } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  }
});
