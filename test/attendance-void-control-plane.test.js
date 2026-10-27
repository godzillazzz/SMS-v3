'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EVIDENCE_WORKFLOW_PATH,
  EXPECTED_CHANGE_PATHS,
  MIGRATIONS,
  MIGRATION_POLICY,
  PREREQUISITE,
  PRODUCTION_BASELINE_MODE,
  PRODUCTION_SOURCE_SHA,
  SOURCE_COMMIT_SHA,
  SOURCE_TREE_SHA,
  VERIFIER_PATH,
  assertApprovedSourceAncestry,
  assertExactProductionPrismaChangeSet,
  validateAttendanceVoidManifest,
  validateAttendanceVoidSource,
  validateAttendanceVoidSql,
  verifyMigrationSet
} = require('../scripts/ci/attendance-void-control-plane');
const {
  EXPECTED_CHECK_NAMES,
  assertDisposableUrl,
  createCheckCollector,
  evaluateRollbackGuard,
  evidenceDocument,
  formatCheckStatus,
  prepareBaseline,
  runEmptySchemaDiff,
  runM1BaselineSchemaDiffs,
  runPostApplySchemaDiffs,
  runPrisma,
  verifyIdempotentDeploy
} = require('../scripts/ci/attendance-void-evidence');
const { validateReleaseManifest } = require('../scripts/ci/verify-release-manifest');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, '.github/releases/approved-attendance-void-migration.json');
const EVIDENCE_WORKFLOW = fs.readFileSync(path.join(ROOT, EVIDENCE_WORKFLOW_PATH), 'utf8');
const ROLLBACK_WORKFLOW_PATH = path.join(ROOT, '.github/workflows/rollback-production.yml');
const ROLLBACK_WORKFLOW = fs.readFileSync(ROLLBACK_WORKFLOW_PATH, 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const SQL_BY_NAME = Object.fromEntries(MIGRATIONS.map(({ name, path: migrationPath }) => [name, fs.readFileSync(path.join(ROOT, migrationPath), 'utf8')]));

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readSql(name) {
  return SQL_BY_NAME[name];
}

function evidenceDetails(name, phase) {
  if (name === 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF') {
    return phase === 'preflight'
      ? { disposable_database_to_m1_schema_diff: 'EMPTY' }
      : {
          first_deploy_migrations: MIGRATIONS.map(({ name: migration }) => migration),
          second_deploy_idempotent: true,
          full_migration_to_schema_diff: 'EMPTY',
          disposable_database_to_new_schema_diff: 'EMPTY'
        };
  }
  if (name === 'P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS') {
    return phase === 'preflight'
      ? { row_counts_before: { attendance_sessions: 0, attendance_events: 0, attendance_selfie_policies: 4 }, source_migration_checksums_verified: true, no_data_backfill_or_DML_in_approved_SQL: true }
      : { post_schema_verified: true, row_counts_unchanged: true, migration_checksums: MIGRATIONS.map(({ name: migration }) => ({ migration_name: migration, checksum_match: true })) };
  }
  if (name === 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY') {
    return phase === 'preflight'
      ? { old_application_schema_read: 'PASS', new_application_schema_read: 'NOT_RUN', database_writes: false }
      : { old_application_schema_read: 'PASS', new_application_schema_read: 'PASS', database_writes: false };
  }
  return { checked: true };
}

test('manifest pins exact source/tree, M2-M5 order, M1 checksum and non-Production policy', () => {
  const result = validateAttendanceVoidManifest(MANIFEST, { root: ROOT });
  assert.equal(SOURCE_COMMIT_SHA, 'a50f99618ea9545668ad10152947fa126c6fc533');
  assert.equal(SOURCE_TREE_SHA, git(['rev-parse', `${SOURCE_COMMIT_SHA}^{tree}`]));
  assert.equal(PRODUCTION_SOURCE_SHA, '83fa98c9e9cd19fc09e27b5ad106d3eee9551442');
  assert.equal(PRODUCTION_BASELINE_MODE, 'IMMUTABLE_EXTERNAL_BASELINE_EXACT_PRISMA_DIFF');
  assert.deepEqual(result.migrationNames, MIGRATIONS.map(({ name }) => name));
  assert.deepEqual(result.migrationPaths, MIGRATIONS.map(({ path: migrationPath }) => migrationPath));
  assert.equal(result.migrationPolicy, 'ADDITIVE_ENUM_COLUMNS_CONSTRAINT_SWAP_PARTIAL_UNIQUE');
  assert.deepEqual(result.prerequisiteMigration, PREREQUISITE);
  assert.equal(result.preflightEvidenceRunId, null);
  assert.equal(result.dataMutation, false);
  assert.equal(result.dataBackfill, false);
  assert.equal(result.applicationDeploy, false);
  assert.equal(result.destructiveRollback, false);
  assert.equal(result.rollbackPolicy, 'FIX_FORWARD_OR_OWNER_APPROVED_PITR');
  assert.equal(result.appRollbackPrecondition, 'ZERO_VOIDED_ROWS');
  assert.equal(result.maintenanceWindowRequired, true);
  assert.equal(MANIFEST.production_dispatch_authorized, false);
  assert.deepEqual(EXPECTED_CHANGE_PATHS, git(['diff', '--name-only', PRODUCTION_SOURCE_SHA, SOURCE_COMMIT_SHA, '--', 'prisma/schema.prisma', 'prisma/migrations']).split('\n').sort());
});

test('exact source/tree/provenance and M1-M5 SQL checksums are mechanically verified', () => {
  const result = validateAttendanceVoidSource(MANIFEST, ROOT);
  assert.equal(result.sourceCommitSha, SOURCE_COMMIT_SHA);
  assert.equal(result.sourceTreeSha, SOURCE_TREE_SHA);
  assert.equal(result.productionBaselineMode, PRODUCTION_BASELINE_MODE);
  assert.equal(result.canonicalIntegrationSha, git(['rev-parse', 'refs/remotes/origin/fix/serverless-database-reliability']));
  assert.equal(result.sourceOnCanonicalIntegration, true);
  assert.equal(result.exactPrismaChangeSet, true);
  for (const migration of [PREREQUISITE, ...MIGRATIONS]) {
    const content = execFileSync('git', ['show', `${SOURCE_COMMIT_SHA}:${migration.path}`], { cwd: ROOT, encoding: 'buffer' });
    const hash = require('node:crypto').createHash('sha256').update(content).digest('hex');
    assert.equal(hash, migration.sha256, migration.name);
  }
  for (const migration of MIGRATIONS) assert.equal(validateAttendanceVoidSql(migration.name, readSql(migration.name)).sha256, migration.sha256);
});

test('immutable Production baseline needs no shared history while unrelated approved-source roots fail ancestry guards', () => {
  const tempRoot = process.env.TMPDIR || os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempRoot, 'attendance-void-provenance-'));
  const runGit = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    runGit(['init', '-q', '-b', 'production']);
    runGit(['config', 'user.name', 'SMS-v3 provenance test']);
    runGit(['config', 'user.email', 'provenance-test@example.invalid']);
    fs.writeFileSync(path.join(root, 'production.txt'), 'production lineage\n');
    runGit(['add', 'production.txt']);
    runGit(['commit', '-q', '-m', 'immutable external Production baseline']);
    const productionSha = runGit(['rev-parse', 'HEAD']);
    runGit(['switch', '-q', '--orphan', 'approved']);
    fs.writeFileSync(path.join(root, 'approved.txt'), 'approved source lineage\n');
    runGit(['add', '-A']);
    runGit(['commit', '-q', '-m', 'approved source external lineage']);
    const approvedSha = runGit(['rev-parse', 'HEAD']);
    assert.throws(() => runGit(['merge-base', productionSha, approvedSha]));
    runGit(['switch', '-q', '-c', 'control']);
    fs.writeFileSync(path.join(root, 'control.txt'), 'control plane\n');
    runGit(['add', 'control.txt']);
    runGit(['commit', '-q', '-m', 'control descendant']);
    const controlSha = runGit(['rev-parse', 'HEAD']);
    const canonicalRef = 'refs/remotes/origin/fix/serverless-database-reliability';
    runGit(['update-ref', canonicalRef, controlSha]);
    assert.equal(assertApprovedSourceAncestry(root, approvedSha, controlSha, canonicalRef), controlSha);

    runGit(['switch', '-q', '--orphan', 'unrelated']);
    fs.writeFileSync(path.join(root, 'unrelated.txt'), 'unrelated root\n');
    runGit(['add', '-A']);
    runGit(['commit', '-q', '--allow-empty', '-m', 'unrelated root']);
    const unrelatedSha = runGit(['rev-parse', 'HEAD']);
    assert.throws(() => assertApprovedSourceAncestry(root, approvedSha, unrelatedSha, canonicalRef), /approved application source must be an ancestor of the control-plane checkout/);
    runGit(['update-ref', canonicalRef, unrelatedSha]);
    assert.throws(() => assertApprovedSourceAncestry(root, approvedSha, controlSha, canonicalRef), /approved application source must be an ancestor of canonical Integration/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unrelated Production baseline is accepted only for the exact M1-M5/schema Prisma diff', () => {
  const tempRoot = process.env.TMPDIR || os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempRoot, 'attendance-void-prisma-diff-'));
  const runGit = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    runGit(['init', '-q', '-b', 'production']);
    runGit(['config', 'user.name', 'SMS-v3 provenance test']);
    runGit(['config', 'user.email', 'provenance-test@example.invalid']);
    for (const relativePath of EXPECTED_CHANGE_PATHS) {
      const file = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'Production baseline');
    }
    runGit(['add', '-A']);
    runGit(['commit', '-q', '-m', 'immutable external Production baseline']);
    const productionSha = runGit(['rev-parse', 'HEAD']);
    runGit(['switch', '-q', '--orphan', 'approved']);
    for (const relativePath of EXPECTED_CHANGE_PATHS) {
      const file = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'approved source');
    }
    runGit(['add', '-A']);
    runGit(['commit', '-q', '-m', 'approved source on unrelated root']);
    const sourceSha = runGit(['rev-parse', 'HEAD']);
    assert.throws(() => runGit(['merge-base', productionSha, sourceSha]));
    assert.equal(assertExactProductionPrismaChangeSet(root, productionSha, sourceSha), true);

    fs.mkdirSync(path.join(root, 'prisma/migrations/unapproved'), { recursive: true });
    fs.writeFileSync(path.join(root, 'prisma/migrations/unapproved/migration.sql'), 'unexpected migration');
    runGit(['add', '-A']);
    runGit(['commit', '-q', '-m', 'unexpected migration path']);
    assert.throws(() => assertExactProductionPrismaChangeSet(root, productionSha, runGit(['rev-parse', 'HEAD'])), /Prisma diff is not exactly M1-M5 plus prisma\/schema.prisma/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('valid exact M2-M5 set passes the strict migration allowlist', () => {
  const result = verifyMigrationSet({
    migrationNames: MIGRATIONS.map(({ name }) => name),
    migrationPaths: MIGRATIONS.map(({ path: migrationPath }) => migrationPath),
    migrationSqlByName: SQL_BY_NAME
  });
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(({ dropCount }) => dropCount), [0, 0, 1, 1]);
});

