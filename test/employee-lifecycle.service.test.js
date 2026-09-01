const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEmployeeLifecycleService } = require('../src/services/employee-lifecycle.service');

const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

function createHarness() {
  let now = new Date('2026-08-13T02:00:00.000Z');
  let sequence = 0;
  const store = {
    employees: [{ id: EMPLOYEE_ID, employeeCode: 'EMP001', firstName: 'สมชาย', lastName: 'ใจดี', displayName: 'สมชาย ใจดี', department: 'Security A', jobTitle: 'Officer', isActive: true, deletedAt: null, updatedAt: new Date('2026-08-13T00:00:00.000Z') }],
    users: [{ id: USER_ID, employeeId: EMPLOYEE_ID, displayName: 'สมชาย ใจดี', department: 'Security A', role: 'VIEWER', isActive: true, accountStatus: 'ACTIVE', employmentSuspendedAt: null, tokenVersion: 0 }],
    events: [],
    shifts: [{ id: 'shift-1', employeeId: EMPLOYEE_ID, workDate: new Date('2026-09-05T00:00:00.000Z') }],
    leaves: [{ id: 'leave-1', employeeId: EMPLOYEE_ID, status: 'PENDING', endDate: new Date('2026-09-06T00:00:00.000Z') }, { id: 'leave-2', employeeId: EMPLOYEE_ID, status: 'APPROVED', endDate: new Date('2026-09-10T00:00:00.000Z') }],
    quotas: [{ id: 'quota-1', employeeId: EMPLOYEE_ID }],
    licenses: [{ id: 'license-1', employeeId: EMPLOYEE_ID, status: 'Active', expiryDate: new Date('2027-01-01T00:00:00.000Z') }],
    documents: [{ id: 'document-1', employeeId: EMPLOYEE_ID }],
    sessions: [{ id: 'session-1', userId: USER_ID, revokedAt: null }],
    audits: []
  };
  let failAudit = false;
  let inTransaction = false;
  let transactionImpactQueries = 0;
  let lastTransactionOptions;
  const employeeWithUser = (employee) => employee ? { ...employee, user: store.users.find((user) => user.employeeId === employee.id) || null } : null;
  const sortEvents = (rows, orderBy = []) => rows.sort((left, right) => {
    for (const order of orderBy) {
      const [field, direction] = Object.entries(order)[0];
      const difference = field === 'sequence' ? Number(left[field]) - Number(right[field]) : new Date(left[field]).getTime() - new Date(right[field]).getTime();
      if (difference) return direction === 'desc' ? -difference : difference;
      if (field === 'employeeId') {
        const textDifference = direction === 'desc' ? String(right[field]).localeCompare(String(left[field])) : String(left[field]).localeCompare(String(right[field]));
        if (textDifference) return textDifference;
      }
    }
    return 0;
  });
  const eventFilter = (where = {}) => store.events.filter((event) => {
    if (where.id && event.id !== where.id) return false;
    if (where.employeeId && typeof where.employeeId === 'string' && event.employeeId !== where.employeeId) return false;
    if (where.employeeId?.in && !where.employeeId.in.includes(event.employeeId)) return false;
    if (where.status && event.status !== where.status) return false;
    if (where.effectiveDate?.lte && event.effectiveDate > where.effectiveDate.lte) return false;
    if (where.effectiveDate?.gt && event.effectiveDate <= where.effectiveDate.gt) return false;
    return true;
  });
  const client = {
    departmentMaster: { findUnique: async ({ where }) => { const values = new Map([['security a', 'Security A'], ['security b', 'Security B'], ['security c', 'Security C']]); const name = values.get(where.normalizedName); return name ? { name, isActive: true } : null; } },
    positionMaster: { findUnique: async ({ where }) => { const values = new Map([['officer', 'Officer'], ['senior officer', 'Senior Officer'], ['supervisor', 'Supervisor']]); const name = values.get(where.normalizedName); return name ? { name, isActive: true } : null; } },
    employee: {
      findFirst: async ({ where, include }) => { const row = store.employees.find((employee) => employee.id === where.id && employee.deletedAt === null) || null; return include?.user ? employeeWithUser(row) : row; },
      findUnique: async ({ where, include }) => { const row = store.employees.find((employee) => employee.id === where.id) || null; return include?.user ? employeeWithUser(row) : row; },
      findUniqueOrThrow: async ({ where, include }) => { const row = store.employees.find((employee) => employee.id === where.id); if (!row) throw new Error('missing employee'); return include?.user ? employeeWithUser(row) : row; },
      findMany: async ({ where }) => store.employees.filter((employee) => !where?.id?.in || where.id.in.includes(employee.id)).map((employee) => ({ ...employee })),
      update: async ({ where, data }) => { const row = store.employees.find((employee) => employee.id === where.id); Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1000) }); return { ...row }; }
    },
    user: {
      findUnique: async ({ where }) => store.users.find((user) => where.id ? user.id === where.id : user.employeeId === where.employeeId) || null,
      update: async ({ where, data }) => { const row = store.users.find((user) => user.id === where.id); for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value; return { ...row }; }
    },
    employeeLifecycleEvent: {
      findFirst: async ({ where, orderBy }) => sortEvents(eventFilter(where), orderBy)[0] || null,
      findUnique: async ({ where, include }) => { const row = store.events.find((event) => where.id ? event.id === where.id : event.idempotencyKey === where.idempotencyKey) || null; return row && include?.changedBy ? { ...row, changedBy: { displayName: 'Admin UAT', role: 'ADMIN' } } : row; },
      create: async ({ data }) => { const row = { id: `44444444-4444-4444-8444-${String(++sequence).padStart(12, '0')}`, createdAt: new Date(now), updatedAt: new Date(now), ...data }; store.events.push(row); return { ...row }; },
      update: async ({ where, data }) => { const row = store.events.find((event) => event.id === where.id); Object.assign(row, data, { updatedAt: new Date(now) }); return { ...row }; },
      count: async ({ where }) => eventFilter(where).length,
      findMany: async ({ where, orderBy, distinct, select, skip = 0, take }) => { let rows = sortEvents(eventFilter(where), orderBy).map((row) => ({ ...row })); if (distinct?.includes('employeeId')) rows = rows.filter((row, index) => rows.findIndex((candidate) => candidate.employeeId === row.employeeId) === index); rows = rows.slice(skip, take ? skip + take : undefined); if (select?.id) return rows.map(({ id, type }) => ({ id, ...(select.type && { type }) })); return rows; }
    },
    shiftAssignment: { count: async ({ where }) => { if (inTransaction) transactionImpactQueries += 1; return store.shifts.filter((row) => row.employeeId === where.employeeId && row.workDate >= where.workDate.gte).length; } },
    leaveRequest: { count: async ({ where }) => { if (inTransaction) transactionImpactQueries += 1; return store.leaves.filter((row) => row.employeeId === where.employeeId && row.status === where.status && row.endDate >= where.endDate.gte).length; } },
    leaveQuota: { count: async ({ where }) => { if (inTransaction) transactionImpactQueries += 1; return store.quotas.filter((row) => row.employeeId === where.employeeId).length; } },
    employeeLicense: { count: async ({ where }) => { if (inTransaction) transactionImpactQueries += 1; return store.licenses.filter((row) => row.employeeId === where.employeeId && row.status === where.status && (!row.expiryDate || row.expiryDate >= where.OR[1].expiryDate.gte)).length; } },
    employeeLicenseDocument: { count: async ({ where }) => { if (inTransaction) transactionImpactQueries += 1; return store.documents.filter((row) => row.employeeId === where.employeeId).length; } },
    refreshSession: { updateMany: async ({ where, data }) => { let count = 0; store.sessions.forEach((row) => { if (row.userId === where.userId && row.revokedAt === null) { Object.assign(row, data); count += 1; } }); return { count }; } },
    $executeRaw: async () => 1,
    $transaction: async (work, options) => {
      if (Array.isArray(work)) return Promise.all(work);
      const snapshot = structuredClone(store);
      lastTransactionOptions = options;
      inTransaction = true;
      try { return await work(client); }
      catch (error) { Object.keys(store).forEach((key) => { store[key].splice(0, store[key].length, ...snapshot[key]); }); throw error; }
      finally { inTransaction = false; }
    }
  };
  const auditService = { log: async ({ actorUserId, action, entityType, entityId, metadata }) => { if (failAudit) throw new Error('forced audit failure'); store.audits.push({ actorUserId, action, entityType, entityId, metadata }); } };
  const service = createEmployeeLifecycleService({ prismaClient: client, auditService, clock: () => new Date(now) });
  const setNow = (value) => { now = new Date(value); };
  const setFailAudit = (value) => { failAudit = value; };
  const metrics = () => ({ transactionImpactQueries, lastTransactionOptions });
  return { service, store, setNow, setFailAudit, metrics };
}

