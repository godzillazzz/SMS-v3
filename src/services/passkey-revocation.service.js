const audit = require('./audit.service');

function createPasskeyRevocationService({ auditService = audit, clock = () => new Date() } = {}) {
  async function revokeAll({ tx, userId, actorUserId }) {
    const activeCredentials = await tx.webAuthnCredential.findMany({
      where: { userId, revokedAt: null },
      select: { id: true }
    });
    for (const credential of activeCredentials) {
      const result = await tx.webAuthnCredential.updateMany({
        where: { id: credential.id, userId, revokedAt: null },
        data: { revokedAt: clock() }
      });
      if (result.count !== 1) throw new Error('Passkey credential revoke conflict.');
      await auditService.log({
        actorUserId,
        action: 'PASSKEY_REVOKED',
        entityType: 'WebAuthnCredential',
        entityId: credential.id,
        metadata: { reason: 'admin_revoked' }
      }, tx);
    }
    return { count: activeCredentials.length };
  }

  return { revokeAll };
}

module.exports = { createPasskeyRevocationService };
