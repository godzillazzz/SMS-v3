'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../e2e/helpers/uat-config');

const SCOPE = 'q13c-business-workflow-targeted';
const TITLES = [
  'Q13C ADMIN: Preview mutation safety guard',
  'Q13C ADMIN: Personnel Master reversible lifecycle',
  'Q13C ADMIN: Employee Change governed approval workflow',
  'Q13C ADMIN: Disposable user access lifecycle',
  'Q13C ADMIN: Security Site reversible configuration workflow',
  'Q13C ADMIN: System Setting reversible standard update'
];

test('Q13C targeted scope is fixed and authenticated-only', () => {
  assert.equal(config.normalizeUatScope(SCOPE), SCOPE);
  assert.deepEqual(config.getUatScopeTestTitles({ UAT_SCOPE: SCOPE }), TITLES);
  const grep = config.getUatScopeGrep({ UAT_MODE: 'authenticated', UAT_SCOPE: SCOPE });
  assert.ok(grep instanceof RegExp);
  for (const title of TITLES) assert.match(title, grep);
  assert.throws(() => config.getUatConfig({ UAT_BASE_URL: 'https://example.test', UAT_MODE: 'technical', UAT_SCOPE: SCOPE }), (error) => error?.code === 'UAT_SCOPE_MODE_INVALID');
});

test('Q13C workflow keeps Preview DB fixture jobs separate from credentialed API write job', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
  assert.match(workflow, /q13c_write_confirmation/);
  assert.match(workflow, /MUTATE_Q13C_PREVIEW_BUSINESS_V1/);
  assert.match(workflow, /q13c-preview-fixture-prep/);
  assert.match(workflow, /q13c-authenticated-write/);
  assert.match(workflow, /q13c-preview-fixture-cleanup/);
  assert.match(workflow, /environment: "Preview .*sms-v3-staging"/);
  assert.match(workflow, /Q13C_HARNESS_BRANCH: test\/automated-uat-v3-authenticated/);
  assert.match(workflow, /UAT_APPLICATION_ROOT: \$\{\{ github\.workspace \}\}\/application-under-test/);
  const writeSection = workflow.split('  q13c-authenticated-write:')[1].split('  q13c-preview-fixture-cleanup:')[0];
  assert.doesNotMatch(writeSection, /DATABASE_URL|DIRECT_URL/);
});

test('Q13C fixture helper has fail-closed identity and exact cleanup markers', () => {
  const helper = fs.readFileSync(path.join(__dirname, '../scripts/admin/q13c-preview-fixture.js'), 'utf8');
  assert.match(helper, /Q13C_PREVIEW_DATABASE_IDENTITY=PROVEN/);
  assert.match(helper, /Q13C_PREVIEW_FIXTURE_CLEANUP=PASS/);
  assert.match(helper, /ZZZ_Q13C_DEPT_V1/);
  assert.match(helper, /ZZZ_Q13C_SITE_V1/);
  assert.match(helper, /LINE_TEMPLATE_NEW_LEAVE/);
  assert.match(helper, /resetDisposableUatEmployee/);
  assert.match(helper, /employeeChangeRequestEvent\.deleteMany/);
  assert.match(helper, /securitySiteQrCredential\.deleteMany/);
});

test('Q13C specialist spec covers all remaining business write contracts', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../e2e/smoke/q13c-business-workflow.spec.js'), 'utf8');
  for (const title of TITLES) assert.match(spec, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(spec, /employee-change-requests/);
  assert.match(spec, /personnel-masters/);
  assert.match(spec, /security-sites/);
  assert.match(spec, /system-settings/);
  assert.match(spec, /SUSPENDED/);
  assert.match(spec, /APPROVED/);
});