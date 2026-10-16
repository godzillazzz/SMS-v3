'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { API_CHECKS, apiCheckName, assertApiHttpStatus } = require('../e2e/uat-v3/api-diagnostics');
const { safeFailureCheck, safeApiFailureReason, safeFailureReason, browserFailure, makeSafeSummary, diagnosticLines } = require('../e2e/uat-v3/reporter');
const { getRoleApiMatrix } = require('../e2e/uat-v3/role-matrix');

test('only reviewed API contract checks can enter the report', () => {
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']) {
    for (const route of getRoleApiMatrix(role)) {
      assert.ok(API_CHECKS.includes(apiCheckName(route.label)));
      assert.match(apiCheckName(route.label), /^API_[A-Z0-9_]+$/);
    }
  }
  assert.throws(() => apiCheckName('raw-token-secret-from-request-body'), /UAT_API_CHECK_UNALLOWLISTED/);
  assert.ok(API_CHECKS.includes('API_DENY_NO_TOKEN'));
  assert.ok(API_CHECKS.includes('API_DENY_INVALID_TOKEN'));
});

test('API suite still checks every protected status and both negative auth boundaries', () => {
  const source = fs.readFileSync('e2e/uat-v3/readonly.spec.js', 'utf8');
  assert.match(source, /test\.step\(apiCheckName\(route\.label\)/);
  assert.match(source, /assertApiHttpStatus\(response\.status\(\), route\.expectedStatus\)/);
  assert.match(source, /assertApiHttpStatus\(response\.status\(\), 401\)/);
  assert.match(source, /API_DENY_NO_TOKEN/);
  assert.match(source, /API_DENY_INVALID_TOKEN/);
  const runner = fs.readFileSync('playwright.uat-v3.config.js', 'utf8');
  assert.match(runner, /maxFailures:\s*1/);
  assert.match(runner, /retries:\s*0/);
});

test('HTTP mismatches and request failures provide only fixed categories', () => {
  assert.doesNotThrow(() => assertApiHttpStatus(200, 200));
  assert.throws(() => assertApiHttpStatus(403, 200), { message: 'UAT_API_HTTP_MISMATCH_EXPECTED_200_ACTUAL_403' });
  assert.throws(() => assertApiHttpStatus(-1, 200), { message: 'UAT_API_STATUS_UNVERIFIED' });

  const secret = 'private-password@example.invalid raw-SECRET-or-token';
  const mismatch = { title: 'API_APPROVAL_CENTER', error: {
    message: 'UAT_API_HTTP_MISMATCH_EXPECTED_200_ACTUAL_403\n' + secret
  }};
  const bad = { title: 'API_THIS_CHECK_DOES_NOT_EXIST', error: { message: secret } };
  assert.equal(safeFailureCheck([{ title: 'outer', steps: [mismatch] }]), 'API_APPROVAL_CENTER');
  assert.equal(safeApiFailureReason([mismatch]), 'HTTP_403_EXPECTED_200');
  assert.equal(safeFailureCheck([bad]), 'UNCLASSIFIED');
  assert.equal(safeApiFailureReason([bad]), 'UNCLASSIFIED');
  assert.equal(safeApiFailureReason([{ title: 'API_USERS', error: { message: secret } }]), 'UNCLASSIFIED');
  assert.equal(safeApiFailureReason([{ title: 'API_USERS', error: { message: 'UAT_API_REQUEST_FAILED' } }]), 'REQUEST_FAILED');

  const summary = makeSafeSummary([{ role: 'ADMIN', phase: 'API_AUTHORIZATION', status: 'failed',
    failure_check: safeFailureCheck([mismatch]), failure_reason: safeApiFailureReason([mismatch]) }],
  { ADMIN: 'READY' }, { status: 'failed', source_sha: 'a'.repeat(40),
    harness_sha: 'b'.repeat(40), deployment_id: 'dpl_Synthetic' });
  assert.equal(summary.roles.ADMIN.failed_check, 'API_APPROVAL_CENTER');
  assert.equal(summary.roles.ADMIN.failed_reason, 'HTTP_403_EXPECTED_200');
  const log = diagnosticLines(summary).join('\n');
  assert.match(log, /UAT_FAILED_CHECK_ADMIN=API_APPROVAL_CENTER/);
  assert.match(log, /UAT_FAILED_REASON_ADMIN=HTTP_403_EXPECTED_200/);
  assert.doesNotMatch(JSON.stringify(summary) + log, /private-password|example\.invalid|raw-SECRET/);
  assert.equal(summary.status, 'failed');
});

test('untrusted failure inputs never become a leaked identifier or reason', () => {
  const secret = 'this-is-a-raw-session-cookie-value@example.test';
  const summary = makeSafeSummary([{ role: 'ADMIN', phase: 'API_AUTHORIZATION', status: 'failed',
    failure_check: secret, failure_reason: secret }], { ADMIN: 'READY' }, { status: 'failed' });
  const s = JSON.stringify(summary) + diagnosticLines(summary).join('\n');
  assert.doesNotMatch(s, /raw-session|cookie-value|example\.test/);
  assert.equal(summary.roles.ADMIN.failed_check, 'UNCLASSIFIED');
  assert.equal(summary.roles.ADMIN.failed_reason, 'UNCLASSIFIED');
});

test('browser login identity diagnostics classify safe reasons and retry-after', () => {
  assert.equal(safeFailureReason('LOGIN_HTTP_429'), 'LOGIN_HTTP_429');
  assert.equal(safeFailureReason('LOGIN_HTTP_503'), 'LOGIN_HTTP_503');
  assert.equal(safeFailureReason('LOGIN_ROLE_MISMATCH'), 'LOGIN_ROLE_MISMATCH');
  assert.equal(safeFailureReason('LOGIN_ID_MISMATCH'), 'LOGIN_ID_MISMATCH');
  assert.equal(safeFailureReason('LOGIN_BODY_UNREADABLE'), 'LOGIN_BODY_UNREADABLE');
  assert.equal(safeFailureReason('LOGIN_HTTP_600'), 'UNCLASSIFIED');
  assert.deepEqual(browserFailure([{ title: 'BROWSER_LOGIN_IDENTITY', error: { message: 'Error: UAT_LOGIN_HTTP_429_RETRY_AFTER_17\nsecret@example.test' } }]), { reason: 'LOGIN_HTTP_429', retry_after: 17 });
  assert.deepEqual(browserFailure([{ title: 'BROWSER_LOGIN_IDENTITY', error: { message: 'UAT_LOGIN_ID_MISMATCH' } }]), { reason: 'LOGIN_ID_MISMATCH' });
  const summary = makeSafeSummary([
    { role: 'MANAGER', phase: 'BROWSER_LOGIN', status: 'failed', failure_check: 'BROWSER_LOGIN_IDENTITY', failure_reason: 'LOGIN_HTTP_429', retry_after: 17 },
    { role: 'ADMIN', phase: 'BROWSER_LOGIN', status: 'failed', failure_check: 'BROWSER_LOGIN_IDENTITY', failure_reason: 'LOGIN_ROLE_MISMATCH' }
  ], { MANAGER: 'READY', ADMIN: 'READY' }, { status: 'failed', login_attempts_total: 8 });
  const lines = diagnosticLines(summary).join('\n');
  assert.match(lines, /UAT_FAILED_REASON_MANAGER=LOGIN_HTTP_429/);
  assert.match(lines, /UAT_LOGIN_RETRY_AFTER_MANAGER=17/);
  assert.match(lines, /UAT_FAILED_REASON_ADMIN=LOGIN_ROLE_MISMATCH/);
  assert.match(lines, /UAT_LOGIN_ATTEMPTS_TOTAL=8/);
  assert.doesNotMatch(lines, /payload|token|email|synthetic/);
});