async function execute(harness, type, changes, idempotencyKey, effectiveDate = '2026-08-13') {
  const preflight = await harness.service.preflight({ employeeId: EMPLOYEE_ID, type, effectiveDate, changes });
  return harness.service.createEvent({ employeeId: EMPLOYEE_ID, actorUserId: ACTOR_ID, type, effectiveDate, reason: `เหตุผลสำหรับ ${type}`, changes, expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt, expectedLifecycleSequence: preflight.latestLifecycleSequence, idempotencyKey, acknowledgeWarnings: true });
}

test('lifecycle preflight reports bounded dependency impacts without changing data', async () => {
  const harness = createHarness();
  const result = await harness.service.preflight({ employeeId: EMPLOYEE_ID, type: 'EMPLOYMENT_TERMINATION', effectiveDate: '2026-09-01', changes: {} });
  assert.equal(result.impacts.futureShiftAssignments, 1);
  assert.equal(result.impacts.pendingLeaveRequests, 1);
  assert.equal(result.impacts.approvedFutureLeaveRequests, 1);
  assert.equal(result.impacts.leaveQuotaRecords, 1);
  assert.equal(result.impacts.activeLicenses, 1);
  assert.equal(result.impacts.licenseDocuments, 1);
  assert.equal(result.warnings.some((issue) => issue.code === 'FUTURE_EFFECTIVE_DATE'), true);
  assert.equal(harness.store.events.length, 0);
});

