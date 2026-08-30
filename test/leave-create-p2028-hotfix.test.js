const test = require('node:test');
const { validPngFixture } = require('./support/valid-jpeg-fixture');
const assert = require('node:assert/strict');

const { errorHandler } = require('../src/middlewares/error-handler');
const { logger } = require('../src/utils/logger');
const {
  LEAVE_TRANSACTION_OPTIONS,
  LEAVE_TRANSACTION_TIMEOUT,
  LEAVE_TRANSACTION_TIMEOUT_MESSAGE,
  LEAVE_CREATE_TIMING_STAGES,
  createLeaveStageDurations,
  measureLeaveTransactionStage,
  runLeaveTransaction
} = require('../src/services/leave-transaction.service');

function fakeResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('A/G. general leave transaction uses bounded options and never retries P2028', async () => {
  let calls = 0;
  let options;
  const prismaClient = {
    $transaction: async (callback, receivedOptions) => {
      calls += 1;
      options = receivedOptions;
      return callback({});
    }
  };
  const result = await runLeaveTransaction(prismaClient, async () => 'ok');
  assert.equal(result, 'ok');
  assert.deepEqual(options, LEAVE_TRANSACTION_OPTIONS);
  assert.deepEqual(options, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 });
  assert.equal(calls, 1);

  const timeoutPrisma = {
    $transaction: async () => {
      calls += 1;
      throw Object.assign(new Error('transaction timeout'), { code: 'P2028' });
    }
  };
  calls = 0;
  await assert.rejects(() => runLeaveTransaction(timeoutPrisma, async () => undefined), (error) => error.code === 'P2028');
  assert.equal(calls, 1);
});

test('B. P2028 maps to stable safe HTTP 503 contract', async () => {
  let mapped;
  try {
    await runLeaveTransaction({ $transaction: async () => { throw Object.assign(new Error('sensitive prisma text'), { code: 'P2028' }); } }, async () => undefined);
  } catch (error) {
    mapped = error;
  }
  assert.equal(mapped.statusCode, 503);
  assert.equal(mapped.publicCode, LEAVE_TRANSACTION_TIMEOUT);
  assert.equal(mapped.publicMessage, LEAVE_TRANSACTION_TIMEOUT_MESSAGE);
  assert.match(mapped.publicMessage, /ตรวจสอบประวัติคำขอลา/);

  const req = { requestId: 'req-safe', method: 'POST', originalUrl: '/api/v1/leave-requests' };
  const res = fakeResponse();
  errorHandler(mapped, req, res, () => {});
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: LEAVE_TRANSACTION_TIMEOUT_MESSAGE, requestId: 'req-safe', code: LEAVE_TRANSACTION_TIMEOUT });
  assert.doesNotMatch(JSON.stringify(res.body), /Prisma|postgres|database_url|stack/i);
});

test('C. P2034 keeps existing leave quota conflict behavior', async () => {
  await assert.rejects(
    () => runLeaveTransaction({ $transaction: async () => { throw Object.assign(new Error('serialization'), { code: 'P2034' }); } }, async () => undefined),
    (error) => error.statusCode === 409 && error.details?.code === 'LEAVE_QUOTA_STATE_CONFLICT'
  );
});

test('timing event records only bounded stage timing fields', async () => {
  const records = [];
  const originals = { info: logger.info, warn: logger.warn, error: logger.error };
  logger.info = (event, fields) => records.push({ level: 'info', event, fields });
  logger.warn = (event, fields) => records.push({ level: 'warn', event, fields });
  logger.error = (event, fields) => records.push({ level: 'error', event, fields });
  try {
    const stageDurationsMs = createLeaveStageDurations();
    await runLeaveTransaction({ $transaction: async (callback) => callback({}) }, async () => {
      await measureLeaveTransactionStage(stageDurationsMs, 'current_user_lookup', async () => undefined);
      return 'ok';
    }, { requestId: 'req-timing', stageDurationsMs, timingEvent: 'leave_create_transaction_timing' });
    assert.deepEqual(Object.keys(stageDurationsMs), LEAVE_CREATE_TIMING_STAGES);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, 'leave_create_transaction_timing');
    assert.equal(records[0].fields.requestId, 'req-timing');
    assert.equal(records[0].fields.outcome, 'COMMITTED');
    assert.equal(typeof records[0].fields.totalDurationMs, 'number');
    assert.deepEqual(Object.keys(records[0].fields.stageDurationsMs), LEAVE_CREATE_TIMING_STAGES);
  } finally {
    logger.info = originals.info; logger.warn = originals.warn; logger.error = originals.error;
  }
});

