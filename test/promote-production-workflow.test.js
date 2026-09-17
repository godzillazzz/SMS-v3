const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'promote-production.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n');

test('promotion workflow is manual-only and requires exact candidate plus current canonical checkpoint', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.match(workflow, /deployment_id:/);
  assert.match(workflow, /expected_sha:/);
  assert.match(workflow, /expected_previous_deployment_id:/);
  assert.match(workflow, /confirmation:/);
  assert.doesNotMatch(workflow, /^\s+(?:push|schedule|repository_dispatch):/m);
});

test('promotion workflow has no hardcoded staged deployment or candidate SHA', () => {
  assert.doesNotMatch(workflow, /EXPECTED_STAGED_DEPLOYMENT_ID/);
  assert.doesNotMatch(workflow, /EXPECTED_SHA:/);
  assert.match(workflow, /\$\{\{ inputs\.expected_sha \}\}/);
  assert.match(workflow, /\$\{\{ inputs\.expected_previous_deployment_id \}\}/);
});

test('promotion validates staged deployment identity, project, target, readiness, and exact SHA', () => {
  assert.match(workflow, /PROMOTION_GUARD=\$\{category\}/);
  assert.match(workflow, /PROJECT_ID_MISMATCH/);
  assert.match(workflow, /PROJECT_NAME_MISMATCH/);
  assert.match(workflow, /TARGET_NOT_PRODUCTION/);
  assert.match(workflow, /DEPLOYMENT_NOT_READY/);
  assert.match(workflow, /SHA_MISMATCH/);
  assert.match(workflow, /sha !== expectedSha/);
});

test('promotion fails closed if canonical Production changed since approval', () => {
  assert.match(workflow, /inspect "\$EXPECTED_CANONICAL_URL"/);
  assert.match(workflow, /CANONICAL_CHANGED_SINCE_APPROVAL/);
  assert.match(workflow, /CANONICAL_TARGET_NOT_PRODUCTION/);
  assert.match(workflow, /CANONICAL_NOT_READY/);
  assert.match(workflow, /PRE_PROMOTION_CANONICAL=/);
});

test('promotion aliases only after guards and verifies canonical identity, SHA, and health', () => {
  const validateAt = workflow.indexOf('Validate staged deployment and current canonical checkpoint');
  const promoteAt = workflow.indexOf('Promote existing application deployment');
  const verifyAt = workflow.indexOf('Verify canonical deployment identity and SHA');
  const healthAt = workflow.indexOf('Verify canonical application health');
  assert.ok(validateAt >= 0 && promoteAt > validateAt && verifyAt > promoteAt && healthAt > verifyAt);
  assert.match(workflow, /vercel@"\$VERCEL_CLI_VERSION" promote/);
  assert.match(workflow, /CANONICAL_DEPLOYMENT=/);
  assert.match(workflow, /CANONICAL_SHA=/);
  assert.match(workflow, /node scripts\/ci\/verify-health\.js/);
});

test('promotion remains application-only and never invokes Prisma or database mutation commands', () => {
  assert.doesNotMatch(workflow, /DATABASE_URL|DIRECT_URL|prisma\s+(?:migrate|db)|prisma-migration|run_migrations/i);
  assert.match(workflow, /Database migration: not performed/);
});