test('one-byte SQL mutation fails the pinned SHA-256 check', () => {
  const name = MIGRATIONS[1].name;
  const mutated = readSql(name).replace('voided_at', 'voided_ax');
  assert.throws(() => validateAttendanceVoidSql(name, mutated), /SQL sha256 mismatch/);
});

test('DROP COLUMN, DML/backfill, GRANT/POLICY and arbitrary DROP all fail closed', () => {
  const name = MIGRATIONS[1].name;
  for (const poison of [
    'ALTER TABLE "attendance_sessions" DROP COLUMN "work_date";',
    'UPDATE "attendance_sessions" SET "state" = \'VOIDED\';',
    'INSERT INTO "attendance_events" DEFAULT VALUES;',
    'DELETE FROM "attendance_sessions";',
    'TRUNCATE TABLE "attendance_sessions";',
    'GRANT SELECT ON TABLE "attendance_sessions" TO authenticated;',
    'CREATE POLICY "unsafe" ON public."attendance_sessions" USING (true);',
    'DROP TABLE "attendance_events";'
  ]) {
    assert.throws(() => validateAttendanceVoidSql(name, `${readSql(name)}\n${poison}`), /SQL sha256 mismatch/);
    assert.throws(() => validateAttendanceVoidSql(name, `${readSql(name)}\n${poison}`, { verifyChecksum: false }), /forbidden|unapproved DROP/);
  }
});