function createFakePrisma(config = {}) {
  const state = { leaves: [], attachments: [], audits: [], quotas: [] };
  if (!config.autoQuota) state.quotas.push({ id: 'quota-existing', employeeId: '10000000-0000-4000-8000-000000000100', quotaYear: 2026, sickLeave: config.sickLeave ?? 30, personalLeave: 3, vacationLeave: 6, matchStatus: 'MATCHED' });
  let transactionCalls = 0;
  let transactionOptions;

  const prisma = {
    async $transaction(callback, options) {
      transactionCalls += 1;
      transactionOptions = options;
      const draft = structuredClone(state);
      const employee = { id: '10000000-0000-4000-8000-000000000100', firstName: 'Test', lastName: 'Employee', displayName: 'Test Employee', department: 'OPS', deletedAt: null, isActive: true };
      const tx = {
        systemSetting: { findMany: async () => [] },
        user: { findUniqueOrThrow: async () => ({ role: 'ADMIN', employeeId: employee.id }) },
        employee: {
          findUniqueOrThrow: async () => employee,
          findFirst: async () => employee
        },
        leaveQuota: {
          findUnique: async ({ where }) => draft.quotas.find((q) => q.employeeId === where.employeeId_quotaYear.employeeId && q.quotaYear === where.employeeId_quotaYear.quotaYear) || null,
          findMany: async () => [],
          createMany: async ({ data }) => {
            for (const row of data) draft.quotas.push({ id: 'quota-auto', sickLeave: 30, personalLeave: 3, vacationLeave: 6, matchStatus: 'MATCHED', ...row });
            return { count: data.length };
          }
        },
        leaveRequest: {
          findFirst: async () => config.overlap ? { id: 'overlap' } : null,
          findMany: async () => config.approvedRows || [],
          create: async ({ data }) => {
            const row = { id: 'leave-' + (draft.leaves.length + 1), ...data };
            draft.leaves.push(row);
            return row;
          },
          update: async ({ where, data }) => {
            const row = draft.leaves.find((item) => item.id === where.id);
            Object.assign(row, data);
            return row;
          }
        },
        leaveAttachment: {
          create: async ({ data }) => { const row = { id: 'attachment-' + (draft.attachments.length + 1), ...data }; draft.attachments.push(row); return row; }
        },
        auditLog: {
          create: async ({ data }) => { const row = { id: 'audit-' + (draft.audits.length + 1), ...data }; draft.audits.push(row); return row; }
        }
      };
      const result = await callback(tx);
      if (config.failAfterCallbackCode) throw Object.assign(new Error('simulated transaction failure'), { code: config.failAfterCallbackCode });
      state.leaves = draft.leaves; state.attachments = draft.attachments; state.audits = draft.audits; state.quotas = draft.quotas;
      return result;
    }
  };
  return { prisma, state, get transactionCalls() { return transactionCalls; }, get transactionOptions() { return transactionOptions; } };
}

function clearRouteCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.endsWith('src\\routes\\operations.routes.js') || key.endsWith('src/routes/operations.routes.js')) delete require.cache[key];
  }
}

