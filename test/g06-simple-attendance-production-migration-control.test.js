'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateG06SimpleAttendanceSql,
  validateMigrationManifest
} = require('../scripts/ci/verify-approved-production-migration');
const {
  EXPECTED_CONSTRAINTS,
  EXPECTED_ENUM_VALUES,
  EXPECTED_INDEXES,
  verify: verifyPostMigration
} = require('../scripts/ci/verify-g06-simple-attendance-production-migration');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, '.github/releases/approved-g06-simple-attendance-production-migration.json');
const workflowPath = path.join(root, '.github/workflows/apply-approved-g06-simple-attendance-production-migration.yml');
const deployWorkflowPath = path.join(root, '.github/workflows/deploy-approved-production-v2.yml');
const postVerifyPath = path.join(root, 'scripts/ci/verify-g06-simple-attendance-production-migration.js');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sql = fs.readFileSync(path.join(root, ...manifest.migration_path.split('/')), 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const deployWorkflow = fs.readFileSync(deployWorkflowPath, 'utf8').replace(/\r\n/g, '\n');
const postVerify = fs.readFileSync(postVerifyPath, 'utf8');

test('G06 migration manifest pins exact merged app source and only performs schema migration', () => {
  const result = validateMigrationManifest(manifest, { root });
  assert.equal(result.migrationId, 'G06-SIMPLE-ATTENDANCE');
  assert.equal(result.sourceCommitSha, '7fb3c1d2e48cbf5fe0193abfe7096200bc8e4cfa');
  assert.equal(result.sourceTreeSha, '7aa9e16ee87c95658c05050f3d747c2cdd1eaf89');
  assert.equal(result.currentProductionDeploymentId, 'dpl_B2SBHcStgAKHjt2YbpRcjnqh7FQB');
  assert.equal(result.currentProductionApplicationSha, '43a303d91f7287f49bb3381e0287a117449aec51');
  assert.equal(result.dataBackfill, false);
  assert.equal(result.schemaChanged, true);
  assert.equal(result.statementCount, 18);
  assert.equal(result.controlledUpdateCount, 0);
  assert.equal(manifest.application_deploy, false);
  assert.equal(manifest.destructive_rollback, false);
  assert.equal(manifest.owner_action, 'APPROVE_PRODUCTION_MIGRATION_ONLY');
});

test('G06 migration accepts the pinned SQL and rejects any content change', () => {
  assert.doesNotThrow(() => validateG06SimpleAttendanceSql(sql));
  for (const unsafe of [
    sql + '\nUPDATE attendance_events SET review_required = true;',
    sql + '\nDELETE FROM attendance_events;',
    sql + '\nDROP TABLE attendance_events;',
    sql + '\nGRANT SELECT ON attendance_pending_events TO anon;',
    sql + '\nCREATE POLICY unsafe_client_policy ON attendance_pending_events USING (true);',
    sql + '\nALTER TABLE attendance_events DROP COLUMN employee_id;',
    sql.replace('REVOKE ALL ON TABLE public."attendance_pending_events" FROM anon', 'GRANT ALL ON TABLE public."attendance_pending_events" TO anon'),
    sql.replace('ENABLE ROW LEVEL SECURITY', 'DISABLE ROW LEVEL SECURITY')
  ]) {
    assert.throws(() => validateG06SimpleAttendanceSql(unsafe), /exact approved migration content|forbidden|allowlist|RLS/i);
  }
});

test('G06 migration workflow retains exact source, current canonical, database-target and protected approval guards', () => {
  assert.match(workflow, /^name: Apply Approved G06 Simple Attendance Production Migration$/m);
  assert.match(workflow, /MANIFEST_PATH: \.github\/releases\/approved-g06-simple-attendance-production-migration\.json/);
  assert.match(workflow, /environment:\n\s+name: production-sms-v3-staging/);
  assert.match(workflow, /git merge-base --is-ancestor "\$SOURCE_SHA" "origin\/\$EXPECTED_SOURCE_BRANCH"/);
  assert.match(workflow, /gh run list --repo "\$GITHUB_REPOSITORY" --workflow CI --commit "\$SOURCE_SHA"/);
  assert.match(workflow, /inspectDeploymentRecord\(fs\.readFileSync\(file, 'utf8'\)/);
  assert.match(workflow, /node scripts\/ci\/inspect-vercel-deployment\.js/);
  assert.match(workflow, /node scripts\/ci\/verify-deployment-target\.js --verify/);
  assert.match(workflow, /MIGRATION_STATUS_CLASS=PENDING_MIGRATIONS_ONLY/);
  assert.match(workflow, /MIGRATION_NAME=\$MIGRATION_NAME/);
  assert.match(workflow, /node scripts\/ci\/prisma-migration\.js deploy/);
  assert.match(workflow, /verify-g06-simple-attendance-production-migration\.js/);
  assert.match(workflow, /CANONICAL_CORS_TRUSTED=204 UNTRUSTED=403/);
  assert.doesNotMatch(workflow, /vercel(?:@[^\s]+)?\s+(?:deploy|promote|rollback)|vercel\s+(?:deploy|promote|rollback)/i);
  assert.match(workflow, /Application deployment performed: NO/);
  assert.match(workflow, /Data backfill: NOT PERFORMED/);
});

test('governed Production release accepts only a successful protected G06 migration evidence run', () => {
  assert.match(deployWorkflow, /\.github\/releases\/approved-g06-simple-attendance-production-migration\.json\)/);
  assert.match(deployWorkflow, /EVIDENCE_WORKFLOW_NAME='Apply Approved G06 Simple Attendance Production Migration'/);
  assert.match(deployWorkflow, /EVIDENCE_WORKFLOW_PATH='\.github\/workflows\/apply-approved-g06-simple-attendance-production-migration\.yml'/);
  assert.match(deployWorkflow, /EVIDENCE_WORKFLOW_EVENT='push'/);
  assert.match(deployWorkflow, /PRE_APPLIED_PRODUCTION_MIGRATION_EVIDENCE=PASS/);
});

test('post-migration verification inspects only schema metadata and never emits Attendance data', () => {
  assert.match(postVerify, /G06_SIMPLE_ATTENDANCE_PRODUCTION_MIGRATION_VERIFY=PASS/);
  assert.match(postVerify, /PENDING_EVENTS_RLS=enabled/);
  assert.match(postVerify, /PENDING_EVENTS_ANON_AUTHENTICATED_PRIVILEGES=0/);
  assert.match(postVerify, /RAW_ATTENDANCE_DATA_EMITTED=false/);
  assert.doesNotMatch(postVerify, /INSERT\s+INTO|UPDATE\s+attendance|DELETE\s+FROM|SELECT\s+\*\s+FROM\s+attendance_(?:events|pending_events)/i);
});

function postVerifyRows({ rls = true, policyCount = 0, anonCanSelect = false, missingIndex = false } = {}) {
  const role = (rolname, can_select) => ({
    rolname,
    can_select,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    can_reference: false,
    can_trigger: false
  });
  const columns = [
    ['attendance_device_enrollments', 'observation_only', 'NO'],
    ['attendance_events', 'face_verification_session_id', 'YES'],
    ['attendance_events', 'device_enrollment_id', 'YES'],
    ['attendance_events', 'source_mode', 'NO'],
    ['attendance_events', 'device_captured_at', 'YES'],
    ['attendance_events', 'review_required', 'NO'],
    ['attendance_events', 'review_reasons', 'YES'],
    ...[
      'id', 'employee_id', 'shift_assignment_id', 'capture_id', 'event_type',
      'source_mode', 'captured_at', 'received_at', 'location_evidence',
      'device_snapshot', 'risk_flags', 'payload_digest', 'status',
      'reviewed_by_user_id', 'reviewed_at', 'review_comment',
      'attendance_event_id', 'created_at', 'updated_at'
    ].map((name) => ['attendance_pending_events', name, 'NO'])
  ].map(([table_name, column_name, is_nullable]) => ({ table_name, column_name, is_nullable }));
  return [
    [{ rls_enabled: rls, policy_count: policyCount }],
    [role('anon', anonCanSelect), role('authenticated', false)],
    EXPECTED_ENUM_VALUES.map((enumlabel) => ({ enumlabel })),
    EXPECTED_INDEXES.filter((name) => !(missingIndex && name === EXPECTED_INDEXES[0])).map((indexname) => ({ indexname })),
    EXPECTED_CONSTRAINTS.map((conname) => ({ conname, convalidated: true })),
    columns
  ];
}

test('post-migration database verifier passes only when schema, RLS and browser-role revokes are present', async () => {
  const output = [];
  const rows = postVerifyRows();
  const prisma = { $queryRaw: async () => rows.shift() };
  assert.equal(await verifyPostMigration({ prisma, log: (line) => output.push(line) }), true);
  assert.ok(output.includes('G06_SIMPLE_ATTENDANCE_PRODUCTION_MIGRATION_VERIFY=PASS'));
  assert.ok(output.includes('RAW_ATTENDANCE_DATA_EMITTED=false'));

  for (const invalid of [
    postVerifyRows({ rls: false }),
    postVerifyRows({ policyCount: 1 }),
    postVerifyRows({ anonCanSelect: true }),
    postVerifyRows({ missingIndex: true })
  ]) {
    await assert.rejects(
      verifyPostMigration({ prisma: { $queryRaw: async () => invalid.shift() }, log: () => {} }),
      /G06 migration verification:/
    );
  }
});
