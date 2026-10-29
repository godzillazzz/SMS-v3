'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_LEAVE_POLICY, LEAVE_POLICY_KEYS } = require('../src/services/leave-policy.service');
const { saveLeavePolicyBatch } = require('../src/services/leave-policy-batch.service');

function fixture(failAt) {
  let rows = new Map(Object.values(LEAVE_POLICY_KEYS).map((key) => [key, { key, value: 'old' }]));
  let logs = [];
  let transactions = 0;
  const prisma = { $transaction: async (fn) => {
    transactions++;
    const pending = new Map(rows); const pendingLogs = [];
    const tx = { systemSetting: {
      findUnique: async ({ where }) => pending.get(where.key) || null,
      upsert: async ({ where, update, create }) => {
        if (where.key === failAt) throw new Error('write failure');
        const row = { ...(pending.has(where.key) ? { key: where.key, ...update } : create) };
        pending.set(where.key, row); return row;
      }
    }};
    const result = await fn(tx); rows = pending; logs = pendingLogs; return result;
  }};
  const audit = { log: async (event, tx) => { assert.ok(tx); if (failAt === 'audit' && event.entityId === LEAVE_POLICY_KEYS.viewerRetroactiveSelfEnabled) throw new Error('audit failure'); pendingLog(event); } };
  let pendingLog = () => {};
  // Capture audit records in the transaction context.
  const original = prisma.$transaction;
  prisma.$transaction = async (fn) => original(async (tx) => { const events = []; pendingLog = (event) => events.push(event); const result = await fn(tx); tx.events = events; return { result, events }; }).then((out) => { logs = out.events; return out.result; });
  return { prisma, audit, state: () => ({ rows: [...rows.values()], logs, transactions }) };
}

test('complete policy saves every key with per-setting transactional audit', async () => {
  const f = fixture();
  await saveLeavePolicyBatch({ prisma: f.prisma, audit: f.audit, actor: { sub: 'admin' }, policy: { ...DEFAULT_LEAVE_POLICY, viewerRetroactiveMaxDaysBack: 7 } });
  const state = f.state();
  assert.equal(state.transactions, 1); assert.equal(state.logs.length, 10);
  assert.equal(state.rows.find((r) => r.key === LEAVE_POLICY_KEYS.viewerRetroactiveMaxDaysBack).value, '7');
  assert.ok(state.logs.every((event) => event.actorUserId === 'admin' && event.entityType === 'SystemSetting'));
});

test('invalid, incomplete or unknown fields are rejected before any transaction', async () => {
  for (const policy of [{ ...DEFAULT_LEAVE_POLICY, viewerRetroactiveMaxDaysBack: -1 }, { ...DEFAULT_LEAVE_POLICY, viewerRetroactiveMaxDaysBack: '7' }, { ...DEFAULT_LEAVE_POLICY, extra: true }, (({ viewerRetroactiveMaxDaysBack, ...rest }) => rest)(DEFAULT_LEAVE_POLICY)]) {
    const f = fixture();
    await assert.rejects(saveLeavePolicyBatch({ prisma: f.prisma, audit: f.audit, actor: { sub: 'admin' }, policy }));
    assert.equal(f.state().transactions, 0);
  }
});

test('write or audit failure rolls back all settings and audit entries', async () => {
  for (const failure of [LEAVE_POLICY_KEYS.viewerRetroactiveMaxDaysBack, 'audit']) {
    const f = fixture(failure); const before = f.state().rows;
    await assert.rejects(saveLeavePolicyBatch({ prisma: f.prisma, audit: f.audit, actor: { sub: 'admin' }, policy: DEFAULT_LEAVE_POLICY }), /failure/);
    assert.deepEqual(f.state().rows, before); assert.deepEqual(f.state().logs, []);
  }
});
