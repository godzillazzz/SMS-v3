process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { linkLeaveQuota, LEAVE_QUOTA_STATE_CONFLICT } = require('../src/services/leave-quota-link.service');

test('manual quota link uses Serializable isolation and maps P2034 to a safe conflict', async () => {
  let isolationLevel;
  const prismaClient = {
    $transaction: async (_callback, options) => {
      isolationLevel = options?.isolationLevel;
      throw Object.assign(new Error('serialization'), { code: 'P2034' });
    }
  };
  await assert.rejects(
    () => linkLeaveQuota({ quotaId: 'quota-1', employeeId: 'employee-1', actorUserId: 'admin-1', prismaClient }),
    (error) => error.statusCode === 409 && error.details?.code === LEAVE_QUOTA_STATE_CONFLICT
  );
  assert.equal(isolationLevel, 'Serializable');
});
