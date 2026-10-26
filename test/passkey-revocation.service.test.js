const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasskeyRevocationService } = require('../src/services/passkey-revocation.service');

const now = new Date('2026-10-26T00:00:00.000Z');

test('admin passkey revoke-all only revokes active credentials for the target and audits each in the transaction', async () => {
  const credentials = [
    { id: 'target-1', userId: 'target', revokedAt: null },
    { id: 'target-2', userId: 'target', revokedAt: null },
    { id: 'already-revoked', userId: 'target', revokedAt: new Date('2026-01-01T00:00:00Z') },
    { id: 'other-user', userId: 'other', revokedAt: null }
  ];
  const auditEvents = [];
  const tx = {
    webAuthnCredential: {
      findMany: async ({ where, select }) => {
        assert.deepEqual(where, { userId: 'target', revokedAt: null });
        assert.deepEqual(select, { id: true });
        return credentials.filter((row) => row.userId === where.userId && row.revokedAt === null).map(({ id }) => ({ id }));
      },
      updateMany: async ({ where, data }) => {
        assert.deepEqual(where, { id: where.id, userId: 'target', revokedAt: null });
        const row = credentials.find((item) => item.id === where.id && item.userId === where.userId && item.revokedAt === null);
        if (!row) return { count: 0 };
        row.revokedAt = data.revokedAt;
        return { count: 1 };
      }
    }
  };
  const service = createPasskeyRevocationService({ auditService: { log: async (event, client) => { assert.equal(client, tx); auditEvents.push(event); } }, clock: () => now });

  const result = await service.revokeAll({ tx, userId: 'target', actorUserId: 'admin' });

  assert.deepEqual(result, { count: 2 });
  assert.ok(credentials[0].revokedAt instanceof Date);
  assert.ok(credentials[1].revokedAt instanceof Date);
  assert.equal(credentials[2].revokedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(credentials[3].revokedAt, null);
  assert.deepEqual(auditEvents.map(({ actorUserId, action, entityType, entityId, metadata }) => [actorUserId, action, entityType, entityId, metadata.reason]), [
    ['admin', 'PASSKEY_REVOKED', 'WebAuthnCredential', 'target-1', 'admin_revoked'],
    ['admin', 'PASSKEY_REVOKED', 'WebAuthnCredential', 'target-2', 'admin_revoked']
  ]);
});

test('admin passkey revoke-all fails closed if a credential changed before its conditional revoke', async () => {
  const tx = { webAuthnCredential: {
    findMany: async () => [{ id: 'credential' }],
    updateMany: async () => ({ count: 0 })
  } };
  const service = createPasskeyRevocationService({ auditService: { log: async () => assert.fail('must not audit an unsuccessful revoke') }, clock: () => now });

  await assert.rejects(() => service.revokeAll({ tx, userId: 'target', actorUserId: 'admin' }), /credential revoke conflict/i);
});
