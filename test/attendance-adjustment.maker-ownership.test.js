'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAttendanceAdjustmentService } = require('../src/services/attendance-adjustment.service');

// Maker ownership lock: only the request maker may submit or revise its own request.
const request = {
  id: '22222222-2222-4222-8222-222222222222',
  shiftAssignmentId: '11111111-1111-4111-8111-111111111111',
  employeeId: 'employee-1',
  status: 'DRAFT',
  makerUserId: 'maker-user',
  makerRoleSnapshot: 'SUPERVISOR',
  currentRevision: 1,
  beforeSnapshot: {},
  beforeDigest: 'a'.repeat(64),
  currentProposal: { checkInAt: '2026-10-17T01:00:00.000Z', checkOutAt: '2026-10-17T09:00:00.000Z' },
  currentProposalDigest: 'b'.repeat(64),
  reason: 'fixture'
};
const assignment = {
  id: request.shiftAssignmentId,
  employeeId: 'employee-1',
  workDate: new Date('2026-10-17T00:00:00.000Z'),
  employee: { department: 'OPS' },
  attendanceSession: null
};

const fakePrisma = {
  $queryRaw: async (...args) => {
    const strings = args[0]?.strings || [];
    const joined = Array.isArray(strings) ? strings.join(' ') : '';
    if (joined.includes('FROM attendance_adjustment_requests')) return [request];
    return [];
  },
  $executeRaw: async () => 1,
  shiftAssignment: { findUnique: async () => assignment },
  $transaction: async (fn) => fn(fakePrisma)
};
const service = createAttendanceAdjustmentService({
  prisma: fakePrisma,
  audit: { log: async () => {} },
  clock: () => new Date('2026-10-18T05:00:00.000Z')
});

test('the maker may submit its own draft', async () => {
  const result = await service.submit({ actor: { sub: 'maker-user', role: 'SUPERVISOR' }, id: request.id });
  assert.equal(result.id, request.id);
});

test('a different user cannot submit somebody else request', async () => {
  await assert.rejects(
    () => service.submit({ actor: { sub: 'other-user', role: 'ADMIN' }, id: request.id }),
    (error) => (error.details?.code || error.code) === 'ATTENDANCE_ADJUSTMENT_NOT_MAKER'
  );
});

test('a different user cannot revise somebody else request', async () => {
  await assert.rejects(
    () => service.revise({
      actor: { sub: 'other-user', role: 'MANAGER' },
      id: request.id,
      requestType: 'ADJUST_WORK_TIME',
      proposal: { checkInAt: '2026-10-17T02:00:00.000Z', checkOutAt: '2026-10-17T08:00:00.000Z' },
      reason: 'fixture revise'
    }),
    (error) => (error.details?.code || error.code) === 'ATTENDANCE_ADJUSTMENT_NOT_MAKER'
  );
});
