'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceDeviceService } = require('../src/services/attendance-device.service');

const actor = { sub: 'admin-1', role: 'ADMIN' };
const now = new Date('2026-10-19T00:00:00.000Z');

function makeHarness({ eventReasons = [['DEVICE_MISMATCH'], ['DEVICE_MISMATCH', 'GPS_REVIEW']] } = {}) {
  const request = {
    id: 'request-1',
    employeeId: 'employee-1',
    requestType: 'REPLACEMENT',
    status: 'PENDING_APPROVAL',
    candidateDeviceEnrollmentId: 'candidate-1',
    currentDeviceEnrollmentId: 'current-1',
    reviewerComment: null,
    reviewedByUserId: null,
    reviewedAt: null,
    employee: { id: 'employee-1', isActive: true, deletedAt: null },
    candidateDevice: { id: 'candidate-1', status: 'PENDING_APPROVAL', proofVerifiedAt: now }
  };
  const enrollments = {
    'current-1': { id: 'current-1', employeeId: 'employee-1', status: 'ACTIVE' },
    'candidate-1': { id: 'candidate-1', employeeId: 'employee-1', status: 'PENDING_APPROVAL', proofVerifiedAt: now }
  };
  const events = eventReasons.map((reviewReasons, index) => ({
    id: `event-${index + 1}`,
    captureId: `capture-${index + 1}`,
    reviewReasons: [...reviewReasons],
    reviewRequired: false
  }));
  const eventUpdates = [];
  const enrollmentUpdates = [];
  const audits = [];

  const tx = {
    attendanceEvent: {
      findMany: async () => events.map((event) => ({ ...event, reviewReasons: [...event.reviewReasons] })),
      update: async ({ where, data }) => {
        const event = events.find((row) => row.id === where.id);
        eventUpdates.push({ where, data: { ...data, reviewReasons: data.reviewReasons && [...data.reviewReasons] } });
        Object.assign(event, data);
        return event;
      }
    },
    attendanceDeviceChangeRequest: {
      findUnique: async () => ({ ...request, candidateDevice: { ...request.candidateDevice }, employee: { ...request.employee } }),
      update: async ({ data }) => {
        Object.assign(request, data);
        return { ...request };
      },
      updateMany: async ({ data }) => {
        Object.assign(request, data);
        return { count: 1 };
      }
    },
    attendanceDeviceEnrollment: {
      findFirst: async ({ where }) => Object.values(enrollments).find((row) => row.employeeId === where.employeeId && row.status === where.status) || null,
      update: async ({ where, data }) => {
        const enrollment = enrollments[where.id];
        enrollmentUpdates.push({ where, data: { ...data } });
        Object.assign(enrollment, data);
        return { ...enrollment, approvedBy: null };
      }
    }
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const audit = { log: async (entry) => { audits.push(entry); } };
  const service = createAttendanceDeviceService({ prisma, audit, clock: () => now });
  return { service, request, events, eventUpdates, enrollmentUpdates, audits };
}

test('reject marks every candidate event as review-required without changing enrollments', async () => {
  const harness = makeHarness();

  await harness.service.reject({ actor, requestId: harness.request.id, reason: 'device proof was rejected' });

  assert.equal(harness.eventUpdates.length, 2);
  for (const update of harness.eventUpdates) {
    assert.equal(update.data.reviewRequired, true);
    assert.ok(update.data.reviewReasons.includes('DEVICE_TRANSFER_REJECTED'));
    assert.ok(update.data.reviewReasons.includes('DEVICE_MISMATCH'));
  }
  assert.equal(harness.enrollmentUpdates.length, 0);
  const rejectionAudit = harness.audits.find((entry) => entry.metadata?.event === 'DEVICE_TRANSFER_REJECTED');
  assert.ok(rejectionAudit);
  assert.equal(rejectionAudit.metadata.rejectedEventCount, 2);
  assert.deepEqual(rejectionAudit.metadata.excludedCaptureIds, ['capture-1', 'capture-2']);
});

test('approve removes only the rejection flag after rejected events were marked', async () => {
  const harness = makeHarness({
    eventReasons: [
      ['DEVICE_MISMATCH', 'DEVICE_TRANSFER_REJECTED'],
      ['GPS_REVIEW', 'DEVICE_TRANSFER_REJECTED']
    ]
  });

  await harness.service.approve({ actor, requestId: harness.request.id });

  assert.equal(harness.eventUpdates.length, 2);
  for (const update of harness.eventUpdates) {
    assert.ok(!update.data.reviewReasons.includes('DEVICE_TRANSFER_REJECTED'));
  }
  assert.deepEqual(harness.eventUpdates[0].data.reviewReasons, ['DEVICE_MISMATCH']);
  assert.deepEqual(harness.eventUpdates[1].data.reviewReasons, ['GPS_REVIEW']);
  assert.equal(harness.enrollmentUpdates.length, 2);
  assert.deepEqual(harness.enrollmentUpdates.map((update) => update.where.id), ['current-1', 'candidate-1']);
  assert.equal(harness.enrollmentUpdates[0].data.status, 'REVOKED');
  assert.equal(harness.enrollmentUpdates[1].data.status, 'ACTIVE');
});
