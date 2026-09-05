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

test('Preview witness workflow fails before build when the Preview contract is not proven', () => {
  const workflow = readWorkflow('deploy-date-format-preview.yml');
  assert.match(workflow, /Verify Preview environment contract before build/);
  assert.match(workflow, /--require-preview-fingerprint/);
  assert.match(workflow, /--run-migrations=false/);
  assert.match(workflow, /GOVERNANCE_SHA: a259c34aa026be86ad009a27d96439a8ac6c7a16/);
  assert.match(workflow, /GOVERNANCE_TREE: c1fc3eb180353557c1ef053353a6efc332b5b9b1/);
  assert.match(workflow, /Checkout approved governance tooling source/);
  assert.match(workflow, /ref: \$\{\{ env\.GOVERNANCE_SHA \}\}/);
  assert.match(workflow, /Snapshot approved governance tooling and checkout exact Application SHA/);
  assert.match(workflow, /cp scripts\/ci\/verify-environment-contract\.js "\$governance_root\/scripts\/ci\/verify-environment-contract\.js"/);
  assert.match(workflow, /git checkout --detach "\$TARGET_SHA"/);
  assert.match(workflow, /node "\$RUNNER_TEMP\/sms-v3-governance\/scripts\/ci\/verify-environment-contract\.js" --contract-only/);
  assert.match(workflow, /NODE_PATH="\$PWD\/node_modules" node "\$RUNNER_TEMP\/sms-v3-governance\/scripts\/ci\/verify-environment-contract\.js"/);
  assert.match(workflow, /--cwd="\$PWD"/);
  assert.match(workflow, /node "\$RUNNER_TEMP\/sms-v3-governance\/scripts\/ci\/verify-linux-artifact\.js" \.vercel\/output --require-sharp-load/);
  assert.match(workflow, /\/api\/v1\/health/);
  assert.match(workflow, /\/api\/v1\/ready/);
  assert.match(workflow, /PREVIEW_CORS_ORIGIN_GATE=PASS/);
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
