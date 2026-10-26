'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceDeviceService } = require('../src/services/attendance-device.service');

const admin = { sub: 'admin-1', role: 'ADMIN' };
const now = new Date('2026-10-26T15:00:00.000Z');

function harness({ active = true, candidate = {}, openRequest = null } = {}) {
  const enrollments = new Map();
  if (active) enrollments.set('old-phone', { id: 'old-phone', employeeId: 'employee-1', status: 'ACTIVE', activatedAt: new Date('2026-10-01T00:00:00Z') });
  enrollments.set('new-phone', { id: 'new-phone', employeeId: 'employee-1', status: 'PENDING_APPROVAL', observationOnly: true, proofVerifiedAt: now, displayName: 'อุปกรณ์ลงเวลา', ...candidate });
  const requests = new Map();
  if (openRequest) requests.set(openRequest.id, { employeeId: 'employee-1', status: 'PENDING_APPROVAL', ...openRequest });
  const audits = [];
  let sequence = 0;
  const withRelations = (row) => row && ({ ...row, candidateDevice: { ...enrollments.get(row.candidateDeviceEnrollmentId) }, employee: { id: row.employeeId, isActive: true, deletedAt: null } });
  const tx = {
    attendanceDeviceEnrollment: {
      findUnique: async ({ where }) => (enrollments.has(where.id) ? { ...enrollments.get(where.id) } : null),
      findFirst: async ({ where }) => [...enrollments.values()].find((row) => row.employeeId === where.employeeId && row.status === where.status) || null,
      update: async ({ where, data }) => { Object.assign(enrollments.get(where.id), data); return { ...enrollments.get(where.id), approvedBy: null }; }
    },
    attendanceDeviceChangeRequest: {
      findFirst: async ({ where }) => [...requests.values()].find((row) => row.employeeId === where.employeeId && where.status.in.includes(row.status)) || null,
      findUnique: async ({ where }) => withRelations(requests.get(where.id)),
      create: async ({ data }) => { const row = { id: `request-${++sequence}`, ...data, status: 'PENDING_APPROVAL', createdAt: now }; requests.set(row.id, row); return { ...row }; },
      updateMany: async ({ where, data }) => {
        const row = requests.get(where.id);
        const statuses = typeof where.status === 'string' ? [where.status] : where.status.in;
        if (!row || !statuses.includes(row.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    },
    attendanceEvent: { findMany: async () => [], update: async () => ({}) }
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const audit = { log: async (entry) => { audits.push(entry); } };
  return { service: createAttendanceDeviceService({ prisma, audit, clock: () => now }), enrollments, requests, audits };
}

test('ADMIN can make an observed device primary; the previous primary is revoked through the normal approval path', async () => {
  const h = harness();
  const result = await h.service.promoteDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone', reason: 'เปลี่ยนโทรศัพท์ใหม่' });
  assert.equal(result.status, 'APPROVED');
  assert.equal(h.enrollments.get('new-phone').status, 'ACTIVE');
  assert.equal(h.enrollments.get('new-phone').observationOnly, false);
  assert.equal(h.enrollments.get('old-phone').status, 'REVOKED');
  const request = [...h.requests.values()][0];
  assert.equal(request.requestType, 'REPLACEMENT');
  assert.equal(request.currentDeviceEnrollmentId, 'old-phone');
  assert.equal(request.requestedByUserId, 'admin-1');
  assert.ok(h.audits.some((entry) => entry.metadata?.event === 'ADMIN_PROMOTE_PRIMARY_DEVICE' && entry.metadata.reason === 'เปลี่ยนโทรศัพท์ใหม่'));
  assert.ok(h.audits.some((entry) => entry.metadata?.event === 'FINAL_APPROVE'));
});

test('an employee without a primary device gets an INITIAL request approved', async () => {
  const h = harness({ active: false });
  await h.service.promoteDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone', reason: 'เครื่องแรก' });
  assert.equal([...h.requests.values()][0].requestType, 'INITIAL');
  assert.equal(h.enrollments.get('new-phone').status, 'ACTIVE');
});

test('a pending employee request for another device is cancelled before promoting', async () => {
  const h = harness({ openRequest: { id: 'employee-request', candidateDeviceEnrollmentId: 'other-phone', requestType: 'REPLACEMENT' } });
  await h.service.promoteDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone', reason: 'ใช้เครื่องที่ลงเวลาจริง' });
  assert.equal(h.requests.get('employee-request').status, 'CANCELLED');
  assert.ok(h.audits.some((entry) => entry.metadata?.event === 'CANCELLED_BY_ADMIN_PROMOTE'));
});

test('a pending employee request for the same device is approved instead of duplicated', async () => {
  const h = harness({ openRequest: { id: 'employee-request', candidateDeviceEnrollmentId: 'new-phone', requestType: 'REPLACEMENT', currentDeviceEnrollmentId: 'old-phone' } });
  const result = await h.service.promoteDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone', reason: 'อนุมัติตามคำขอ' });
  assert.equal(result.id, 'employee-request');
  assert.equal(h.requests.size, 1);
  assert.equal(h.enrollments.get('new-phone').status, 'ACTIVE');
});

test('guards: admin only, reason required, own employee only, verified non-revoked device only', async () => {
  const h = harness();
  await assert.rejects(h.service.promoteDevice({ actor: { sub: 'm', role: 'MANAGER' }, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone', reason: 'abc' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_ADMIN_REQUIRED');
  await assert.rejects(h.service.promoteDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone', reason: ' ' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_PROMOTE_REASON_REQUIRED');
  await assert.rejects(h.service.promoteDevice({ actor: admin, employeeId: 'employee-2', deviceEnrollmentId: 'new-phone', reason: 'abc' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_NOT_FOUND');
  await assert.rejects(h.service.promoteDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'old-phone', reason: 'abc' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_ALREADY_PRIMARY');
  const revoked = harness({ candidate: { status: 'REVOKED' } });
  await assert.rejects(revoked.service.promoteDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone', reason: 'abc' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_NOT_ACTIONABLE');
  const unverified = harness({ candidate: { proofVerifiedAt: null } });
  await assert.rejects(unverified.service.promoteDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone', reason: 'abc' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_NOT_ACTIONABLE');
  assert.equal(h.enrollments.get('old-phone').status, 'ACTIVE');
});

function selfieHarness({ selfie = { id: 'selfie-1', employeeId: 'employee-1', enrollmentId: 'new-phone', storageObjectKey: 'attendance-selfie/abc/capture-1.jpg', mimeType: 'image/jpeg', capturedAt: now, purgedAt: null } } = {}) {
  const audits = []; const reads = [];
  const prisma = {
    attendanceDeviceEnrollment: { findUnique: async ({ where }) => ({ 'new-phone': { id: 'new-phone', employeeId: 'employee-1', status: 'PENDING_APPROVAL' } })[where.id] || null },
    attendanceDeviceSelfie: { findFirst: async ({ where }) => (selfie && where.enrollmentId === selfie.enrollmentId && where.employeeId === selfie.employeeId && where.purgedAt === null ? selfie : null) }
  };
  const selfieStorage = { getBytes: async ({ objectKey }) => { reads.push(objectKey); return { buffer: Buffer.from('jpeg') }; } };
  const service = createAttendanceDeviceService({ prisma, audit: { log: async (entry) => { audits.push(entry); } }, clock: () => now, selfieStorage });
  return { service, audits, reads };
}

test('ADMIN can view the latest clock-in selfie of a device; every view is audited', async () => {
  const h = selfieHarness();
  const result = await h.service.getDeviceSelfie({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone' });
  assert.equal(result.buffer.toString(), 'jpeg');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.deepEqual(h.reads, ['attendance-selfie/abc/capture-1.jpg']);
  assert.ok(h.audits.some((entry) => entry.metadata?.event === 'ADMIN_VIEW_DEVICE_SELFIE' && entry.metadata.selfieId === 'selfie-1'));
});

test('selfie view is ADMIN-only, scoped to the employee, and 404s when nothing is stored', async () => {
  const h = selfieHarness();
  await assert.rejects(h.service.getDeviceSelfie({ actor: { sub: 's', role: 'SUPERVISOR' }, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_ADMIN_REQUIRED');
  await assert.rejects(h.service.getDeviceSelfie({ actor: admin, employeeId: 'employee-2', deviceEnrollmentId: 'new-phone' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_NOT_FOUND');
  const empty = selfieHarness({ selfie: null });
  await assert.rejects(empty.service.getDeviceSelfie({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'new-phone' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_SELFIE_NOT_FOUND');
  assert.equal(h.reads.length, 0);
  assert.equal(h.audits.length, 0);
});
