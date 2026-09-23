'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../e2e/helpers/uat-config');

const SCOPE = 'q13b-specialist-write-targeted';
const TITLES = [
  'Q13B ADMIN: Preview mutation safety guard',
  'Q13B ADMIN: Leave Pending reversible decision workflow',
  'Q13B ADMIN: Auto Schedule Pattern create update and cleanup',
  'Q13B ADMIN: Approval Authority policy update and exact restore',
  'Q13B ADMIN: Access self-mutation denial contract'
];

test('Q13B targeted scope is fixed and authenticated-only', () => {
  assert.equal(config.normalizeUatScope(SCOPE), SCOPE);
  assert.deepEqual(config.getUatScopeTestTitles({ UAT_SCOPE: SCOPE }), TITLES);
  const grep = config.getUatScopeGrep({ UAT_MODE: 'authenticated', UAT_SCOPE: SCOPE });
  assert.ok(grep instanceof RegExp);
  for (const title of TITLES) assert.match(title, grep);
  assert.throws(
    () => config.getUatConfig({ UAT_BASE_URL: 'https://example.test', UAT_MODE: 'technical', UAT_SCOPE: SCOPE }),
    (error) => error?.code === 'UAT_SCOPE_MODE_INVALID'
  );
});

test('Q13B existing UAT workflow separates Preview DB fixture jobs from credentialed API job', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
  assert.match(workflow, /q13b_write_confirmation/);
  assert.match(workflow, /MUTATE_Q13B_PREVIEW_SPECIALIST_V1/);
  assert.match(workflow, /environment: "Preview .*sms-v3-staging"/);
  assert.match(workflow, /production-sms-v3-staging/);
  assert.match(workflow, /APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT/);
  assert.match(workflow, /APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT/);
  assert.match(workflow, /q13b-preview-fixture-cleanup/);
  assert.match(workflow, /Q13B_HARNESS_BRANCH: test\/automated-uat-v3-authenticated/);
  assert.match(workflow, /Diagnose Q13-B Preview fixture prerequisites/);
  assert.match(workflow, /Capture reversible Preview baseline before mutation/);
  assert.match(workflow, /baseline_ready: \$\{\{ steps\.baseline\.outputs\.ready \}\}/);
  assert.match(workflow, /needs\.q13b-preview-fixture-prep\.outputs\.baseline_ready == 'true'/);
  assert.match(workflow, /path: application-under-test/);
  assert.match(workflow, /npm --prefix application-under-test run prisma:generate/);
  assert.match(workflow, /UAT_APPLICATION_ROOT: \$\{\{ github\.workspace \}\}\/application-under-test/);
  const writeSection = workflow.split('  q13b-authenticated-write:')[1].split('  q13b-preview-fixture-cleanup:')[0];
  assert.doesNotMatch(writeSection, /DATABASE_URL|DIRECT_URL/);
});

test('Q13B fixture helper fail-closes on Preview DB identity and has explicit cleanup', () => {
  const helper = fs.readFileSync(path.join(__dirname, '../scripts/admin/q13b-preview-fixture.js'), 'utf8');
  assert.match(helper, /Q13B_PREVIEW_DATABASE_IDENTITY=PROVEN/);
  assert.match(helper, /Preview and Production target fingerprints must be distinct/);
  assert.match(helper, /Q13B-UAT/);
  assert.match(helper, /ZZZ_Q13B_UAT_PATTERN_V1/);
  assert.match(helper, /resetDisposableUatEmployee/);
  assert.match(helper, /cleanup/);
  assert.match(helper, /Q13B_PREVIEW_BASELINE_CAPTURED=PASS/);
  assert.match(helper, /fixtureInitiallyPresent/);
  assert.match(helper, /safeDiagnosticCode/);
  assert.match(helper, /command === 'snapshot'/);
  assert.match(helper, /Q13B_APPLICATION_ROOT_REQUIRED/);
  assert.match(helper, /Q13B_APPLICATION_PRISMA_CLIENT_UNAVAILABLE/);
  assert.match(helper, /node_modules.*@prisma.*client/);
});

test('Q13B specialist spec fail-closes before mutations and proves terminal cleanup states', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../e2e/smoke/q13b-specialist-write.spec.js'), 'utf8');
  assert.match(spec, /UAT_TARGET_MODE/);
  assert.match(spec, /MUTATE_Q13B_PREVIEW_SPECIALIST_V1/);
  assert.match(spec, /\/api\/v1\/ready/);
  assert.match(spec, /database/);
  assert.match(spec, /ZZZ_Q13B_UAT_PATTERN_V1/);
  assert.match(spec, /RETURNED_FOR_CORRECTION/);
  assert.match(spec, /CANCELLED/);
  assert.match(spec, /SELF_ACCESS_MUTATION_FORBIDDEN/);
});
