'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('G06 authority and evidence metadata are locked behind the application backend boundary', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../prisma/migrations/202608270005_g06_server_only_rls_v1/migration.sql'),
    'utf8'
  );
  for (const table of [
    'attendance_adjustment_events',
    'attendance_adjustment_requests',
    'attendance_adjustment_revisions',
    'attendance_corrections',
    'attendance_device_challenges',
    'attendance_device_change_requests',
    'attendance_device_enrollments',
    'attendance_events',
    'attendance_evidence',
    'attendance_month_certifications',
    'attendance_sessions',
    'employee_reference_photos',
    'face_verification_receipts',
    'face_verification_sessions',
    'security_site_departments',
    'security_site_qr_credentials',
    'security_sites'
  ]) {
    assert.match(migration, new RegExp("'" + table + "'"));
  }
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /pg_roles/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM anon/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM authenticated/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
});
