'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { safeFailureCheck, makeSafeSummary, diagnosticLines } = require('../e2e/uat-v3/reporter');

test('hosted UAT fails fast before login preflight can re-run across restarted workers', () => {
  const config = fs.readFileSync('playwright.uat-v3.config.js', 'utf8');
  assert.doesNotMatch(config, /maxFailures:\s*1/);
  assert.match(config, /workers:\s*1/);
  assert.match(config, /retries:\s*0/);
});

test('browser login has six isolated safe diagnostic steps', () => {
  const source = fs.readFileSync('e2e/uat-v3/readonly.spec.js', 'utf8');
  for (const stage of ['BROWSER_PAGE_READY', 'BROWSER_CREDENTIAL_INPUTS',
    'BROWSER_LOGIN_REQUEST', 'BROWSER_LOGIN_IDENTITY',
    'BROWSER_AUTH_TRANSITION', 'BROWSER_READONLY_GUARD']) {
    assert.match(source, new RegExp("test\\.step\\('" + stage + "'"));
  }
  assert.match(source, /maxRedirects: 0|loginPreflightRequestOptions/);
});

test('each serial role suite settles the serverless connection pool before starting', () => {
  const source = fs.readFileSync('e2e/uat-v3/readonly.spec.js', 'utf8');
  assert.match(source, /test\.describe\.serial\(role, \(\) => \{/);
  assert.match(source, /test\.beforeAll\(async \(\) => \{[\s\S]*?UAT_ROLE_COOLDOWN_MS[\s\S]*?5000[\s\S]*?setTimeout\(resolve, cooldownMs\)/);
});

test('allowlisted failed step is logged with no raw error, URL, credential or locator text', () => {
  const secret = 'synthetic-password-and-token-not-to-print';
  const step = { title: 'BROWSER_PAGE_READY', error: { message: secret } };
  assert.equal(safeFailureCheck([{ title: 'hook', steps: [step] }]), 'BROWSER_PAGE_READY');
  assert.equal(safeFailureCheck([{ title: secret, error: { message: secret } }]), 'UNCLASSIFIED');
  const summary = makeSafeSummary(
    [{ role: 'ADMIN', phase: 'BROWSER_LOGIN', status: 'failed',
      failure_check: safeFailureCheck([step]) }],
    { ADMIN: 'READY' },
    { status: 'failed', source_sha: 'a'.repeat(40), harness_sha: 'b'.repeat(40),
      deployment_id: 'dpl_Fixture' }
  );
  assert.equal(summary.roles.ADMIN.failed_check, 'BROWSER_PAGE_READY');
  const lines = diagnosticLines(summary).join('\n');
  assert.match(lines, /UAT_FAILED_CHECK_ADMIN=BROWSER_PAGE_READY/);
  assert.doesNotMatch(JSON.stringify(summary) + lines, /synthetic-password-and-token-not-to-print/);
  assert.equal(summary.counts.failed, 1);
  assert.notEqual(summary.status, 'passed');
});
