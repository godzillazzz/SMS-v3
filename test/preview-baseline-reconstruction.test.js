'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BASELINE_ALLOWLIST,
  FORBIDDEN_RESOLVE_MIGRATIONS,
  fileSha256,
  verifyManifest,
} = require('../scripts/ci/verify-preview-baseline-manifest');
const {
  expectedCheckMatches,
  expectedForeignKeyMatches,
  expectedIndexMatches,
  evaluateContract,
  normalizeSqlExpression,
  parseForeignKey,
  parseIndexDefinition,
} = require('../scripts/ci/verify-preview-baseline-effects');
const {
  CHECKSUMS,
  postcondition,
  precondition,
} = require('../scripts/ci/verify-preview-baseline-ledger');
const { parseTarget, targetFingerprint } = require('../scripts/ci/verify-deployment-target');
const { verifyPreviewMigrationTarget } = require('../scripts/ci/verify-preview-migration-target');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'governance', 'preview-baseline-reconstruction-20260907.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'reconcile-approved-preview-baseline.yml'), 'utf8').replaceAll('\r\n', '\n');

test('manifest guard proves exact checksums, ordered allowlist and blocked data migrations', () => {
  const result = verifyManifest({ cwd: root, log: () => {} });
  assert.deepEqual(result.baselineAllowlist, BASELINE_ALLOWLIST);
  assert.equal(manifest.candidates.find((entry) => entry.migration_name === '202608240004_g06_attendance_event_workflow_v1').eligible_for_resolve, false);
  assert.ok(FORBIDDEN_RESOLVE_MIGRATIONS.every((name) => !BASELINE_ALLOWLIST.includes(name)));
  for (const entry of manifest.blocked_migrations.filter((item) => item.has_data_statements)) assert.equal(entry.eligible_for_resolve, false);
});

test('manifest checksum guard rejects a wrong checksum without changing files', () => {
  const entry = manifest.candidates.find((item) => item.migration_name === BASELINE_ALLOWLIST[0]);
  const actual = fileSha256(path.join(root, 'prisma', 'migrations', entry.migration_name, 'migration.sql'));
  assert.equal(actual, entry.sha256);
  assert.notEqual(actual, '0'.repeat(64));
});

test('PostgreSQL check normalization removes neutral casts and converts ANY arrays to IN', () => {
  const normalizedA = normalizeSqlExpression('("status"::text = ANY (ARRAY[\'CERTIFIED\'::text, \'UNLOCKED\'::text]::text[]))');
  const normalizedB = normalizeSqlExpression("status IN ('CERTIFIED', 'UNLOCKED')");
  assert.equal(normalizedA, normalizedB);
  assert.notEqual(normalizeSqlExpression('status IN (\'CERTIFIED\')'), normalizedB);
});

test('partial unique index equivalence compares uniqueness, columns and predicate', () => {
  const actual = parseIndexDefinition('CREATE UNIQUE INDEX foo ON public.t ("department_name") WHERE ("is_default" = true)');
  assert.equal(expectedIndexMatches({ indexdef: 'CREATE UNIQUE INDEX foo ON public.t ("department_name") WHERE ("is_default" = true)' }, {
    unique: true, columns: ['department_name'], predicate: 'is_default = TRUE',
  }), true);
  assert.equal(actual.unique, true);
  assert.equal(expectedIndexMatches({ indexdef: 'CREATE UNIQUE INDEX foo ON public.t ("department_name") WHERE ("is_default" = false)' }, {
    unique: true, columns: ['department_name'], predicate: 'is_default = TRUE',
  }), false);
});

