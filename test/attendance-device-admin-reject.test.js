'use strict';

// Owner request (2026-10-28): devices that clocked in without an approval request stayed "รออนุมัติ"
// forever because the only rejection path needed a change request. ADMIN must be able to reject such
// a device directly, with a reason, without touching the current primary device.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceDeviceService } = require('../src/services/attendance-device.service');

const admin = { sub: 'admin-1', role: 'ADMIN' };
const now = new Date('2026-10-28T10:00:00.000Z');

function harness({ candidate = {}, openRequest = null } = {}) {
  const enrollments = new Map();
  enrollments.set('primary', { id: 'primary', employeeId: 'employee-1', status: 'ACTIVE' });
  enrollments.set('stray', { id: 'stray', employeeId: 'employee-1', status: 'PENDING_APPROVAL', proofVerifiedAt: now, ...candidate });
  const requests = new Map();
  if (openRequest) requests.set(openRequest.id, { employeeId: 'employee-1', status: 'PENDING_APPROVAL', ...openRequest });
  const audits = [];
  const tx = {
    attendanceDeviceEnrollment: {
      findUnique: async ({ where }) => (enrollments.has(where.id) ? { ...enrollments.get(where.id) } : null),
      updateMany: async ({ where, data }) => {
        const row = enrollments.get(where.id);
        if (!row || row.employeeId !== where.employeeId || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    },
    attendanceDeviceChangeRequest: {
      findFirst: async ({ where }) => [...requests.values()].find((row) => row.employeeId === where.employeeId && row.candidateDeviceEnrollmentId === where.candidateDeviceEnrollmentId && where.status.in.includes(row.status)) || null,
      updateMany: async ({ where, data }) => {
        const row = requests.get(where.id);
        if (!row || !where.status.in.includes(row.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    }
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const audit = { log: async (entry) => { audits.push(entry); } };
  return { service: createAttendanceDeviceService({ prisma, audit, clock: () => now }), enrollments, requests, audits };
}

test('ADMIN rejects a pending device directly; the primary device is untouched and the action is audited', async () => {
  const h = harness();
  const result = await h.service.rejectDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'stray', reason: 'ไม่ใช่เครื่องของพนักงาน' });
  assert.equal(result.device.status, 'REJECTED');
  assert.equal(h.enrollments.get('stray').status, 'REJECTED');
  assert.equal(h.enrollments.get('stray').revokedReason, 'ไม่ใช่เครื่องของพนักงาน');
  assert.equal(h.enrollments.get('primary').status, 'ACTIVE');
  assert.ok(h.audits.some((entry) => entry.metadata?.event === 'ADMIN_REJECT_DEVICE' && entry.metadata.deviceEnrollmentId === 'stray' && entry.metadata.reason === 'ไม่ใช่เครื่องของพนักงาน'));
});

test('an open change request for the same device is rejected with it', async () => {
  const h = harness({ openRequest: { id: 'req-1', candidateDeviceEnrollmentId: 'stray' } });
  const result = await h.service.rejectDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'stray', reason: 'ไม่อนุมัติ' });
  assert.equal(h.requests.get('req-1').status, 'REJECTED');
  assert.equal(result.rejectedRequestId, 'req-1');
});

test('guards: admin only, reason required, own employee only, pending devices only', async () => {
  const h = harness();
  await assert.rejects(h.service.rejectDevice({ actor: { sub: 'm', role: 'MANAGER' }, employeeId: 'employee-1', deviceEnrollmentId: 'stray', reason: 'abc' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_ADMIN_REQUIRED');
  await assert.rejects(h.service.rejectDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'stray', reason: ' a ' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_REJECT_REASON_REQUIRED');
  await assert.rejects(h.service.rejectDevice({ actor: admin, employeeId: 'employee-2', deviceEnrollmentId: 'stray', reason: 'abc' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_NOT_FOUND');
  await assert.rejects(h.service.rejectDevice({ actor: admin, employeeId: 'employee-1', deviceEnrollmentId: 'primary', reason: 'abc' }), (e) => e.details?.code === 'ATTENDANCE_DEVICE_NOT_ACTIONABLE');
  assert.equal(h.enrollments.get('primary').status, 'ACTIVE');
  assert.equal(h.enrollments.get('stray').status, 'PENDING_APPROVAL');
});
