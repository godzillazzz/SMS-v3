const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ZodError } = require('zod');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('schedule batch uses its transaction client for the existing-assignment lookup', () => {
  const source = read('src/services/schedule.service.js');
  const start = source.indexOf('const results = await prisma.$transaction(async (tx) => {');
  const end = source.indexOf("  }, { maxWait: 10000, timeout: 60000 });", start);
  const transactionBody = source.slice(start, end);

  assert.match(transactionBody, /await tx\.shiftAssignment\.findMany\(/);
  assert.doesNotMatch(transactionBody, /await prisma\.shiftAssignment\.findMany\(/);
});

test('schedule batch validates calendar dates and logs sanitized write diagnostics', () => {
  const source = read('src/routes/schedules.routes.js');

  assert.match(source, /Work date must be a valid calendar date/);
  assert.match(source, /schedule_batch_write_failed/);
  assert.match(source, /requestId: req\.requestId/);
  assert.match(source, /assignmentCount/);
  assert.match(source, /operation: 'upsert_batch'/);
  assert.match(source, /model: 'ShiftAssignment'/);
});

test('batch write uses the same transaction flow for one and several assignments', async () => {
  const prisma = require('../src/config/prisma');
  const scheduleService = require('../src/services/schedule.service');
  const original = {
    employeeFindMany: prisma.employee.findMany,
    shiftTypeFindMany: prisma.shiftType.findMany,
    licenseFindMany: prisma.employeeLicense.findMany,
    licenseDocumentFindMany: prisma.employeeLicenseDocument.findMany,
    globalAssignmentFindMany: prisma.shiftAssignment.findMany,
    transaction: prisma.$transaction
  };
  const calls = { existingFindMany: 0, upserts: 0, globalFindMany: 0, commits: 0, rollbacks: 0 };
  let approval;
  const tx = {
    shiftAssignment: {
      findMany: async () => { calls.existingFindMany += 1; return []; },
      upsert: async ({ where, create }) => {
        calls.upserts += 1;
        return { id: `assignment-${calls.upserts}`, ...create, workDate: where.workDate_employeeId.workDate };
      }
    },
    scheduleApproval: {
      findFirst: async () => approval,
      create: async ({ data }) => { approval = { id: 'approval-1', ...data }; return approval; },
      update: async ({ data }) => { approval = { ...approval, ...data }; return approval; }
    },
    auditLog: { create: async ({ data }) => ({ id: 'audit-1', ...data }) }
  };
  const employee = { id: '00000000-0000-4000-8000-000000000001', displayName: 'Test Employee', firstName: 'Test', lastName: 'Employee', department: 'Test' };
  const shiftType = { id: '00000000-0000-4000-8000-000000000002', code: 'OFF', startTime: '00:00', endTime: '00:00', hours: 0 };
  const assignment = (day) => ({ employeeId: employee.id, shiftTypeId: shiftType.id, workDate: `2026-08-${day}`, remark: 'test' });
  try {
    prisma.employee.findMany = async () => [employee];
    prisma.shiftType.findMany = async () => [shiftType];
    prisma.employeeLicense.findMany = async () => [];
    prisma.employeeLicenseDocument.findMany = async () => [];
    prisma.shiftAssignment.findMany = async () => { calls.globalFindMany += 1; throw new Error('global client used inside transaction'); };
    prisma.$transaction = async (callback) => {
      try { const result = await callback(tx); calls.commits += 1; return result; }
      catch (error) { calls.rollbacks += 1; throw error; }
    };

    const one = await scheduleService.saveBatchAssignments([assignment('01')], employee.id);
    const many = await scheduleService.saveBatchAssignments([assignment('02'), assignment('03')], employee.id);

    assert.equal(one.count, 1);
    assert.equal(many.count, 2);
    assert.equal(calls.existingFindMany, 2);
    assert.equal(calls.upserts, 3);
    assert.equal(calls.globalFindMany, 0);
    assert.equal(calls.commits, 2);
    assert.equal(calls.rollbacks, 0);
  } finally {
    prisma.employee.findMany = original.employeeFindMany;
    prisma.shiftType.findMany = original.shiftTypeFindMany;
    prisma.employeeLicense.findMany = original.licenseFindMany;
    prisma.employeeLicenseDocument.findMany = original.licenseDocumentFindMany;
    prisma.shiftAssignment.findMany = original.globalAssignmentFindMany;
    prisma.$transaction = original.transaction;
  }
});

test('findMany failure rejects the transaction and is not converted into a successful write', async () => {
  const prisma = require('../src/config/prisma');
  const scheduleService = require('../src/services/schedule.service');
  const original = { employeeFindMany: prisma.employee.findMany, shiftTypeFindMany: prisma.shiftType.findMany, licenseFindMany: prisma.employeeLicense.findMany, transaction: prisma.$transaction };
  let rolledBack = false;
  const employee = { id: '00000000-0000-4000-8000-000000000011', displayName: 'Test Employee', department: 'Test' };
  const shiftType = { id: '00000000-0000-4000-8000-000000000012', code: 'OFF', startTime: '00:00', endTime: '00:00', hours: 0 };
  try {
    prisma.employee.findMany = async () => [employee];
    prisma.shiftType.findMany = async () => [shiftType];
    prisma.employeeLicense.findMany = async () => [];
    prisma.employeeLicenseDocument.findMany = async () => [];
    prisma.$transaction = async (callback) => {
      try { return await callback({ shiftAssignment: { findMany: async () => { throw Object.assign(new Error('findMany failed'), { code: 'P2024' }); } } }); }
      catch (error) { rolledBack = true; throw error; }
    };
    await assert.rejects(() => scheduleService.saveBatchAssignments([{ employeeId: employee.id, shiftTypeId: shiftType.id, workDate: '2026-08-01' }], employee.id), (error) => error.code === 'P2024');
    assert.equal(rolledBack, true);
  } finally {
    prisma.employee.findMany = original.employeeFindMany;
    prisma.shiftType.findMany = original.shiftTypeFindMany;
    prisma.employeeLicense.findMany = original.licenseFindMany;
    prisma.employeeLicenseDocument.findMany = original.licenseDocumentFindMany;
    prisma.$transaction = original.transaction;
  }
});

test('an unknown employee in a later item rolls back earlier upserts in the same batch', async () => {
  const prisma = require('../src/config/prisma');
  const scheduleService = require('../src/services/schedule.service');
  const original = { employeeFindMany: prisma.employee.findMany, shiftTypeFindMany: prisma.shiftType.findMany, licenseFindMany: prisma.employeeLicense.findMany, transaction: prisma.$transaction };
  const knownEmployee = { id: '00000000-0000-4000-8000-000000000031', displayName: 'Known Employee', department: 'Test' };
  const shiftType = { id: '00000000-0000-4000-8000-000000000032', code: 'OFF', startTime: '00:00', endTime: '00:00', hours: 0 };
  let upserts = 0;
  let rolledBack = false;
  try {
    prisma.employee.findMany = async () => [knownEmployee];
    prisma.shiftType.findMany = async () => [shiftType];
    prisma.employeeLicense.findMany = async () => [];
    prisma.employeeLicenseDocument.findMany = async () => [];
    prisma.$transaction = async (callback) => {
      const tx = {
        shiftAssignment: {
          findMany: async () => [],
          upsert: async () => { upserts += 1; return { id: 'assignment-rollback', workDate: new Date('2026-08-01T00:00:00.000Z'), employeeId: knownEmployee.id }; }
        }
      };
      try { return await callback(tx); } catch (error) { rolledBack = true; throw error; }
    };
    await assert.rejects(() => scheduleService.saveBatchAssignments([
      { employeeId: knownEmployee.id, shiftTypeId: shiftType.id, workDate: '2026-08-01' },
      { employeeId: '00000000-0000-4000-8000-000000000033', shiftTypeId: shiftType.id, workDate: '2026-08-02' }
    ], knownEmployee.id), /Employee not found/);
    assert.equal(upserts, 1);
    assert.equal(rolledBack, true);
  } finally {
    prisma.employee.findMany = original.employeeFindMany;
    prisma.shiftType.findMany = original.shiftTypeFindMany;
    prisma.employeeLicense.findMany = original.licenseFindMany;
    prisma.employeeLicenseDocument.findMany = original.licenseDocumentFindMany;
    prisma.$transaction = original.transaction;
  }
});

test('date validation accepts real dates without timezone shifting and rejects impossible dates', () => {
  const { batchSchema } = require('../src/routes/schedules.routes');
  const valid = { assignments: [{ employeeId: '00000000-0000-4000-8000-000000000021', shiftTypeId: '00000000-0000-4000-8000-000000000022', workDate: '2026-07-31' }] };
  assert.equal(batchSchema.parse(valid).assignments[0].workDate, '2026-07-31');
  assert.equal(new Date(`${valid.assignments[0].workDate}T00:00:00.000Z`).toISOString().slice(0, 10), '2026-07-31');
  assert.throws(() => batchSchema.parse({ ...valid, assignments: [{ ...valid.assignments[0], workDate: '2026-02-30' }] }), ZodError);
});

test('validation errors remain HTTP 400 and do not expose stack details', () => {
  const { errorHandler } = require('../src/middlewares/error-handler');
  let statusCode;
  let body;
  const res = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
  errorHandler(new ZodError([{ code: 'custom', path: ['assignments', 0, 'workDate'], message: 'invalid date' }]), { requestId: 'test-request' }, res, () => {});
  assert.equal(statusCode, 400);
  assert.match(body.error, /Validation failed/);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'stack'), false);
  assert.notEqual(statusCode, 503);
});

