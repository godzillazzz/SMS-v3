'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EXPECTED_MIGRATION,
  classifyBeforeStatus,
  verifyAfterStatus,
  verifyTimePolicySchema,
} = require('../scripts/ci/apply-approved-pr-preview-attendance-time-policy-migration');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/migrate-approved-pr-preview-attendance-time-policy.yml'), 'utf8').replaceAll('\r\n', '\n');

test('migration classifier permits only exactly the named pending migration or a fully current database', () => {
  const pending = classifyBeforeStatus(`Following migration(s) have not yet been applied:\n${EXPECTED_MIGRATION}`, 1);
  assert.equal(pending.applyNeeded, true);
  assert.throws(() => classifyBeforeStatus(`Following migration(s) have not yet been applied:\n${EXPECTED_MIGRATION}\n202609010002_older`, 1));
  assert.throws(() => classifyBeforeStatus('The following migration failed to apply', 1));
  assert.equal(classifyBeforeStatus('Database schema is up to date!', 0).applyNeeded, false);
  assert.throws(() => verifyAfterStatus(`Following migration(s) have not yet been applied:\n${EXPECTED_MIGRATION}`, 1));
});

test('Preview schema verification checks only safe schema/RLS/revoke metadata', async () => {
  const prisma = {
    async $queryRawUnsafe(sql) {
      if (sql.includes('to_regclass')) return [{ name: 'attendance_time_policies' }];
      if (sql.includes('information_schema.columns')) return [
        ['attendance_time_policies', 'scope_type'], ['attendance_time_policies', 'site_id'], ['attendance_time_policies', 'shift_type_id'],
        ['attendance_time_policies', 'policy'], ['attendance_time_policies', 'effective_from'],
        ['attendance_events', 'punctuality'], ['attendance_events', 'checkout_condition'], ['attendance_events', 'time_policy_snapshot'],
        ['attendance_pending_events', 'time_policy_snapshot'],
      ].map(([table_name, column_name]) => ({ table_name, column_name }));
      if (sql.includes('relrowsecurity')) return [{ enabled: true }];
      if (sql.includes('pg_indexes')) return [
        'attendance_time_policies_company_effective_idx', 'attendance_time_policies_company_effective_key',
        'attendance_time_policies_site_effective_idx', 'attendance_time_policies_site_effective_key',
        'attendance_time_policies_shift_effective_idx', 'attendance_time_policies_shift_effective_key',
        'attendance_time_policies_created_by_created_idx',
      ].map((indexname) => ({ indexname }));
      if (sql.includes('pg_constraint')) return [
        'attendance_time_policies_pkey', 'attendance_time_policies_scope_check', 'attendance_time_policies_values_check',
        'attendance_time_policies_site_fkey', 'attendance_time_policies_shift_type_fkey', 'attendance_time_policies_created_by_fkey',
        'attendance_events_punctuality_check', 'attendance_events_checkout_condition_check',
      ].map((conname) => ({ conname }));
      if (sql.includes('has_table_privilege')) return [{ anon_has_any_privilege: false, authenticated_has_any_privilege: false }];
      throw new Error('unexpected query');
    },
  };
  const logs = [];
  await verifyTimePolicySchema({ prisma, log: (message) => logs.push(message) });
  assert.ok(logs.includes('ATTENDANCE_TIME_POLICY_RLS=PASS'));
  assert.ok(logs.includes('ATTENDANCE_TIME_POLICY_ROLE_REVOKES=PASS'));
  assert.ok(logs.includes('RAW_ATTENDANCE_OR_POLICY_ROWS_READ=false'));
});

test('Preview migration workflow is manual, exact-PR, fingerprint-guarded and Preview-only', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /EXPECTED_SOURCE_BRANCH: fix\/serverless-database-reliability/);
  assert.match(workflow, /EXPECTED_PR_NUMBER: '417'/);
  assert.match(workflow, /pr\.draft !== true/);
  assert.match(workflow, /check\.name === 'validate'/);
  assert.match(workflow, /vercelStatus\.state !== 'success'/);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /node scripts\/ci\/verify-preview-migration-target\.js/);
  assert.match(workflow, /EXPECTED_MIGRATION_HEAD: 202610020002_attendance_time_policy_v1/);
  assert.match(workflow, /EXPECTED_SCHEMA_SHA256/);
  assert.match(workflow, /EXPECTED_MIGRATION_SHA256/);
  assert.match(workflow, /EXPECTED_MIGRATION_SHA256: 5822719590321945832adf87647ca448773f5eff8cb40b7d35ccdd8cf5f443ee/);
  assert.match(workflow, /apply-approved-pr-preview-attendance-time-policy-migration\.js/);
  assert.doesNotMatch(workflow, /production-sms-v3-staging|vercel(?:@[^\s]+)?\s+(?:deploy|promote|rollback)/i);
  assert.doesNotMatch(workflow, /prisma\s+(?:db\s+push|db\s+seed|migrate\s+reset|migrate\s+resolve)/i);
});
