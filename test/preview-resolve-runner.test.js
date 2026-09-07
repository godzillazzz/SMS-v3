'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  EXPECTED_MIGRATION_OBJECT_COUNT,
  EXPECTED_COLUMNS,
  EXPECTED_CONSTRAINTS,
  EXPECTED_INDEXES,
  EXPECTED_TABLES,
  classifyInventory,
  comparePostLedger,
  preResolveLedgerSafe,
  RESOLVE_CHECKSUM,
  RESOLVE_TARGET,
} = require('../scripts/ci/verify-preview-resolve-state');
const {
  hasDataStatements,
  verifyPreviewResolveSource,
} = require('../scripts/ci/verify-preview-resolve-source');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'resolve-preview-202608240003.yml'), 'utf8').replaceAll('\r\n', '\n');

test('resolve source guard proves the exact checksum and rejects data statements', () => {
  const logs = [];
  const result = verifyPreviewResolveSource({ cwd: root, log: (line) => logs.push(line) });
  assert.equal(result.checksum, RESOLVE_CHECKSUM);
  assert.equal(hasDataStatements('CREATE TABLE x (id int);'), false);
  assert.equal(hasDataStatements('INSERT INTO x VALUES (1);'), true);
  assert.ok(logs.includes('RESOLVE_TARGET_SOURCE=PASS'));
  assert.ok(logs.includes('RESOLVE_CHECKSUM=PASS'));
  assert.ok(logs.includes('MIGRATION_HAS_DATA_STATEMENTS=NO'));
});

test('pre-resolve ledger guard requires the exact unfinished zero-step failed row', () => {
  const base = { migration_name: RESOLVE_TARGET, checksum: RESOLVE_CHECKSUM, finished_at: null, rolled_back_at: null, applied_steps_count: 0 };
  assert.equal(preResolveLedgerSafe(base), true);
  assert.equal(preResolveLedgerSafe({ ...base, applied_steps_count: 1 }), false);
  assert.equal(preResolveLedgerSafe({ ...base, checksum: '0'.repeat(64) }), false);
  assert.equal(preResolveLedgerSafe({ ...base, finished_at: new Date() }), false);
  assert.equal(preResolveLedgerSafe({ ...base, rolled_back_at: new Date() }), false);
});

test('schema inventory classification is fail-closed for the complete 36-object signature', () => {
  const tables = [{ table_name: 'security_sites' }, { table_name: 'security_site_qr_credentials' }];
  const columns = [];
  const constraints = [];
  const indexes = [];
  const inventory = classifyInventory({ tables, columns, constraints, indexes });
  assert.equal(inventory.expected, EXPECTED_MIGRATION_OBJECT_COUNT);
  assert.equal(inventory.missing, EXPECTED_MIGRATION_OBJECT_COUNT - 2);
  assert.equal(inventory.exact, false);
});

test('schema inventory accepts the reviewed 36-object signature only when every object matches', () => {
  const tables = EXPECTED_TABLES.map((table_name) => ({ table_name }));
  const columns = EXPECTED_COLUMNS.map(([table_name, column_name, udt_name, is_nullable, hasDefault]) => ({
    table_name,
    column_name,
    udt_name,
    is_nullable,
    column_default: hasDefault ? 'reviewed_default()' : null,
  }));
  const constraints = EXPECTED_CONSTRAINTS.map(([table_name, conname, contype]) => ({ table_name, conname, contype }));
  const indexes = EXPECTED_INDEXES.map(([tablename, indexname, indexColumns]) => ({
    tablename,
    indexname,
    indexdef: `CREATE INDEX ${indexname} ON public.${tablename} (${indexColumns.join(', ')})`,
  }));
  const inventory = classifyInventory({ tables, columns, constraints, indexes });
  assert.deepEqual(inventory, {
    expected: 36,
    matching: 36,
    missing: 0,
    differing: 0,
    exact: true,
  });
});

test('post-resolve ledger comparison allows only the target reconciliation', () => {
  const before = [{ migration_name: 'older', checksum: 'a', started_at: null, finished_at: '2026-01-01T00:00:00.000Z', rolled_back_at: null, applied_steps_count: 1 }, { migration_name: RESOLVE_TARGET, checksum: RESOLVE_CHECKSUM, started_at: '2026-01-01T00:00:00.000Z', finished_at: null, rolled_back_at: null, applied_steps_count: 0 }];
  const after = [{ ...before[0] }, { ...before[1], finished_at: '2026-01-02T00:00:00.000Z' }];
  assert.equal(comparePostLedger(before, after), true);
  assert.equal(comparePostLedger(before, [{ ...after[0], checksum: 'changed' }, after[1]]), false);
});

test('resolve workflow is manual, two-stage, protected, hardcoded, and mutation-minimal', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /source-preflight:/);
  assert.match(workflow, /protected-preview-resolve:/);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(workflow, /DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/);
  assert.match(workflow, /verify-preview-resolve-source\.js/);
  assert.match(workflow, /verify-preview-resolve-state\.js --mode=pre/);
  assert.match(workflow, /prisma migrate resolve --applied 202608240003_g06_security_site_qr_gps_v1/);
  assert.equal((workflow.match(/prisma migrate resolve --applied/g) || []).length, 1);
  assert.doesNotMatch(workflow, /prisma migrate deploy|prisma migrate reset|--rolled-back|db:seed|prisma db push/i);
  assert.doesNotMatch(workflow, /DATABASE_URL[^\n]*(?:GITHUB_OUTPUT|GITHUB_STEP_SUMMARY)/i);
  assert.match(workflow, /MIGRATION_DEPLOY_EXECUTED=NO/);
  assert.match(workflow, /Production database accessed: NO/);
});
