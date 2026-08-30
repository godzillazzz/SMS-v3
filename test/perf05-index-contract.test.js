'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'prisma/migrations/202608300001_perf05_hot_path_indexes/migration.sql'),
  'utf8'
);

test('PERF-05 schema keeps only justified approval and leave hot-path indexes', () => {
  assert.match(schema, /@@index\(\[accountStatus, requestedAt, createdAt\]\)/);
  assert.match(schema, /@@index\(\[status, createdAt\]\)[\s\S]*@@map\("attendance_device_change_requests"\)/);
  assert.match(schema, /@@index\(\[status, uploadedAt\]\)[\s\S]*@@map\("employee_reference_photos"\)/);
  assert.match(schema, /@@index\(\[status, uploadedAt\]\)[\s\S]*@@map\("employee_license_documents"\)/);
  assert.match(schema, /@@index\(\[status, requestedAt\]\)[\s\S]*@@map\("leave_requests"\)/);
});

test('PERF-05 migration is additive and contains the exact five candidate indexes', () => {
  const expected = [
    'users_account_status_requested_at_created_at_idx',
    'attendance_device_change_requests_status_created_at_idx',
    'employee_reference_photos_status_uploaded_at_idx',
    'employee_license_documents_status_uploaded_at_idx',
    'leave_requests_status_requested_at_idx'
  ];
  for (const indexName of expected) assert.match(migration, new RegExp(`CREATE INDEX "${indexName}"`));
  assert.equal((migration.match(/CREATE INDEX /g) || []).length, 5);
  assert.doesNotMatch(migration, /DROP\s+(?:INDEX|TABLE|COLUMN)|ALTER\s+TABLE|DELETE\s+FROM|TRUNCATE/i);
});
