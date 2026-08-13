const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '../prisma/migrations/202608130001_employee_lifecycle_v1/migration.sql');

test('Employee Lifecycle migration is additive and preserves existing business records', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /CREATE TABLE "employee_lifecycle_events"/);
  assert.match(sql, /ADD COLUMN "employment_suspended_at"/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.match(sql, /employee_lifecycle_events_employee_id_sequence_key/);
  assert.doesNotMatch(sql, /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE)\b/im);
  assert.doesNotMatch(sql, /ALTER COLUMN[\s\S]+NOT NULL/i);
});