test('foreign key equivalence rejects action mismatch', () => {
  const actual = { definition: 'FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE RESTRICT' };
  const expected = { columns: ['employee_id'], refTable: 'employees', refColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' };
  assert.deepEqual(parseForeignKey(actual.definition), expected);
  assert.equal(expectedForeignKeyMatches(actual, { ...expected, table: 't', name: 'f' }), true);
  assert.equal(expectedForeignKeyMatches({ definition: 'FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE CASCADE' }, { ...expected, table: 't', name: 'f' }), false);
});

test('face verified-state weaker constraint is rejected', () => {
  const expected = { expression: "status NOT IN ('VERIFIED','CONSUMED') OR (device_proof_verified_at IS NOT NULL AND verified_at IS NOT NULL AND face_match_passed IS TRUE AND ((verification_mode = 'FACE_MATCH_WITH_LIVENESS' AND pad_passed IS TRUE AND injection_risk_detected IS FALSE) OR (verification_mode = 'FACE_MATCH_ONLY' AND pad_passed IS NULL AND injection_risk_detected IS NULL)))" };
  const weaker = { definition: 'CHECK (status NOT IN (\'VERIFIED\',\'CONSUMED\') OR face_match_passed IS TRUE)' };
  const equivalent = { definition: `CHECK (${expected.expression})` };
  assert.equal(expectedCheckMatches(weaker, expected), false);
  assert.equal(expectedCheckMatches(equivalent, expected), true);
});

test('RLS and grant mismatches fail the exact final-state contract', () => {
  const logs = [];
  assert.throws(() => evaluateContract('202608270004_attendance_face_evidence_rls_v1', {
    tableRows: [{ table_name: 'attendance_evidence' }], columnRows: [], constraintRows: [], indexRows: [], enumRows: [],
    rlsRows: [{ table_name: 'attendance_evidence', relrowsecurity: true, relforcerowsecurity: true }],
    grantRows: [], policyRows: [{ table_name: 'attendance_evidence', policy_count: 0 }],
  }, (line) => logs.push(line)), /semantic effect verification failed/);
  assert.throws(() => evaluateContract('202608270004_attendance_face_evidence_rls_v1', {
    tableRows: [{ table_name: 'attendance_evidence' }], columnRows: [], constraintRows: [], indexRows: [], enumRows: [],
    rlsRows: [{ table_name: 'attendance_evidence', relrowsecurity: true, relforcerowsecurity: false }],
    grantRows: [{ table_name: 'attendance_evidence', grantee: 'anon', privilege_type: 'SELECT' }], policyRows: [{ table_name: 'attendance_evidence', policy_count: 0 }],
  }), /semantic effect verification failed/);
});

test('ledger precondition rejects partial failed rows and postcondition requires every allowlisted row', () => {
  const failedRows = BASELINE_ALLOWLIST.map((migration_name, index) => ({
    id: String(index), migration_name, checksum: CHECKSUMS[migration_name], started_at: null, finished_at: null, rolled_back_at: null, applied_steps_count: index === 0 ? 1 : 0,
  }));
  assert.throws(() => precondition(failedRows, () => {}), /partial failed steps/);
  const before = BASELINE_ALLOWLIST.map((migration_name, index) => ({ id: String(index), migration_name, checksum: CHECKSUMS[migration_name], started_at: null, finished_at: null, rolled_back_at: null, applied_steps_count: 0 }));
  const after = before.map((row) => ({ ...row, finished_at: '2026-09-07T00:00:00.000Z', applied_steps_count: 1 }));
  assert.equal(postcondition(before, after, () => {}), true);
  assert.throws(() => postcondition(before, after.slice(1), () => {}), /not applied/);
});

test('Preview target guard rejects a Production fingerprint reuse', () => {
  const databaseUrl = 'postgresql://postgres.previewref:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
  const directUrl = 'postgresql://postgres.previewref:placeholder@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require';
  const fingerprint = targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', directUrl));
  assert.throws(() => verifyPreviewMigrationTarget({ env: {
    VERCEL_ENV: 'preview', DATABASE_URL: databaseUrl, DIRECT_URL: directUrl,
    APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint,
    APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT: fingerprint,
  }, log: () => {} }), /distinct/);
});

test('workflow is protected, hardcoded, ordered and has no generic repair path', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /verify-preview-baseline-effects\.js/);
  assert.match(workflow, /verify-preview-baseline-ledger\.js --mode=pre/);
  assert.equal((workflow.match(/prisma migrate resolve --applied/g) || []).length, BASELINE_ALLOWLIST.length);
  assert.doesNotMatch(workflow, /inputs\.migration|prisma\s+migrate\s+(?:deploy|reset)|--rolled-back|\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b|db:seed|prisma\s+db\s+push/i);
  assert.match(workflow, /MIGRATION_DEPLOY_EXECUTED=NO/);
  assert.match(workflow, /BASELINE_RECONSTRUCTION_POSTCHECK=PASS/);
});

test('partial semantic preflight is before every possible resolve command', () => {
  const effectPosition = workflow.indexOf('verify-preview-baseline-effects.js');
  const ledgerPosition = workflow.indexOf('verify-preview-baseline-ledger.js --mode=pre');
  const firstResolvePosition = workflow.indexOf('prisma migrate resolve --applied');
  assert.ok(effectPosition >= 0 && ledgerPosition >= 0 && firstResolvePosition > effectPosition && firstResolvePosition > ledgerPosition);
});
