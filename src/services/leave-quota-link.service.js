const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');

const LEAVE_QUOTA_STATE_CONFLICT = 'LEAVE_QUOTA_STATE_CONFLICT';

async function linkLeaveQuota({ quotaId, employeeId, actorUserId, prismaClient = prisma, auditService = audit }) {
  try {
    return await prismaClient.$transaction(async (tx) => {
    const quota = await tx.leaveQuota.findUnique({
      where: { id: quotaId },
      select: { id: true, employeeId: true, employeeNameSnapshot: true, matchStatus: true }
    });
    if (!quota) throw new HttpError(404, 'Leave quota was not found.');
    if (quota.employeeId || ['MATCHED', 'DUPLICATE_MATCHED'].includes(quota.matchStatus)) {
      throw new HttpError(409, 'Leave quota is already linked.');
    }

    const employee = await tx.employee.findFirst({
      where: { id: employeeId, deletedAt: null, isActive: true },
      select: { id: true, employeeCode: true, displayName: true, department: true }
    });
    if (!employee) throw new HttpError(404, 'Selected employee is unavailable.');

    const existingQuota = await tx.leaveQuota.findFirst({
      where: { employeeId, id: { not: quotaId } },
      select: { id: true }
    });
    if (existingQuota) throw new HttpError(409, 'Selected employee already has a leave quota.');

    const after = await tx.leaveQuota.update({
      where: { id: quotaId },
      data: { employeeId, matchStatus: 'MATCHED' },
      select: { id: true, employeeId: true, employeeNameSnapshot: true, matchStatus: true }
    });
    await auditService.log({
      actorUserId,
      action: 'UPDATE',
      entityType: 'LeaveQuotaLink',
      entityId: quotaId,
      metadata: {
        before: { employeeId: quota.employeeId, matchStatus: quota.matchStatus },
        after: { employeeId: after.employeeId, matchStatus: after.matchStatus },
        employee: { employeeCode: employee.employeeCode, displayName: employee.displayName, department: employee.department }
      }
    }, tx);
    return { ...after, employee };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error?.code === 'P2034') {
      throw new HttpError(409, 'Leave quota state changed. Refresh and try again.', { code: LEAVE_QUOTA_STATE_CONFLICT });
    }
    throw error;
  }
}

module.exports = { linkLeaveQuota, LEAVE_QUOTA_STATE_CONFLICT };
