const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/generate-production-target-fingerprint.yml'), 'utf8');

test('production target bootstrap is manual-only and protected', () => {
  assert.match(workflow, /name: Generate Production Target Fingerprint/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule|workflow_run):/m);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /group: sms-v3-staging-production/);
  assert.match(workflow, /name: production-sms-v3-staging/);
  assert.match(workflow, /prevent_self_review|environment:/);
});

test('production target bootstrap validates commit and project before generating', () => {
  assert.match(workflow, /commit_sha:/);
  assert.match(workflow, /confirm_project_name:/);
  assert.match(workflow, /confirm_environment:/);
  assert.match(workflow, /EXPECTED_PROJECT_ID/);
  assert.match(workflow, /VERCEL_PROJECT_ID/);
  assert.match(workflow, /VERCEL_ORG_ID/);
  assert.match(workflow, /merge-base --is-ancestor/);
  assert.match(workflow, /--generate-fingerprint/);
});

test('production target bootstrap cannot connect, migrate, build, or deploy', () => {
  assert.doesNotMatch(workflow, /prisma\s+(migrate|db)/i);
  assert.doesNotMatch(workflow, /npx\s+--yes\s+vercel@/i);
  assert.doesNotMatch(workflow, /fetch\(|axios|curl|Invoke-WebRequest/i);
  assert.match(workflow, /No database connection, Prisma migration, Vercel API, build, or deployment performed/);
});

test('bootstrap output is restricted to safe status and fingerprint fields', () => {
  assert.match(workflow, /verify-deployment-target\.js --generate-fingerprint/);
  assert.match(workflow, /APPROVED_DATABASE_TARGET_FINGERPRINT/);
  assert.match(workflow, /TARGET_PAIR_MATCH=true/);
  assert.match(workflow, /DIRECT_CONNECTION_MODE=\(direct\|verified-supabase-session\)/);
  assert.doesNotMatch(workflow, /(?:DATABASE_URL|DIRECT_URL).*GITHUB_OUTPUT/);
});
