const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const crypto = require('crypto');

async function submitRequest(data) {
  const { employeeId, leaveType, startDate, endDate, reason } = data;

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new HttpError(404, 'Employee not found.');

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end < start) {
    throw new HttpError(400, 'End date cannot be earlier than start date.');
  }

  const dayCount = (end - start) / (1000 * 60 * 60 * 24) + 1;
  const sourceFingerprint = crypto.createHash('sha256').update(`${employeeId}_${startDate}_${endDate}_${Date.now()}`).digest('hex');

  return prisma.leaveRequest.create({
    data: {
      employeeId,
      leaveType,
      startDate: start,
      endDate: end,
      dayCount,
      reason,
      status: 'PENDING',
      sourceFingerprint,
      employeeNameSnapshot: `${emp.firstName} ${emp.lastName}`,
      departmentSnapshot: emp.department
    }
  });
}

async function listRequests(query) {
  const { status, employeeId } = query || {};
  const where = {
    ...(status && { status }),
    ...(employeeId && { employeeId })
  };

  return prisma.leaveRequest.findMany({
    where,
    include: { employee: true },
    orderBy: { createdAt: 'desc' }
  });
}

async function approveRequest(id, actorUserId) {
  const request = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: true }
  });

  if (!request) throw new HttpError(404, 'Leave request not found.');
  if (request.status === 'APPROVED') return request;

  // Find or create LEAVE shift type
  let leaveShift = await prisma.shiftType.findFirst({ where: { code: 'LEAVE' } });
  if (!leaveShift) {
    leaveShift = await prisma.shiftType.create({
      data: { code: 'LEAVE', name: 'Leave', hours: 0, color: '#ef4444' }
    });
  }

  // Update LeaveRequest status to APPROVED
  const updatedRequest = await prisma.leaveRequest.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedByLegacyRef: actorUserId
    }
  });

  // Automatically sync employee schedule for all dates in leave range
  const curr = new Date(request.startDate);
  const end = new Date(request.endDate);

  while (curr <= end) {
    const workDate = new Date(curr);
    await prisma.shiftAssignment.upsert({
      where: {
        workDate_employeeId: {
          workDate,
          employeeId: request.employeeId
        }
      },
      update: {
        shiftTypeId: leaveShift.id,
        hours: 0,
        remark: `Approved ${request.leaveType} leave`
      },
      create: {
        employeeId: request.employeeId,
        shiftTypeId: leaveShift.id,
        workDate,
        hours: 0,
        employeeNameSnapshot: request.employeeNameSnapshot,
        departmentSnapshot: request.departmentSnapshot,
        remark: `Approved ${request.leaveType} leave`
      }
    });

    curr.setDate(curr.getDate() + 1);
  }

  return updatedRequest;
}

async function rejectRequest(id, reason, actorUserId) {
  const request = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!request) throw new HttpError(404, 'Leave request not found.');

  return prisma.leaveRequest.update({
    where: { id },
    data: {
      status: 'REJECTED',
      approvedByLegacyRef: actorUserId,
      approvedAt: new Date()
    }
  });
}

async function getSummary(employeeId) {
  const currentYear = new Date().getFullYear();

  let quota = await prisma.leaveQuota.findFirst({
    where: { employeeId }
  });

  if (!quota) {
    const sourceFingerprint = crypto.createHash('sha256').update(`quota_${employeeId}_${currentYear}`).digest('hex');
    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });

    quota = await prisma.leaveQuota.create({
      data: {
        employeeId,
        employeeNameSnapshot: emp ? `${emp.firstName} ${emp.lastName}` : 'Employee',
        sickLeave: 30,
        personalLeave: 6,
        vacationLeave: 10,
        matchStatus: 'MATCHED',
        sourceFingerprint
      }
    });
  }

  const approvedLeaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: 'APPROVED'
    }
  });

  const usedSick = approvedLeaves.filter((l) => l.leaveType === 'SICK').reduce((sum, l) => sum + Number(l.dayCount), 0);
  const usedPersonal = approvedLeaves.filter((l) => l.leaveType === 'PERSONAL').reduce((sum, l) => sum + Number(l.dayCount), 0);
  const usedVacation = approvedLeaves.filter((l) => l.leaveType === 'VACATION').reduce((sum, l) => sum + Number(l.dayCount), 0);

  return {
    quota: {
      sick: Number(quota.sickLeave),
      personal: Number(quota.personalLeave),
      vacation: Number(quota.vacationLeave)
    },
    used: {
      sick: usedSick,
      personal: usedPersonal,
      vacation: usedVacation
    },
    remaining: {
      sick: Math.max(0, Number(quota.sickLeave) - usedSick),
      personal: Math.max(0, Number(quota.personalLeave) - usedPersonal),
      vacation: Math.max(0, Number(quota.vacationLeave) - usedVacation)
    }
  };
}

module.exports = {
  submitRequest,
  listRequests,
  approveRequest,
  rejectRequest,
  getSummary
};
