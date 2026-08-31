'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LEAVE_QUOTA_BUCKETS,
  CORE_LEAVE_TYPES,
  canonicalLeaveTypeCode,
  canonicalQuotaBucket,
  leaveTypeDisplayName,
  leaveTypeSnapshot,
  listLeaveTypes,
  resolveLeaveTypeForRequest,
  createLeaveTypeService
} = require('../src/services/leave-type.service');
const { quotaFieldForLeaveType, validateAnnualLeaveAvailability } = require('../src/services/leave-annual-accounting.service');

test('CFG-03 core Leave Type definitions preserve current three leave semantics', () => {
  assert.deepEqual(CORE_LEAVE_TYPES.map((item) => [item.code, item.name, item.quotaBucket]), [
    ['SICK', 'ลาป่วย', 'SICK'],
    ['PERSONAL', 'ลากิจ', 'PERSONAL'],
    ['VACATION', 'ลาพักร้อน', 'VACATION']
  ]);
  assert.deepEqual(LEAVE_QUOTA_BUCKETS, ['SICK', 'PERSONAL', 'VACATION', 'NONE']);
});

test('CFG-03 user-facing core Leave Type names are Thai even for legacy rows without snapshots', () => {
  assert.equal(leaveTypeDisplayName('SICK'), 'ลาป่วย');
  assert.equal(leaveTypeDisplayName('PERSONAL'), 'ลากิจ');
  assert.equal(leaveTypeDisplayName('VACATION'), 'ลาพักร้อน');
  assert.equal(leaveTypeDisplayName('SICK', 'ชื่อที่บันทึกไว้'), 'ชื่อที่บันทึกไว้');
  assert.equal(leaveTypeDisplayName('TRAINING'), 'TRAINING');
});

test('CFG-03 canonicalizes legacy Thai/English aliases but permits stable custom codes', () => {
  assert.equal(canonicalLeaveTypeCode('ลาป่วย'), 'SICK');
  assert.equal(canonicalLeaveTypeCode('Sick Leave'), 'SICK');
  assert.equal(canonicalLeaveTypeCode('ลากิจ'), 'PERSONAL');
  assert.equal(canonicalLeaveTypeCode('Vacation'), 'VACATION');
  assert.equal(canonicalLeaveTypeCode('training_leave'), 'TRAINING_LEAVE');
  assert.throws(() => canonicalLeaveTypeCode('bad code!'), /A-Z/);
  assert.equal(canonicalQuotaBucket('none'), 'NONE');
  assert.throws(() => canonicalQuotaBucket('OTHER'), /quota bucket/);
});

test('CFG-03 resolves active master rows and rejects inactive rows for new requests', async () => {
  const row = { id: '11111111-1111-4111-8111-111111111111', code: 'TRAINING', name: 'ลาฝึกอบรม', quotaBucket: 'NONE', isActive: false, isSystem: false, sortOrder: 90 };
  const client = { leaveTypeMaster: { findUnique: async ({ where }) => where.code === 'TRAINING' ? row : null } };
  await assert.rejects(() => resolveLeaveTypeForRequest(client, 'TRAINING'), (error) => error.details?.code === 'LEAVE_TYPE_INACTIVE');
  const allowed = await resolveLeaveTypeForRequest(client, 'TRAINING', { allowInactiveId: row.id });
  assert.equal(allowed.id, row.id);
  assert.deepEqual(leaveTypeSnapshot(allowed), {
    leaveTypeId: row.id,
    leaveType: 'TRAINING',
    leaveTypeNameSnapshot: 'ลาฝึกอบรม',
    leaveQuotaBucketSnapshot: 'NONE'
  });
});

test('CFG-03 core fallback keeps unit-test and legacy partial-client compatibility without permitting custom phantom types', async () => {
  const rows = await listLeaveTypes({}, {});
  assert.equal(rows.length, 3);
  const sick = await resolveLeaveTypeForRequest({}, 'ลาป่วย');
  assert.equal(sick.code, 'SICK');
  await assert.rejects(() => resolveLeaveTypeForRequest({}, 'TRAINING'), (error) => error.details?.code === 'LEAVE_TYPE_NOT_FOUND');
});

