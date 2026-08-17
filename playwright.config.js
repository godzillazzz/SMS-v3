const { defineConfig } = require('@playwright/test');
const { getTraceMode } = require('./e2e/helpers/technical-smoke');
const { getUatScopeGrep } = require('./e2e/helpers/uat-config');

const baseURL = process.env.UAT_BASE_URL || 'https://uat.invalid';
const authenticatedMode = process.env.UAT_MODE === 'authenticated';
const reporters = [
  ['line'],
  [require.resolve('./e2e/uat-reporter.js'), {
    outputFile: 'test-results/uat-summary.md',
    jsonOutputFile: 'test-results/uat-results.json',
    mode: authenticatedMode ? 'authenticated' : 'technical'
  }]
];
const uatScopeGrep = getUatScopeGrep();

module.exports = defineConfig({
  testDir: './e2e/smoke',
  outputDir: 'test-results/playwright',
  globalSetup: require.resolve('./e2e/global-setup.js'),
  globalTeardown: require.resolve('./e2e/global-teardown.js'),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: authenticatedMode ? 0 : (process.env.CI ? 1 : 0),
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  ...(uatScopeGrep ? { grep: uatScopeGrep } : {}),
  reporter: reporters,
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: process.env.UAT_MODE === 'authenticated' ? 'off' : getTraceMode(),
    screenshot: 'off',
    video: 'off'
  }
});