test('reordered migration list and removed M2 fail exact set and order checks', () => {
  const names = MIGRATIONS.map(({ name }) => name);
  const paths = MIGRATIONS.map(({ path: migrationPath }) => migrationPath);
  assert.throws(() => verifyMigrationSet({ migrationNames: [...names].reverse(), migrationPaths: [...paths].reverse(), migrationSqlByName: SQL_BY_NAME }), /not exactly M2→M3→M4→M5/);
  assert.throws(() => verifyMigrationSet({ migrationNames: names.slice(1), migrationPaths: paths.slice(1), migrationSqlByName: Object.fromEntries(Object.entries(SQL_BY_NAME).filter(([name]) => name !== names[0])) }), /not exactly M2→M3→M4→M5/);
});

test('allowed drops are bound to their named file and exact required paired ADD', () => {
  const m4 = MIGRATIONS[2];
  const m5 = MIGRATIONS[3];
  const wrongM4 = readSql(m4.name).replace('attendance_sessions_shift_assignment_id_key', 'other_index');
  const wrongM5 = readSql(m5.name).replace('attendance_sessions_closed_state_check', 'other_constraint');
  assert.throws(() => validateAttendanceVoidSql(m4.name, wrongM4), /SQL sha256 mismatch/);
  assert.throws(() => validateAttendanceVoidSql(m4.name, wrongM4, { verifyChecksum: false }), /exact allowlisted statement/);
  assert.throws(() => validateAttendanceVoidSql(m5.name, wrongM5), /SQL sha256 mismatch/);
  assert.throws(() => validateAttendanceVoidSql(m5.name, wrongM5, { verifyChecksum: false }), /exact allowlisted statement/);

  const m4WithoutPairedAdd = readSql(m4.name).replace(/CREATE UNIQUE INDEX "attendance_sessions_one_live_per_assignment_key"[\s\S]*?;/, '');
  const m5WithoutPairedAdd = readSql(m5.name).replace(/ALTER TABLE "attendance_sessions"\s+ADD CONSTRAINT[\s\S]*?;/, '');
  assert.throws(() => validateAttendanceVoidSql(m4.name, m4WithoutPairedAdd, { verifyChecksum: false }), /M4 must contain exactly one approved index swap/);
  assert.throws(() => validateAttendanceVoidSql(m5.name, m5WithoutPairedAdd, { verifyChecksum: false }), /M5 must contain only the closed-state/);
});

