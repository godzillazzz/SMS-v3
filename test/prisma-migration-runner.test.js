const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { classifyMigrationStatus, runMigrationCommand, sanitizeOutput } = require('../scripts/ci/prisma-migration');

const env = {
  DATABASE_URL: 'runtime-test-url',
  DIRECT_URL: 'direct-test-url'
};

const knownMigration = '202608020001_license_correction_disposal';

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

test('migration status allows only known pending migrations before deploy', () => {
  const pending = () => ({
    status: 1,
    stdout: `The following migration has not yet been applied:\n${knownMigration}`,
    stderr: ''
  });
  assert.equal(runMigrationCommand('status', {
    env,
    run: pending,
    knownMigrations: [knownMigration],
    allowPending: true,
    log: () => {},
    error: () => {}
  }), 0);
  assert.equal(runMigrationCommand('status', {
    env,
    run: pending,
    knownMigrations: [knownMigration],
    log: () => {},
    error: () => {}
  }), 1);
});

test('pending status can proceed through deploy and a clean post-status', () => {
  const outputs = [
    { status: 1, stdout: `The following migrations have not yet been applied:\n${knownMigration}`, stderr: '' },
    { status: 0, stdout: 'Applied migrations successfully.', stderr: '' },
    { status: 0, stdout: 'Database schema is up to date.', stderr: '' }
  ];
  const run = () => outputs.shift();
  assert.equal(runMigrationCommand('status', { env, run, knownMigrations: [knownMigration], allowPending: true, log: () => {}, error: () => {} }), 0);
  assert.equal(runMigrationCommand('deploy', { env, run, log: () => {}, error: () => {} }), 0);
  assert.equal(runMigrationCommand('status', { env, run, knownMigrations: [knownMigration], log: () => {}, error: () => {} }), 0);
});

test('failed deploy and pending post-status remain blocking', () => {
  const deployFailure = runMigrationCommand('deploy', {
    env,
    run: () => ({ status: 1, stdout: 'P3018 migration failed to apply', stderr: '' }),
    log: () => {},
    error: () => {}
  });
  const postPending = runMigrationCommand('status', {
    env,
    run: () => ({ status: 1, stdout: `The following migration has not yet been applied:\n${knownMigration}`, stderr: '' }),
    knownMigrations: [knownMigration],
    log: () => {},
    error: () => {}
  });
  assert.equal(deployFailure, 1);
  assert.equal(postPending, 1);
});

test('unknown pending migration is fail-closed', () => {
  const result = classifyMigrationStatus(
    'The following migration has not yet been applied:\n202608020099_unexpected_change',
    1,
    { knownMigrations: [knownMigration] }
  );
  assert.equal(result.classification, 'UNKNOWN');
  assert.equal(runMigrationCommand('status', {
    env,
    run: () => ({ status: 1, stdout: 'The following migration has not yet been applied:\n202608020099_unexpected_change', stderr: '' }),
    knownMigrations: [knownMigration],
    allowPending: true,
    log: () => {},
    error: () => {}
  }), 1);
});

test('migration status classifies connection errors', () => {
  const result = classifyMigrationStatus('Error: P1001 Cannot reach database server', 1, { knownMigrations: [] });
  assert.equal(result.classification, 'CONNECTION_ERROR');
  assert.deepEqual(result.errorCodes, ['P1001']);
});

test('migration status classifies failed migrations', () => {
  const result = classifyMigrationStatus(`Error: P3009 failed migrations found\n${knownMigration}`, 1, { knownMigrations: [knownMigration] });
  assert.equal(result.classification, 'FAILED_MIGRATION');
  assert.equal(result.migrationNames[0], knownMigration);
});

test('migration status classifies history divergence', () => {
  const result = classifyMigrationStatus('Migration history and local migrations do not match. Error: P3015', 1, { knownMigrations: [] });
  assert.equal(result.classification, 'HISTORY_DIVERGED');
  assert.equal(result.migrationHistoryMismatch, true);
});

test('migration status classifies missing migration table', () => {
  const result = classifyMigrationStatus('The table _prisma_migrations does not exist', 1, { knownMigrations: [] });
  assert.equal(result.classification, 'MIGRATION_TABLE_MISSING');
});

test('migration status classifies schema and configuration errors', () => {
  const result = classifyMigrationStatus('Error: P1012 Schema validation error: unknown field', 1, { knownMigrations: [] });
  assert.equal(result.classification, 'SCHEMA_OR_CONFIG_ERROR');
  assert.equal(result.schemaMismatch, true);
});

test('migration status classifies unknown failures', () => {
  const result = classifyMigrationStatus('Unexpected database response', 1, { knownMigrations: [] });
  assert.equal(result.classification, 'UNKNOWN');
});

test('migration status reports up to date only for confirmed output', () => {
  const result = classifyMigrationStatus('Database schema is up to date.', 0, { knownMigrations: [] });
  assert.equal(result.classification, 'UP_TO_DATE');
});

test('migration runner never prints connection details', () => {
  const output = sanitizeOutput('Datasource db at host=db.example.invalid port=5432 user=runtime password=placeholder\nApplying migration');
  assert.doesNotMatch(output, /db\.example|password|postgres|runtime/i);
  assert.match(output, /Applying migration/);
  assert.doesNotMatch(sanitizeOutput('P1001 unable to reach 10.20.30.40:5432'), /10\.20\.30\.40|5432/);
});

test('status diagnostics never emit raw database output', () => {
  const logs = [];
  runMigrationCommand('status', {
    env,
    run: () => ({
      status: 1,
      stdout: `Datasource db at host=db.example.invalid port=5432 user=runtime password=placeholder\nThe following migration has not yet been applied:\n${knownMigration}`,
      stderr: 'sanitized diagnostic output'
    }),
    knownMigrations: [knownMigration],
    allowPending: true,
    log: (message) => logs.push(message),
    error: () => {}
  });
  const output = logs.join('\n');
  assert.doesNotMatch(output, /postgresql|db\.example|password|sms_v3_test|user/i);
  assert.match(output, /MIGRATION_STATUS_CLASS=PENDING_MIGRATIONS_ONLY/);
});

test('production workflow allows expected pending status and requires clean post-status', () => {
  const workflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
  assert.match(workflow, /prisma-migration\.js status --allow-pending/);
  assert.match(workflow, /prisma-migration\.js deploy/);
  assert.match(workflow, /prisma-migration\.js status\s*$/m);
  assert.match(workflow, /needs:\s*\[validate, migrate\]/);
  assert.doesNotMatch(workflow, /if:\s*always\(\)/);
  assert.doesNotMatch(workflow, /prisma db push|prisma migrate reset|continue-on-error/);
});
