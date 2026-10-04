'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PREDECESSOR, TARGET, REQUIRED_COLUMNS, classifyHistory, policyShape } = require('../scripts/ci/verify-attendance-time-policy-production-migration');
const { validateMigrationManifest, validateSqlForMigration } = require('../scripts/ci/verify-approved-production-migration');
const names = ['202607160000_initial_schema', PREDECESSOR, TARGET];
const source = names.map((name) => ({ name, checksum: 'private-comparison-value-' + name }));
const completed = (name) => ({ migration_name: name, checksum: source.find((m) => m.name === name).checksum, finished_at: 'completed', rolled_back_at: null });
test('completed canonical history requires schema verification and does not reapply', () => {
  assert.deepEqual(classifyHistory(names.map(completed), source), { state: 'BOTH_ALREADY_APPLIED_AND_VALID', pending: [] });
});
test('exact missing predecessor and target is the only allowed two-migration batch', () => {
  assert.deepEqual(classifyHistory([completed(names[0])], source), { state: 'EXACTLY_PENDING_001_THEN_002', pending: [PREDECESSOR, TARGET] });
});
test('already applied predecessor allows only target', () => {
  assert.deepEqual(classifyHistory(names.slice(0, 2).map(completed), source), { state: '001_APPLIED_002_PENDING', pending: [TARGET] });
});
test('unexpected canonical pending migration fails closed', () => {
  assert.equal(classifyHistory([], source).state, 'HISTORY_DIVERGED');
});
test('unknown Preview-only history is never reconciled into Production', () => {
  assert.equal(classifyHistory([...names.map(completed), { migration_name: '202609280001_g06_gps_only_uat_event_provenance' }], source).state, 'HISTORY_DIVERGED');
});
test('checksum mismatch fails without emitting checksum', () => {
  const rows = names.map(completed); rows[0].checksum = 'sensitive-mismatch';
  const result = classifyHistory(rows, source);
  assert.equal(result.state, 'HISTORY_DIVERGED');
  assert(!JSON.stringify(result).includes('sensitive-mismatch'));
});
test('active failed migration is not retried', () => {
  const rows = names.map(completed); rows[1].finished_at = null;
  assert.equal(classifyHistory(rows, source).state, 'PARTIAL_OR_FAILED');
});
test('completed duplicate records fail closed', () => {
  assert.equal(classifyHistory([...names.map(completed), completed(PREDECESSOR)], source).state, 'HISTORY_DIVERGED');
});
test('same-checksum rolled-back then completed history remains explainable', () => {
  const rolledBack = { ...completed(names[0]), finished_at: null, rolled_back_at: 'rolled-back' };
  assert.equal(classifyHistory([rolledBack, ...names.map(completed)], source).state, 'BOTH_ALREADY_APPLIED_AND_VALID');
});
test('rolled-back-only history cannot be silently treated as applied', () => {
  const rows = names.map(completed); rows[1].finished_at = null; rows[1].rolled_back_at = 'rolled-back';
  assert.equal(classifyHistory(rows, source).state, 'HISTORY_DIVERGED');
});
function validColumns() {
  return Object.entries(REQUIRED_COLUMNS).flatMap(([table_name, fields]) => Object.entries(fields).map(([column_name, udt_name]) => ({
    table_name, column_name, udt_name,
    attnotnull: table_name === 'attendance_time_policies' && !['site_id','shift_type_id'].includes(column_name), atttypmod: -1
  })));
}
test('all mapped physical fields and native timestamps are recognized', () => {
  assert.equal(policyShape(validColumns()), 'PRESENT');
  const explicitPrecision = validColumns().map((c) => c.udt_name === 'timestamptz' ? { ...c, atttypmod: 6 } : c);
  assert.equal(policyShape(explicitPrecision), 'PRESENT');
});
test('empty schema is absent while a partial migration is not eligible for apply', () => {
  assert.equal(policyShape([]), 'ABSENT');
  assert.equal(policyShape(validColumns().slice(1)), 'PARTIAL');
});
test('wrong timestamp type, precision or nullability fails schema verification', () => {
  for (const change of [{ udt_name: 'timestamp' }, { atttypmod: 3 }, { attnotnull: false }]) {
    const rows = validColumns().map((row) => row.column_name === 'effective_from' ? { ...row, ...change } : row);
    assert.equal(policyShape(rows), 'PARTIAL');
  }
});
test('approved manifest pins exact application and additive immutable target SQL', () => {
  const manifest = JSON.parse(fs.readFileSync('.github/releases/approved-attendance-time-policy-production-migration.json'));
  const result = validateMigrationManifest(manifest);
  assert.equal(result.sourceCommitSha, '500aaa53d60d6835cccec16c79ca25de00ab06c6');
  assert.equal(result.sourceTreeSha, 'a2cdfc2f2eea4ad52eeca07b41183d74e5fcfa74');
  const sql = fs.readFileSync(manifest.migration_path, 'utf8');
  assert.doesNotThrow(() => validateSqlForMigration('G06-TIME-POLICY', sql));
  assert.throws(() => validateSqlForMigration('G06-TIME-POLICY', sql + '\nDELETE FROM attendance_events;'), /identity mismatch/);
});
test('protected workflow inspects ledger/schema before apply and keeps application deployment separate', () => {
  const workflow = fs.readFileSync('.github/workflows/apply-approved-attendance-time-policy-production-migration.yml', 'utf8');
  assert(workflow.includes('name: production-sms-v3-staging'));
  assert(workflow.indexOf('Verify Production database target guard') < workflow.indexOf('Inspect exact Production ledger'));
  assert(workflow.indexOf('Inspect exact Production ledger') < workflow.indexOf('Apply exact approved Production migration'));
  assert(workflow.includes('node /tmp/reconcile-production-attendance-migrations.js'));
  assert(workflow.includes('g06-production-migration-candidates.json'));
  assert(!/migrate resolve|db push|UAT_PASSWORD|VERCEL_AUTOMATION_BYPASS_SECRET|reconcil.*preview/i.test(workflow));
});
