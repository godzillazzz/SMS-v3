const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');
const { createApprovalPolicyService } = require('./approval-policy.service');

const USER_MUTATION_LOCK = 746281903;
const SELF_ACCESS_MUTATION_FORBIDDEN = 'SELF_ACCESS_MUTATION_FORBIDDEN';
const LAST_ADMIN_PROTECTION = 'LAST_ADMIN_PROTECTION';
const eligibleAdminWhere = { role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false };
const protectedAccessFields = ['role', 'accountStatus', 'isActive'];

function safetyError(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function changedProtectedFields(before, input) {
  return protectedAccessFields.filter((field) => Object.prototype.hasOwnProperty.call(input, field) && input[field] !== before[field]);
}

function becomesIneligibleAdministrator(before, input) {
  if (!before || before.role !== 'ADMIN' || !before.isActive || before.accountStatus !== 'ACTIVE' || before.passwordResetRequired) return false;
  return (Object.prototype.hasOwnProperty.call(input, 'role') && input.role !== 'ADMIN')
    || (Object.prototype.hasOwnProperty.call(input, 'accountStatus') && input.accountStatus !== 'ACTIVE')
    || (Object.prototype.hasOwnProperty.call(input, 'isActive') && input.isActive !== true);
}

async function recordRejectedAttempt(auditService, { actorUserId, actorRole, targetId, reasonCode, attemptedProtectedFields }) {
  try {
    await auditService.log({
      actorUserId,
      action: 'UPDATE',
      entityType: 'UserAccessMutation',
      entityId: targetId,
      metadata: { result: 'denied', reasonCode, actorRole, attemptedProtectedFields }
    });
  } catch {
    // Audit failure must never permit the protected mutation.
  }
}

function createUserAccessService({ prismaClient = prisma, auditService = audit, approvalPolicyService } = {}) {
  const policyService = approvalPolicyService || createApprovalPolicyService({ prismaClient, auditService });
  async function updateUserAccount({ id, input, actorUserId, actorRole }) {
    let outcome;
    try {
      outcome = await prismaClient.$transaction(async (tx) => {
        // All account access mutations use the same PostgreSQL transaction lock.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${USER_MUTATION_LOCK})`;
        const before = await tx.user.findUniqueOrThrow({ where: { id } });
        const effectiveInput = { ...input };

        if (actorRole === 'MANAGER') {
          if (before.accountStatus !== 'PENDING') throw new HttpError(403, 'Managers may approve pending accounts only.');
          await policyService.assertReviewer('USER_ACCESS', { role: actorRole, sub: actorUserId }, tx);
          if (effectiveInput.role && effectiveInput.role !== 'VIEWER') throw new HttpError(403, 'Managers may assign the Viewer role only.');
          if (effectiveInput.accountStatus && effectiveInput.accountStatus !== 'ACTIVE') throw new HttpError(403, 'Managers may only approve pending accounts.');
          effectiveInput.role = 'VIEWER';
          effectiveInput.accountStatus = 'ACTIVE';
          effectiveInput.isActive = true;
        }
        if (actorRole === 'ADMIN' && before.accountStatus === 'PENDING' && effectiveInput.accountStatus === 'ACTIVE') {
          await policyService.assertReviewer('USER_ACCESS', { role: actorRole, sub: actorUserId }, tx);
        }

        const attemptedProtectedFields = changedProtectedFields(before, effectiveInput);
        if (actorRole === 'ADMIN' && id === actorUserId && attemptedProtectedFields.length > 0) {
          return { denied: { statusCode: 403, code: SELF_ACCESS_MUTATION_FORBIDDEN, attemptedProtectedFields } };
        }

        if (becomesIneligibleAdministrator(before, effectiveInput)) {
          const eligibleAdministrators = await tx.user.count({ where: eligibleAdminWhere });
          if (eligibleAdministrators <= 1) return { denied: { statusCode: 409, code: LAST_ADMIN_PROTECTION, attemptedProtectedFields } };
        }

        const after = await tx.user.update({
          where: { id },
          data: { ...effectiveInput, approvedAt: effectiveInput.accountStatus === 'ACTIVE' ? new Date() : undefined, tokenVersion: { increment: 1 } },
          select: { id: true, legacyUserId: true, displayName: true, email: true, role: true, department: true, accountStatus: true, isActive: true, passwordResetRequired: true }
        });
        await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        await auditService.log({ actorUserId, action: 'UPDATE', entityType: 'User', entityId: id, metadata: { before: { role: before.role, department: before.department, accountStatus: before.accountStatus, isActive: before.isActive }, after: { role: after.role, department: after.department, accountStatus: after.accountStatus, isActive: after.isActive } } }, tx);
        return { after };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error?.code === 'P2034') {
        await recordRejectedAttempt(auditService, { actorUserId, actorRole, targetId: id, reasonCode: LAST_ADMIN_PROTECTION, attemptedProtectedFields: protectedAccessFields.filter((field) => Object.prototype.hasOwnProperty.call(input, field)) });
        throw safetyError(409, LAST_ADMIN_PROTECTION, 'At least one eligible administrator must remain.');
      }
      throw error;
    }

    if (outcome.denied) {
      await recordRejectedAttempt(auditService, { actorUserId, actorRole, targetId: id, reasonCode: outcome.denied.code, attemptedProtectedFields: outcome.denied.attemptedProtectedFields });
      throw safetyError(outcome.denied.statusCode, outcome.denied.code, outcome.denied.code === SELF_ACCESS_MUTATION_FORBIDDEN ? 'You cannot change access to the account currently in use.' : 'At least one eligible administrator must remain.');
    }

    return outcome.after;
  }

  return { updateUserAccount };
}

module.exports = {
  createUserAccessService,
  updateUserAccount: createUserAccessService().updateUserAccount,
  SELF_ACCESS_MUTATION_FORBIDDEN,
  LAST_ADMIN_PROTECTION,
  eligibleAdminWhere
};