test('CFG-03 quota accounting uses snapshot bucket authority and NONE skips quota provisioning', async () => {
  assert.equal(quotaFieldForLeaveType('CUSTOM', 'SICK'), 'sickLeave');
  assert.equal(quotaFieldForLeaveType('CUSTOM', 'PERSONAL'), 'personalLeave');
  assert.equal(quotaFieldForLeaveType('CUSTOM', 'VACATION'), 'vacationLeave');
  assert.equal(quotaFieldForLeaveType('CUSTOM', 'NONE'), null);

  let quotaTouched = false;
  const tx = {
    leaveQuota: { findUnique: async () => { quotaTouched = true; throw new Error('quota should not be touched'); } },
    leaveRequest: { findMany: async () => [] }
  };
  const result = await validateAnnualLeaveAvailability(tx, {
    employeeId: '11111111-1111-4111-8111-111111111111',
    leaveType: 'TRAINING',
    leaveQuotaBucketSnapshot: 'NONE',
    requestedUsageByYear: { 2026: 1 }
  });
  assert.equal(quotaTouched, false);
  assert.equal(result.quotaField, null);
  assert.deepEqual(result.balances, {});
});

test('CFG-03 service creates audited custom types and protects core quota bucket on update', async () => {
  const rows = new Map();
  const auditRows = [];
  let n = 0;
  const tx = {
    leaveTypeMaster: {
      findUnique: async ({ where }) => where.code ? [...rows.values()].find((row) => row.code === where.code) || null : rows.get(where.id) || null,
      create: async ({ data }) => {
        const row = { id: 'id-' + (++n), ...data };
        rows.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row);
        return row;
      }
    }
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const audit = { log: async (entry) => { auditRows.push(entry); } };
  const service = createLeaveTypeService({ prisma, audit });

  const custom = await service.create({ code: 'training', name: 'ลาฝึกอบรม', quotaBucket: 'NONE', sortOrder: 80 }, 'actor-1');
  assert.equal(custom.code, 'TRAINING');
  assert.equal(custom.isSystem, false);
  assert.equal(auditRows[0].entityType, 'LeaveTypeMaster');
  assert.equal(auditRows[0].action, 'CREATE');

  const core = { id: 'core-real', code: 'SICK', name: 'ลาป่วย', quotaBucket: 'SICK', isActive: true, isSystem: true, sortOrder: 10 };
  rows.set(core.id, core);
  await assert.rejects(
    () => service.update(core.id, { quotaBucket: 'PERSONAL' }, 'actor-1'),
    (error) => error.details?.code === 'CORE_LEAVE_TYPE_QUOTA_BUCKET_IMMUTABLE'
  );
});

test('CFG-03 migration creates master/snapshot fields, seeds core types, backfills safely, and has no destructive delete', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '202608310001_cfg03_leave_type_master', 'migration.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE "leave_type_master"/);
  assert.match(sql, /"leave_type_name_snapshot"/);
  assert.match(sql, /"leave_quota_bucket_snapshot"/);
  assert.match(sql, /\('SICK', 'ลาป่วย', 'SICK'/);
  assert.match(sql, /\('PERSONAL', 'ลากิจ', 'PERSONAL'/);
  assert.match(sql, /\('VACATION', 'ลาพักร้อน', 'VACATION'/);
  assert.match(sql, /SET "leave_type_name_snapshot" = "leave_type"/);
  assert.doesNotMatch(sql, /DELETE FROM "leave_requests"/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
});

test('CFG-03 operations route exposes governed master CRUD without DELETE and snapshots requests', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'operations.routes.js'), 'utf8');
  assert.match(source, /router\.get\('\/leave-types'/);
  assert.match(source, /router\.post\('\/leave-types', authorize\('ADMIN'\)/);
  assert.match(source, /router\.put\('\/leave-types\/:id', authorize\('ADMIN'\)/);
  assert.doesNotMatch(source, /router\.delete\('\/leave-types/);
  assert.match(source, /resolveLeaveTypeForRequest\(tx, input\.leaveType/);
  assert.match(source, /leaveTypeNameSnapshot: leaveTypeState\.leaveTypeNameSnapshot/);
  assert.match(source, /leaveQuotaBucketSnapshot: leaveTypeState\.leaveQuotaBucketSnapshot/);
  assert.doesNotMatch(source, /const normalizeLeaveType/);
});

test('CFG-03 reports and user-facing leave errors use Thai core names', () => {
  const executive = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'executive-report.service.js'), 'utf8');
  const approval = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'approval-center.service.js'), 'utf8');
  const notification = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'notification-email.service.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'operations.routes.js'), 'utf8');

  assert.match(executive, /leaveTypeDisplayName\(row\.leaveType, row\.leaveTypeNameSnapshot\)/);
  assert.match(approval, /leaveTypeDisplayName\(row\.leaveType, row\.leaveTypeNameSnapshot\)/);
  assert.match(notification, /leaveTypeDisplayName\(leaveRequest\.leaveType, leaveRequest\.leaveTypeNameSnapshot\)/);
  assert.match(routes, /ลาป่วยเกิน \$\{attachmentThresholdDays\} วัน ต้องแนบเอกสารประกอบ/);
  assert.doesNotMatch(routes, /Sick leave longer than/);
});