test('M4 and M5 drops cannot be moved into another migration file', () => {
  assert.throws(() => validateAttendanceVoidSql(MIGRATIONS[0].name, readSql(MIGRATIONS[0].name) + '\nDROP INDEX IF EXISTS "attendance_sessions_shift_assignment_id_key";', { verifyChecksum: false }), /unapproved DROP/);
  assert.throws(() => validateAttendanceVoidSql(MIGRATIONS[1].name, readSql(MIGRATIONS[1].name) + '\nALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_closed_state_check";', { verifyChecksum: false }), /unapproved DROP/);
});

test('rollback guard permits application rollback only on verified zero counts; otherwise fix-forward', () => {
  assert.deepEqual(evaluateRollbackGuard({ attendance_sessions_voided: 0, attendance_events_voided: 0 }), {
    status: 'APP_ROLLBACK_ALLOWED_ZERO_VOIDED_ROWS',
    migration_rollback: 'NOT_PERFORMED'
  });
  assert.equal(evaluateRollbackGuard({ attendance_sessions_voided: 1, attendance_events_voided: 0 }).status, 'FIX_FORWARD_REQUIRED');
  assert.equal(evaluateRollbackGuard({ attendance_sessions_voided: 0, attendance_events_voided: 1 }).status, 'FIX_FORWARD_REQUIRED');
  assert.throws(() => evaluateRollbackGuard({ attendance_sessions_voided: null, attendance_events_voided: 0 }), /counts are missing/);
});

