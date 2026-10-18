'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAttendanceAdjustmentService } = require('../src/services/attendance-adjustment.service');

// Service-level guards: these go through createDraft/reject so that removing the guard from the
// implementation (mutation) makes the tests fail, not just the pure helper.
const assignment = {
  id: '11111111-1111-4111-8111-111111111111',
  employeeId: 'employee-1',
  workDate: new Date('2026-10-17T00:00:00.000Z'),
  startTime: '08:00',
  endTime: '17:00',
  employee: { department: 'OPS' },
  attendanceSession: null
};

function buildService(requestOverrides = {}) {
  const auditCalls = [];
  const request = {
    id: '22222222-2222-4222-8222-222222222222',
    shiftAssignmentId: assignment.id,
    employeeId: 'employee-1',
    status: 'PENDING_ADMIN',
    makerUserId: 'maker-user',
    makerRoleSnapshot: 'VIEWER',
    currentRevision: 1,
    beforeSnapshot: {},
    beforeDigest: 'a'.repeat(64),
    currentProposal: { checkInAt: '2026-10-17T01:00:00.000Z', checkOutAt: '2026-10-17T10:00:00.000Z' },
    currentProposalDigest: 'b'.repeat(64),
    reason: 'fixture reason',
    ...requestOverrides
  };
  const prisma = {
    $queryRaw: async (sql) => {
      const joined = sql?.strings?.join(' ') || '';
      if (joined.includes('FROM attendance_adjustment_requests')) return [request];
      return [];
    },
    $executeRaw: async () => 1,
    shiftAssignment: { findUnique: async () => assignment },
    $transaction: async (fn) => fn(prisma)
  };
  const service = createAttendanceAdjustmentService({
    prisma,
    audit: { log: async (input) => { auditCalls.push(input); } },
    clock: () => new Date('2026-10-18T05:00:00.000Z')
  });
  return { service, auditCalls };
}

const codeOf = async (fn) => {
  try { await fn(); return null; } catch (error) { return error.details?.code || error.code || error.message; }
};

test('createDraft rejects a duration longer than the allowed shift window', async () => {
  const { service } = buildService();
  assert.equal(await codeOf(() => service.createDraft({
    actor: { sub: 'admin-1', role: 'ADMIN' },
    assignmentId: assignment.id,
    requestType: 'ADJUST_WORK_TIME',
    proposal: {
      checkInAt: '2026-10-17T01:00:00.000Z', // 08:00 Bangkok
      checkOutAt: '2026-10-18T00:00:00.000Z' // 07:00 next day = 23 hours
    },
    reason: 'ยืนยันเวลาทำงานจริง'
  })), 'ATTENDANCE_ADJUSTMENT_DURATION_INVALID');
});

test('createDraft rejects a check-in far before the planned shift start', async () => {
  const { service } = buildService();
  assert.equal(await codeOf(() => service.createDraft({
    actor: { sub: 'admin-1', role: 'ADMIN' },
    assignmentId: assignment.id,
    requestType: 'ADJUST_WORK_TIME',
    proposal: {
      checkInAt: '2026-10-16T20:00:00.000Z', // 03:00 Bangkok, five hours early
      checkOutAt: '2026-10-17T10:00:00.000Z'
    },
    reason: 'ยืนยันเวลาทำงานจริง'
  })), 'ATTENDANCE_ADJUSTMENT_WINDOW_INVALID');
});

test('reject is refused before the request reaches the administrator stage', async () => {
  const { service } = buildService({ status: 'PENDING_MANAGER' });
  assert.equal(await codeOf(() => service.reject({
    actor: { sub: 'admin-1', role: 'ADMIN' },
    id: 'req-1',
    comment: 'ไม่อนุมัติ'
  })), 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION');
});

test('reject is allowed at the administrator stage', async () => {
  const { service, auditCalls } = buildService({ status: 'PENDING_ADMIN' });
  const result = await service.reject({
    actor: { sub: 'admin-1', role: 'ADMIN' },
    id: 'req-1',
    comment: 'ไม่อนุมัติ'
  });
  assert.equal(result.id, '22222222-2222-4222-8222-222222222222');
  const rejected = auditCalls.find((call) => call?.metadata?.event === 'REJECTED');
  assert.ok(rejected, 'expected a REJECTED audit entry');
  assert.equal(rejected.metadata.fromStatus, 'PENDING_ADMIN', 'audit must record the real source stage');
});
