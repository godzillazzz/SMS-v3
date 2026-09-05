'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readWorkflow = (name) => fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8').replaceAll('\r\n', '\n');

test('CI runs the static environment governance contract without Production secrets', () => {
  const workflow = readWorkflow('ci.yml');
  assert.match(workflow, /Verify environment governance contract definition/);
  assert.match(workflow, /node scripts\/ci\/verify-environment-contract\.js --contract-only/);
  assert.doesNotMatch(workflow, /environment governance contract definition[\s\S]{0,300}DATABASE_URL: \$\{\{ secrets\./i);
});

test('manual Production workflow defaults migrations to false and gates environment readiness', () => {
  const workflow = readWorkflow('deploy-production.yml');
  assert.match(workflow, /run_migrations:[\s\S]*default: false/);
  assert.match(workflow, /Verify Production environment contract before build/);
  assert.match(workflow, /--require-approved-fingerprint/);
  assert.match(workflow, /--run-migrations="\$RUN_MIGRATIONS"/);
  assert.match(workflow, /node scripts\/ci\/verify-linux-artifact\.js \.vercel\/output --require-sharp-load/);
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|schedule|repository_dispatch):/m);
});

test('Preview witness workflow validates readable guards in the control plane and defers sensitive DB identity to runtime readiness', () => {
  const workflow = readWorkflow('deploy-date-format-preview.yml');
  assert.match(workflow, /TARGET_SHA: 7d4e911aca8c256233849044a1e131dc7710965d/);
  assert.match(workflow, /EXPECTED_TREE: 2ca95476552c16a8b4b7797817515b1ce5e0dcbe/);
  assert.match(workflow, /GOVERNANCE_SHA: 7d4e911aca8c256233849044a1e131dc7710965d/);
  assert.match(workflow, /GOVERNANCE_TREE: 2ca95476552c16a8b4b7797817515b1ce5e0dcbe/);
  assert.match(workflow, /APPROVED_DATABASE_TARGET_FINGERPRINT: \${\{ vars\.APPROVED_DATABASE_TARGET_FINGERPRINT \}\}/);
  assert.match(workflow, /Checkout approved governance tooling source/);
  assert.match(workflow, /ref: \${\{ env\.GOVERNANCE_SHA \}\}/);
  assert.match(workflow, /Snapshot approved governance tooling and checkout exact Application SHA/);
  assert.match(workflow, /cp scripts\/ci\/verify-preview-control-plane\.js "\$governance_root\/scripts\/ci\/verify-preview-control-plane\.js"/);
  assert.match(workflow, /git checkout --detach "\$TARGET_SHA"/);
  assert.match(workflow, /node "\$RUNNER_TEMP\/sms-v3-governance\/scripts\/ci\/verify-environment-contract\.js" --contract-only/);
  assert.match(workflow, /env list preview --format json/);
  assert.match(workflow, /Verify Preview control-plane contract before build/);
  assert.match(workflow, /verify-preview-control-plane\.js/);
  assert.match(workflow, /--metadata-file="\$metadata_file"/);
  assert.match(workflow, /--production-fingerprint="\$APPROVED_DATABASE_TARGET_FINGERPRINT"/);
  assert.match(workflow, /--run-migrations=false/);
  assert.match(workflow, /--source-sha="\$TARGET_SHA"/);
  assert.match(workflow, /--source-tree="\$EXPECTED_TREE"/);
  assert.match(workflow, /--cwd="\$PWD"/);
  assert.match(workflow, /node "\$RUNNER_TEMP\/sms-v3-governance\/scripts\/ci\/verify-linux-artifact\.js" \.vercel\/output --require-sharp-load/);
  assert.match(workflow, /\/api\/v1\/health/);
  assert.match(workflow, /\/api\/v1\/ready/);
  assert.match(workflow, /PREVIEW_CORS_ORIGIN_GATE=PASS/);
  assert.match(workflow, /VERCEL_TOKEN: \${\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /vercel@"\$VERCEL_CLI_VERSION" --scope "\$VERCEL_ORG_ID" --token "\$VERCEL_TOKEN" curl/);
  const vercelCurlCalls = workflow.match(/npx --yes vercel@"\$VERCEL_CLI_VERSION" curl /g) || [];
  assert.equal(vercelCurlCalls.length, 8);
});
test('manifest Production release is explicitly dispatched and includes both hardening gates', () => {
  const workflow = readWorkflow('deploy-approved-production-v2.yml');
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.match(workflow, /Verify environment governance contract definition/);
  assert.match(workflow, /Verify Production environment contract before build/);
  assert.match(workflow, /--require-approved-fingerprint/);
  assert.match(workflow, /node scripts\/ci\/verify-linux-artifact\.js \.vercel\/output --require-sharp-load/);
});