test('rollback workflow verifies database target and runs read-only VOIDED guard before promotion', () => {
  assert.match(ROLLBACK_WORKFLOW, /APPROVED_DATABASE_TARGET_FINGERPRINT:/);
  assert.match(ROLLBACK_WORKFLOW, /verify-deployment-target\.js --verify/);
  assert.match(ROLLBACK_WORKFLOW, /attendance-void-rollback-guard\.js/);
  assert.ok(ROLLBACK_WORKFLOW.indexOf('attendance-void-rollback-guard.js') < ROLLBACK_WORKFLOW.indexOf('Promote application deployment only'));
  assert.match(ROLLBACK_WORKFLOW, /DATABASE migration rollback: not performed|migration rollback: NOT_PERFORMED/i);
  const guard = fs.readFileSync(path.join(ROOT, 'scripts/ci/attendance-void-rollback-guard.js'), 'utf8');
  assert.match(guard, /SET TRANSACTION READ ONLY/);
  assert.match(guard, /state.*VOIDED/s);
  assert.doesNotMatch(guard, /\$executeRawUnsafe\(['"`].*(?:UPDATE|DELETE|INSERT|DROP|TRUNCATE)/is);
  assert.doesNotMatch(ROLLBACK_WORKFLOW, /prisma migrate (?:deploy|reset|resolve)|PITR|point.in.time recovery/i);
});

test('preflight evidence only accepts the disposable CI PostgreSQL aliases and identity', () => {
  const env = { ATTENDANCE_VOID_DISPOSABLE_DATABASE: 'true' };
  assert.deepEqual(assertDisposableUrl('postgresql://ci_user:ci_test_only@postgres:5432/sms_v3_test', 'sms_v3_test', env), {
    hostAlias: 'postgres', databaseName: 'sms_v3_test', roleName: 'ci_user'
  });
  for (const rawUrl of [
    'postgresql://user:secret@127.0.0.1:5432/sms_v3_test',
    'postgresql://ci_user:ci_test_only@postgres:5432/production',
    'postgresql://ci_user:ci_test_only@other:5432/sms_v3_test'
  ]) assert.throws(() => assertDisposableUrl(rawUrl, 'sms_v3_test', env));
  assert.throws(() => assertDisposableUrl('postgresql://ci_user:***@postgres:5432/sms_v3_test', 'sms_v3_test', {}), /guard is not enabled/);
});

test('disposable baseline paths use the exact M1 schema and migration history', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-void-m1-baseline-test-'));
  let baseline;
  try {
    baseline = prepareBaseline({ root: ROOT, tempRoot });
    const expectedSchema = execFileSync('git', ['show', '56c33991503e09c5904279205fe1aaa423a8b219:prisma/schema.prisma'], { cwd: ROOT, encoding: 'buffer' });
    assert.deepEqual(fs.readFileSync(baseline.schemaPath), expectedSchema);
    const sourceMigrations = execFileSync('git', ['ls-tree', '-d', '--name-only', `${SOURCE_COMMIT_SHA}:prisma/migrations`], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).sort();
    const expectedM1Migrations = sourceMigrations.filter((name) => name <= PREREQUISITE.name);
    assert.deepEqual(fs.readdirSync(baseline.migrationsRoot).filter((name) => name !== 'migration_lock.toml').sort(), expectedM1Migrations);
    assert.equal(expectedM1Migrations.at(-1), PREREQUISITE.name);
    assert.equal(baseline.migrationCount, expectedM1Migrations.length);
    assert.equal(baseline.fullSchemaPath, path.join(baseline.baselineRoot, 'target/schema.prisma'));
    assert.deepEqual(fs.readFileSync(baseline.fullSchemaPath), execFileSync('git', ['show', `${SOURCE_COMMIT_SHA}:prisma/schema.prisma`], { cwd: ROOT, encoding: 'buffer' }));
  } finally {
    if (baseline) fs.rmSync(baseline.baselineRoot, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('P10 compares disposable DB schema to M1 baseline before apply and to full schema after apply', () => {
  const env = {
    ATTENDANCE_VOID_DISPOSABLE_DATABASE: 'true',
    DIRECT_URL: 'postgresql://ci_user:ci_test_only@postgres:5432/sms_v3_test',
    SHADOW_DATABASE_URL: 'postgresql://ci_user:ci_test_only@postgres:5432/sms_v3_shadow'
  };
  const baseline = {
    migrationsRoot: '/tmp/m1/prisma/migrations',
    schemaPath: '/tmp/m1/prisma/schema.prisma',
    fullMigrationRoot: path.join(ROOT, 'prisma/migrations'),
    fullSchemaPath: path.join(ROOT, 'prisma/schema.prisma')
  };
  const calls = [];
  const runner = (args) => { calls.push(args); return 'No difference detected.'; };

  const m1BaselineDiffs = runM1BaselineSchemaDiffs(baseline, env, ROOT, runner);
  assert.deepEqual(m1BaselineDiffs, {
    disposable_database_to_m1_schema_diff: 'EMPTY'
  });
  const checks = createCheckCollector();
  checks.partial('preflight', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', m1BaselineDiffs);
  assert.equal(checks.complete().P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF.preflight.status, 'PARTIAL');
  assert.throws(() => checks.pass('preflight', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', m1BaselineDiffs), /P10 preflight must be PARTIAL/);
  assert.throws(() => checks.partial('preflight', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', { deferred: true }), /P10 M1 baseline schema evidence is incomplete/);
  assert.deepEqual(calls, [
    ['migrate', 'diff', '--from-url', env.DIRECT_URL, '--to-schema-datamodel', baseline.schemaPath, '--exit-code']
  ]);

  calls.length = 0;
  assert.deepEqual(runPostApplySchemaDiffs(baseline, env, ROOT, runner), {
    full_migration_to_schema_diff: 'EMPTY',
    disposable_database_to_new_schema_diff: 'EMPTY'
  });
  assert.deepEqual(calls, [
    ['migrate', 'diff', '--from-migrations', baseline.fullMigrationRoot, '--to-schema-datamodel', baseline.fullSchemaPath, '--shadow-database-url', env.SHADOW_DATABASE_URL, '--exit-code'],
    ['migrate', 'diff', '--from-url', env.DIRECT_URL, '--to-schema-datamodel', baseline.fullSchemaPath, '--exit-code']
  ]);
});

test('P10 fails closed on a non-empty schema diff or a second deploy that applies migrations', () => {
  const env = {
    ATTENDANCE_VOID_DISPOSABLE_DATABASE: 'true',
    DIRECT_URL: 'postgresql://ci_user:ci_test_only@postgres:5432/sms_v3_test',
    SHADOW_DATABASE_URL: 'postgresql://ci_user:ci_test_only@postgres:5432/sms_v3_shadow'
  };
  const baseline = {
    migrationsRoot: '/tmp/m1/migrations',
    schemaPath: '/tmp/m1/schema.prisma',
    fullSchemaPath: '/repo/prisma/schema.prisma'
  };
  assert.throws(() => runM1BaselineSchemaDiffs(baseline, env, ROOT, (args) => args.includes('--from-url') ? 'ALTER TABLE unexpected' : ''), /disposable database to M1 schema diff is not empty/);
  assert.equal(verifyIdempotentDeploy(baseline.fullSchemaPath, env, ROOT, () => 'No pending migrations to apply.'), true);
  assert.throws(() => verifyIdempotentDeploy(baseline.fullSchemaPath, env, ROOT, () => 'Applying migration 202610230002_attendance_void_closed_state'), /attempted to apply an additional migration/);
  assert.throws(() => verifyIdempotentDeploy(baseline.fullSchemaPath, env, ROOT, () => 'unexpected Prisma output'), /not recognizable/);
});

test('P10 failure evidence captures bounded redacted diff output without passing a non-empty diff', () => {
  const label = 'disposable database to M1 schema diff';
  const secretUrl = 'postgresql://ci_user:password123@postgres:5432/sms_v3_test?token=hidden';
  const stderr = `Prisma diff target ${secretUrl}; owner@example.com token=hidden-token`;
  const runnerError = Object.assign(new Error('Prisma diff failed'), {
    status: 2,
    stdout: 'ALTER TABLE "attendance_sessions" ADD COLUMN "unexpected" TEXT;\n',
    stderr
  });
  assert.throws(() => runEmptySchemaDiff([], {}, label, ROOT, () => { throw runnerError; }), (error) => {
    assert.equal(error.code, label);
    assert.match(error.message, /exit=2/);
    assert.deepEqual(error.details, {
      command_label: label,
      exit_code: 2,
      stdout: 'ALTER TABLE "attendance_sessions" ADD COLUMN "unexpected" TEXT;\n',
      stderr: 'Prisma diff target [REDACTED CONNECTION STRING] [REDACTED EMAIL] token=[REDACTED]'
    });

    const checks = createCheckCollector();
    checks.fail('preflight', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', { failure: error.details });
    const document = evidenceDocument({
      status: 'FAIL',
      metadata: null,
      preflight: { checks },
      startedAt: 'start',
      completedAt: 'end',
      failureCode: error.code
    });
    const serialized = JSON.stringify(document);
    const artifact = JSON.parse(serialized);
    assert.equal(artifact.evidence_status, 'FAIL');
    assert.equal(artifact.checks.P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF.preflight.status, 'FAIL');
    assert.deepEqual(artifact.checks.P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF.preflight.failure, error.details);
    assert.equal(artifact.checks.P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS.preflight.status, 'NOT_RUN');
    assert.equal(artifact.checks.P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY.preflight.status, 'NOT_RUN');
    assert.doesNotMatch(serialized, /password123|hidden-token|owner@example\.com|postgresql:\/\//);
    return true;
  });

  assert.throws(() => runEmptySchemaDiff([], {}, label, ROOT, () => 'ALTER TABLE unexpected;'), (error) => {
    assert.match(error.message, /is not empty/);
    assert.equal(error.details.command_label, label);
    assert.equal(error.details.exit_code, 0);
    assert.equal(error.details.stdout, 'ALTER TABLE unexpected;');
    return true;
  });

  const oversized = 'ALTER TABLE unexpected;'.repeat(1000);
  assert.throws(() => runEmptySchemaDiff([], {}, label, ROOT, () => oversized), (error) => {
    assert.equal(error.details.stdout.length, 12_000 + '...[truncated]'.length);
    assert.ok(error.details.stdout.endsWith('...[truncated]'));
    return true;
  });
});

test('Prisma migrate diff preserves bounded diagnostics on nonzero exit while other Prisma errors stay generic', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-void-prisma-runner-test-'));
  const cliPath = path.join(tempRoot, 'node_modules/prisma/build/index.js');
  const label = 'disposable database to M1 schema diff';
  const diff = 'ALTER TABLE "attendance_sessions" ADD COLUMN "unexpected" TEXT;';
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  try {
    fs.writeFileSync(cliPath, `process.stdout.write(${JSON.stringify(diff)}); process.stderr.write('P1000 postgresql://ci_user:password@postgres:5432/sms_v3_test'); process.exit(2);`);
    assert.throws(() => runPrisma(['migrate', 'diff'], {}, label, tempRoot), (error) => {
      assert.equal(error.status, 2);
      assert.equal(error.details.command_label, label);
      assert.equal(error.details.exit_code, 2);
      assert.equal(error.details.stdout, diff);
      assert.equal(error.details.stderr, 'P1000 [REDACTED CONNECTION STRING]');
      assert.doesNotMatch(JSON.stringify(error.details), /password|postgresql:\/\//);
      return true;
    });

    fs.writeFileSync(cliPath, "process.stdout.write('do not retain this output'); process.stderr.write('error'); process.exit(1);");
    assert.throws(() => runPrisma(['migrate', 'deploy'], {}, 'approved deploy', tempRoot), (error) => {
      assert.equal(error.details, undefined);
      assert.equal(error.stdout, undefined);
      return true;
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('evidence status formatting reports real per-phase results and rejects deferred P10-P12 PASS', () => {
  assert.equal(formatCheckStatus('P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', {
    preflight: { status: 'PARTIAL' }, post_apply: { status: 'NOT_RUN' }
  }), 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF=preflight:PARTIAL,post_apply:NOT_RUN');
  const checks = createCheckCollector();
  assert.throws(() => checks.pass('preflight', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', {
    disposable_database_to_m1_schema_diff: 'EMPTY'
  }), /P10 preflight must be PARTIAL/);
  assert.doesNotThrow(() => checks.pass('preflight', 'P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS', evidenceDetails('P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS', 'preflight')));
  assert.throws(() => checks.partial('preflight', 'P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS', { deferred: true }), /partial evidence is allowed/);
  assert.throws(() => checks.pass('preflight', 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY', { old_application_schema_read: 'PASS', new_application_schema_read: 'NOT_RUN', database_writes: false }), /P12 preflight/);
});

test('evidence collector requires every P1-P12 in both read-only preflight and post-apply phases', () => {
  const checks = createCheckCollector();
  for (const name of EXPECTED_CHECK_NAMES) {
    if (['P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY'].includes(name)) checks.partial('preflight', name, evidenceDetails(name, 'preflight'));
    else checks.pass('preflight', name, evidenceDetails(name, 'preflight'));
  }
  assert.throws(() => checks.assertComplete(), /post-apply evidence is not PASS/);
  for (const name of EXPECTED_CHECK_NAMES) checks.pass('post_apply', name, evidenceDetails(name, 'post_apply'));
  checks.assertComplete();
  const completed = checks.complete();
  assert.equal(Object.keys(completed).length, 12);
  const document = evidenceDocument({ status: 'PASS', metadata: {}, preflight: { checks }, postflight: { checks }, startedAt: 'start', completedAt: 'end' });
  assert.equal(document.checks.P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF.preflight.status, 'PARTIAL');
  assert.equal(document.checks.P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF.post_apply.status, 'PASS');
  assert.equal(document.checks.P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY.preflight.status, 'PARTIAL');
  assert.equal(document.checks.P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY.post_apply.status, 'PASS');
});

test('disposable evidence workflow cannot target Production/UAT or real credentials', () => {
  assert.match(EVIDENCE_WORKFLOW, /postgres:16-alpine/);
  assert.match(EVIDENCE_WORKFLOW, /ATTENDANCE_VOID_DISPOSABLE_DATABASE: 'true'/);
  assert.match(EVIDENCE_WORKFLOW, /ci_test_only/);
  assert.match(EVIDENCE_WORKFLOW, /sms_v3_test/);
  assert.match(EVIDENCE_WORKFLOW, /sms_v3_shadow/);
  assert.match(EVIDENCE_WORKFLOW, /upload-artifact@v4/);
  assert.match(EVIDENCE_WORKFLOW, /retention-days:/);
  assert.doesNotMatch(EVIDENCE_WORKFLOW, /secrets\.(?:DATABASE_URL|DIRECT_URL|VERCEL_TOKEN)/);
  assert.doesNotMatch(EVIDENCE_WORKFLOW, /environment:\s*production|environment:\s*uat/i);
  assert.doesNotMatch(EVIDENCE_WORKFLOW, /vercel(?:\.vercel)?\.app|supabase\.co/i);
  assert.match(EVIDENCE_WORKFLOW, /npm run prisma:generate/);
  assert.match(EVIDENCE_WORKFLOW, /attendance-void-evidence\.js run/);
});

test('application release retains separate run_migrations=false and rejects missing migration evidence IDs', () => {
  const productionManifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.github/releases/approved-production.json'), 'utf8'));
  assert.equal(productionManifest.run_migrations, false);
  assert.notEqual(productionManifest.pre_applied_migration_manifest_path, MANIFEST.evidence_workflow_path);
  assert.equal(productionManifest.pre_applied_migration_evidence_run_id == null, false);
  assert.throws(() => validateReleaseManifest({
    ...productionManifest,
    pre_applied_migration_manifest_path: '.github/releases/approved-attendance-void-migration.json',
    pre_applied_migration_evidence_run_id: null
  }), /invalid pre_applied_migration_evidence_run_id/);
});

test('exact approved source has the fixed M1-M5/schema-only Prisma diff and no new migration SQL is authored here', () => {
  assert.deepEqual(EXPECTED_CHANGE_PATHS, [
    ...[PREREQUISITE.path, ...MIGRATIONS.map(({ path: migrationPath }) => migrationPath), 'prisma/schema.prisma'].sort()
  ]);
  assert.equal(git(['diff', '--name-only', SOURCE_COMMIT_SHA, 'HEAD', '--', 'prisma/migrations', 'prisma/schema.prisma']).split('\n').filter(Boolean).length, 0);
  const manifestCheck = validateAttendanceVoidManifest(MANIFEST, { root: ROOT });
  assert.equal(manifestCheck.sqlResults.length, 4);
});
