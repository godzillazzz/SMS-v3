const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');
const {
  validateQuotaYear,
  bangkokQuotaYear,
  annualFingerprint,
  lockAnnualQuotaProvisioning,
  LEAVE_QUOTA_ALREADY_EXISTS,
  LEAVE_QUOTA_STATE_CONFLICT
} = require('./annual-leave-quota.service');
const { assertAnnualQuotaCreationAllowed } = require('./g03-1-multi-year-activation.service');

async function provisionLeaveQuota({
  actor,
  employeeId,
  quotaYear,
  sickLeave,
  personalLeave,
  vacationLeave,
  quotaYearDefaulted = false,
  prismaClient = prisma,
  auditService = audit,
  fingerprintFactory = annualFingerprint
}) {
  if (actor?.role !== 'ADMIN') throw new HttpError(403, 'Admin access required.');
  const year = validateQuotaYear(quotaYear ?? bangkokQuotaYear());
  try {
    return await prismaClient.$transaction(async (tx) => {
      await lockAnnualQuotaProvisioning(tx, employeeId, year);
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true, displayName: true }
      });
      if (!employee) throw new HttpError(404, 'Selected employee is unavailable.');

      const [existing, legacy] = await Promise.all([
        tx.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId, quotaYear: year } }, select: { id: true } }),
        tx.leaveQuota.findMany({ where: { employeeId, quotaYear: null }, select: { id: true } })
      ]);
      if (existing) {
        throw new HttpError(409, 'Employee already has a leave quota for this year.', { code: LEAVE_QUOTA_ALREADY_EXISTS, quotaYear: year });
      }
      if (legacy.length) {
        throw new HttpError(409, 'Legacy leave quota must be classified before creating an annual quota.', { code: 'LEAVE_QUOTA_LEGACY_AMBIGUOUS', quotaYear: year });
      }
      await assertAnnualQuotaCreationAllowed(tx, year);

      const employeeNameSnapshot = String(employee.displayName || `${employee.firstName} ${employee.lastName}`).trim();
      const quota = await tx.leaveQuota.create({
        data: {
          sourceFingerprint: fingerprintFactory(employeeId, year),
          employeeId,
          quotaYear: year,
          employeeNameSnapshot,
          sickLeave,
          personalLeave,
          vacationLeave,
          matchStatus: 'MATCHED'
        },
        select: {
          id: true,
          employeeId: true,
          quotaYear: true,
          employeeNameSnapshot: true,
          sickLeave: true,
          personalLeave: true,
          vacationLeave: true,
          matchStatus: true,
          createdAt: true,
          updatedAt: true
        }
      });

      await auditService.log({
        actorUserId: actor.sub,
        action: 'CREATE',
        entityType: 'LeaveQuota',
        entityId: quota.id,
        metadata: {
          event: 'ADMIN_ANNUAL_QUOTA_CREATED',
          employeeId: quota.employeeId,
          quotaYear: year,
          quotaYearDefaulted: Boolean(quotaYearDefaulted),
          matchStatus: quota.matchStatus,
          after: {
            sickLeave: quota.sickLeave,
            personalLeave: quota.personalLeave,
            vacationLeave: quota.vacationLeave
          }
        }
      }, tx);

      return quota;
    }, { isolationLevel: 'ReadCommitted' });
  } catch (error) {
    if (error?.code === 'P2002') throw new HttpError(409, 'Employee already has a leave quota for this year.', { code: LEAVE_QUOTA_ALREADY_EXISTS, quotaYear: year });
    if (error?.code === 'P2034') throw new HttpError(409, 'Leave quota state changed. Refresh and try again.', { code: LEAVE_QUOTA_STATE_CONFLICT });
    throw error;
  }
}

module.exports = {
  provisionLeaveQuota,
  LEAVE_QUOTA_ALREADY_EXISTS,
  LEAVE_QUOTA_STATE_CONFLICT
};
