const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LEAVE_APPROVAL_TRANSACTION_OPTIONS,
  LEAVE_APPROVAL_TRANSACTION_TIMEOUT,
  measureLeaveApprovalStage,
  runLeaveApprovalTransaction
} = require('../src/services/leave-approval-transaction.service');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('leave approval transaction uses bounded ReadCommitted options and records stage timing', async () => {
  let transactionCalls = 0;
  let receivedOptions;
  const stageDurationsMs = {};
  const prismaClient = {
    $transaction: async (callback, options) => {
      transactionCalls += 1;
      receivedOptions = options;
      await delay(10);
      return callback({});
    }
  };

  const result = await runLeaveApprovalTransaction(prismaClient, async () => measureLeaveApprovalStage(stageDurationsMs, 'leave_lock_read', async () => {
    await delay(10);
    return { status: 'APPROVED' };
  }), { stageDurationsMs });

  assert.deepEqual(receivedOptions, LEAVE_APPROVAL_TRANSACTION_OPTIONS);
  assert.deepEqual(receivedOptions, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 });
  assert.equal(transactionCalls, 1);
  assert.equal(result.status, 'APPROVED');
  assert.ok(stageDurationsMs.leave_lock_read >= 10);
});

test('P2028 becomes a stable retryable timeout error without a second transaction attempt', async () => {
  let transactionCalls = 0;
  const prismaClient = {
    $transaction: async () => {
      transactionCalls += 1;
      throw Object.assign(new Error('transaction exceeded timeout'), { code: 'P2028' });
    }
  };

  await assert.rejects(
    () => runLeaveApprovalTransaction(prismaClient, async () => undefined),
    (error) => error.statusCode === 503
      && error.code === 'P2028'
      && error.publicCode === LEAVE_APPROVAL_TRANSACTION_TIMEOUT
      && error.details?.code === LEAVE_APPROVAL_TRANSACTION_TIMEOUT
  );
  assert.equal(transactionCalls, 1);
});

test('transaction timeout leaves business state unchanged when the transaction rolls back', async () => {
  const state = { leaveStatus: 'PENDING', shiftCount: 0, auditCount: 0 };
  const prismaClient = {
    $transaction: async (callback) => {
      const pendingState = { ...state };
      await callback({
        leaveRequest: { update: async () => { pendingState.leaveStatus = 'APPROVED'; return { status: 'APPROVED' }; } },
        shiftAssignment: { upsert: async () => { pendingState.shiftCount += 1; } },
        auditLog: { create: async () => { pendingState.auditCount += 1; } }
      });
      throw Object.assign(new Error('transaction exceeded timeout'), { code: 'P2028' });
    }
  };

  await assert.rejects(() => runLeaveApprovalTransaction(prismaClient, async (tx) => {
    await tx.shiftAssignment.upsert();
    await tx.leaveRequest.update();
    await tx.auditLog.create();
  }));
  assert.deepEqual(state, { leaveStatus: 'PENDING', shiftCount: 0, auditCount: 0 });
});

test('P2034 keeps the existing leave quota conflict contract', async () => {
  const prismaClient = { $transaction: async () => { throw Object.assign(new Error('serialization conflict'), { code: 'P2034' }); } };
  await assert.rejects(
    () => runLeaveApprovalTransaction(prismaClient, async () => undefined),
    (error) => error.statusCode === 409 && error.details?.code === 'LEAVE_QUOTA_STATE_CONFLICT'
  );
});
