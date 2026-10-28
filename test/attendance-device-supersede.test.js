'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceDeviceService } = require('../src/services/attendance-device.service');

// Owner issue 9 (2026-10-28): approving a device closes the employee's other open requests and older waiting devices.
const admin = { sub: 'admin-1', role: 'ADMIN' };
const now = new Date('2026-10-28T09:00:00.000Z');
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('in' in value) return value.in.includes(row[key]);
    if ('not' in value) return row[key] !== value.not;
    if ('lt' in value) return row[key] < value.lt;
  }
  return row[key] === value;
});

function harness() {
  const enrollments = new Map([
    ['old-phone', { id: 'old-phone', employeeId: 'employee-1', status: 'ACTIVE', activatedAt: new Date('2026-10-01T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z') }],
    ['older-candidate', { id: 'older-candidate', employeeId: 'employee-1', status: 'PENDING_APPROVAL', proofVerifiedAt: now, createdAt: new Date('2026-10-20T00:00:00Z') }],
    ['new-phone', { id: 'new-phone', employeeId: 'employee-1', status: 'PENDING_APPROVAL', proofVerifiedAt: now, createdAt: new Date('2026-10-27T00:00:00Z') }],
    ['other-employee-candidate', { id: 'other-employee-candidate', employeeId: 'employee-2', status: 'PENDING_APPROVAL', proofVerifiedAt: now, createdAt: new Date('2026-10-02T00:00:00Z') }]
  ]);
  const requests = new Map([
    ['older-request', { id: 'older-request', employeeId: 'employee-1', status: 'RETURNED_FOR_CORRECTION', requestType: 'REPLACEMENT', candidateDeviceEnrollmentId: 'older-candidate', currentDeviceEnrollmentId: 'old-phone' }],
    ['request-to-approve', { id: 'request-to-approve', employeeId: 'employee-1', status: 'PENDING_APPROVAL', requestType: 'REPLACEMENT', candidateDeviceEnrollmentId: 'new-phone', currentDeviceEnrollmentId: 'old-phone' }],
    ['other-employee-request', { id: 'other-employee-request', employeeId: 'employee-2', status: 'PENDING_APPROVAL', requestType: 'INITIAL', candidateDeviceEnrollmentId: 'other-employee-candidate' }]
  ]);
  const audits = [];
  const withRelations = (row) => row && ({ ...row, candidateDevice: { ...enrollments.get(row.candidateDeviceEnrollmentId) }, employee: { id: row.employeeId, isActive: true, deletedAt: null } });
  const tx = {
    attendanceDeviceEnrollment: {
      findUnique: async ({ where }) => (enrollments.has(where.id) ? { ...enrollments.get(where.id) } : null),
      findFirst: async ({ where }) => [...enrollments.values()].find((row) => matches(row, where)) || null,
      update: async ({ where, data }) => { Object.assign(enrollments.get(where.id), data); return { ...enrollments.get(where.id), approvedBy: null }; },
      updateMany: async ({ where, data }) => { const rows = [...enrollments.values()].filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; }
    },
    attendanceDeviceChangeRequest: {
      findUnique: async ({ where }) => withRelations(requests.get(where.id)),
      findMany: async ({ where }) => [...requests.values()].filter((row) => matches(row, where)).map((row) => ({ ...row })),
      updateMany: async ({ where, data }) => { const rows = [...requests.values()].filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; }
    },
    attendanceEvent: { findMany: async () => [], update: async () => ({}) }
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const audit = { log: async (entry) => { audits.push(entry); } };
  return { service: createAttendanceDeviceService({ prisma, audit, clock: () => now }), enrollments, requests, audits };
}

test('approving a device closes the same employee’s other open requests with an audit trail', async () => {
  const h = harness();
  await h.service.approve({ actor: admin, requestId: 'request-to-approve' });
  assert.equal(h.requests.get('request-to-approve').status, 'APPROVED');
  const older = h.requests.get('older-request');
  assert.equal(older.status, 'CANCELLED');
  assert.equal(older.reviewerComment, 'ถูกแทนที่ด้วยคำขอที่อนุมัติแล้ว');
  assert.equal(older.reviewedByUserId, 'admin-1');
  assert.ok(h.audits.some((entry) => entry.entityId === 'older-request' && entry.metadata?.event === 'SUPERSEDED_BY_APPROVAL'));
});

test('approving a device retires older waiting devices but leaves other employees untouched', async () => {
  const h = harness();
  await h.service.approve({ actor: admin, requestId: 'request-to-approve' });
  assert.equal(h.enrollments.get('new-phone').status, 'ACTIVE');
  assert.equal(h.enrollments.get('old-phone').status, 'REVOKED');
  assert.equal(h.enrollments.get('older-candidate').status, 'CANCELLED');
  assert.equal(h.enrollments.get('other-employee-candidate').status, 'PENDING_APPROVAL');
  assert.equal(h.requests.get('other-employee-request').status, 'PENDING_APPROVAL');
});
