'use strict';
// Regression uses the real Playwright CLI and Reporter against a loopback-only
// synthetic API. No UAT credentials, Vercel, Production or remote network calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { safeRunnerFailureReason } = require('../e2e/uat-v3/reporter');

const cli = require.resolve('@playwright/test/cli');
const playwrightModule = require.resolve('@playwright/test');
const reporterModule = require.resolve('../e2e/uat-v3/reporter');
const secret = 'fixture-only-private@example.test session-cookie-token-fixture';

function runSynthetic(mode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-uat-playwright-'));
  try {
    const config = path.join(directory, 'playwright.config.cjs');
    const spec = path.join(directory, 'api-fixture.spec.cjs');
    fs.writeFileSync(config, [
      "const { defineConfig } = require(" + JSON.stringify(playwrightModule) + ");",
      'module.exports = defineConfig({ testDir: ' + JSON.stringify(directory) + ',',
      "testMatch: '**/*.spec.cjs', workers: 1, retries: 0, maxFailures: 1, timeout: 15000,",
      "reporter: [[" + JSON.stringify(reporterModule) + "]] });"
    ].join('\n'));
    fs.writeFileSync(spec, [
      "'use strict';",
      "const { test, request } = require(" + JSON.stringify(playwrightModule) + ");",
      "const http = require('node:http');",
      "const assert = require('node:assert/strict');",
      "const mode = process.env.SYNTHETIC_UAT_MODE;",
      'let server; let baseURL;',
      "test.beforeAll(async () => {",
      "  server = http.createServer((req, res) => {",
      "    const denied = req.url === '/denied';",
      "    res.writeHead(denied ? 401 : 200, { 'content-type': 'application/json' });",
      "    res.end('{}');",
      "  });",
      "  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));",
      "  baseURL = 'http://127.0.0.1:' + server.address().port;",
      "});",
      "test.afterAll(async () => {",
      "  if (server) await new Promise((resolve, reject) =>",
      "    server.close(error => error ? reject(error) : resolve()));",
      "});",
      "if (mode === 'after_hook') test.afterEach(async () => {",
      "  throw new Error(" + JSON.stringify(secret) + ");",
      "});",
      "test('ADMIN: API authorization and expected denial', async () => {",
      "  let context;",
      "  await test.step('API_CONTEXT_CREATE', async () => {",
      "    context = await request.newContext({ baseURL });",
      "  });",
      "  try {",
      "    await test.step('API_DASHBOARD', async () => {",
      "      const response = await context.get('/ok', { maxRedirects: 0 });",
      "      assert.equal(response.status(), 200);",
      "    });",
      "    await test.step('API_DENY_NO_TOKEN', async () => {",
      "      const response = await context.get('/denied', { maxRedirects: 0 });",
      "      assert.equal(response.status(), 401);",
      "    });",
      "    await test.step('API_AUTHORIZATION_COMPLETE', async () => {});",
      "  } finally {",
      "    await test.step('API_CONTEXT_DISPOSE', async () => {",
      "      await context.dispose();",
      "      if (mode === 'dispose') throw new Error('UAT_API_CONTEXT_DISPOSE_FAILED');",
      "    });",
      "  }",
      "});"
    ].join('\n'));
    const result = spawnSync(process.execPath, [cli, 'test', '--config', config], {
      cwd: directory, env: {
        ...process.env, SYNTHETIC_UAT_MODE: mode,
        NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1',
        UAT_SOURCE_SHA: 'a'.repeat(40), GITHUB_SHA: 'b'.repeat(40),
        UAT_EXPECTED_DEPLOYMENT_ID: 'dpl_Synthetic'
      },
      encoding: 'utf8', stdio: 'pipe', timeout: 25000
    });
    assert.equal(result.error, undefined, 'Synthetic runner must finish without OS errors');
    const summaryPath = path.join(directory, 'test-results/uat-v3-safe/results.json');
    assert.ok(fs.existsSync(summaryPath), 'Reporter must emit a safe summary');
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    assert.doesNotMatch(JSON.stringify(summary), /fixture-only-private|session-cookie-token-fixture/);
    return { code: result.status, summary };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('real Playwright request context passes for 200/401 and explicit cleanup', () => {
  const result = runSynthetic('pass');
  assert.equal(result.code, 0);
  assert.equal(result.summary.counts.passed, 1);
  assert.equal(result.summary.counts.failed, 0);
});

test('real Playwright step failure during API teardown retains allowlisted reason', () => {
  const result = runSynthetic('dispose');
  assert.notEqual(result.code, 0);
  assert.equal(result.summary.roles.ADMIN.failed_phase, 'API_AUTHORIZATION');
  assert.equal(result.summary.roles.ADMIN.failed_check, 'API_CONTEXT_DISPOSE');
  assert.equal(result.summary.roles.ADMIN.failed_reason, 'CONTEXT_DISPOSE_FAILED');
});

test('real Playwright afterEach error stays failed with safe runner category', () => {
  const result = runSynthetic('after_hook');
  assert.notEqual(result.code, 0);
  assert.equal(result.summary.roles.ADMIN.failed_phase, 'API_AUTHORIZATION');
  assert.equal(result.summary.roles.ADMIN.failed_check, 'API_OUTSIDE_CHECK');
  assert.equal(result.summary.roles.ADMIN.last_check, 'API_CONTEXT_DISPOSE');
  assert.ok(['AFTER_HOOK_FAILED', 'FIXTURE_OR_RUNNER_FAILED'].includes(
    result.summary.roles.ADMIN.failed_reason));
});

test('structured runner metadata cannot leak raw exception content', () => {
  const error = { message: secret, stack: secret };
  assert.equal(safeRunnerFailureReason({ status: 'timedOut', errors: [error] }), 'TEST_TIMEOUT');
  assert.equal(safeRunnerFailureReason({ status: 'failed', errors: [error] }), 'FIXTURE_OR_RUNNER_FAILED');
  assert.equal(safeRunnerFailureReason({ status: 'failed', steps: [], errors: [] }), 'NO_RECORDED_ERROR');
});
