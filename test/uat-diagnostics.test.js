'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightAccounts } = require('../e2e/uat-v3/auth');
const { makeSafeSummary, diagnosticLines, safePreflight, safeStage } = require('../e2e/uat-v3/reporter');
const { roles } = require('../e2e/uat-v3/config');

function configured() {
  return { accounts: Object.fromEntries(roles.map((role) =>
    [role, { email: role.toLowerCase() + '@example.test', password: 'synthetic-only' }])) };
}
function session(role) {
  return { user: { role, id: 'synthetic-' + role }, accessToken: 'synthetic-' + role + '-session' };
}
test('preflight reports a fixed role and HTTP code, never raw login response or credentials', async () => {
  const status = [];
  let current = 0;
  const createContext = async () => {
    const role = roles[current++];
    return { post: async () => ({ status: () => role === 'MANAGER' ? 401 : 200,
      json: async () => session(role) }), dispose: async () => {} };
  };
  await assert.rejects(() => preflightAccounts(createContext, configured(), (entry) => status.push(entry)),
    { code: 'UAT_ACCOUNT_PREFLIGHT_FAILED' });
  assert.deepEqual(status, [{ role: 'ADMIN', code: 'READY' }, { role: 'MANAGER', code: 'HTTP_401' }]);
  const log = JSON.stringify(status);
  assert.ok(!log.includes('example.test'));
  assert.ok(!log.includes('synthetic-ADMIN-session'));
});
test('preflight collapses untrusted exceptions to REQUEST_ERROR without leaking strings', async () => {
  const status = [];
  await assert.rejects(() => preflightAccounts(async () => ({
    post: async () => { throw new Error('secret@example.test raw_token_12345'); },
    dispose: async () => {}
  }), configured(), (entry) => status.push(entry)), { code: 'UAT_ACCOUNT_PREFLIGHT_FAILED' });
  assert.deepEqual(status, [{ role: 'ADMIN', code: 'REQUEST_ERROR' }]);
});
test('preflight reports all four existing accounts when successful', async () => {
  const entries = [];
  let index = 0;
  const s = await preflightAccounts(async () => {
    const role = roles[index++];
    return { post: async () => ({ status: () => 200, json: async () => session(role) }),
      dispose: async () => {} };
  }, configured(), (entry) => entries.push(entry));
  assert.equal(s.summary().length, 4);
  assert.deepEqual(entries, roles.map((role) => ({ role, code: 'READY' })));
  s.clear();
});
test('diagnostic summary classifies preflight and test phases using only allowlisted values', () => {
  const source = { status: 'failed', source_sha: 'a'.repeat(40),
    harness_sha: 'b'.repeat(40), deployment_id: 'dpl_Synthetic' };
  const input = [
    { role: 'ADMIN', phase: 'BROWSER_LOGIN', status: 'passed' },
    { role: 'MANAGER', phase: 'API_AUTHORIZATION', status: 'failed' },
    { role: 'SUPERVISOR', phase: 'NAVIGATION', status: 'skipped' },
    { role: 'VIEWER', phase: 'BROWSER_LOGIN', status: 'skipped' }
  ];
  const summary = makeSafeSummary(input, {
    ADMIN: 'READY', MANAGER: 'READY', SUPERVISOR: 'HTTP_401', VIEWER: 'NOT_RUN'
  }, source);
  assert.equal(summary.roles.MANAGER.state, 'FAILED_TEST');
  assert.equal(summary.roles.MANAGER.failed_phase, 'API_AUTHORIZATION');
  assert.equal(summary.roles.SUPERVISOR.state, 'BLOCKED_PREFLIGHT');
  assert.equal(summary.roles.VIEWER.preflight, 'NOT_RUN');
  const lines = diagnosticLines(summary).join('\n');
  assert.match(lines, /UAT_PREFLIGHT_SUPERVISOR=HTTP_401/);
  assert.match(lines, /UAT_ROLE_MANAGER=FAILED_TEST/);
  assert.match(lines, /UAT_FAILED_PHASE_MANAGER=API_AUTHORIZATION/);
  assert.doesNotMatch(lines, /raw_token|example\.test/);
});
test('unsafe diagnostic fields never reach logs or summaries', () => {
  const sensitive = 'person@example.test secret_password_token_123';
  const summary = makeSafeSummary(
    [{ role: 'ADMIN', phase: sensitive, status: sensitive }, { role: sensitive,
      phase: sensitive, status: sensitive }],
    { ADMIN: sensitive, MANAGER: sensitive }, { status: 'failed' });
  const lines = diagnosticLines(summary).join('\n');
  assert.doesNotMatch(lines, /person|example\.test|secret_password_token/);
  assert.equal(summary.roles.ADMIN.preflight, 'REQUEST_ERROR');
  assert.equal(summary.tests[0].phase, 'UNKNOWN');
  assert.equal(summary.tests[1].role, 'UNKNOWN');
  assert.equal(safePreflight('HTTP_401'), 'HTTP_401');
  assert.equal(safePreflight('HTTP_999'), 'REQUEST_ERROR');
  assert.equal(safeStage('ADMIN: real browser login and exact identity'), 'BROWSER_LOGIN');
  assert.equal(safeStage(sensitive), 'UNKNOWN');
});
