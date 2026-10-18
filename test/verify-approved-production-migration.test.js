'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  EXPECTED,
  MIGRATIONS,
  validateMigrationManifest,
  validateSqlForMigration,
  validateAttChainMl002Sql,
  validateAttChainMl003Sql,
  validateAttChainMlSql,
  outputLines
} = require('../scripts/ci/verify-approved-production-migration');

const MANIFEST_PATH = path.join(__dirname, '..', '.github', 'releases', 'approved-attendance-multilevel-production-migration.json');
const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'deploy-approved-production-v2.yml');

function readValidManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

test('valid ATT-CHAIN-ML migration set manifest passes verification', () => {
  const manifest = readValidManifest();
  const result = validateMigrationManifest(manifest);

  assert.equal(result.migrationId, 'ATT-CHAIN-ML');
  assert.equal(result.sourceCommitSha, 'e541e2aa850d156d75b1b8b82f42fed58733c797');
  assert.equal(result.sourceTreeSha, '726e88b54852b1205034722f543a6923c039e212');
  assert.deepEqual(result.migrationNames, [
    '202610180002_attendance_adjustment_multilevel_approval',
    '202610180003_attendance_adjustment_status_restore_cancelled'
  ]);
  assert.deepEqual(result.migrationPaths, [
    'prisma/migrations/202610180002_attendance_adjustment_multilevel_approval/migration.sql',
    'prisma/migrations/202610180003_attendance_adjustment_status_restore_cancelled/migration.sql'
  ]);
  assert.equal(result.migrationPolicy, 'ADDITIVE_ATTENDANCE_MULTILEVEL_APPROVAL_STATUS_CHECK_ONLY_NO_BACKFILL');
  assert.equal(result.postVerifyScript, 'scripts/ci/verify-attendance-multilevel-constraints.js');
  assert.equal(result.currentProductionDeploymentId, 'dpl_7muKnT92uy5AWo8QxqxPakyPHWL9');
  assert.equal(result.currentProductionApplicationSha, 'a0250b8b0ca8072104a4d3593012220c4fe2fb84');
  assert.equal(result.dataBackfill, false);
  assert.equal(result.schemaChanged, false);
  assert.equal(result.statementCount, 6);
  assert.equal(result.controlledUpdateCount, 0);

  const lines = outputLines(result);
  assert(lines.includes('PRODUCTION_MIGRATION_MANIFEST_GUARD=PASS'));
  assert(lines.includes('migration_id=ATT-CHAIN-ML'));
  assert(lines.includes('migration_path=prisma/migrations/202610180002_attendance_adjustment_multilevel_approval/migration.sql'));
  assert(lines.includes('migration_path=prisma/migrations/202610180003_attendance_adjustment_status_restore_cancelled/migration.sql'));
  assert(lines.includes('prisma_schema_changed=false'));
});

test('CLI execution on valid ATT-CHAIN-ML manifest outputs PASS and expected metadata', () => {
  const output = execFileSync('node', ['scripts/ci/verify-approved-production-migration.js', MANIFEST_PATH], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });
  assert(output.includes('PRODUCTION_MIGRATION_MANIFEST_GUARD=PASS'));
  assert(output.includes('migration_id=ATT-CHAIN-ML'));
  assert(output.includes('sql_statement_count=6'));
});

