'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'prisma/migrations/202610220001_attendance_void_uat_reset/migration.sql');
const schemaPath = path.join(root, 'prisma/schema.prisma');

test('Attendance Void migration is additive, stateful and never hard-deletes evidence', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  assert.match(sql, /ALTER TYPE "AttendanceSessionState" ADD VALUE IF NOT EXISTS 'VOIDED'/);
  assert.match(sql, /CREATE TYPE "AttendanceEventState" AS ENUM \('ACTIVE', 'VOIDED'\)/);
  assert.match(sql, /ADD COLUMN "voided_at"/);
  assert.match(sql, /ADD COLUMN "voided_by_user_id"/);
  assert.match(sql, /ADD COLUMN "void_reason"/);
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|TRUNCATE/i);
  assert.match(schema, /enum AttendanceEventState/);
  assert.match(schema, /state\s+AttendanceSessionState/);
  assert.match(schema, /state\s+AttendanceEventState/);
});

test('migration carries an explicit rollback warning and no execution marker', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /Rollback: not automatic/);
  assert.doesNotMatch(sql, /prisma migrate deploy|prisma\.\$execute/i);
});
