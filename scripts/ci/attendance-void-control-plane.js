'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_COMMIT_SHA = 'a50f99618ea9545668ad10152947fa126c6fc533';
const SOURCE_TREE_SHA = '09bbaa8fd99ce8dd22e16212b93c0a2ee03964b5';
// Production is an immutable external baseline; compatibility is proven by the exact Prisma diff, not Git ancestry.
const PRODUCTION_SOURCE_SHA = '83fa98c9e9cd19fc09e27b5ad106d3eee9551442';
const PRODUCTION_BASELINE_MODE = 'IMMUTABLE_EXTERNAL_BASELINE_EXACT_PRISMA_DIFF';
const MIGRATION_POLICY = 'ADDITIVE_ENUM_COLUMNS_CONSTRAINT_SWAP_PARTIAL_UNIQUE';
const EVIDENCE_WORKFLOW_PATH = '.github/workflows/apply-approved-attendance-void-non-production-evidence.yml';
const VERIFIER_PATH = 'scripts/ci/attendance-void-evidence.js';
const PREREQUISITE = Object.freeze({
  name: '202610200001_attendance_selfie_policy',
  path: 'prisma/migrations/202610200001_attendance_selfie_policy/migration.sql',
  sha256: 'fe78d650a67a14d7adf5739be7194b3dbc2287dd98d6bf1d83ee831734b47231'
});
const MIGRATIONS = Object.freeze([
  Object.freeze({
    name: '202610220001_attendance_void_uat_reset',
    path: 'prisma/migrations/202610220001_attendance_void_uat_reset/migration.sql',
    sha256: '355ed9327f10da8f2b3e38810bbd3a397065d0f209ac912b6b672a1f6f7fde81'
  }),
  Object.freeze({
    name: '202610220002_attendance_void_schema',
    path: 'prisma/migrations/202610220002_attendance_void_schema/migration.sql',
    sha256: '5ceebfb2e579e8e992c85464b562d87f17c09d270be2c81a07f3a0d59d7687c8'
  }),
  Object.freeze({
    name: '202610230001_attendance_session_history',
    path: 'prisma/migrations/202610230001_attendance_session_history/migration.sql',
    sha256: 'd94a3772f9a271a1c17b2e0f7894c56b05fc540c091639c8c75474a93cfe12a7'
  }),
  Object.freeze({
    name: '202610230002_attendance_void_closed_state',
    path: 'prisma/migrations/202610230002_attendance_void_closed_state/migration.sql',
    sha256: '70d749b67f84d81089ddc17859575934226d499885fb4d261635c75a7288110b'
  })
]);
const MIGRATION_BY_NAME = new Map(MIGRATIONS.map((migration) => [migration.name, migration]));
const EXPECTED_CHANGE_PATHS = Object.freeze([
  PREREQUISITE.path,
  ...MIGRATIONS.map((migration) => migration.path),
  'prisma/schema.prisma'
].sort());

