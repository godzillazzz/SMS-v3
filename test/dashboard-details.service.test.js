'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDashboardDetails } = require('../src/services/dashboard-detail.service');

function model(total, rows, capture) {
  return {
    async count(args) { capture.count = args; return total; },
    async findMany(args) { capture.list = args; return rows; }
  };
}
function clientFor(name, total, rows, capture) {
  const client = { $transaction: async (queries) => Promise.all(queries) };
  client[name] = model(total, rows, capture);
  return client;
}

test('dashboard detail counts the filtered result before pagination and keeps manager department scope', async () => {
  const capture = {};
  const prismaClient = clientFor('employee', 41, [{ id: 'employee-1', employeeCode: 'E-001', displayName: 'Guard One', department: 'AN1', jobTitle: 'Security Guard', isActive: true }], capture);
  const result = await getDashboardDetails({
    prismaClient,
    requestUser: { role: 'MANAGER', employeeId: 'manager-1', department: 'AN1' },
    filters: { metric: 'activeEmployees', date: '2026-10-10', month: '2026-10', department: 'UNTRUSTED', page: 2, pageSize: 20 }
  });
  assert.equal(result.total, 41);
  assert.equal(result.totalPages, 3);
  assert.equal(result.records.length, 1);
  assert.equal(capture.count.where.department, 'AN1');
  assert.equal(capture.count.where.isActive, true);
  assert.deepEqual(capture.list.where, capture.count.where);
  assert.equal(capture.list.skip, 20);
  assert.equal(capture.list.take, 20);
  assert.equal(result.department, 'AN1');
});

test('viewer detail is limited to the authenticated employee even when a department is supplied', async () => {
  const capture = {};
  const prismaClient = clientFor('employee', 1, [], capture);
  const result = await getDashboardDetails({
    prismaClient,
    requestUser: { role: 'VIEWER', employeeId: 'viewer-1', department: 'AN1' },
    filters: { metric: 'totalEmployees', department: 'OTHER', page: 1, pageSize: 20 }
  });
  assert.equal(result.total, 1);
  assert.equal(capture.count.where.id, 'viewer-1');
  assert.equal(capture.count.where.department, undefined);
});

test('leave-today detail uses only approved overlapping leave and matches a distinct employee list', async () => {
  const capture = {};
  const prismaClient = clientFor('employee', 2, [
    { id: 'e1', employeeCode: 'E-1', displayName: 'One', department: 'AN1', jobTitle: 'Guard', isActive: true, leaveRequests: [{ leaveType: 'PERSONAL', startDate: new Date('2026-10-09Z'), endDate: new Date('2026-10-11Z') }] }
  ], capture);
  const result = await getDashboardDetails({
    prismaClient,
    requestUser: { role: 'SUPERVISOR', employeeId: 's1', department: 'AN1' },
    filters: { metric: 'leaveToday', date: '2026-10-10' }
  });
  assert.equal(result.total, 2);
  assert.equal(capture.count.where.leaveRequests.some.status, 'APPROVED');
  assert.deepEqual(capture.list.where, capture.count.where);
  assert.equal(result.records[0].status, 'APPROVED');
});

test('license detail uses authenticated scope, guard classification, and disjoint expiry filters', async () => {
  const capture = {};
  const row = { id: 'document-1', licenseId: '11111111-1111-4111-8111-111111111111', status: 'APPROVED', proposedExpiryDate: new Date('2026-10-25T00:00:00.000Z'), employee: { employeeCode: 'E-1', displayName: 'Guard', department: 'AN1', jobTitle: 'Security Guard' }, license: { licenseType: 'บัตร รปภ.' } };
  const prismaClient = clientFor('employeeLicenseDocument', 12, [row], capture);
  const result = await getDashboardDetails({
    prismaClient,
    requestUser: { role: 'MANAGER', employeeId: 'm1', department: 'AN1' },
    filters: { metric: 'licenseExpiry', expiryBucket: 'EXPIRING_0_30', date: '2026-10-10', licenseId: row.licenseId }
  });
  assert.equal(result.total, 12);
  assert.equal(capture.count.where.employee.is.department, 'AN1');
  assert.deepEqual(capture.count.where.employee.is.OR, [
    { jobTitle: { contains: 'guard', mode: 'insensitive' } },
    { jobTitle: { contains: 'รปภ' } },
    { jobTitle: { contains: 'รักษาความปลอดภัย' } }
  ]);
  assert.deepEqual(capture.count.where.proposedExpiryDate, {
    gte: new Date('2026-10-10T00:00:00.000Z'),
    lte: new Date('2026-11-09T00:00:00.000Z')
  });
  assert.equal(capture.count.where.licenseId, row.licenseId);
  assert.deepEqual(capture.list.where, capture.count.where);
  assert.equal(result.records[0].expiryDate, '2026-10-25');
});

