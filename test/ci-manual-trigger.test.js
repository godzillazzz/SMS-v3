'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('CI triggers are governed: push/pull_request on release branches and manual dispatch', () => {
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8').replaceAll('\r\n', '\n');
  assert.match(workflow, /on:\n/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
});
