const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(__dirname, '../.github/workflows/recover-preview-uat-accounts.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('Preview UAT recovery workflow never binds GitHub Environment database secrets directly', () => {
  assert.match(workflow, /environment: production-sms-v3-staging/);
  assert.match(workflow, /UAT_ADMIN_EMAIL: \$\{\{ secrets\.UAT_ADMIN_EMAIL \}\}/);
  assert.match(workflow, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.doesNotMatch(workflow, /DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/);
  assert.match(workflow, /vercel@"\$VERCEL_CLI_VERSION" pull --yes --environment=preview/);
  assert.match(workflow, /--env-file=\.vercel\/\.env\.preview\.local/);
});

test('Preview UAT recovery workflow proves deployment and database identity before mutation', () => {
  const identity = workflow.indexOf('RECOVERY_DEPLOYMENT_IDENTITY=PASS');
  const controlPlane = workflow.indexOf('verify-preview-control-plane.js');
  const runtimeGuard = workflow.indexOf('verifyPreviewDatabaseTarget');
  const dryRun = workflow.indexOf('bootstrap-uat-users.js --dry-run');
  const mutation = workflow.indexOf('scripts/admin/bootstrap-uat-users.js | tee');
  assert.ok(identity >= 0);
  assert.ok(controlPlane > identity);
  assert.ok(runtimeGuard > controlPlane);
  assert.ok(dryRun > runtimeGuard);
  assert.ok(mutation > dryRun);
  assert.match(workflow, /PREVIEW_DATABASE_TARGET_GUARD=PASS/);
  assert.match(workflow, /PREVIEW_PRODUCTION_DATABASE_DISTINCT=PASS/);
});

test('Preview UAT recovery workflow requires explicit owner confirmation and post-repair idempotency', () => {
  assert.match(workflow, /test "\$CONFIRMATION" = 'REPAIR_PREVIEW_UAT_ACCOUNTS'/);
  assert.match(workflow, /test "\$EXECUTE_REPAIR" = 'true'/);
  assert.match(workflow, /UAT_BOOTSTRAP_CONFIRM: CREATE_SMS_V3_STAGING_UAT_USERS/);
  assert.match(workflow, /UAT_ADMIN \.\.\.\. EXISTS/);
  assert.match(workflow, /UAT_MANAGER \.\.\.\. EXISTS/);
  assert.match(workflow, /UAT_VIEWER \.\.\.\. EXISTS/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /\.env\.preview\.local/);
});
