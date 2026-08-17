process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureAnnualQuotaInTransaction,
  LEAVE_QUOTA_LEGACY_AMBIGUOUS
} = require('../src/services/annual-leave-quota.service');

function fixture({ employee = { id: 'e1', firstName: 'A', lastName: 'B', displayName: 'A B' }, annual, legacy = [], inserted = 1 } = {}) {
  const state = { audits: [], creates: [] };
  const tx = {
    employee: { findFirst: async () => employee },
    leaveQuota: {
      findUnique: async () => annual || (state.creates[0] ?? null),
      findMany: async () => legacy,
      createMany: async ({ data }) => { if (inserted) state.creates.push(data[0]); return { count: inserted }; }
    },
    auditLog: { create: async ({ data }) => { state.audits.push(data); return data; } }
  };
  const auditService = { log: async (input, client) => client.auditLog.create({ data: input }) };
  return { tx, state, auditService };
}

test('ensure creates 30/3/6 and audit atomically for a missing annual row', async () => {
  const f = fixture();
  const result = await ensureAnnualQuotaInTransaction(f.tx, { employeeId: 'e1', quotaYear: 2027, source: 'ON_DEMAND', auditService: f.auditService });
  assert.equal(result.created, true);
  assert.deepEqual({ sickLeave: f.state.creates[0].sickLeave, personalLeave: f.state.creates[0].personalLeave, vacationLeave: f.state.creates[0].vacationLeave, quotaYear: f.state.creates[0].quotaYear }, { sickLeave: 30, personalLeave: 3, vacationLeave: 6, quotaYear: 2027 });
  assert.equal(f.state.audits.length, 1);
  assert.equal(f.state.audits[0].metadata.event, 'AUTO_ANNUAL_QUOTA_PROVISIONED');
  assert.equal(f.state.audits[0].metadata.source, 'ON_DEMAND');
});

test('ensure preserves existing customized annual quota without a write', async () => {
  const custom = { id: 'q', employeeId: 'e1', quotaYear: 2027, sickLeave: 30, personalLeave: 3, vacationLeave: 10 };
  const f = fixture({ annual: custom });
  const result = await ensureAnnualQuotaInTransaction(f.tx, { employeeId: 'e1', quotaYear: 2027, auditService: f.auditService });
  assert.equal(result.created, false);
  assert.equal(result.quota.vacationLeave, 10);
  assert.equal(f.state.creates.length, 0);
  assert.equal(f.state.audits.length, 0);
});

test('ensure fails closed for inactive/deleted/unavailable employee', async () => {
  const f = fixture({ employee: null });
  await assert.rejects(() => ensureAnnualQuotaInTransaction(f.tx, { employeeId: 'e1', quotaYear: 2027, auditService: f.auditService }), (error) => error.statusCode === 404);
});

test('ensure fails closed beside an unclassified linked legacy quota', async () => {
  const f = fixture({ legacy: [{ id: 'legacy', matchStatus: 'MATCHED' }] });
  await assert.rejects(() => ensureAnnualQuotaInTransaction(f.tx, { employeeId: 'e1', quotaYear: 2027, auditService: f.auditService }), (error) => error.statusCode === 409 && error.details?.code === LEAVE_QUOTA_LEGACY_AMBIGUOUS);
  assert.equal(f.state.creates.length, 0);
});

test('createMany race loser re-reads winner and does not emit duplicate audit', async () => {
  const winner = { id: 'winner', employeeId: 'e1', quotaYear: 2027, sickLeave: 30, personalLeave: 3, vacationLeave: 9 };
  let uniqueReads = 0;
  const f = fixture({ inserted: 0 });
  f.tx.leaveQuota.findUnique = async () => { uniqueReads += 1; return uniqueReads === 1 ? null : winner; };
  const result = await ensureAnnualQuotaInTransaction(f.tx, { employeeId: 'e1', quotaYear: 2027, auditService: f.auditService });
  assert.equal(result.created, false);
  assert.equal(result.raceRecovered, true);
  assert.equal(result.quota.vacationLeave, 9);
  assert.equal(f.state.audits.length, 0);
});
