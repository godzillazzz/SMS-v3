'use strict';
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'r5b-ephemeral-browser.spec.cjs',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: '/tmp/r5b-browser-private-artifacts',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    viewport: {width: 1440, height: 900},
    trace: 'off', screenshot: 'off', video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 30_000
  }
});
