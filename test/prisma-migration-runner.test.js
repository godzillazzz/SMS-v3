const test = require('node:test');
const assert = require('node:assert/strict');
const { runMigrationCommand, sanitizeOutput } = require('../scripts/ci/prisma-migration');

const env = {
  DATABASE_URL: 'postgresql://runtime:placeholder@localhost:5432/sms_v3_test',
  DIRECT_URL: 'postgresql://migration:placeholder@localhost:5432/sms_v3_test'
};

test('migration runner requires both runtime and direct URLs', () => {
  const errors = [];
  const status = runMigrationCommand('deploy', { env: { DATABASE_URL: env.DATABASE_URL }, error: (message) => errors.push(message) });
  assert.equal(status, 1);
  assert.match(errors[0], /DATABASE_URL and DIRECT_URL/);
});

test('migration status requires an explicit up-to-date result', () => {
  const runner = () => ({ status: 0, stdout: 'No pending migrations to apply.', stderr: '' });
  assert.equal(runMigrationCommand('status', { env, run: runner, log: () => {} }), 0);
  const stale = () => ({ status: 0, stdout: 'Migration status unknown', stderr: '' });
  assert.equal(runMigrationCommand('status', { env, run: stale, log: () => {}, error: () => {} }), 1);
});

test('migration runner never prints connection details', () => {
  const output = sanitizeOutput('Datasource db at postgresql://user:password@db.example.invalid:5432/postgres\nApplying migration');
  assert.doesNotMatch(output, /postgresql|db\.example|password/i);
  assert.match(output, /Applying migration/);
});
