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
