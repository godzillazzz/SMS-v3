'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'verify-g06-pr-preview-runtime-readonly.yml'), 'utf8').replaceAll('\r\n', '\n');

test('runtime workflow is main-dispatched, exact-source pinned, and has no database or mutation authority', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/);
  assert.match(workflow, /EXPECTED_PR_SHA: e12c28c339c6d420c6db13b02aa1ddffb2c3e5ba/);
  assert.match(workflow, /EXPECTED_PR_TREE: a2cdfc2f2eea4ad52eeca07b41183d74e5fcfa74/);
  assert.match(workflow, /verify-preview-attendance-time-policy-readonly-runtime\.js/);
  assert.match(workflow, /PR_417_EXACT_SHA_VERCEL_STATUS=PASS PROJECT=sms-v3-staging/);
  assert.match(workflow, /previewPath\[0\] !== 'godzillazz'/);
  assert.match(workflow, /previewPath\[1\] !== 'sms-v3-staging'/);
  assert.match(workflow, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(workflow, /\bVERCEL_(?:TOKEN|ORG_ID|PROJECT_ID)\b/);
  assert.doesNotMatch(workflow, /\b(?:DATABASE_URL|DIRECT_URL)\b/);
  assert.doesNotMatch(workflow, /\benvironment:/i);
  assert.doesNotMatch(workflow, /prisma\s+(?:migrate\s+deploy|db\s+push|migrate\s+resolve|migrate\s+repair|migrate\s+reset)/i);
  assert.doesNotMatch(workflow, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i);
  assert.doesNotMatch(workflow, /attendance\/time-policies.*(?:POST|PUT|PATCH|DELETE)/i);
});