test('P2024 and P2028 are logged with sanitized diagnostics while clients receive safe 503 responses', () => {
  const { errorHandler } = require('../src/middlewares/error-handler');
  const { logger, sanitize } = require('../src/utils/logger');
  const originalError = logger.error;
  const records = [];
  logger.error = (event, fields) => records.push({ event, fields: sanitize(fields) });
  try {
    for (const code of ['P2024', 'P2028']) {
      let statusCode;
      let body;
      const res = { status(value) { statusCode = value; return this; }, json(value) { body = value; return this; } };
      errorHandler(Object.assign(new Error(`database ${code} detail`), {
        name: 'PrismaClientKnownRequestError',
        code,
        meta: { details: 'safe detail', hint: 'safe hint' },
        stack: `Error\n at query (sensitive-stack-value-${'a'.repeat(64)})`
      }), { requestId: `request-${code}` }, res, () => {});
      assert.equal(statusCode, 503);
      assert.equal(body.error, 'Database unavailable.');
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'stack'), false);
    }
    assert.deepEqual(records.map((record) => record.fields.errorCode), ['P2024', 'P2028']);
    assert.equal(records.every((record) => record.fields.operation === 'request_database_operation'), true);
    assert.equal(records.every((record) => !Object.prototype.hasOwnProperty.call(record.fields, 'errorMessage')), true);
    assert.equal(records.every((record) => !Object.prototype.hasOwnProperty.call(record.fields, 'errorDetails')), true);
    assert.equal(records.every((record) => !Object.prototype.hasOwnProperty.call(record.fields, 'errorHint')), true);
    assert.equal(records.every((record) => !Object.prototype.hasOwnProperty.call(record.fields, 'stack')), true);
  } finally {
    logger.error = originalError;
  }
});
