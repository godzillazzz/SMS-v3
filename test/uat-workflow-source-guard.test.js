process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8').replace(/\r\n/g, '\n');
const count = (needle) => workflow.split(needle).length - 1;

test('UAT workflow trusts exact remote branch HEAD/SHA instead of a static application branch allowlist', () => {
  assert.doesNotMatch(workflow, /UAT_APPLICATION_SOURCE_BRANCH_NOT_APPROVED/);
  assert.doesNotMatch(workflow, /case \"\$SOURCE_BRANCH\" in/);
  assert.equal(count('git check-ref-format --branch "$SOURCE_BRANCH" >/dev/null'), 2);
  assert.equal(count('"+refs/heads/${SOURCE_BRANCH}:refs/remotes/origin/${SOURCE_BRANCH}"'), 2);
  assert.equal(count('SOURCE_BRANCH_HEAD_CHECK=PASS'), 2);
  assert.equal(count('node e2e/helpers/uat-target-contract.js source-branch "$SOURCE_BRANCH"'), 2);
  assert.equal(count('node e2e/helpers/uat-target-contract.js source-head "$SOURCE_BRANCH"'), 2);
  assert.equal(count('node e2e/helpers/uat-target-contract.js harness "$HARNESS_SHA"'), 2);
  assert.equal(count('node e2e/helpers/uat-target-contract.js scope "$target_mode" "$TARGET_URL"'), 2);
});

test('UAT workflow retains exact source, harness, application checkout, and deployment identity guards in both jobs', () => {
  assert.equal(count('if [[ "$(git rev-parse "refs/remotes/origin/${SOURCE_BRANCH}^{commit}")" != "$SOURCE_SHA" ]]; then'), 2);
  assert.equal(count('git rev-parse origin/test/automated-uat-v3-authenticated'), 4);
  assert.equal(count('test "$(git rev-parse HEAD)" = "$HARNESS_SHA"'), 4);
  assert.equal(count('ref: ${{ inputs.source_sha }}'), 2);
  assert.equal(count('test "$(git -C application-under-test rev-parse HEAD)" = "$SOURCE_SHA"'), 2);
  assert.equal(count('UAT_EXPECTED_DEPLOYMENT_ID: ${{ inputs.expected_deployment_id }}'), 2);
  assert.equal(count('\n          DEPLOYMENT_ID: ${{ inputs.expected_deployment_id }}'), 2);
});