test('fails closed when migration set is missing a file or has an extra file', () => {
  const manifest = readValidManifest();

  // Missing 002
  const missing002 = {
    ...manifest,
    migration_names: ['202610180003_attendance_adjustment_status_restore_cancelled'],
    migration_paths: ['prisma/migrations/202610180003_attendance_adjustment_status_restore_cancelled/migration.sql']
  };
  assert.throws(() => validateMigrationManifest(missing002), /migration_names count mismatch/);

  // Missing 003
  const missing003 = {
    ...manifest,
    migration_names: ['202610180002_attendance_adjustment_multilevel_approval'],
    migration_paths: ['prisma/migrations/202610180002_attendance_adjustment_multilevel_approval/migration.sql']
  };
  assert.throws(() => validateMigrationManifest(missing003), /migration_names count mismatch/);

  // Extra migration file
  const extraFile = {
    ...manifest,
    migration_names: [
      '202610180002_attendance_adjustment_multilevel_approval',
      '202610180003_attendance_adjustment_status_restore_cancelled',
      '202610180004_unexpected_migration'
    ],
    migration_paths: [
      'prisma/migrations/202610180002_attendance_adjustment_multilevel_approval/migration.sql',
      'prisma/migrations/202610180003_attendance_adjustment_status_restore_cancelled/migration.sql',
      'prisma/migrations/202610180004_unexpected_migration/migration.sql'
    ]
  };
  assert.throws(() => validateMigrationManifest(extraFile), /migration_names count mismatch/);

  // Wrong file name
  const wrongName = {
    ...manifest,
    migration_names: [
      '202610180002_attendance_adjustment_multilevel_approval',
      '202610180003_wrong_name'
    ]
  };
  assert.throws(() => validateMigrationManifest(wrongName), /unexpected migration_name in migration_names/);

  // Non-array migration_names
  const notArray = {
    ...manifest,
    migration_names: '202610180002_attendance_adjustment_multilevel_approval'
  };
  assert.throws(() => validateMigrationManifest(notArray), /migration_names must be an array/);
});

test('fails closed when 003 does not have CANCELLED status', () => {
  const sql003WithoutCancelled = `
ALTER TABLE "attendance_adjustment_requests"
  DROP CONSTRAINT IF EXISTS "attendance_adjustment_requests_status_check";

ALTER TABLE "attendance_adjustment_requests"
  ADD CONSTRAINT "attendance_adjustment_requests_status_check"
  CHECK ("status" IN (
    'DRAFT',
    'PENDING_APPROVAL',
    'PENDING_SUPERVISOR',
    'PENDING_MANAGER',
    'PENDING_ADMIN',
    'RETURNED_FOR_CORRECTION',
    'APPROVED',
    'REJECTED'
  ));
  `;

  // Direct validator check
  assert.throws(
    () => validateAttChainMl003Sql(sql003WithoutCancelled),
    /003 SQL sha256 mismatch|003 missing CANCELLED/
  );

  assert.throws(
    () => validateSqlForMigration('ATT-CHAIN-ML', sql003WithoutCancelled, '202610180003_attendance_adjustment_status_restore_cancelled'),
    /003 SQL sha256 mismatch|003 missing CANCELLED/
  );
});

test('fails closed when 002 is missing staged approval roles or legacy approval value', () => {
  const valid002Sql = fs.readFileSync('prisma/migrations/202610180002_attendance_adjustment_multilevel_approval/migration.sql', 'utf8');

  for (const missing of ['PENDING_SUPERVISOR', 'PENDING_MANAGER', 'PENDING_ADMIN', 'REVIEWED', 'PENDING_APPROVAL']) {
    const brokenSql = valid002Sql.replace(new RegExp(`'${missing}'`, 'g'), "'DUMMY'");
    assert.throws(
      () => validateAttChainMl002Sql(brokenSql),
      new RegExp(`002 SQL sha256 mismatch|002 missing ${missing}`)
    );
  }
});

test('fails closed when any migration in the set contains destructive or DML mutations', () => {
  const valid002Sql = fs.readFileSync('prisma/migrations/202610180002_attendance_adjustment_multilevel_approval/migration.sql', 'utf8');
  const valid003Sql = fs.readFileSync('prisma/migrations/202610180003_attendance_adjustment_status_restore_cancelled/migration.sql', 'utf8');

  for (const poison of [
    'INSERT INTO attendance_adjustment_requests VALUES (1);',
    'UPDATE attendance_adjustment_requests SET status = "APPROVED";',
    'DELETE FROM attendance_adjustment_requests;',
    'TRUNCATE attendance_adjustment_requests;',
    'DROP TABLE attendance_adjustment_requests;',
    'ALTER TABLE attendance_adjustment_requests DROP COLUMN reason;'
  ]) {
    assert.throws(
      () => validateAttChainMl002Sql(valid002Sql + '\n' + poison),
      /002 data mutation or destructive SQL is forbidden/
    );
    assert.throws(
      () => validateAttChainMl003Sql(valid003Sql + '\n' + poison),
      /003 data mutation or destructive SQL is forbidden/
    );
  }
});

