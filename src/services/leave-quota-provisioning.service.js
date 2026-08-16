const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');

const LEAVE_QUOTA_ALREADY_EXISTS = 'LEAVE_QUOTA_ALREADY_EXISTS';
const LEAVE_QUOTA_STATE_CONFLICT = 'LEAVE_QUOTA_STATE_CONFLICT';

function conflict(code, message) {
  return new HttpError(409, message, { code });
}

function defaultFingerprint() {
  return crypto.createHash('sha256').update(`v3:leave-quota:${crypto.randomUUID()}`).digest('hex');
}

async function provisionLeaveQuota({
  actor,
  employeeId,
  sickLeave,
  personalLeave,
  vacationLeave,
  prismaClient = prisma,
  auditService = audit,
  fingerprintFactory = defaultFingerprint
}) {
  if (actor?.role !== 'ADMIN') throw new HttpError(403, 'Admin access required.');

  try {
    return await prismaClient.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true, displayName: true }
      });
      if (!employee) throw new HttpError(404, 'Selected employee is unavailable.');

      const existingQuotas = await tx.leaveQuota.findMany({
        where: { employeeId },
        select: { id: true }
      });
      if (existingQuotas.length >= 1) {
        throw conflict(LEAVE_QUOTA_ALREADY_EXISTS, 'Employee already has a leave quota.');
      }

      const employeeNameSnapshot = String(employee.displayName || `${employee.firstName} ${employee.lastName}`).trim();
      const quota = await tx.leaveQuota.create({
        data: {
          sourceFingerprint: fingerprintFactory(),
          employeeId,
          employeeNameSnapshot,
          sickLeave,
          personalLeave,
          vacationLeave,
          matchStatus: 'MATCHED'
        },
        select: {
          id: true,
          employeeId: true,
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
          employeeId: quota.employeeId,
          matchStatus: quota.matchStatus,
          after: {
            sickLeave: quota.sickLeave,
            personalLeave: quota.personalLeave,
            vacationLeave: quota.vacationLeave
          }
        }
      }, tx);

      return quota;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error?.code === 'P2034') {
      throw conflict(LEAVE_QUOTA_STATE_CONFLICT, 'Leave quota state changed. Refresh and try again.');
    }
    throw error;
  }
}

module.exports = {
  provisionLeaveQuota,
  defaultFingerprint,
  LEAVE_QUOTA_ALREADY_EXISTS,
  LEAVE_QUOTA_STATE_CONFLICT
};
