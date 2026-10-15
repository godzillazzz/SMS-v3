'use strict';
const { spawnSync } = require('node:child_process');
try {
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.uat-v3.config.js', '--list', '--reporter=json'], { encoding: 'utf8', env: { ...process.env } });
  if (result.status !== 0 || result.error) throw new Error();
  const specs = [];
  function visit(suite) { specs.push(...(suite.specs || [])); for (const child of suite.suites || []) visit(child); }
  for (const suite of JSON.parse(result.stdout).suites) visit(suite);
  if (specs.length !== 24 || specs.some(spec => spec.tests.length !== 1 || spec.tests[0].expectedStatus !== 'passed')) throw new Error();
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']) if (specs.filter(spec => spec.title.startsWith(role + ':')).length !== 6) throw new Error();
  console.log('UAT_COLLECTION=24_TESTS_0_SKIPPED');
} catch { console.error('UAT_COLLECTION_FAILED'); process.exitCode = 1; }
