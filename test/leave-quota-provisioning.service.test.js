process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  provisionLeaveQuota,
  defaultFingerprint,
  LEAVE_QUOTA_ALREADY_EXISTS,
  LEAVE_QUOTA_STATE_CONFLICT
} = require('../src/services/leave-quota-provisioning.service');

function fakePrisma({ employee, existing = [], transactionError, auditFails = false } = {}) {
  const state = { quotas: [], audits: [] };
  const calls = { isolationLevel: null, createData: null };
  const auditService = {
    log: async (input, tx) => {
      if (auditFails) throw new Error('AUDIT_FAILURE');
      return tx.auditLog.create({ data: input });
    }
  };
  const client = {
    auditService,
    $transaction: async (callback, options) => {
      calls.isolationLevel = options?.isolationLevel;
      if (transactionError) throw transactionError;
      const draft = { quotas: [...state.quotas], audits: [...state.audits] };
      const tx = {
        employee: { findFirst: async () => employee || null },
        leaveQuota: {
          findMany: async () => existing,
          create: async ({ data }) => {
            calls.createData = data;
            const row = { id: 'quota-created', ...data, createdAt: new Date('2026-08-16T00:00:00.000Z'), updatedAt: new Date('2026-08-16T00:00:00.000Z') };
            draft.quotas.push(row);
            return row;
          }
        },
        auditLog: { create: async ({ data }) => { draft.audits.push(data); return data; } }
      };
      const result = await callback(tx);
      state.quotas = draft.quotas;
      state.audits = draft.audits;
      return result;
    }
  };
  return { client, state, calls };
}

const employee = { id: 'employee-1', firstName: 'Server', lastName: 'Snapshot', displayName: 'Server Snapshot' };
const input = { employeeId: employee.id, sickLeave: 30, personalLeave: 6, vacationLeave: 10 };

function invoke(fixture, overrides = {}) {
  return provisionLeaveQuota({
    actor: { sub: 'admin-1', role: 'ADMIN' },
    ...input,
    prismaClient: fixture.client,
    auditService: fixture.client.auditService,
    fingerprintFactory: () => 'f'.repeat(64),
    ...overrides
  });
}

test('ADMIN provisioning is serializable, server-derived, matched, fingerprinted, and audited', async () => {
  const fixture = fakePrisma({ employee });
  const result = await invoke(fixture);
  assert.equal(fixture.calls.isolationLevel, 'Serializable');
  assert.equal(result.employeeNameSnapshot, 'Server Snapshot');
  assert.equal(result.matchStatus, 'MATCHED');
  assert.equal(fixture.calls.createData.sourceFingerprint, 'f'.repeat(64));
  assert.equal(fixture.calls.createData.employeeNameSnapshot, 'Server Snapshot');
  assert.equal(fixture.state.quotas.length, 1);
  assert.equal(fixture.state.audits.length, 1);
  assert.deepEqual(fixture.state.audits[0], {
    actorUserId: 'admin-1', action: 'CREATE', entityType: 'LeaveQuota', entityId: 'quota-created',
    metadata: { employeeId: 'employee-1', matchStatus: 'MATCHED', after: { sickLeave: 30, personalLeave: 6, vacationLeave: 10 } }
  });
});

test('service denies MANAGER and VIEWER even if called outside the route', async () => {
  for (const role of ['MANAGER', 'VIEWER']) {
    const fixture = fakePrisma({ employee });
    await assert.rejects(() => invoke(fixture, { actor: { sub: `${role}-1`, role } }), (error) => error.statusCode === 403);
    assert.equal(fixture.state.quotas.length, 0);
  }
});

test('unknown, inactive, or deleted employee state fails closed before quota creation', async () => {
  for (const label of ['unknown', 'inactive', 'deleted']) {
    const fixture = fakePrisma({ employee: null });
    await assert.rejects(() => invoke(fixture), (error) => error.statusCode === 404, label);
    assert.equal(fixture.state.quotas.length, 0);
  }
});

test('one or multiple linked quotas both fail with LEAVE_QUOTA_ALREADY_EXISTS', async () => {
  for (const existing of [[{ id: 'q1' }], [{ id: 'q1' }, { id: 'q2' }]]) {
    const fixture = fakePrisma({ employee, existing });
    await assert.rejects(() => invoke(fixture), (error) => error.statusCode === 409 && error.details?.code === LEAVE_QUOTA_ALREADY_EXISTS);
    assert.equal(fixture.state.quotas.length, 0);
  }
});

test('audit failure prevents the transaction from committing the quota', async () => {
  const fixture = fakePrisma({ employee, auditFails: true });
  await assert.rejects(() => invoke(fixture), /AUDIT_FAILURE/);
  assert.equal(fixture.state.quotas.length, 0);
  assert.equal(fixture.state.audits.length, 0);
});

test('P2034 is mapped to a safe state conflict without retry', async () => {
  const error = Object.assign(new Error('serialization'), { code: 'P2034' });
  const fixture = fakePrisma({ employee, transactionError: error });
  await assert.rejects(() => invoke(fixture), (reason) => reason.statusCode === 409 && reason.details?.code === LEAVE_QUOTA_STATE_CONFLICT);
});

test('default fingerprint is unique-looking, fixed length, and not based on employee data', () => {
  const first = defaultFingerprint();
  const second = defaultFingerprint();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(second, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(first.includes('employee'), false);
});
