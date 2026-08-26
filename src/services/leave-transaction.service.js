'use strict';

const HttpError = require('../utils/http-error');
const { logger } = require('../utils/logger');

const LEAVE_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: 'ReadCommitted',
  maxWait: 5000,
  timeout: 15000
});
const LEAVE_TRANSACTION_TIMEOUT = 'LEAVE_TRANSACTION_TIMEOUT';
const LEAVE_TRANSACTION_TIMEOUT_MESSAGE = 'การบันทึกคำขอลาใช้เวลานานเกินไป กรุณาตรวจสอบประวัติคำขอลาก่อน แล้วลองใหม่อีกครั้ง';
const LEAVE_CREATE_TIMING_STAGES = Object.freeze([
  'current_user_lookup',
  'employee_lookup',
  'overlap_lookup',
  'quota_ensure',
  'approved_usage_lookup',
  'leave_create',
  'attachment_create',
  'audit'
]);

function elapsedMilliseconds(startedAt) {
  return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
}

function createLeaveStageDurations() {
  return Object.fromEntries(LEAVE_CREATE_TIMING_STAGES.map((stage) => [stage, 0]));
}

async function measureLeaveTransactionStage(stageDurationsMs, stage, operation) {
  const startedAt = process.hrtime.bigint();
  try {
    return await operation();
  } finally {
    stageDurationsMs[stage] = elapsedMilliseconds(startedAt);
  }
}

function logTransactionTiming({ timingEvent, requestId, outcome, startedAt, stageDurationsMs, errorCode }) {
  if (!timingEvent) return;
  const fields = {
    requestId,
    outcome,
    totalDurationMs: elapsedMilliseconds(startedAt),
    stageDurationsMs
  };
  if (errorCode) fields.errorCode = errorCode;
  const write = outcome === 'COMMITTED' ? logger.info : (errorCode === 'P2028' ? logger.error : logger.warn);
  write(timingEvent, fields);
}

function transactionTimeoutError() {
  const error = new HttpError(503, LEAVE_TRANSACTION_TIMEOUT_MESSAGE, { code: LEAVE_TRANSACTION_TIMEOUT });
  error.code = 'P2028';
  error.publicMessage = LEAVE_TRANSACTION_TIMEOUT_MESSAGE;
  error.publicCode = LEAVE_TRANSACTION_TIMEOUT;
  return error;
}

async function runLeaveTransaction(prismaClient, callback, { requestId, stageDurationsMs = {}, timingEvent } = {}) {
  const startedAt = process.hrtime.bigint();
  try {
    const result = await prismaClient.$transaction(callback, LEAVE_TRANSACTION_OPTIONS);
    logTransactionTiming({ timingEvent, requestId, outcome: 'COMMITTED', startedAt, stageDurationsMs });
    return result;
  } catch (error) {
    logTransactionTiming({ timingEvent, requestId, outcome: 'ROLLED_BACK', startedAt, stageDurationsMs, errorCode: error?.code });
    if (error?.code === 'P2028') throw transactionTimeoutError();
    if (error?.code === 'P2034') throw new HttpError(409, 'Leave quota state changed. Refresh and try again.', { code: 'LEAVE_QUOTA_STATE_CONFLICT' });
    throw error;
  }
}

module.exports = {
  LEAVE_TRANSACTION_OPTIONS,
  LEAVE_TRANSACTION_TIMEOUT,
  LEAVE_TRANSACTION_TIMEOUT_MESSAGE,
  LEAVE_CREATE_TIMING_STAGES,
  createLeaveStageDurations,
  measureLeaveTransactionStage,
  runLeaveTransaction
};
