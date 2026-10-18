'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAttendanceAdjustmentService,
  nextStageForMaker,
  reviewerRoleFor,
  PENDING_SUPERVISOR,
  PENDING_MANAGER,
  PENDING_ADMIN
} = require('../src/services/attendance-adjustment.service');

// OWNER policy (18 Oct 2026): employee -> any SUPERVISOR -> any MANAGER -> ADMIN.
test('an employee submission starts at the supervisor stage', () => {
  assert.equal(nextStageForMaker('VIEWER'), PENDING_SUPERVISOR);
});

test('a supervisor submission skips its own stage and goes to the manager', () => {
  assert.equal(nextStageForMaker('SUPERVISOR'), PENDING_MANAGER);
});

test('a manager or admin submission goes straight to the admin stage', () => {
  assert.equal(nextStageForMaker('MANAGER'), PENDING_ADMIN);
  assert.equal(nextStageForMaker('ADMIN'), PENDING_ADMIN);
});

test('each stage is owned by exactly one reviewer role', () => {
  assert.equal(reviewerRoleFor(PENDING_SUPERVISOR), 'SUPERVISOR');
  assert.equal(reviewerRoleFor(PENDING_MANAGER), 'MANAGER');
  assert.equal(reviewerRoleFor(PENDING_ADMIN), 'ADMIN');
});

function requestFor(status) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    shiftAssignmentId: '11111111-1111-4111-8111-111111111111',
    employeeId: 'employee-1',
    status,
    makerUserId: 'maker-user',
    makerRoleSnapshot: 'VIEWER',
    currentRevision: 1,
    beforeSnapshot: {},
    beforeDigest: 'a'.repeat(64),
    currentProposal: { checkInAt: '2026-10-17T01:00:00.000Z', checkOutAt: '2026-10-17T09:00:00.000Z' },
    currentProposalDigest: 'b'.repeat(64),
    reason: 'fixture reason'
  };
}

function sqlText(sql) {
  const strings = (sql?.strings || []).join(' ');
  const values = JSON.stringify(sql?.values || []);
  return `${strings} ${values}`;
}

function buildService(status) {
  const executed = [];
  const prisma = {
    $queryRaw: async (sql) => {
      const joined = sql?.strings?.join(' ') || '';
      if (joined.includes('FROM attendance_adjustment_requests')) return [requestFor(status)];
      return [];
    },
    $executeRaw: async (sql) => { executed.push(sql); return 1; },
    $transaction: async (fn) => fn(prisma)
  };
  const service = createAttendanceAdjustmentService({
    prisma,
    audit: { log: async () => {} },
    clock: () => new Date('2026-10-18T05:00:00.000Z')
  });
  return { service, executed };
}

const codeOf = async (fn) => {
  try { await fn(); return null; } catch (error) { return error.details?.code || error.code || error.message; }
};

test('a supervisor forwards a supervisor-stage request to the manager stage', async () => {
  const { service, executed } = buildService(PENDING_SUPERVISOR);
  await service.review({ actor: { sub: 'supervisor-1', role: 'SUPERVISOR' }, id: 'req-1', comment: 'ตรวจแล้ว' });
  const update = executed.find((sql) => (sql?.strings || []).join(' ').includes('UPDATE attendance_adjustment_requests'));
  assert.ok(update, 'expected an UPDATE statement');
  assert.ok(update.values.includes(PENDING_MANAGER), 'expected the next stage to be PENDING_MANAGER');
  const event = executed.find((sql) => sqlText(sql).includes('INSERT INTO attendance_adjustment_events'));
  assert.ok(event && sqlText(event).includes('REVIEWED'), 'expected a REVIEWED audit event');
});

test('a manager forwards a manager-stage request to the admin stage', async () => {
  const { service, executed } = buildService(PENDING_MANAGER);
  await service.review({ actor: { sub: 'manager-1', role: 'MANAGER' }, id: 'req-1' });
  const update = executed.find((sql) => (sql?.strings || []).join(' ').includes('UPDATE attendance_adjustment_requests'));
  assert.ok(update.values.includes(PENDING_ADMIN));
});

test('the wrong reviewer role cannot forward a stage', async () => {
  const supervisorView = buildService(PENDING_MANAGER);
  assert.equal(
    await codeOf(() => supervisorView.service.review({ actor: { sub: 'supervisor-1', role: 'SUPERVISOR' }, id: 'req-1' })),
    'ATTENDANCE_ADJUSTMENT_STAGE_FORBIDDEN'
  );

  const managerView = buildService(PENDING_SUPERVISOR);
  assert.equal(
    await codeOf(() => managerView.service.review({ actor: { sub: 'manager-1', role: 'MANAGER' }, id: 'req-1' })),
    'ATTENDANCE_ADJUSTMENT_STAGE_FORBIDDEN'
  );
});

test('a viewer or employee cannot forward a stage', async () => {
  const { service } = buildService(PENDING_SUPERVISOR);
  assert.equal(
    await codeOf(() => service.review({ actor: { sub: 'viewer-1', role: 'VIEWER' }, id: 'req-1' })),
    'ATTENDANCE_ADJUSTMENT_REVIEWER_REQUIRED'
  );
});

test('the admin stage is not forwardable any further', async () => {
  const { service } = buildService(PENDING_ADMIN);
  assert.equal(
    await codeOf(() => service.review({ actor: { sub: 'admin-1', role: 'ADMIN' }, id: 'req-1' })),
    'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION'
  );
});

test('approval is refused before the request reaches the admin stage', async () => {
  const { service } = buildService(PENDING_MANAGER);
  assert.equal(
    await codeOf(() => service.approve({ actor: { sub: 'admin-1', role: 'ADMIN' }, id: 'req-1' })),
    'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION'
  );
});

test('every stage may return for correction but only its own reviewer role', async () => {
  const supervisorStage = buildService(PENDING_SUPERVISOR);
  assert.equal(
    await codeOf(() => supervisorStage.service.returnForCorrection({ actor: { sub: 'manager-1', role: 'MANAGER' }, id: 'req-1', comment: 'ไม่ผ่าน' })),
    'ATTENDANCE_ADJUSTMENT_STAGE_FORBIDDEN'
  );

  const { service, executed } = buildService(PENDING_SUPERVISOR);
  await service.returnForCorrection({ actor: { sub: 'supervisor-1', role: 'SUPERVISOR' }, id: 'req-1', comment: 'กรุณาแก้ไข' });
  const update = executed.find((sql) => sqlText(sql).includes('UPDATE attendance_adjustment_requests'));
  assert.ok(sqlText(update).includes('RETURNED_FOR_CORRECTION'));
});
