const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');
const { validateQuotaYear, lockAnnualQuotaProvisioning, LEAVE_QUOTA_STATE_CONFLICT } = require('./annual-leave-quota.service');
const { assertAnnualQuotaCreationAllowed } = require('./g03-1-multi-year-activation.service');

async function linkLeaveQuota({ quotaId, employeeId, quotaYear, actorUserId, prismaClient = prisma, auditService = audit }) {
  const year = validateQuotaYear(quotaYear);
  try {
    return await prismaClient.$transaction(async (tx) => {
      await lockAnnualQuotaProvisioning(tx, employeeId, year);
      const quota = await tx.leaveQuota.findUnique({
        where: { id: quotaId },
        select: { id: true, employeeId: true, quotaYear: true, employeeNameSnapshot: true, matchStatus: true }
      });
      if (!quota) throw new HttpError(404, 'Leave quota was not found.');
      if (quota.quotaYear !== null) throw new HttpError(409, 'This leave quota already has an annual year and cannot be moved through legacy linking.');
      if (quota.employeeId && quota.employeeId !== employeeId) {
        throw new HttpError(409, 'A linked legacy quota cannot be moved to a different employee.');
      }
      if (!quota.employeeId && ['MATCHED', 'DUPLICATE_MATCHED'].includes(quota.matchStatus)) {
        throw new HttpError(409, 'Legacy leave quota linkage state is inconsistent and requires remediation.');
      }

      const employee = await tx.employee.findFirst({
        where: { id: employeeId, deletedAt: null, isActive: true },
        select: { id: true, employeeCode: true, displayName: true, department: true }
      });
      if (!employee) throw new HttpError(404, 'Selected employee is unavailable.');

      const existingQuota = await tx.leaveQuota.findUnique({
        where: { employeeId_quotaYear: { employeeId, quotaYear: year } },
        select: { id: true }
      });
      if (existingQuota) throw new HttpError(409, 'Selected employee already has a leave quota for this year.', { code: 'LEAVE_QUOTA_ALREADY_EXISTS', quotaYear: year });

      const linkedLegacy = await tx.leaveQuota.findMany({ where: { employeeId, quotaYear: null, id: { not: quotaId } }, select: { id: true } });
      if (linkedLegacy.length) throw new HttpError(409, 'Selected employee has unclassified legacy leave quota data.', { code: 'LEAVE_QUOTA_LEGACY_AMBIGUOUS', quotaYear: year });
      await assertAnnualQuotaCreationAllowed(tx, year);

      const after = await tx.leaveQuota.update({
        where: { id: quotaId },
        data: { employeeId: quota.employeeId || employeeId, quotaYear: year, matchStatus: 'MATCHED' },
        select: { id: true, employeeId: true, quotaYear: true, employeeNameSnapshot: true, matchStatus: true }
      });
      await auditService.log({
        actorUserId,
        action: 'UPDATE',
        entityType: 'LeaveQuotaLink',
        entityId: quotaId,
        metadata: {
          event: 'ADMIN_ANNUAL_QUOTA_CLASSIFIED',
          before: { employeeId: quota.employeeId, quotaYear: quota.quotaYear, matchStatus: quota.matchStatus },
          after: { employeeId: after.employeeId, quotaYear: after.quotaYear, matchStatus: after.matchStatus },
          employeeId
        }
      }, tx);
      return { ...after, employee };
    }, { isolationLevel: 'ReadCommitted' });
  } catch (error) {
    if (error?.code === 'P2002') throw new HttpError(409, 'Selected employee already has a leave quota for this year.', { code: 'LEAVE_QUOTA_ALREADY_EXISTS', quotaYear: year });
    if (error?.code === 'P2034') throw new HttpError(409, 'Leave quota state changed. Refresh and try again.', { code: LEAVE_QUOTA_STATE_CONFLICT });
    throw error;
  }
}

module.exports = { linkLeaveQuota, LEAVE_QUOTA_STATE_CONFLICT };
