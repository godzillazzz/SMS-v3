process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { provisionLeaveQuota, LEAVE_QUOTA_ALREADY_EXISTS, LEAVE_QUOTA_STATE_CONFLICT } = require('../src/services/leave-quota-provisioning.service');

function fakePrisma({ employee, annual = null, legacy = [], transactionError, auditFails = false, activationValue = 'true', activationExists = true } = {}) {
  const state = { quotas: [], audits: [] };
  const calls = { isolationLevel: null, createData: null };
  const auditService = { log: async (input) => { if (auditFails) throw new Error('AUDIT_FAILURE'); state.audits.push(input); return input; } };
  const client = {
    $transaction: async (callback, options) => {
      calls.isolationLevel = options?.isolationLevel;
      if (transactionError) throw transactionError;
      const tx = {
        employee: { findFirst: async () => employee || null },
        systemSetting: { findUnique: async () => activationExists ? { value: activationValue } : null },
        leaveQuota: {
          findUnique: async () => annual,
          findMany: async () => legacy,
          create: async ({ data }) => { calls.createData = data; const row = { id: 'quota-created', ...data, createdAt: new Date(), updatedAt: new Date() }; state.quotas.push(row); return row; }
        }
      };
      return callback(tx);
    }
  };
  return { client, state, calls, auditService };
}

const employee = { id: 'employee-1', firstName: 'Server', lastName: 'Snapshot', displayName: 'Server Snapshot' };
const input = { employeeId: employee.id, quotaYear: 2027, sickLeave: 30, personalLeave: 3, vacationLeave: 6 };

function invoke(f, overrides = {}) {
  return provisionLeaveQuota({ actor: { sub: 'admin-1', role: 'ADMIN' }, ...input, prismaClient: f.client, auditService: f.auditService, fingerprintFactory: () => 'f'.repeat(64), ...overrides });
}

test('ADMIN annual provisioning is Serializable, year-aware, matched and audited', async () => {
  const f = fakePrisma({ employee });
  const result = await invoke(f);
  assert.equal(f.calls.isolationLevel, 'Serializable');
  assert.equal(result.quotaYear, 2027);
  assert.equal(result.employeeNameSnapshot, 'Server Snapshot');
  assert.deepEqual({ sick: Number(result.sickLeave), personal: Number(result.personalLeave), vacation: Number(result.vacationLeave) }, { sick: 30, personal: 3, vacation: 6 });
  assert.equal(f.state.audits[0].metadata.event, 'ADMIN_ANNUAL_QUOTA_CREATED');
  assert.equal(f.state.audits[0].metadata.quotaYear, 2027);
});

test('Admin non-base creation is blocked while inactive but base-year creation remains allowed', async () => {
  const blocked = fakePrisma({ employee, activationValue: 'false' });
  await assert.rejects(() => invoke(blocked), (e) => e.statusCode === 409 && e.details?.code === 'G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED');
  assert.equal(blocked.state.quotas.length, 0);
  const base = fakePrisma({ employee, activationExists: false });
  const created = await invoke(base, { quotaYear: 2026 });
  assert.equal(created.quotaYear, 2026);
});

test('MANAGER and VIEWER are denied by service', async () => {
  for (const role of ['MANAGER', 'VIEWER']) {
    const f = fakePrisma({ employee });
    await assert.rejects(() => invoke(f, { actor: { sub: role, role } }), (e) => e.statusCode === 403);
  }
});

test('unknown/inactive/deleted employee fails closed', async () => {
  const f = fakePrisma({ employee: null });
  await assert.rejects(() => invoke(f), (e) => e.statusCode === 404);
});

test('same employee/year conflicts while a different year is permitted by lookup identity', async () => {
  const f = fakePrisma({ employee, annual: { id: 'same-year' } });
  await assert.rejects(() => invoke(f), (e) => e.statusCode === 409 && e.details?.code === LEAVE_QUOTA_ALREADY_EXISTS && e.details?.quotaYear === 2027);
  const other = fakePrisma({ employee, annual: null });
  const created = await invoke(other, { quotaYear: 2028 });
  assert.equal(created.quotaYear, 2028);
});

test('linked null-year legacy authority blocks competing annual creation', async () => {
  const f = fakePrisma({ employee, legacy: [{ id: 'legacy' }] });
  await assert.rejects(() => invoke(f), (e) => e.statusCode === 409 && e.details?.code === 'LEAVE_QUOTA_LEGACY_AMBIGUOUS');
});

test('audit failure aborts provisioning path', async () => {
  const f = fakePrisma({ employee, auditFails: true });
  await assert.rejects(() => invoke(f), /AUDIT_FAILURE/);
});

test('P2034 maps to deterministic state conflict', async () => {
  const f = fakePrisma({ employee, transactionError: Object.assign(new Error('serialization'), { code: 'P2034' }) });
  await assert.rejects(() => invoke(f), (e) => e.statusCode === 409 && e.details?.code === LEAVE_QUOTA_STATE_CONFLICT);
});