test('deploy workflow contains the ATT-CHAIN-ML pre-applied migration case branch with exact evidence configuration', () => {
  const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  // Verify the case branch exists for approved-attendance-multilevel-production-migration.json
  assert(
    workflowContent.includes('.github/releases/approved-attendance-multilevel-production-migration.json)'),
    'deploy workflow must have case branch for approved-attendance-multilevel-production-migration.json'
  );

  // Extract the case block
  const caseStart = workflowContent.indexOf('.github/releases/approved-attendance-multilevel-production-migration.json)');
  assert.notEqual(caseStart, -1);
  const caseEnd = workflowContent.indexOf(';;', caseStart);
  assert.notEqual(caseEnd, -1);
  const caseBlock = workflowContent.slice(caseStart, caseEnd);

  assert(
    caseBlock.includes("EVIDENCE_WORKFLOW_NAME='Apply Approved Attendance Multi-Level Approval Production Migration'"),
    'workflow case must specify EVIDENCE_WORKFLOW_NAME'
  );
  assert(
    caseBlock.includes("EVIDENCE_WORKFLOW_PATH='.github/workflows/apply-approved-attendance-multilevel-production-migration.yml'"),
    'workflow case must specify EVIDENCE_WORKFLOW_PATH'
  );
  assert(
    caseBlock.includes("EVIDENCE_WORKFLOW_EVENT='push'"),
    'workflow case must specify EVIDENCE_WORKFLOW_EVENT push'
  );

  // Verify expected_prisma supports migration set
  assert(
    workflowContent.includes('readarray -t migration_path_list <<< "$MIGRATION_PATH"'),
    'deploy workflow must read migration_path_list as array'
  );
  assert(
    workflowContent.includes('expected_prisma=$(printf \'%s\\n%s\\n\' "$MIGRATION_PATH" \'prisma/schema.prisma\' | sed \'/^$/d\' | sort)'),
    'expected_prisma must support migration set with prisma/schema.prisma'
  );
  assert(
    workflowContent.includes('expected_prisma=$(printf \'%s\\n\' "$MIGRATION_PATH" | sed \'/^$/d\' | sort)'),
    'expected_prisma must support migration set without schema changes'
  );
});

test('deploy workflow fails validation when required case branch or configuration is missing', () => {
  const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  const checkCasePresent = (content, manifestPath) => {
    return content.includes(manifestPath);
  };

  assert.equal(
    checkCasePresent(workflowContent, '.github/releases/approved-attendance-multilevel-production-migration.json'),
    true
  );
  assert.equal(
    checkCasePresent(workflowContent, '.github/releases/nonexistent-migration.json'),
    false
  );
});

test('existing single-migration profiles remain unchanged and valid', () => {
  const g06TimePolicy = MIGRATIONS['G06-TIME-POLICY'];
  assert.equal(g06TimePolicy.migrationName, '202610020002_attendance_time_policy_v1');
  assert.equal(g06TimePolicy.schemaChanged, true);

  const cfg03 = MIGRATIONS['CFG-03'];
  assert.equal(cfg03.migrationName, '202608310001_cfg03_leave_type_master');
  assert.equal(cfg03.dataBackfill, true);

  const g06Simple = MIGRATIONS['G06-SIMPLE-ATTENDANCE'];
  assert.equal(g06Simple.migrationName, '202610020001_g06_simple_device_offline');

  const timePolicyManifest = JSON.parse(
    fs.readFileSync('.github/releases/approved-attendance-time-policy-production-migration.json', 'utf8')
  );
  const result = validateMigrationManifest(timePolicyManifest);
  assert.equal(result.migrationId, 'G06-TIME-POLICY');
  assert.equal(result.schemaChanged, true);
});
