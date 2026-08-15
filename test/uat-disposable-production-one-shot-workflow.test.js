'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflowPath = path.resolve('.github/workflows/automated-uat-sms-v3-staging.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const authenticatedStart = workflow.indexOf('\n  authenticated-uat:');
assert.notEqual(authenticatedStart, -1, 'authenticated-uat job must exist');
const authenticated = workflow.slice(authenticatedStart);
const jobsStart = workflow.indexOf('\\njobs:');
const technical = workflow.slice(jobsStart, authenticatedStart);
const disposableStepStart = authenticated.indexOf('\n      - name: Run exact disposable employee lifecycle once');
assert.notEqual(disposableStepStart, -1, 'disposable step must exist');
const disposable = authenticated.slice(disposableStepStart);

const EXACT = {
  target: 'https://sms-v3-staging-ten.vercel.app',
  sourceBranch: 'feat/request-id-visibility-v1',
  sourceSha: 'dd78e635146ca452b620216973069be9d1e6e3ea',
  harnessSha: '22dc92c1abf9159b272837637f6986f3b6267d9e',
  deploymentId: 'dpl_C9HC6M3Rp2mHb6CAmUCmuMhmCCup',
  confirmation: 'MUTATE_SMS_V3_DISPOSABLE_UAT_EMPLOYEE_V1'
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('normal technical/authenticated modes cannot execute the disposable step', () => {
  assert.doesNotMatch(technical, /disposable-approved-v1/);
  assert.match(authenticated, /inputs\.uat_mode == 'authenticated' \|\| inputs\.uat_mode == 'disposable-approved-v1'/);
  assert.match(disposable, /if: \$\{\{ inputs\.uat_mode == 'disposable-approved-v1' \}\}/);
  assert.match(authenticated, /Run authenticated UAT V3\n        if: \$\{\{ inputs\.uat_mode == 'authenticated' \}\}/);
});

test('disposable-approved-v1 is the only temporary mutation mode and exact confirmation is required', () => {
  assert.equal((workflow.match(/- disposable-approved-v1/g) || []).length, 1);
  assert.match(workflow, /fixture_confirmation:/);
  assert.match(authenticated, /inputs\.fixture_confirmation/);
  assert.match(authenticated, new RegExp(EXACT.confirmation));
  assert.match(authenticated, /UAT_EMPLOYEE_CONFIRMATION_REQUIRED/);
});

test('one-shot lane is bound to exact target, deployment, application, source branch and harness identities', () => {
  for (const value of Object.values(EXACT)) assert.match(authenticated, new RegExp(escapeRegExp(value)));
  assert.match(authenticated, /UAT_DISPOSABLE_RELEASE_IDENTITY_MISMATCH/);
  assert.match(authenticated, /uat-target-contract\.js verify canonical/);
  assert.match(authenticated, /withGitRepoInfo=true/);
  assert.match(authenticated, /normalizeDeploymentIdentity/);
  assert.match(authenticated, /raw\?\.meta\?\.gitCommitSha/);
  assert.match(authenticated, /raw\.meta\.gitCommitRef/);
  assert.match(authenticated, /UAT_DISPOSABLE_RAW_DEPLOYMENT_IDENTITY_MISMATCH/);
  assert.match(authenticated, /raw\?\.id !== approvedDeploymentId/);
  assert.match(authenticated, /url: approvedCanonicalHost/);
  assert.doesNotMatch(authenticated, /npx --yes vercel@latest api/);
  assert.match(authenticated, /prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s/);
  assert.match(authenticated, /sms-v3-staging/);
});

test('production Environment and existing serialized concurrency protect the temporary path', () => {
  assert.match(authenticated, /environment: production-sms-v3-staging/);
  assert.match(authenticated, /group: sms-v3-staging-authenticated-uat/);
  assert.match(authenticated, /cancel-in-progress: false/);
});

test('production DB secret is protected and manager/viewer secrets are not exposed to the disposable step', () => {
  assert.match(authenticated, /PROTECTED_FIXTURE_DB_URL: \$\{\{ secrets\['DATABASE_URL'\] \}\}/);
  assert.match(disposable, /UAT_ADMIN_EMAIL: \$\{\{ secrets\.UAT_ADMIN_EMAIL \}\}/);
  assert.match(disposable, /UAT_ADMIN_PASSWORD: \$\{\{ secrets\.UAT_ADMIN_PASSWORD \}\}/);
  assert.doesNotMatch(disposable, /secrets\.UAT_MANAGER_/);
  assert.doesNotMatch(disposable, /secrets\.UAT_VIEWER_/);
  assert.doesNotMatch(authenticated, /vercel env add|gh secret set|printenv|env \|/i);
  assert.match(disposable, /core\.setSecret\(secret\)/);
});

test('schema equality precedes protected shared DB context validation', () => {
  const schemaIndex = authenticated.indexOf('cmp -s prisma/schema.prisma application-under-test/prisma/schema.prisma');
  const contextIndex = authenticated.indexOf('Validate protected disposable fixture execution context');
  assert.ok(schemaIndex >= 0);
  assert.ok(contextIndex > schemaIndex);
  assert.match(authenticated, /UAT_FIXTURE_SCHEMA_MISMATCH/);
});

test('fixture environment names are assembled only inside the disposable execution path', () => {
  assert.match(disposable, /\['UAT_' \+ 'DISPOSABLE_EMPLOYEE_ENABLED'\]: 'true'/);
  assert.match(disposable, /\['UAT_' \+ 'DISPOSABLE_EMPLOYEE_MODE'\]: 'shared-approved'/);
  assert.match(disposable, /\['UAT_' \+ 'DISPOSABLE_EMPLOYEE_CONFIRM'\]: 'MUTATE_SMS_V3_DISPOSABLE_UAT_EMPLOYEE_V1'/);
  assert.doesNotMatch(workflow, /UAT_DISPOSABLE_EMPLOYEE_ENABLED/);
  assert.doesNotMatch(workflow, /UAT_DISPOSABLE_EMPLOYEE_CONFIRM/);
});

test('only the disposable employee spec runs with workers=1 and retries=0 and no benchmark/full suite', () => {
  assert.match(disposable, /'playwright', 'test', 'e2e\/smoke\/disposable-employee\.spec\.js'/);
  assert.match(disposable, /--workers=1/);
  assert.match(disposable, /--retries=0/);
  assert.match(disposable, /globalSetup: undefined/);
  assert.match(disposable, /globalTeardown: undefined/);
  assert.doesNotMatch(disposable, /npm', \['run', 'test:uat'/);
  assert.doesNotMatch(disposable, /performance-validation\.spec\.js|matched benchmark/i);
});

test('workflow has no arbitrary employee identifier input', () => {
  const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
  assert.doesNotMatch(inputs, /employee(_id|Id|Code)?\s*:/);
  assert.doesNotMatch(inputs, /legacy_employee/i);
});

test('baseline restoration, single recovery reset and exact post-reset count contract are mandatory', () => {
  assert.match(disposable, /runHelper\('assert'\)/);
  assert.equal((disposable.match(/runHelper\('reset'\)/g) || []).length, 1);
  assert.match(disposable, /FIXTURE_RECOVERY_REQUIRED/);
  assert.match(disposable, /UAT_FIXTURE_POST_RESET_COUNT_MISMATCH/);
  for (const needle of [
    'counts.employee !== 1', 'counts.user !== 1', 'counts.marker !== 1',
    'counts.lifecycleEvents !== 0', 'counts.lifecycleAudit !== 0',
    'counts.refreshSessions !== 0', 'counts.otp !== 0', 'counts.leave !== 0',
    'counts.quota !== 0', 'counts.shift !== 0', 'counts.license !== 0',
    'counts.licenseDocuments !== 0'
  ]) assert.match(disposable, new RegExp(escapeRegExp(needle)));
});

test('artifact scanner runs and raw secret material is not written to artifacts', () => {
  assert.match(disposable, /scanArtifact/);
  assert.match(disposable, /uat-v3-artifact-summary\.json/);
  assert.match(disposable, /artifactLeakCount/);
  assert.doesNotMatch(disposable, /fs\.writeFileSync\([^\n]*(DATABASE_URL|UAT_ADMIN_PASSWORD)/);
  assert.doesNotMatch(disposable, /passwordHash|accessToken|refreshToken|cookie/i);
});
test('embedded disposable github-script parses as JavaScript', () => {
  const scriptMarker = "\n        with:\n          script: |\n";
  const scriptStart = disposable.indexOf(scriptMarker);
  assert.notEqual(scriptStart, -1);
  const bodyStart = scriptStart + scriptMarker.length;
  const bodyEnd = disposable.indexOf("\n      - name: Publish authenticated UAT summary", bodyStart);
  assert.notEqual(bodyEnd, -1);
  const script = disposable.slice(bodyStart, bodyEnd)
    .split('\n')
    .map((line) => line.startsWith('            ') ? line.slice(12) : line)
    .join('\n');
  assert.doesNotThrow(() => new Function(script));
});
