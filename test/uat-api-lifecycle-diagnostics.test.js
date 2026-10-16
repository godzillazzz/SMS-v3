'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const SafeReporter = require('../e2e/uat-v3/reporter');
const { safeApiFailureReason, safeFailureCheck, safeLastCheck, makeSafeSummary, diagnosticLines } = SafeReporter;
const { API_CHECKS } = require('../e2e/uat-v3/api-diagnostics');

test('API context creation and teardown have fixed bounded check names', () => {
  const s = fs.readFileSync('e2e/uat-v3/readonly.spec.js', 'utf8');
  for (const label of ['API_CONTEXT_CREATE', 'API_CONTEXT_DISPOSE', 'API_AUTHORIZATION_COMPLETE']) {
    assert.ok(API_CHECKS.includes(label));
    assert.ok(s.includes("test.step('" + label + "'"));
  }
  assert.ok(s.includes("await context.dispose()"));
  assert.ok(s.includes("getRoleApiMatrix(role)"));
  assert.ok(s.includes("API_DENY_INVALID_TOKEN"));
  assert.doesNotMatch(fs.readFileSync('playwright.uat-v3.config.js', 'utf8'), /maxFailures:\s*1/);
});

test('context disposal failures report only a safe fixed category', () => {
  const secret = 'password@example.test-and-secret-token';
  const steps = [
    { title:'API_DENY_INVALID_TOKEN', duration:2 },
    { title:'API_AUTHORIZATION_COMPLETE', duration:0 },
    { title:'API_CONTEXT_DISPOSE', error:{message:'Error: UAT_API_CONTEXT_DISPOSE_FAILED\n' + secret} }
  ];
  assert.equal(safeFailureCheck(steps), 'API_CONTEXT_DISPOSE');
  assert.equal(safeApiFailureReason(steps), 'CONTEXT_DISPOSE_FAILED');
  assert.equal(safeLastCheck(steps), 'API_CONTEXT_DISPOSE');
  const reporter = new SafeReporter();
  reporter.onTestEnd({title:'ADMIN: API authorization and expected denial'}, {status:'failed',steps});
  const summary = makeSafeSummary(reporter.results,{ ADMIN:'READY' },{status:'failed'});
  const lines = diagnosticLines(summary).join('\n');
  assert.match(lines,/UAT_FAILED_CHECK_ADMIN=API_CONTEXT_DISPOSE/);
  assert.match(lines,/UAT_FAILED_REASON_ADMIN=CONTEXT_DISPOSE_FAILED/);
  assert.match(lines,/UAT_LAST_CHECK_ADMIN=API_CONTEXT_DISPOSE/);
  assert.doesNotMatch(JSON.stringify(summary) + lines,/password@example\.test|secret-token/);
  assert.equal(summary.status,'failed');
});

test('context construction failure remains fail closed and sanitized', () => {
  const steps=[{title:'API_CONTEXT_CREATE',error:{message:'UAT_API_CONTEXT_CREATE_FAILED'}}];
  assert.equal(safeApiFailureReason(steps),'CONTEXT_CREATE_FAILED');
  const reporter=new SafeReporter();
  reporter.onTestEnd({title:'VIEWER: API authorization and expected denial'}, {status:'failed',steps});
  const summary=makeSafeSummary(reporter.results,{VIEWER:'READY'},{status:'failed'});
  assert.equal(summary.roles.VIEWER.failed_check,'API_CONTEXT_CREATE');
  assert.equal(summary.roles.VIEWER.failed_reason,'CONTEXT_CREATE_FAILED');
});

test('unknown top-level failure is classified without reading or serializing raw errors', () => {
  const secret='top-level-secret:user@example.test';
  const reporter=new SafeReporter();
  const steps=[{title:'API_DENY_INVALID_TOKEN',duration:5}, {title:'API_AUTHORIZATION_COMPLETE',duration:0}];
  reporter.onTestEnd({title:'ADMIN: API authorization and expected denial'},{
    status:'failed',steps,error:{message:secret,stack:secret}
  });
  const summary=makeSafeSummary(reporter.results,{ADMIN:'READY'}, {status:'failed'});
  assert.equal(summary.roles.ADMIN.failed_check,'API_OUTSIDE_CHECK');
  assert.equal(summary.roles.ADMIN.failed_reason,'OUTSIDE_CHECK');
  assert.equal(summary.roles.ADMIN.last_check,'API_AUTHORIZATION_COMPLETE');
  const diag=diagnosticLines(summary).join('\n');
  assert.match(diag,/UAT_FAILED_CHECK_ADMIN=API_OUTSIDE_CHECK/);
  assert.match(diag,/UAT_LAST_CHECK_ADMIN=API_AUTHORIZATION_COMPLETE/);
  assert.doesNotMatch(JSON.stringify(summary)+diag,/top-level-secret|user@example\.test/);
  assert.notEqual(summary.status,'passed');
});

test('untrusted check identifiers and reasons are never serialized', () => {
  const dirty='Bearer synthetic-secret@domain.invalid';
  const summary=makeSafeSummary([{role:'ADMIN',phase:'API_AUTHORIZATION',status:'failed',
    failure_check:dirty, failure_reason:dirty,last_check:dirty}], { ADMIN:'READY' }, { status:'failed' });
  assert.equal(summary.roles.ADMIN.failed_check,'UNCLASSIFIED');
  assert.equal(summary.roles.ADMIN.last_check,'NONE');
  assert.equal(summary.roles.ADMIN.failed_reason,'UNCLASSIFIED');
  assert.doesNotMatch(JSON.stringify(summary)+diagnosticLines(summary).join('\n'),/synthetic-secret|domain\.invalid/);
});
