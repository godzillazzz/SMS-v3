const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e/uat-v3-fixtures', workers: 1, retries: 0, timeout: 30000,
  reporter: [['list']], outputDir: 'test-results/uat-v3-local-fixture',
  use: { serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' }
});