test('all five lifecycle actions preserve employee identity and linked records', async () => {
  const harness = createHarness();
  await execute(harness, 'NAME_CHANGE', { firstName: 'สมชาย', lastName: 'ใจงาม' }, '50000000-0000-4000-8000-000000000001');
  assert.equal(harness.store.employees[0].displayName, 'สมชาย ใจงาม');
  assert.equal(harness.store.users[0].displayName, 'สมชาย ใจงาม');
  await execute(harness, 'DEPARTMENT_TRANSFER', { department: 'Security B' }, '50000000-0000-4000-8000-000000000002');
  assert.equal(harness.store.employees[0].department, 'Security B');
  assert.equal(harness.store.users[0].department, 'Security B');
  await execute(harness, 'POSITION_CHANGE', { jobTitle: 'Senior Officer' }, '50000000-0000-4000-8000-000000000003');
  assert.equal(harness.store.employees[0].jobTitle, 'Senior Officer');
  assert.equal(harness.store.users[0].role, 'VIEWER');
  await execute(harness, 'EMPLOYMENT_TERMINATION', {}, '50000000-0000-4000-8000-000000000004');
  assert.equal(harness.store.employees[0].isActive, false);
  assert.equal(harness.store.users[0].accountStatus, 'SUSPENDED');
  assert.ok(harness.store.users[0].employmentSuspendedAt);
  await execute(harness, 'REHIRE', { department: 'Security C', jobTitle: 'Supervisor' }, '50000000-0000-4000-8000-000000000005');
  assert.equal(harness.store.employees[0].id, EMPLOYEE_ID);
  assert.equal(harness.store.employees.length, 1);
  assert.equal(harness.store.employees[0].isActive, true);
  assert.equal(harness.store.users[0].accountStatus, 'ACTIVE');
  assert.equal(harness.store.events.length, 5);
  assert.equal(harness.store.shifts[0].employeeId, EMPLOYEE_ID);
  assert.equal(harness.store.leaves.every((row) => row.employeeId === EMPLOYEE_ID), true);
  assert.equal(harness.store.quotas[0].employeeId, EMPLOYEE_ID);
  assert.equal(harness.store.licenses[0].employeeId, EMPLOYEE_ID);
  assert.equal(harness.store.documents[0].employeeId, EMPLOYEE_ID);
});

