'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'),
  'utf8'
).replace(/\r\n/g, '\n');

const technicalStart = workflow.indexOf('\n  technical-smoke:');
const authenticatedStart = workflow.indexOf('\n  authenticated-uat:');
assert.notEqual(technicalStart, -1);
assert.notEqual(authenticatedStart, -1);
const technical = workflow.slice(technicalStart, authenticatedStart);
const authenticated = workflow.slice(authenticatedStart);

test('workflow exposes only the approved fixed UAT scopes', () => {
  const scopeInput = workflow.slice(workflow.indexOf('      uat_scope:'), workflow.indexOf('\n\npermissions:'));
  assert.match(scopeInput, /type: choice/);
  assert.match(scopeInput, /default: full/);
  assert.match(scopeInput, /- full/);
  assert.match(scopeInput, /- report-center-diagnostic/);
  assert.match(scopeInput, /- admin-rbac-targeted-retry/);
  assert.doesNotMatch(workflow, /grep:\s*\$\{\{\s*inputs\.uat_scope\s*\}\}/);
  assert.doesNotMatch(workflow, /--grep\s+\$\{\{\s*inputs\.uat_scope\s*\}\}/);
});

test('technical job binds the protected Environment and Vercel token without exposing it', () => {
  assert.match(technical, /environment: production-sms-v3-staging/);
  assert.match(technical, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.match(technical, /test -n "\$VERCEL_TOKEN"/);
  assert.doesNotMatch(technical, /echo[^\n]*VERCEL_TOKEN/);
  assert.doesNotMatch(technical, /printf[^\n]*VERCEL_TOKEN/);
});

test('authenticated job retains protected Environment, scope plumbing, and serialization', () => {
  assert.match(authenticated, /environment: production-sms-v3-staging/);
  assert.match(authenticated, /UAT_SCOPE: \$\{\{ inputs\.uat_scope \}\}/);
  assert.match(authenticated, /concurrency:\n      group: sms-v3-staging-authenticated-uat\n      cancel-in-progress: false/);
  assert.match(authenticated, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.match(authenticated, /test -n "\$VERCEL_TOKEN"/);
});

test('exact source, Harness, checkout, and deployment identity guards remain in both jobs', () => {
  assert.equal((workflow.match(/uat-target-contract\.js source-branch/g) || []).length, 2);
  assert.equal((workflow.match(/uat-target-contract\.js source-head/g) || []).length, 2);
  assert.equal((workflow.match(/uat-target-contract\.js harness/g) || []).length, 2);
  assert.equal((workflow.match(/uat-target-contract\.js verify/g) || []).length, 2);
  assert.equal((workflow.match(/test \"\$\(git rev-parse HEAD\)\" = \"\$HARNESS_SHA\"/g) || []).length, 2);
  assert.equal((workflow.match(/test \"\$\(git -C application-under-test rev-parse HEAD\)\" = \"\$SOURCE_SHA\"/g) || []).length, 2);
  assert.equal((workflow.match(/UAT_EXPECTED_DEPLOYMENT_ID: \$\{\{ inputs\.expected_deployment_id \}\}/g) || []).length, 2);
  assert.equal((workflow.match(/VERCEL_REST_V13/g) || []).length, 2);
});

test('workflow passes fixed scope to the checked-out Harness without arbitrary selector input', () => {
  assert.equal((workflow.match(/UAT_SCOPE: \$\{\{ inputs\.uat_scope \}\}/g) || []).length, 4);
  assert.doesNotMatch(workflow, /inputs\.uat_scope[^\n]*(?:shell|command|path|file)/i);
  assert.doesNotMatch(workflow, /secrets\.(?:DATABASE_URL|DIRECT_URL)/);
  assert.doesNotMatch(workflow, /test\/uat-v2-regression-guards/);
});
