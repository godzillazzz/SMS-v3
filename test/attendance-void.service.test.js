'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceVoidService } = require('../src/services/attendance-void.service');

const sessionId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

function fixture() {
  return { id: sessionId, state: 'CLOSED', voidedAt: null, voidedByUserId: null, voidReason: null, employeeId: '44444444-4444-4444-8444-444444444444', shiftAssignmentId: '55555555-5555-4555-8555-555555555555', events: [{ id: eventId, state: 'ACTIVE', voidedAt: null, voidedByUserId: null, voidReason: null }] };
}
function fakePrisma(row, auditRows) {
  const tx = {
    attendanceSession: {
      findUnique: async () => row,
      update: async ({ data }) => Object.assign(row, data)
    },
    attendanceEvent: {
      updateMany: async ({ data }) => row.events.forEach((event) => Object.assign(event, data))
    }
  };
  return { $transaction: async (callback) => callback(tx), auditRows };
}

test('ADMIN voids complete session atomically, preserves evidence and audits before/after', async () => {
  const row = fixture();
  const auditRows = [];
  const service = createAttendanceVoidService({
    prisma: fakePrisma(row, auditRows),
    audit: { log: async (entry) => auditRows.push(entry) },
    clock: () => new Date('2026-10-22T00:00:00.000Z')
  });
  const result = await service.voidSession({ actor: { role: 'ADMIN', sub: userId }, sessionId, reason: 'Duplicate attendance evidence' });
  assert.equal(result.idempotent, false);
  assert.equal(row.state, 'VOIDED');
  assert.equal(row.events[0].state, 'VOIDED');
  assert.equal(auditRows[0].metadata.sessionId, sessionId);
  assert.deepEqual(auditRows[0].metadata.eventIds, [eventId]);
  assert.equal(auditRows[0].metadata.before.session.state, 'CLOSED');
  assert.equal(auditRows[0].metadata.after.events[0].state, 'VOIDED');
});

test('void is ADMIN-only and reason is required', async () => {
  const service = createAttendanceVoidService({ prisma: fakePrisma(fixture(), []) });
  await assert.rejects(() => service.voidSession({ actor: { role: 'MANAGER', sub: userId }, sessionId, reason: 'valid reason' }), { statusCode: 403 });
  await assert.rejects(() => service.voidSession({ actor: { role: 'ADMIN', sub: userId }, sessionId, reason: 'no' }), { statusCode: 400 });
});

test('repeat void is idempotent and UAT reset fails closed in production', async () => {
  const row = fixture(); row.state = 'VOIDED'; row.voidedAt = new Date(); row.voidedByUserId = userId; row.voidReason = 'Already voided';
  const service = createAttendanceVoidService({ prisma: fakePrisma(row, []), environment: { ATTENDANCE_RUNTIME_CLASSIFICATION: 'UAT', ATTENDANCE_UAT_RESET_ENABLED: 'true', VERCEL_ENV: 'production' } });
  const result = await service.voidSession({ actor: { role: 'ADMIN', sub: userId }, sessionId, reason: 'repeat request' });
  assert.equal(result.idempotent, true);
  await assert.rejects(() => service.resetApprovedUatFixture({ actor: { role: 'ADMIN', sub: userId }, sessionId, reason: 'fixture reset' }), { statusCode: 404 });
});
