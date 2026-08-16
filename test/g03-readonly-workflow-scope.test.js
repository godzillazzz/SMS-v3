const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'),
  'utf8'
).replaceAll('\r\n', '\n');

test('workflow exposes exactly one fixed G03 read-only authenticated scope choice', () => {
  assert.equal((workflow.match(/- g03-readonly-targeted/g) || []).length, 1);
  assert.match(workflow, /uat_scope:[\s\S]*?options:[\s\S]*?- full[\s\S]*?- report-center-diagnostic[\s\S]*?- admin-rbac-targeted-retry[\s\S]*?- g03-readonly-targeted/);
  assert.doesNotMatch(workflow, /grep:\s*\$\{\{\s*inputs\.uat_scope\s*\}\}/);
  assert.doesNotMatch(workflow, /test_path|test_filter|grep_pattern|free.?form/i);
});

test('workflow keeps technical and existing authenticated scope semantics unchanged', () => {
  assert.match(workflow, /default:\s*full/);
  assert.match(workflow, /- technical/);
  assert.match(workflow, /- authenticated/);
  assert.match(workflow, /- report-center-diagnostic/);
  assert.match(workflow, /- admin-rbac-targeted-retry/);
  assert.match(workflow, /UAT_SCOPE: \$\{\{ inputs\.uat_scope \}\}/);
  assert.equal((workflow.match(/UAT_SCOPE: \$\{\{ inputs\.uat_scope \}\}/g) || []).length, 4);
});
