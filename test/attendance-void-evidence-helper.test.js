'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  migrationDirectories,
  migrationStatus
} = require('../scripts/ci/attendance-void-evidence');
const { PREREQUISITE } = require('../scripts/ci/attendance-void-control-plane');

const ROOT = require('node:path').join(__dirname, '..');

test('migrationDirectories synchronously returns directories accepted by migrationStatus', () => {
  const directories = migrationDirectories(ROOT);

  assert.ok(Array.isArray(directories));
  assert.ok(directories.includes(PREREQUISITE.name));

  const appliedName = directories[0];
  const status = migrationStatus([
    { migration_name: appliedName, checksum: 'verified', finished: true, rolled_back: false }
  ], directories);

  assert.equal(status.applied.get(appliedName), 'verified');
  assert.deepEqual(status.pending, directories.filter((name) => name !== appliedName));
  assert.deepEqual(status.failed, []);
});