test('approval and quota drill-downs retain backend role gates', async () => {
  await assert.rejects(
    getDashboardDetails({ prismaClient: {}, requestUser: { role: 'VIEWER', employeeId: 'v1' }, filters: { metric: 'pendingLeaves' } }),
    /Leave approval access is required/
  );
  await assert.rejects(
    getDashboardDetails({ prismaClient: {}, requestUser: { role: 'SUPERVISOR', department: 'AN1' }, filters: { metric: 'unmatchedQuota' } }),
    /Administrator access is required/
  );
});


test('all supported role scopes derive from the authenticated user, never the URL', async () => {
  const cases = [
    [{ role: 'ADMIN', employeeId: null, department: null }, 'AN1', { department: 'AN1' }],
    [{ role: 'MANAGER', employeeId: 'm1', department: 'AN2' }, 'AN1', { department: 'AN2' }],
    [{ role: 'SUPERVISOR', employeeId: 's1', department: 'AN3' }, 'AN1', { department: 'AN3' }],
    [{ role: 'VIEWER', employeeId: 'v1', department: 'AN4' }, 'AN1', { id: 'v1' }]
  ];
  for (const [requestUser, requestedDepartment, expected] of cases) {
    const capture = {};
    const prismaClient = clientFor('employee', 0, [], capture);
    await getDashboardDetails({
      prismaClient,
      requestUser,
      filters: { metric: 'activeEmployees', department: requestedDepartment }
    });
    for (const [key, value] of Object.entries(expected)) assert.equal(capture.count.where[key], value);
  }
});

test('license expiry buckets use exact expired, 0–30 and 31–90 day boundaries', async () => {
  const date = '2026-10-10';
  const expected = {
    EXPIRED: { OR: [
      { status: 'EXPIRED', isCurrent: true },
      { status: 'APPROVED', isCurrent: true, proposedExpiryDate: { lt: new Date('2026-10-10T00:00:00.000Z') } }
    ] },
    EXPIRING_0_30: { proposedExpiryDate: { gte: new Date('2026-10-10T00:00:00.000Z'), lte: new Date('2026-11-09T00:00:00.000Z') } },
    EXPIRING_31_90: { proposedExpiryDate: { gte: new Date('2026-11-10T00:00:00.000Z'), lte: new Date('2027-01-08T00:00:00.000Z') } }
  };
  for (const [expiryBucket, wherePart] of Object.entries(expected)) {
    const capture = {};
    const prismaClient = clientFor('employeeLicenseDocument', 0, [], capture);
    await getDashboardDetails({
      prismaClient,
      requestUser: { role: 'ADMIN', employeeId: null, department: null },
      filters: { metric: 'licenseExpiry', expiryBucket, date }
    });
    for (const [key, value] of Object.entries(wherePart)) assert.deepEqual(capture.count.where[key], value);
  }
});

test('admin selected department narrows pending-account count and rows together', async () => {
  const capture = {};
  const prismaClient = clientFor('user', 7, [], capture);
  const result = await getDashboardDetails({
    prismaClient,
    requestUser: { role: 'ADMIN', employeeId: null, department: null },
    filters: { metric: 'pendingUsers', department: 'AN1', page: 1, pageSize: 5 }
  });
  assert.equal(result.total, 7);
  assert.equal(capture.count.where.department, 'AN1');
  assert.deepEqual(capture.list.where, capture.count.where);
});


test('manager and supervisor cannot list pending accounts without an authenticated department scope', async () => {
  for (const role of ['MANAGER', 'SUPERVISOR']) {
    await assert.rejects(
      getDashboardDetails({
        prismaClient: {},
        requestUser: { role, employeeId: role.toLowerCase() + '-1', department: '' },
        filters: { metric: 'pendingUsers' }
      }),
      /department scope is required/
    );
  }
});