test('historical state reconstructs name, department, position, and employment status', async () => {
  const harness = createHarness();
  await execute(harness, 'DEPARTMENT_TRANSFER', { department: 'Security B' }, '50000000-0000-4000-8000-000000000011');
  await execute(harness, 'NAME_CHANGE', { firstName: 'สมชาย', lastName: 'ใจงาม' }, '50000000-0000-4000-8000-000000000012');
  assert.deepEqual(harness.store.events.map((event) => [event.sequence, event.newValue.employee.displayName]), [[1, 'สมชาย ใจดี'], [2, 'สมชาย ใจงาม']]);
  const before = await harness.service.stateAt(EMPLOYEE_ID, '2026-08-12');
  const after = await harness.service.stateAt(EMPLOYEE_ID, '2026-08-13');
  assert.equal(before.department, 'Security A');
  assert.equal(before.displayName, 'สมชาย ใจดี');
  assert.equal(after.department, 'Security B');
  assert.equal(after.displayName, 'สมชาย ใจงาม');
  assert.equal(after.employmentStatus, 'ACTIVE');
});

test('future event remains pending and applies atomically when due', async () => {
  const harness = createHarness();
  await execute(harness, 'DEPARTMENT_TRANSFER', { department: 'Security B' }, '50000000-0000-4000-8000-000000000021', '2026-09-01');
  assert.equal(harness.store.events[0].status, 'PENDING');
  assert.equal(harness.store.employees[0].department, 'Security A');
  harness.setNow('2026-09-01T01:00:00.000Z');
  const result = await harness.service.synchronizeDueEvents();
  assert.deepEqual(result, { scanned: 1, applied: 1, failed: 0 });
  assert.equal(harness.store.events[0].status, 'APPLIED');
  assert.equal(harness.store.employees[0].department, 'Security B');
});

test('future termination and rehire preserve projected User state in order', async () => {
  const harness = createHarness();
  await execute(harness, 'EMPLOYMENT_TERMINATION', {}, '50000000-0000-4000-8000-000000000022', '2026-09-01');
  await execute(harness, 'REHIRE', { department: 'Security B', jobTitle: 'Senior Officer' }, '50000000-0000-4000-8000-000000000023', '2026-10-01');
  assert.equal(harness.store.events[1].oldValue.user.accountStatus, 'SUSPENDED');
  assert.equal(harness.store.events[1].newValue.user.accountStatus, 'ACTIVE');
  harness.setNow('2026-10-01T01:00:00.000Z');
  const result = await harness.service.synchronizeDueEvents();
  assert.deepEqual(result, { scanned: 2, applied: 2, failed: 0 });
  assert.equal(harness.store.employees[0].isActive, true);
  assert.equal(harness.store.employees[0].department, 'Security B');
  assert.equal(harness.store.users[0].accountStatus, 'ACTIVE');
  assert.equal(harness.store.users[0].employmentSuspendedAt, null);
});

test('targeted due termination synchronization fails closed on an atomic apply error', async () => {
  const harness = createHarness();
  await execute(harness, 'EMPLOYMENT_TERMINATION', {}, '50000000-0000-4000-8000-000000000024', '2026-09-01');
  harness.setNow('2026-09-01T01:00:00.000Z');
  harness.setFailAudit(true);
  await assert.rejects(
    () => harness.service.synchronizeDueEvents({ employeeId: EMPLOYEE_ID, failClosedOnTermination: true }),
    (error) => error.statusCode === 503 && error.details.code === 'EMPLOYMENT_STATUS_SYNC_FAILED'
  );
  assert.equal(harness.store.employees[0].isActive, true);
  assert.equal(harness.store.users[0].accountStatus, 'ACTIVE');
  assert.equal(harness.store.events[0].status, 'PENDING');
});