function loadHandler(routePath, fakePrisma, notifications = {}) {
  require.cache[require.resolve('../src/config/prisma')] = { exports: fakePrisma };
  const authPath = require.resolve('../src/middlewares/authenticate');
  require.cache[authPath] = { exports: {
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next()
  } };
  const servicePath = require.resolve('../src/services/notification-email.service');
  require.cache[servicePath] = { exports: {
    broadcastLeaveRequestEmail: notifications.broadcast || (async () => {}),
    notifyEmployeeLeaveStatusChange: notifications.employee || (async () => {}),
    sendNotification: async () => {}, createTransporter: () => {}
  } };
  clearRouteCache();
  const routes = require('../src/routes/operations.routes');
  const layer = routes.stack.find((entry) => entry.route && entry.route.path === routePath && entry.route.methods.post);
  assert.ok(layer, 'leave route exists');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function leaveRequestBody() {
  return { employeeId: '10000000-0000-4000-8000-000000000100', leaveType: 'SICK', startDate: '2026-09-10', endDate: '2026-09-10', substitute: 'Sub Person', reason: 'Focused reliability test' };
}

async function invoke(handler, { file } = {}) {
  const req = { body: leaveRequestBody(), user: { sub: 'creator-1', role: 'ADMIN' }, requestId: 'req-route-test', ...(file && { file }) };
  let nextError; let statusCode; let responseBody;
  const res = { status(code) { statusCode = code; return this; }, json(body) { responseBody = body; return this; } };
  await handler(req, res, (error) => { nextError = error; });
  return { nextError, statusCode, responseBody };
}

test('D. normal leave submission creates exactly one LeaveRequest', async () => {
  const f = createFakePrisma();
  const handler = loadHandler('/leave-requests', f.prisma);
  const result = await invoke(handler);
  assert.equal(result.nextError, undefined);
  assert.equal(result.statusCode, 201);
  assert.equal(f.state.leaves.length, 1);
  assert.equal(f.state.attachments.length, 0);
  assert.deepEqual(f.transactionOptions, LEAVE_TRANSACTION_OPTIONS);
  assert.equal(f.transactionCalls, 1);
});

test('E. multipart leave submission creates one LeaveRequest and one attachment', async () => {
  const f = createFakePrisma();
  const handler = loadHandler('/leave-requests/with-attachment', f.prisma);
  const buffer = validPngFixture();
  const file = { mimetype: 'image/png', size: buffer.length, originalname: 'proof.png', buffer };
  const result = await invoke(handler, { file });
  assert.equal(result.nextError, undefined);
  assert.equal(result.statusCode, 201);
  assert.equal(f.state.leaves.length, 1);
  assert.equal(f.state.attachments.length, 1);
  assert.equal(f.transactionCalls, 1);
});

test('F. P2028 after callback rolls back leave, attachment, audit, and auto-created annual quota', async () => {
  const f = createFakePrisma({ autoQuota: true, failAfterCallbackCode: 'P2028' });
  const handler = loadHandler('/leave-requests/with-attachment', f.prisma);
  const buffer = validPngFixture();
  const file = { mimetype: 'image/png', size: buffer.length, originalname: 'proof.png', buffer };
  const result = await invoke(handler, { file });
  assert.equal(result.nextError?.statusCode, 503);
  assert.equal(result.nextError?.publicCode, LEAVE_TRANSACTION_TIMEOUT);
  assert.deepEqual({ leaves: f.state.leaves.length, attachments: f.state.attachments.length, audits: f.state.audits.length, quotas: f.state.quotas.length }, { leaves: 0, attachments: 0, audits: 0, quotas: 0 });
  assert.equal(f.transactionCalls, 1);
});

test('H. existing overlap guard remains unchanged', async () => {
  const f = createFakePrisma({ overlap: true });
  const handler = loadHandler('/leave-requests', f.prisma);
  const result = await invoke(handler);
  assert.equal(result.nextError?.statusCode, 409);
  assert.equal(result.nextError?.message, 'An overlapping leave request already exists.');
  assert.equal(f.state.leaves.length, 0);
});

test('I. existing annual quota validation remains unchanged', async () => {
  const f = createFakePrisma({ sickLeave: 0 });
  const handler = loadHandler('/leave-requests', f.prisma);
  const result = await invoke(handler);
  assert.equal(result.nextError?.statusCode, 400);
  assert.equal(result.nextError?.details?.code, 'LEAVE_QUOTA_INSUFFICIENT');
  assert.equal(f.state.leaves.length, 0);
});

test('J. notification failures stay post-commit and non-fatal', async () => {
  const f = createFakePrisma();
  const fail = async () => { throw new Error('SMTP unavailable'); };
  const handler = loadHandler('/leave-requests', f.prisma, { broadcast: fail, employee: fail });
  const result = await invoke(handler);
  assert.equal(result.nextError, undefined);
  assert.equal(result.statusCode, 201);
  assert.equal(f.state.leaves.length, 1);
  assert.equal(f.transactionCalls, 1);
});
