'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '202608310005_cfg07_data_retention_center', 'migration.sql'), 'utf8');

test('CFG-07 migration is additive and seeds the exact retention policy defaults', () => {
  assert.match(migration, /CREATE TABLE "retention_policy_changes"/);
  assert.match(migration, /CREATE TABLE "retention_cleanup_runs"/);
  assert.match(migration, /RETENTION\.OPERATIONAL_USAGE\.MONTHS'[\s\S]*'6'/);
  assert.match(migration, /RETENTION\.ATTENDANCE_RAW\.MONTHS'[\s\S]*'12'/);
  assert.match(migration, /RETENTION\.PATROL_RAW\.MONTHS'[\s\S]*'3'/);
  assert.match(migration, /RETENTION\.TIMEZONE'[\s\S]*'Asia\/Bangkok'/);
  assert.match(migration, /ON CONFLICT \("key"\) DO NOTHING/);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|DELETE FROM "?(?:audit_logs|attendance_events|attendance_month_certifications)"?/i);
});

test('CFG-07 governance tables are server-only and scheduled change uniqueness is enforced', () => {
  assert.match(migration, /retention_policy_changes_one_scheduled_key/);
  assert.match(migration, /WHERE "status" = 'SCHEDULED'/);
  for (const table of ['retention_policy_changes', 'retention_cleanup_runs']) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.%I ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM anon/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM authenticated/);
    assert.ok(migration.includes(`'${table}'`));
  }
});
