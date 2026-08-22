'use strict';

const HttpError = require('../utils/http-error');
const { logger } = require('../utils/logger');

const LEAVE_APPROVAL_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: 'ReadCommitted',
  maxWait: 5000,
  timeout: 15000
});
const LEAVE_APPROVAL_TRANSACTION_TIMEOUT = 'LEAVE_APPROVAL_TRANSACTION_TIMEOUT';
const LEAVE_APPROVAL_TRANSACTION_TIMEOUT_MESSAGE = 'การอนุมัติใบลาใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง';

function elapsedMilliseconds(startedAt) {
  return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
}

async function measureLeaveApprovalStage(stageDurationsMs, stage, operation) {
  const startedAt = process.hrtime.bigint();
  try {
    return await operation();
  } finally {
    stageDurationsMs[stage] = elapsedMilliseconds(startedAt);
  }
}

function logTransactionTiming({ requestId, outcome, startedAt, stageDurationsMs, errorCode }) {
  const fields = {
    requestId,
    outcome,
    totalDurationMs: elapsedMilliseconds(startedAt),
    stageDurationsMs
  };
  if (errorCode) fields.errorCode = errorCode;
  const write = outcome === 'COMMITTED' ? logger.info : (errorCode === 'P2028' ? logger.error : logger.warn);
  write('leave_approval_transaction_timing', fields);
}

function transactionTimeoutError() {
  const error = new HttpError(503, LEAVE_APPROVAL_TRANSACTION_TIMEOUT_MESSAGE, { code: LEAVE_APPROVAL_TRANSACTION_TIMEOUT });
  error.code = 'P2028';
  error.publicMessage = LEAVE_APPROVAL_TRANSACTION_TIMEOUT_MESSAGE;
  error.publicCode = LEAVE_APPROVAL_TRANSACTION_TIMEOUT;
  return error;
}

async function runLeaveApprovalTransaction(prismaClient, callback, { requestId, stageDurationsMs = {} } = {}) {
  const startedAt = process.hrtime.bigint();
  try {
    const result = await prismaClient.$transaction(callback, LEAVE_APPROVAL_TRANSACTION_OPTIONS);
    logTransactionTiming({ requestId, outcome: 'COMMITTED', startedAt, stageDurationsMs });
    return result;
  } catch (error) {
    logTransactionTiming({ requestId, outcome: 'ROLLED_BACK', startedAt, stageDurationsMs, errorCode: error?.code });
    if (error?.code === 'P2028') throw transactionTimeoutError();
    if (error?.code === 'P2034') throw new HttpError(409, 'Leave quota state changed. Refresh and try again.', { code: 'LEAVE_QUOTA_STATE_CONFLICT' });
    throw error;
  }
}

module.exports = {
  LEAVE_APPROVAL_TRANSACTION_OPTIONS,
  LEAVE_APPROVAL_TRANSACTION_TIMEOUT,
  LEAVE_APPROVAL_TRANSACTION_TIMEOUT_MESSAGE,
  measureLeaveApprovalStage,
  runLeaveApprovalTransaction
};
