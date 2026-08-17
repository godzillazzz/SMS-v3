process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistrationRequestService, ACTIONABLE_STATUSES } = require('../src/services/registration-request.service');

function fakePrisma() {
  const calls = [];
  const registrationRequest = {
    count: async ({ where }) => { calls.push(['count', where]); return 0; },
    findMany: async ({ where }) => { calls.push(['findMany', where]); return []; }
  };
  return {
    registrationRequest,
    $transaction: async (operations) => Promise.all(operations),
    calls
  };
}

test('default RegistrationRequest review queue contains only verified actionable PENDING/MATCHED records', async () => {
  const prisma = fakePrisma();
  const service = createRegistrationRequestService({ prismaClient: prisma, auditService: { log: async () => undefined } });
  await service.list({ page: 1, pageSize: 25 });
  assert.equal(prisma.calls.length, 2);
  for (const [, where] of prisma.calls) {
    assert.deepEqual(where.emailVerifiedAt, { not: null });
    assert.deepEqual(where.status, { in: ACTIONABLE_STATUSES });
    assert.deepEqual(where.status.in, ['PENDING', 'MATCHED']);
  }
});

test('authorized explicit terminal status filter may retrieve historical REJECTED records without changing default queue', async () => {
  const prisma = fakePrisma();
  const service = createRegistrationRequestService({ prismaClient: prisma, auditService: { log: async () => undefined } });
  await service.list({ page: 1, pageSize: 25, status: 'REJECTED' });
  for (const [, where] of prisma.calls) {
    assert.deepEqual(where.emailVerifiedAt, { not: null });
    assert.equal(where.status, 'REJECTED');
  }
});
