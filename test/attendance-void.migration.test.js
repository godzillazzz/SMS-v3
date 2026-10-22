'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const enumMigrationPath = path.join(root, 'prisma/migrations/202610220001_attendance_void_uat_reset/migration.sql');
const schemaMigrationPath = path.join(root, 'prisma/migrations/202610220002_attendance_void_schema/migration.sql');
const schemaPath = path.join(root, 'prisma/schema.prisma');

test('Attendance Void migrations split enum additions from schema DDL', () => {
  const enums = fs.readFileSync(enumMigrationPath, 'utf8');
  const schemaDdl = fs.readFileSync(schemaMigrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  assert.match(enums, /ALTER TYPE "AttendanceSessionState" ADD VALUE IF NOT EXISTS 'VOIDED'/);
  assert.match(enums, /CREATE TYPE "AttendanceEventState" AS ENUM \('ACTIVE', 'VOIDED'\)/);
  assert.doesNotMatch(enums, /ALTER TABLE|CREATE INDEX|ADD CONSTRAINT/i);
  assert.doesNotMatch(enums, /BEGIN;|COMMIT;/i);
  assert.match(schemaDdl, /ADD COLUMN "voided_at"/);
  assert.match(schemaDdl, /ADD COLUMN "voided_by_user_id"/);
  assert.match(schemaDdl, /ADD COLUMN "void_reason"/);
  assert.match(schemaDdl, /ADD CONSTRAINT "attendance_sessions_voided_state_check"/);
  assert.match(schemaDdl, /ADD CONSTRAINT "attendance_events_voided_state_check"/);
  assert.match(schemaDdl, /CREATE INDEX "attendance_sessions_state_work_date_idx"/);
  assert.doesNotMatch(schemaDdl, /BEGIN;|COMMIT;/i);
  assert.doesNotMatch(`${enums}\n${schemaDdl}`, /DELETE FROM|DROP TABLE|TRUNCATE/i);
  assert.match(schema, /enum AttendanceEventState/);
  assert.match(schema, /state\s+AttendanceSessionState/);
  assert.match(schema, /state\s+AttendanceEventState/);
});

test('migrations carry rollback warnings and no execution markers', () => {
  for (const file of [enumMigrationPath, schemaMigrationPath]) {
    const sql = fs.readFileSync(file, 'utf8');
    assert.match(sql, /Rollback: not automatic/);
    assert.doesNotMatch(sql, /prisma migrate deploy|prisma\.\$execute/i);
  }
});

test('migration 2 does not use enum values before migration 1', () => {
  const enums = fs.readFileSync(enumMigrationPath, 'utf8');
  const schemaDdl = fs.readFileSync(schemaMigrationPath, 'utf8');
  assert.ok(enums.indexOf('CREATE TYPE "AttendanceEventState"') < schemaDdl.indexOf('"AttendanceEventState"'), 'enum migration must precede schema migration');
});
