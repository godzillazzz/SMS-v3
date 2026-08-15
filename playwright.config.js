const { defineConfig } = require('@playwright/test');
const { getTraceMode } = require('./e2e/helpers/technical-smoke');

const baseURL = process.env.UAT_BASE_URL || 'https://uat.invalid';
const authenticatedMode = process.env.UAT_MODE === 'authenticated';
const targetMode = String(process.env.UAT_TARGET_MODE || '').trim().toLowerCase();
const diagnosticGrep = !authenticatedMode
  ? undefined
  : targetMode === 'canonical'
    ? /V3 (?:ADMIN|MANAGER|VIEWER): login and role identity/
    : /V3 VIEWER: protected page dashboard/;
const reporters = [
  ['line'],
  [require.resolve('./e2e/uat-reporter.js'), {
    outputFile: 'test-results/uat-summary.md',
    jsonOutputFile: 'test-results/uat-results.json',
    mode: authenticatedMode ? 'authenticated' : 'technical'
  }]
];

module.exports = defineConfig({
  testDir: './e2e/smoke',
  outputDir: 'test-results/playwright',
  globalSetup: require.resolve('./e2e/global-setup.js'),
  globalTeardown: require.resolve('./e2e/global-teardown.js'),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  grep: diagnosticGrep,
  retries: authenticatedMode ? 0 : (process.env.CI ? 1 : 0),
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: reporters,
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: process.env.UAT_MODE === 'authenticated' ? 'off' : getTraceMode(),
    screenshot: 'off',
    video: 'off'
  }
});
