const test = require('node:test');
const assert = require('node:assert/strict');
const HttpError = require('../src/utils/http-error');
const { createUserAccessService } = require('../src/services/user-access.service');

function fakePrisma(before) {
  let updated;
  const tx = {
    $executeRaw: async () => 1,
    user: {
      findUniqueOrThrow: async () => ({ ...before }),
      count: async () => 2,
      update: async ({ data }) => {
        updated = { ...before, ...data, tokenVersion: (before.tokenVersion || 0) + 1 };
        return updated;
      }
    },
    refreshSession: { updateMany: async () => ({ count: 0 }) }
  };
  return {
    client: { $transaction: async (fn) => fn(tx) },
    tx,
    updated: () => updated
  };
}

test('CFG-06 USER_ACCESS policy blocks Manager pending-account approval before mutation', async () => {
  const db = fakePrisma({
    id: 'user-1', role: 'VIEWER', accountStatus: 'PENDING', isActive: true, passwordResetRequired: false, tokenVersion: 1
  });
  const service = createUserAccessService({
    prismaClient: db.client,
    auditService: { log: async () => {} },
    approvalPolicyService: {
      assertReviewer: async () => { throw new HttpError(403, 'blocked', { code: 'APPROVAL_POLICY_REVIEWER_NOT_AUTHORIZED' }); }
    }
  });
  await assert.rejects(
    () => service.updateUserAccount({
      id: 'user-1',
      input: { accountStatus: 'ACTIVE' },
      actorUserId: 'manager-1',
      actorRole: 'MANAGER'
    }),
    (error) => error.statusCode === 403 && error.details?.code === 'APPROVAL_POLICY_REVIEWER_NOT_AUTHORIZED'
  );
  assert.equal(db.updated(), undefined);
});

test('CFG-06 USER_ACCESS policy permits Manager only within legacy pending-to-Viewer safety envelope', async () => {
  const db = fakePrisma({
    id: 'user-1', role: 'VIEWER', accountStatus: 'PENDING', isActive: true, passwordResetRequired: false, tokenVersion: 1
  });
  const calls = [];
  const service = createUserAccessService({
    prismaClient: db.client,
    auditService: { log: async (event) => calls.push(event) },
    approvalPolicyService: {
      assertReviewer: async (type, actor) => {
        assert.equal(type, 'USER_ACCESS');
        assert.equal(actor.role, 'MANAGER');
        return { reviewerRoles: ['ADMIN', 'MANAGER'] };
      }
    }
  });
  const result = await service.updateUserAccount({
    id: 'user-1',
    input: {},
    actorUserId: 'manager-1',
    actorRole: 'MANAGER'
  });
  assert.equal(result.role, 'VIEWER');
  assert.equal(result.accountStatus, 'ACTIVE');
  assert.equal(result.isActive, true);
  assert.equal(result.approvedByLegacyRef, 'manager-1');
  assert.ok(result.approvedAt instanceof Date);
  assert.equal(calls.length, 1);
});

test('CFG-06 does not let Manager use USER_ACCESS policy to assign elevated roles', async () => {
  const db = fakePrisma({
    id: 'user-1', role: 'VIEWER', accountStatus: 'PENDING', isActive: true, passwordResetRequired: false, tokenVersion: 1
  });
  const service = createUserAccessService({
    prismaClient: db.client,
    auditService: { log: async () => {} },
    approvalPolicyService: { assertReviewer: async () => ({ reviewerRoles: ['ADMIN', 'MANAGER'] }) }
  });
  await assert.rejects(
    () => service.updateUserAccount({
      id: 'user-1',
      input: { role: 'ADMIN' },
      actorUserId: 'manager-1',
      actorRole: 'MANAGER'
    }),
    (error) => error.statusCode === 403 && /Viewer role only/.test(error.message)
  );
  assert.equal(db.updated(), undefined);
});

test('ADMIN role/status changes transactionally revoke only that user passkeys and audit each revocation', async () => {
  const targetId = 'target-user';
  const otherId = 'other-user';
  const credentials = [
    { id: 'passkey-one', userId: targetId, revokedAt: null },
    { id: 'passkey-two', userId: targetId, revokedAt: null },
    { id: 'other-passkey', userId: otherId, revokedAt: null }
  ];
  const auditEvents = [];
  let transactionCommitted = false;
  const tx = {
    $executeRaw: async () => 1,
    user: {
      findUniqueOrThrow: async () => ({ id: targetId, role: 'VIEWER', department: null, accountStatus: 'ACTIVE', isActive: true, passwordResetRequired: false }),
      count: async () => 2,
      update: async ({ data }) => ({ id: targetId, role: data.role || 'VIEWER', accountStatus: 'ACTIVE', isActive: true })
    },
    refreshSession: { updateMany: async () => ({ count: 0 }) },
    webAuthnCredential: {
      findMany: async ({ where }) => credentials.filter((row) => row.userId === where.userId && row.revokedAt === null).map(({ id }) => ({ id })),
      updateMany: async ({ where, data }) => {
        const matching = credentials.filter((row) => row.id === where.id && row.userId === where.userId && row.revokedAt === null);
        matching.forEach((row) => { row.revokedAt = data.revokedAt; });
        return { count: matching.length };
      }
    }
  };
  const prismaClient = { $transaction: async (callback) => { const result = await callback(tx); transactionCommitted = true; return result; } };
  const service = createUserAccessService({ prismaClient, auditService: { log: async (event, client) => { assert.equal(client, tx); auditEvents.push(event); } } });

  await service.updateUserAccount({ id: targetId, input: { role: 'MANAGER' }, actorUserId: 'admin-1', actorRole: 'ADMIN' });

  assert.equal(transactionCommitted, true);
  assert.ok(credentials[0].revokedAt instanceof Date);
  assert.ok(credentials[1].revokedAt instanceof Date);
  assert.equal(credentials[2].revokedAt, null);
  assert.deepEqual(auditEvents.filter((event) => event.action === 'PASSKEY_REVOKED').map((event) => [event.actorUserId, event.entityId, event.metadata.reason]), [
    ['admin-1', 'passkey-one', 'admin_revoked'],
    ['admin-1', 'passkey-two', 'admin_revoked']
  ]);
});

test('non-ADMIN account status changes do not revoke passkeys', async () => {
  let credentialQueryCount = 0;
  const tx = {
    $executeRaw: async () => 1,
    user: {
      findUniqueOrThrow: async () => ({ id: 'user-1', role: 'VIEWER', department: null, accountStatus: 'PENDING', isActive: false, passwordResetRequired: false }),
      count: async () => 2,
      update: async ({ data }) => ({ id: 'user-1', role: data.role, accountStatus: data.accountStatus, isActive: data.isActive })
    },
    refreshSession: { updateMany: async () => ({ count: 0 }) },
    webAuthnCredential: { findMany: async () => { credentialQueryCount += 1; return []; }, updateMany: async () => ({ count: 0 }) }
  };
  const service = createUserAccessService({
    prismaClient: { $transaction: async (callback) => callback(tx) },
    auditService: { log: async () => {} },
    approvalPolicyService: { assertReviewer: async () => ({ reviewerRoles: ['MANAGER'] }) }
  });

  await service.updateUserAccount({ id: 'user-1', input: {}, actorUserId: 'manager-1', actorRole: 'MANAGER' });

  assert.equal(credentialQueryCount, 0);
});
