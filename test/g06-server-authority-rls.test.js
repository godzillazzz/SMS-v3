'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../prisma/migrations/202608270005_g06_server_authority_rls_v1/migration.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

const protectedTables = [
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
];

test('G06 authority migration locks every server-authoritative table behind RLS', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /pg_roles WHERE rolname = 'anon'/);
  assert.match(migration, /pg_roles WHERE rolname = 'authenticated'/);
  assert.match(migration, /REVOKE ALL ON TABLE/);
  for (const tableName of protectedTables) {
    assert.match(migration, new RegExp(`'${tableName}'`), `${tableName} must stay protected`);
  }
});

test('G06 authority migration remains portable when Supabase browser roles are absent', () => {
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'anon'\)/);
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'\)/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
});