test('idempotency and optimistic concurrency reject duplicate or stale submissions safely', async () => {
  const harness = createHarness();
  const key = '50000000-0000-4000-8000-000000000031';
  const first = await execute(harness, 'POSITION_CHANGE', { jobTitle: 'Senior Officer' }, key);
  const duplicate = await harness.service.createEvent({ employeeId: EMPLOYEE_ID, actorUserId: ACTOR_ID, type: 'POSITION_CHANGE', effectiveDate: '2026-08-13', reason: 'เหตุผลเดิม', changes: { jobTitle: 'Senior Officer' }, expectedEmployeeUpdatedAt: '2026-08-13T00:00:00.000Z', expectedLifecycleSequence: 0, idempotencyKey: key, acknowledgeWarnings: true });
  assert.equal(first.idempotent, false);
  assert.equal(duplicate.idempotent, true);
  assert.equal(harness.store.events.length, 1);
  await assert.rejects(() => harness.service.createEvent({ employeeId: EMPLOYEE_ID, actorUserId: ACTOR_ID, type: 'NAME_CHANGE', effectiveDate: '2026-08-13', reason: 'เหตุผลที่ถูกต้อง', changes: { firstName: 'ใหม่', lastName: 'ชื่อ' }, expectedEmployeeUpdatedAt: '2025-01-01T00:00:00.000Z', expectedLifecycleSequence: 0, idempotencyKey: '50000000-0000-4000-8000-000000000032', acknowledgeWarnings: true }), (error) => error.statusCode === 409 && error.details.code === 'EMPLOYEE_STATE_CONFLICT');
});

test('transaction rollback prevents partial Employee and lifecycle writes', async () => {
  const harness = createHarness();
  const preflight = await harness.service.preflight({ employeeId: EMPLOYEE_ID, type: 'NAME_CHANGE', effectiveDate: '2026-08-13', changes: { firstName: 'ใหม่', lastName: 'ชื่อ' } });
  harness.setFailAudit(true);
  await assert.rejects(() => harness.service.createEvent({ employeeId: EMPLOYEE_ID, actorUserId: ACTOR_ID, type: 'NAME_CHANGE', effectiveDate: '2026-08-13', reason: 'ทดสอบ rollback', changes: { firstName: 'ใหม่', lastName: 'ชื่อ' }, expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt, expectedLifecycleSequence: preflight.latestLifecycleSequence, idempotencyKey: '50000000-0000-4000-8000-000000000041', acknowledgeWarnings: true }));
  assert.equal(harness.store.employees[0].displayName, 'สมชาย ใจดี');
  assert.equal(harness.store.events.length, 0);
  assert.equal(harness.store.audits.length, 0);
});

