'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceSelfiePolicyService } = require('../src/services/attendance-selfie-policy.service');
const roles = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'];
function fake(rows = []) {
  return {
    attendanceSelfiePolicy: {
      findMany: async () => rows,
      findUnique: async ({ where }) => rows.find((r) => r.role === where.role) || null
    }
  };
}
test('resolves all roles and actions OFF by default', async () => {
  const service = createAttendanceSelfiePolicyService({ prisma: fake() });
  for (const role of roles) for (const action of ['CHECK_IN', 'CHECK_OUT']) {
    const result = await service.resolve({ role, action });
    assert.equal(result.sourceRole, role); assert.equal(result.required, false);
  }
});
test('resolves independent role/action switches', async () => {
  const service = createAttendanceSelfiePolicyService({ prisma: fake([{ role: 'MANAGER', clockInRequired: true, clockOutRequired: false }]) });
  assert.equal((await service.resolve({ role: 'MANAGER', action: 'CHECK_IN' })).required, true);
  assert.equal((await service.resolve({ role: 'MANAGER', action: 'CHECK_OUT' })).required, false);
});
test('rejects unknown roles and actions', async () => {
  const service = createAttendanceSelfiePolicyService({ prisma: fake() });
  await assert.rejects(() => service.resolve({ role: 'OWNER', action: 'CHECK_IN' }), (error) => error.publicCode === 'ATTENDANCE_SELFIE_ROLE_INVALID');
  await assert.rejects(() => service.resolve({ role: 'ADMIN', action: 'BREAK' }), (error) => error.publicCode === 'ATTENDANCE_EVENT_INTENT_INVALID');
});
