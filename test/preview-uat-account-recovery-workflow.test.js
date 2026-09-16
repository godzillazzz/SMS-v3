const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(__dirname, '../.github/workflows/recover-preview-uat-accounts.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('Preview UAT recovery workflow never materializes database secrets outside runtime', () => {
  assert.match(workflow, /environment: production-sms-v3-staging/);
  assert.match(workflow, /VERCEL_AUTOMATION_BYPASS_SECRET: \$\{\{ secrets\.VERCEL_AUTOMATION_BYPASS_SECRET \}\}/);
  assert.match(workflow, /UAT_ADMIN_EMAIL: \$\{\{ secrets\.UAT_ADMIN_EMAIL \}\}/);
  assert.match(workflow, /UAT_VIEWER_PASSWORD: \$\{\{ secrets\.UAT_VIEWER_PASSWORD \}\}/);
  assert.doesNotMatch(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.doesNotMatch(workflow, /DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/);
  assert.doesNotMatch(workflow, /vercel@[^\n]* env pull/);
  assert.doesNotMatch(workflow, /\.env\.preview\.local/);
  assert.doesNotMatch(workflow, /bootstrap-uat-users\.js --dry-run/);
});

test('Preview UAT recovery workflow proves exact deployment and runtime DB readiness before recovery', () => {
  const identity = workflow.indexOf('RECOVERY_DEPLOYMENT_IDENTITY=PASS');
  const readiness = workflow.indexOf('PREVIEW_RUNTIME_DATABASE_GUARD=PASS');
  const dryRun = workflow.indexOf('UAT_ACCOUNT_RECOVERY_DRY_RUN=PASS');
  const mutation = workflow.indexOf('UAT_ACCOUNT_RECOVERY_EXECUTION=PASS');
  const postcheck = workflow.indexOf('UAT_ACCOUNT_RECOVERY_POSTCHECK=PASS');
  assert.ok(identity >= 0);
  assert.ok(readiness > identity);
  assert.ok(dryRun > readiness);
  assert.ok(mutation > dryRun);
  assert.ok(postcheck > mutation);
  assert.match(workflow, /x-vercel-protection-bypass: \$VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(workflow, /\$TARGET_URL\/api\/v1\/ready/);
  assert.match(workflow, /\$TARGET_URL\/api\/v1\/internal\/preview-uat-recovery/);
  assert.match(workflow, /UAT_RECOVERY_DRY_RUN_HTTP=\$status/);
  assert.match(workflow, /UAT_RECOVERY_DRY_RUN_CODE=\$\{code\}/);
});

test('Preview UAT recovery workflow requires explicit owner confirmation and existing-only postcheck semantics', () => {
  assert.match(workflow, /test "\$CONFIRMATION" = 'REPAIR_PREVIEW_UAT_ACCOUNTS'/);
  assert.match(workflow, /test "\$EXECUTE_REPAIR" = 'true'/);
  assert.match(workflow, /confirmation: 'REPAIR_PREVIEW_UAT_ACCOUNTS'/);
  assert.match(workflow, /execute: process\.env\.RECOVERY_EXECUTE === 'true'/);
  assert.match(workflow, /\['CREATE', 'UPDATE', 'EXISTS'\]\.includes\(accounts\[index\]\?\.action\)/);
  assert.match(workflow, /accounts\[index\]\?\.action !== 'EXISTS'/);
  assert.match(workflow, /Create-or-repair recovery dry run: PASS/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /preview-uat-recovery-\*\.json/);
});

test('Preview UAT recovery workflow does not emit credential values or persist request artifacts', () => {
  assert.doesNotMatch(workflow, /echo .*UAT_ADMIN_(EMAIL|PASSWORD)/);
  assert.doesNotMatch(workflow, /echo .*UAT_MANAGER_(EMAIL|PASSWORD)/);
  assert.doesNotMatch(workflow, /echo .*UAT_VIEWER_(EMAIL|PASSWORD)/);
  assert.doesNotMatch(workflow, /upload-artifact/);
  assert.match(workflow, /fs\.writeFileSync\(process\.env\.RECOVERY_REQUEST_FILE, JSON\.stringify\(payload\), \{ mode: 0o600 \}\)/);
  assert.match(workflow, /Raw credentials emitted: NO/);
});
