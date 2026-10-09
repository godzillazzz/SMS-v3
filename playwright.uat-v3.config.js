const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e/uat-v3', testMatch: '**/*.spec.js', workers: 1, fullyParallel: false,
  retries: 0, forbidOnly: Boolean(process.env.CI), timeout: 180000,
  outputDir: 'test-results/uat-v3-readonly', reporter: [['list'], [require.resolve('./e2e/uat-v3/reporter.js')]],
  use: { serviceWorkers: 'block', baseURL: process.env.UAT_BASE_URL, trace: 'off', screenshot: 'off', video: 'off' }
});
