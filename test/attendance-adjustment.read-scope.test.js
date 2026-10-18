'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAttendanceAdjustmentService } = require('../src/services/attendance-adjustment.service');

// Read scope lock (OWNER policy 18 Oct 2026): executives read across departments,
// a linked VIEWER reads only its own requests, and an unlinked VIEWER is denied.
const request = {
  id: '22222222-2222-4222-8222-222222222222',
  shiftAssignmentId: '11111111-1111-4111-8111-111111111111',
  employeeId: 'employee-1',
  status: 'DRAFT',
  makerUserId: 'user-1',
  makerRoleSnapshot: 'MANAGER',
  currentRevision: 1,
  beforeSnapshot: {},
  beforeDigest: 'a'.repeat(64),
  currentProposal: { checkInAt: null, checkOutAt: null },
  currentProposalDigest: 'b'.repeat(64),
  reason: 'fixture'
};

const fakePrisma = {
  $queryRaw: async (...args) => {
    const strings = args[0]?.strings || [];
    const joined = Array.isArray(strings) ? strings.join(' ') : '';
    if (joined.includes('FROM attendance_adjustment_requests')) return [request];
    return [];
  }
};
const audit = { log: async () => {} };
const service = createAttendanceAdjustmentService({
  prisma: fakePrisma,
  audit,
  clock: () => new Date('2026-10-18T05:00:00.000Z')
});

const viewer = (employeeId) => ({ sub: 'viewer-user', role: 'VIEWER', employeeAuthority: employeeId ? { id: employeeId } : null });

test('a linked VIEWER can read its own request', async () => {
  const result = await service.get({ actor: viewer('employee-1'), id: request.id });
  assert.equal(result.id, request.id);
});

test('a linked VIEWER cannot read another employee request', async () => {
  await assert.rejects(
    () => service.get({ actor: viewer('employee-2'), id: request.id }),
    (error) => (error.details?.code || error.code) === 'ATTENDANCE_ADJUSTMENT_READ_FORBIDDEN'
  );
});

test('an unlinked VIEWER cannot read any request', async () => {
  await assert.rejects(
    () => service.get({ actor: viewer(null), id: request.id }),
    (error) => (error.details?.code || error.code) === 'ATTENDANCE_ADJUSTMENT_READ_FORBIDDEN'
  );
});

test('executives read across departments', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR']) {
    const result = await service.get({ actor: { sub: `${role.toLowerCase()}-1`, role }, id: request.id });
    assert.equal(result.id, request.id, `${role} read`);
  }
});
