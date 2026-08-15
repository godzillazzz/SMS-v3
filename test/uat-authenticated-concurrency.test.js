'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const authenticatedStart = workflow.indexOf('\n  authenticated-uat:');
assert.notEqual(authenticatedStart, -1, 'authenticated-uat job must exist');
const authenticated = workflow.slice(authenticatedStart);
const technical = workflow.slice(0, authenticatedStart);

test('authenticated UAT is serialized without cancelling an in-progress destructive-capable run', () => {
  assert.match(authenticated, /\n    concurrency:\r?\n      group: sms-v3-staging-authenticated-uat\r?\n      cancel-in-progress: false/);
  assert.doesNotMatch(technical, /sms-v3-staging-authenticated-uat/);
});

test('concurrency repair does not wire disposable DB mutation flags or database credentials', () => {
  assert.doesNotMatch(workflow, /UAT_DISPOSABLE_EMPLOYEE_ENABLED/);
  assert.doesNotMatch(workflow, /UAT_DISPOSABLE_EMPLOYEE_CONFIRM/);
  assert.doesNotMatch(workflow, /secrets\.DATABASE_URL/);
  assert.doesNotMatch(workflow, /secrets\.DIRECT_URL/);
});

test('existing exact source, harness, target and application checkout guards remain present', () => {
  for (const needle of [
    'git check-ref-format --branch "$SOURCE_BRANCH"',
    'refs/heads/${SOURCE_BRANCH}:refs/remotes/origin/${SOURCE_BRANCH}',
    'UAT_APPLICATION_SOURCE_NOT_APPROVED_HEAD',
    'UAT_HARNESS_SOURCE_NOT_APPROVED_HEAD',
    'uat-target-contract.js source-branch',
    'uat-target-contract.js source-head',
    'uat-target-contract.js harness',
    'uat-target-contract.js scope',
    'ref: ${{ inputs.source_sha }}',
    'UAT_EXPECTED_DEPLOYMENT_ID: ${{ inputs.expected_deployment_id }}'
  ]) assert.equal(workflow.includes(needle), true, needle);
});