test('NAME_CHANGE keeps impact analysis outside the interactive transaction and commits Employee, User, event, and audit atomically', async () => {
  const harness = createHarness();
  const result = await execute(harness, 'NAME_CHANGE', { firstName: 'สมชาย', lastName: 'ใจงาม' }, '50000000-0000-4000-8000-000000000051');
  assert.equal(result.event.type, 'NAME_CHANGE');
  assert.equal(harness.store.employees[0].displayName, 'สมชาย ใจงาม');
  assert.equal(harness.store.users[0].displayName, 'สมชาย ใจงาม');
  assert.equal(harness.store.events.length, 1);
  assert.equal(harness.store.audits.length, 2);
  assert.equal(harness.metrics().transactionImpactQueries, 0);
  assert.deepEqual(harness.metrics().lastTransactionOptions, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
});

test('audit failure rolls back Employee, linked User, lifecycle event, and audit writes together', async () => {
  const harness = createHarness();
  const preflight = await harness.service.preflight({ employeeId: EMPLOYEE_ID, type: 'NAME_CHANGE', effectiveDate: '2026-08-13', changes: { firstName: 'ใหม่', lastName: 'ชื่อ' } });
  harness.setFailAudit(true);
  await assert.rejects(() => harness.service.createEvent({ employeeId: EMPLOYEE_ID, actorUserId: ACTOR_ID, type: 'NAME_CHANGE', effectiveDate: '2026-08-13', reason: 'ทดสอบ atomic rollback', changes: { firstName: 'ใหม่', lastName: 'ชื่อ' }, expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt, expectedLifecycleSequence: preflight.latestLifecycleSequence, idempotencyKey: '50000000-0000-4000-8000-000000000052', acknowledgeWarnings: true }));
  assert.equal(harness.store.employees[0].displayName, 'สมชาย ใจดี');
  assert.equal(harness.store.users[0].displayName, 'สมชาย ใจดี');
  assert.equal(harness.store.events.length, 0);
  assert.equal(harness.store.audits.length, 0);
});

test('stale lifecycle sequence is rejected even when Employee updatedAt has not changed', async () => {
  const harness = createHarness();
  const stale = await harness.service.preflight({ employeeId: EMPLOYEE_ID, type: 'NAME_CHANGE', effectiveDate: '2026-10-01', changes: { firstName: 'สมชาย', lastName: 'ใจงาม' } });
  await execute(harness, 'POSITION_CHANGE', { jobTitle: 'Senior Officer' }, '50000000-0000-4000-8000-000000000053', '2026-09-01');
  await assert.rejects(() => harness.service.createEvent({ employeeId: EMPLOYEE_ID, actorUserId: ACTOR_ID, type: 'NAME_CHANGE', effectiveDate: '2026-10-01', reason: 'ทดสอบ stale lifecycle', changes: { firstName: 'สมชาย', lastName: 'ใจงาม' }, expectedEmployeeUpdatedAt: stale.expectedEmployeeUpdatedAt, expectedLifecycleSequence: stale.latestLifecycleSequence, idempotencyKey: '50000000-0000-4000-8000-000000000054', acknowledgeWarnings: true }), (error) => error.statusCode === 409 && error.details.code === 'LIFECYCLE_STATE_CONFLICT');
  assert.equal(harness.store.events.length, 1);
  assert.equal(harness.store.events[0].type, 'POSITION_CHANGE');
});

test('NAME_CHANGE without a linked User follows existing warning policy and still updates Employee safely', async () => {
  const harness = createHarness();
  harness.store.users.splice(0);
  const preflight = await harness.service.preflight({ employeeId: EMPLOYEE_ID, type: 'NAME_CHANGE', effectiveDate: '2026-08-13', changes: { firstName: 'สมชาย', lastName: 'ใจงาม' } });
  assert.equal(preflight.warnings.some((issue) => issue.code === 'LINKED_USER_MISSING'), true);
  await harness.service.createEvent({ employeeId: EMPLOYEE_ID, actorUserId: ACTOR_ID, type: 'NAME_CHANGE', effectiveDate: '2026-08-13', reason: 'ไม่มีบัญชีเชื่อมโยง', changes: { firstName: 'สมชาย', lastName: 'ใจงาม' }, expectedEmployeeUpdatedAt: preflight.expectedEmployeeUpdatedAt, expectedLifecycleSequence: preflight.latestLifecycleSequence, idempotencyKey: '50000000-0000-4000-8000-000000000055', acknowledgeWarnings: true });
  assert.equal(harness.store.employees[0].displayName, 'สมชาย ใจงาม');
  assert.equal(harness.store.users.length, 0);
  assert.equal(harness.store.events.length, 1);
});

test('route contract keeps mutations ADMIN-only and lifecycle history read-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/employees.routes.js'), 'utf8');
  assert.match(source, /post\('\/:id\/lifecycle\/preflight', authorize\('ADMIN'\)/);
  assert.match(source, /post\('\/:id\/lifecycle', authorize\('ADMIN'\)/);
  assert.match(source, /get\('\/:id\/lifecycle', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(source, /expectedLifecycleSequence: z\.number\(\)\.int\(\)\.min\(0\)/);
  assert.match(source, /EMPLOYEE_CHANGE_REQUEST_REQUIRED/);
  assert.match(source, /post\('\/:id\/master-edit\/preflight', authorize\('ADMIN'\)/);
  assert.match(source, /LIFECYCLE_TERMINATION_REQUIRED/);
  assert.doesNotMatch(source, /router\.(?:put|delete)\('\/:id\/lifecycle/);
});