function assert(condition, message) {
  if (!condition) throw new Error(`attendance void control-plane guard: ${message}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeStatements(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function validateAttendanceVoidSql(migrationName, sql, { verifyChecksum = true } = {}) {
  const profile = MIGRATION_BY_NAME.get(migrationName);
  assert(profile, 'migration name is not in the exact M2-M5 allowlist');
  const source = String(sql || '');
  if (verifyChecksum) assert(sha256(source) === profile.sha256, `${migrationName} SQL sha256 mismatch`);
  const statements = normalizeStatements(source);
  const sqlWithoutComments = source.replace(/--[^\n]*/g, '');
  assert(!/(?:^|;)\s*(?:INSERT\s+INTO|UPDATE\b|DELETE\s+FROM|TRUNCATE\b|GRANT\b|REVOKE\b|CREATE\s+POLICY|DROP\s+POLICY)\b/im.test(sqlWithoutComments), `${migrationName} DML/backfill/privilege/policy mutation is forbidden`);
  const allowedDrop = migrationName === '202610230001_attendance_session_history'
    ? 'DROP INDEX IF EXISTS "attendance_sessions_shift_assignment_id_key"'
    : migrationName === '202610230002_attendance_void_closed_state'
      ? 'ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_closed_state_check"'
      : null;
  const dropTokens = (sqlWithoutComments.match(/\bDROP\b/gi) || []).length;
  assert(dropTokens === (allowedDrop ? 1 : 0), `${migrationName} contains an unapproved DROP statement`);

  const drops = statements.filter((statement) => /^DROP\b/i.test(statement));
  if (migrationName === '202610220001_attendance_void_uat_reset') {
    assert(statements.length === 2, 'M2 must contain exactly the two approved enum additions');
    assert(drops.length === 0, 'M2 must not contain DROP');
    assert(statements[0] === 'ALTER TYPE "AttendanceSessionState" ADD VALUE IF NOT EXISTS \'VOIDED\'', 'M2 AttendanceSessionState addition mismatch');
    assert(statements[1] === 'CREATE TYPE "AttendanceEventState" AS ENUM (\'ACTIVE\', \'VOIDED\')', 'M2 AttendanceEventState addition mismatch');
  } else if (migrationName === '202610220002_attendance_void_schema') {
    assert(statements.length === 8, 'M3 must contain exactly eight additive DDL statements');
    assert(drops.length === 0, 'M3 must not contain DROP');
    assert((source.match(/\bADD\s+COLUMN\b/gi) || []).length === 7, 'M3 must add exactly seven columns');
    assert((source.match(/\bADD\s+CONSTRAINT\b/gi) || []).length === 4, 'M3 must add exactly four constraints');
    assert((source.match(/\bCREATE\s+INDEX\b/gi) || []).length === 2, 'M3 must add exactly two indexes');
    assert(/ALTER TABLE "attendance_sessions"\s+ADD COLUMN "voided_at"/i.test(source), 'M3 session metadata columns missing');
    assert(/ALTER TABLE "attendance_events"\s+ADD COLUMN "state" "AttendanceEventState" NOT NULL DEFAULT 'ACTIVE'/i.test(source), 'M3 event state must be additive and default ACTIVE');
    assert(/attendance_sessions_voided_state_check/.test(source) && /attendance_events_voided_state_check/.test(source), 'M3 void metadata checks missing');
  } else if (migrationName === '202610230001_attendance_session_history') {
    assert(statements.length === 3, 'M4 must contain exactly one approved index swap and both required indexes');
    assert(drops.length === 1, 'M4 must contain exactly one allowed DROP');
    assert(drops[0] === 'DROP INDEX IF EXISTS "attendance_sessions_shift_assignment_id_key"', 'M4 DROP INDEX statement is not the exact allowlisted statement');
    assert(statements[0] === drops[0], 'M4 index removal must precede replacement indexes');
    assert(statements[1] === 'CREATE INDEX IF NOT EXISTS "attendance_sessions_shift_assignment_id_idx" ON "attendance_sessions"("shift_assignment_id")', 'M4 supporting index ADD does not pair with the approved unique-index swap');
    assert(statements[2] === 'CREATE UNIQUE INDEX "attendance_sessions_one_live_per_assignment_key" ON "attendance_sessions"("shift_assignment_id") WHERE "state" <> \'VOIDED\'', 'M4 required partial unique index ADD mismatch');
    assert(statements.includes(allowedDrop), 'M4 required DROP is outside its named migration');
  } else if (migrationName === '202610230002_attendance_void_closed_state') {
    assert(statements.length === 2, 'M5 must contain only the closed-state constraint swap');
    assert(statements[0] === allowedDrop, 'M5 DROP CONSTRAINT statement is not the exact allowlisted statement');
    assert(statements[0] === allowedDrop, 'M5 must drop the closed-state constraint before its replacement ADD');
    assert(/^ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_closed_state_check" CHECK \(/i.test(statements[1]), 'M5 must re-add the same closed-state constraint');
    assert(/\("state" = 'OPEN' AND "closed_at" IS NULL\)/.test(statements[1]), 'M5 OPEN-state invariant missing');
    assert(/\("state" = 'CLOSED' AND "closed_at" IS NOT NULL\)/.test(statements[1]), 'M5 CLOSED-state invariant missing');
    assert(/\("state" = 'VOIDED'\)/.test(statements[1]), 'M5 VOIDED state allowance missing');

  }

  return Object.freeze({ migrationName, sha256: profile.sha256, statementCount: statements.length, dropCount: dropTokens });
}

function git(root, args, options = {}) {
  const value = execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  return Buffer.isBuffer(value) ? value : value.trim();
}

function gitAssertion(root, args, message) {
  try {
    execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch (error) {
    const detail = String(error && error.stderr || '').trim().split(/\r?\n/)[0];
    assert(false, detail ? `${message} (git exit ${error.status}: ${detail.slice(0, 160)})` : `${message} (git exit ${error && error.status})`);
  }
}

function assertApprovedSourceAncestry(root, sourceSha, controlHeadSha, canonicalIntegrationRef) {
  gitAssertion(root, ['merge-base', '--is-ancestor', sourceSha, controlHeadSha], 'approved application source must be an ancestor of the control-plane checkout');
  gitAssertion(root, ['show-ref', '--verify', '--quiet', canonicalIntegrationRef], 'canonical Integration branch ref is unavailable');
  const canonicalIntegrationSha = git(root, ['rev-parse', canonicalIntegrationRef]);
  gitAssertion(root, ['merge-base', '--is-ancestor', sourceSha, canonicalIntegrationRef], 'approved application source must be an ancestor of canonical Integration');
  return canonicalIntegrationSha;
}

function assertExactProductionPrismaChangeSet(root, productionSha, sourceSha) {
  const changedPaths = git(root, ['diff', '--name-only', productionSha, sourceSha, '--', 'prisma/schema.prisma', 'prisma/migrations']).split('\n').filter(Boolean).sort();
  assert(JSON.stringify(changedPaths) === JSON.stringify(EXPECTED_CHANGE_PATHS), 'Production-to-application Prisma diff is not exactly M1-M5 plus prisma/schema.prisma');
  return true;
}

function validateAttendanceVoidSource(input, root) {
  assert(git(root, ['rev-parse', `${SOURCE_COMMIT_SHA}^{commit}`]) === SOURCE_COMMIT_SHA, 'approved source commit is unavailable');
  assert(git(root, ['rev-parse', `${SOURCE_COMMIT_SHA}^{tree}`]) === SOURCE_TREE_SHA, 'source commit tree SHA mismatch');
  assert(git(root, ['rev-parse', `${PRODUCTION_SOURCE_SHA}^{commit}`]) === PRODUCTION_SOURCE_SHA, 'current Production source commit is unavailable');
  const head = git(root, ['rev-parse', 'HEAD']);
  const canonicalIntegrationRef = 'refs/remotes/origin/fix/serverless-database-reliability';
  const canonicalIntegrationSha = assertApprovedSourceAncestry(root, SOURCE_COMMIT_SHA, head, canonicalIntegrationRef);
  assertExactProductionPrismaChangeSet(root, PRODUCTION_SOURCE_SHA, SOURCE_COMMIT_SHA);
  for (const migration of [{ name: PREREQUISITE.name, path: PREREQUISITE.path, sha256: PREREQUISITE.sha256 }, ...MIGRATIONS]) {
    const sourceSql = git(root, ['show', `${SOURCE_COMMIT_SHA}:${migration.path}`], { encoding: 'buffer' });
    assert(sha256(sourceSql) === migration.sha256, `${migration.name} source commit checksum mismatch`);
    const workingSql = fs.readFileSync(path.join(root, ...migration.path.split('/')));
    assert(sha256(workingSql) === migration.sha256, `${migration.name} working-tree file differs from approved source`);
  }
  return Object.freeze({ sourceCommitSha: SOURCE_COMMIT_SHA, sourceTreeSha: SOURCE_TREE_SHA, currentControlHeadSha: head, productionBaselineMode: PRODUCTION_BASELINE_MODE, canonicalIntegrationSha, sourceOnCanonicalIntegration: true, exactPrismaChangeSet: true });
}

function verifyMigrationSet({ migrationNames, migrationPaths, migrationSqlByName, verifyChecksum = true }) {
  assert(JSON.stringify(migrationNames) === JSON.stringify(MIGRATIONS.map(({ name }) => name)), 'migration set is not exactly M2→M3→M4→M5');
  assert(JSON.stringify(migrationPaths) === JSON.stringify(MIGRATIONS.map(({ path: migrationPath }) => migrationPath)), 'migration paths are not exactly M2→M3→M4→M5');
  assert(migrationSqlByName && typeof migrationSqlByName === 'object' && !Array.isArray(migrationSqlByName), 'migration SQL map is missing');
  const expectedNames = MIGRATIONS.map(({ name }) => name).sort();
  assert(JSON.stringify(Object.keys(migrationSqlByName).sort()) === JSON.stringify(expectedNames), 'migration SQL set contains missing or extra migrations');
  return Object.freeze(MIGRATIONS.map(({ name }) => validateAttendanceVoidSql(name, migrationSqlByName[name], { verifyChecksum })));
}

function validateAttendanceVoidManifest(input, { root = process.cwd(), verifySql = true, verifySource = true } = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'manifest must be an object');
  const allowedKeys = new Set([
    'schema_version', 'migration_id', 'manifest_state', 'source_commit_sha', 'source_tree_sha',
    'current_production_source_sha', 'target_project_name', 'target_project_id', 'target_org_id',
    'target_environment', 'evidence_environment', 'canonical_url', 'migration_policy',
    'migration_names', 'migration_paths', 'migration_checksums', 'prerequisite_migration',
    'preflight_evidence_run_id', 'data_mutation', 'data_backfill', 'application_deploy',
    'destructive_rollback', 'rollback_policy', 'app_rollback_precondition',
    'maintenance_window_required', 'production_dispatch_authorized', 'owner_action',
    'evidence_workflow_path', 'evidence_verifier_path', 'evidence_status'
  ]);
  assert(Object.keys(input).every((key) => allowedKeys.has(key)), 'manifest contains an unsupported field');
  assert(input.schema_version === 1, 'unsupported schema_version');
  assert(input.migration_id === 'ATTENDANCE-VOID', 'migration_id mismatch');
  assert(input.manifest_state === 'APPROVED_FOR_NON_PRODUCTION_EVIDENCE_ONLY', 'manifest_state must remain non-Production evidence only');
  assert(input.source_commit_sha === SOURCE_COMMIT_SHA, 'source_commit_sha mismatch');
  assert(input.source_tree_sha === SOURCE_TREE_SHA, 'source_tree_sha mismatch');
  assert(input.current_production_source_sha === PRODUCTION_SOURCE_SHA, 'current_production_source_sha mismatch');
  assert(input.target_project_name === 'sms-v3-staging', 'target_project_name mismatch');
  assert(input.target_project_id === 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s', 'target_project_id mismatch');
  assert(input.target_org_id === 'team_nemCExHbZ8EAhSgsvefHPAEz', 'target_org_id mismatch');
  assert(input.target_environment === 'production', 'target_environment mismatch');
  assert(input.evidence_environment === 'non-production-disposable-postgresql', 'evidence_environment mismatch');
  assert(input.canonical_url === 'https://sms-v3-staging-ten.vercel.app', 'canonical_url mismatch');
  assert(input.evidence_workflow_path === EVIDENCE_WORKFLOW_PATH, 'evidence_workflow_path mismatch');
  assert(input.evidence_verifier_path === VERIFIER_PATH, 'evidence_verifier_path mismatch');
  assert(input.migration_policy === MIGRATION_POLICY, 'migration_policy mismatch');
  assert(JSON.stringify(input.migration_names) === JSON.stringify(MIGRATIONS.map(({ name }) => name)), 'migration_names must be exactly M2→M3→M4→M5');
  assert(JSON.stringify(input.migration_paths) === JSON.stringify(MIGRATIONS.map(({ path: migrationPath }) => migrationPath)), 'migration_paths must be exactly M2→M3→M4→M5');
  const expectedChecksums = Object.fromEntries(MIGRATIONS.map(({ name, sha256: digest }) => [name, digest]));
  assert(input.migration_checksums && typeof input.migration_checksums === 'object' && !Array.isArray(input.migration_checksums), 'migration_checksums must be an object');
  assert(JSON.stringify(Object.keys(input.migration_checksums).sort()) === JSON.stringify(Object.keys(expectedChecksums).sort()), 'migration_checksums key set mismatch');
  for (const [name, digest] of Object.entries(expectedChecksums)) assert(input.migration_checksums[name] === digest, `migration_checksums mismatch for ${name}`);
  assert(input.prerequisite_migration && input.prerequisite_migration.name === PREREQUISITE.name, 'M1 prerequisite name mismatch');
  assert(input.prerequisite_migration.path === PREREQUISITE.path, 'M1 prerequisite path mismatch');
  assert(input.prerequisite_migration.sha256 === PREREQUISITE.sha256, 'M1 prerequisite checksum mismatch');
  assert(input.data_mutation === false, 'data_mutation must be false');
  assert(input.data_backfill === false, 'data_backfill must be false');
  assert(input.application_deploy === false, 'application_deploy must be false');
  assert(input.destructive_rollback === false, 'destructive_rollback must be false');
  assert(input.rollback_policy === 'FIX_FORWARD_OR_OWNER_APPROVED_PITR', 'rollback_policy mismatch');
  assert(input.app_rollback_precondition === 'ZERO_VOIDED_ROWS', 'app_rollback_precondition mismatch');
  assert(input.maintenance_window_required === true, 'maintenance_window_required must be true');
  assert(input.production_dispatch_authorized === false, 'production_dispatch_authorized must be false');
  assert(input.owner_action === 'NON_PRODUCTION_EVIDENCE_ONLY_NO_PRODUCTION_ACTION', 'owner_action mismatch');
  assert(input.preflight_evidence_run_id === null || (Number.isSafeInteger(input.preflight_evidence_run_id) && input.preflight_evidence_run_id > 0), 'preflight_evidence_run_id must be null or a positive verified run id');
  assert(input.evidence_status === 'NOT_RUN' || input.evidence_status === 'PASS', 'evidence_status mismatch');
  assert((input.evidence_status === 'NOT_RUN') === (input.preflight_evidence_run_id === null), 'preflight evidence run ID and evidence_status disagree');

  const sqlResults = [];
  if (verifySql) {
    for (const migration of MIGRATIONS) {
      const file = path.join(root, ...migration.path.split('/'));
      assert(fs.existsSync(file), `migration SQL file missing: ${migration.path}`);
      sqlResults.push(validateAttendanceVoidSql(migration.name, fs.readFileSync(file, 'utf8')));
    }
    const m1File = path.join(root, ...PREREQUISITE.path.split('/'));
    assert(fs.existsSync(m1File), 'M1 prerequisite SQL file missing');
    assert(sha256(fs.readFileSync(m1File)) === PREREQUISITE.sha256, 'M1 prerequisite SQL checksum mismatch');
    assert(fs.existsSync(path.join(root, ...VERIFIER_PATH.split('/'))), 'P1-P12 evidence verifier missing');
    if (verifySource) validateAttendanceVoidSource(input, root);
  }

  return Object.freeze({
    migrationId: input.migration_id,
    sourceCommitSha: input.source_commit_sha,
    sourceTreeSha: input.source_tree_sha,
    migrationNames: Object.freeze([...input.migration_names]),
    migrationPaths: Object.freeze([...input.migration_paths]),
    prerequisiteMigration: Object.freeze({ ...input.prerequisite_migration }),
    migrationPolicy: input.migration_policy,
    migrationChecksums: Object.freeze({ ...input.migration_checksums }),
    currentProductionSourceSha: input.current_production_source_sha,
    targetEnvironment: input.target_environment,
    targetProjectName: input.target_project_name,
    targetProjectId: input.target_project_id,
    targetOrgId: input.target_org_id,
    evidenceEnvironment: input.evidence_environment,
    evidenceWorkflowPath: input.evidence_workflow_path,
    evidenceVerifierPath: input.evidence_verifier_path,
    preflightEvidenceRunId: input.preflight_evidence_run_id,
    dataMutation: input.data_mutation,
    dataBackfill: input.data_backfill,
    applicationDeploy: input.application_deploy,
    destructiveRollback: input.destructive_rollback,
    rollbackPolicy: input.rollback_policy,
    appRollbackPrecondition: input.app_rollback_precondition,
    maintenanceWindowRequired: input.maintenance_window_required,
    sqlResults: Object.freeze(sqlResults)
  });
}

module.exports = {
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
  normalizeStatements,
  sha256,
  validateAttendanceVoidManifest,
  validateAttendanceVoidSource,
  assertExactProductionPrismaChangeSet,
  validateAttendanceVoidSql,
  verifyMigrationSet,
  assertApprovedSourceAncestry,
  gitAssertion
};
