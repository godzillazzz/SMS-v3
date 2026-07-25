const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { evaluateRulesForAssignments } = require('./schedule-rules.service');

function parseMonthDates(yearMonth) {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-indexed

  const startDate = new Date(Date.UTC(year, month, 1));
  const endDate = new Date(Date.UTC(year, month + 1, 0)); // last day of month

  return { year, month: month + 1, startDate, endDate, daysInMonth: endDate.getUTCDate() };
}

async function getMonthlyGrid(yearMonth) {
  const { startDate, endDate, daysInMonth, year, month } = parseMonthDates(yearMonth);

  const dates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = String(day).padStart(2, '0');
    const monthStr = String(month).padStart(2, '0');
    dates.push(`${year}-${monthStr}-${dayStr}`);
  }

  const [rawEmployees, shiftTypes, rawAssignments, approval] = await Promise.all([
    prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ employeeCode: 'asc' }]
    }),
    prisma.shiftType.findMany({ orderBy: { code: 'asc' } }),
    prisma.shiftAssignment.findMany({
      where: {
        workDate: { gte: startDate, lte: endDate }
      },
      include: { shiftType: true }
    }),
    prisma.scheduleApproval.findFirst({
      where: {
        month: startDate
      },
      orderBy: {
        revision: 'desc'
      }
    })
  ]);

  const assignmentsByEmp = new Map();
  for (const ass of rawAssignments) {
    if (!assignmentsByEmp.has(ass.employeeId)) {
      assignmentsByEmp.set(ass.employeeId, []);
    }
    assignmentsByEmp.get(ass.employeeId).push(ass);
  }

  const employees = rawEmployees.map((emp) => ({
    ...emp,
    displayName: `${emp.firstName} ${emp.lastName}`,
    shifts: assignmentsByEmp.get(emp.id) || []
  }));

  const rulesViolations = await evaluateRulesForAssignments(rawAssignments);

  return {
    yearMonth,
    daysInMonth,
    dates,
    approval: approval || { status: 'PENDING', month: startDate },
    employees,
    shiftTypes,
    assignments: rawAssignments,
    violations: rulesViolations
  };
}

async function saveBatchAssignments(assignments, actorUserId) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { count: 0 };
  }

  const empIds = [...new Set(assignments.map(a => a.employeeId).filter(Boolean))];
  const typeIds = [...new Set(assignments.map(a => a.shiftTypeId).filter(Boolean))];

  const [employees, shiftTypes] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: empIds } } }),
    prisma.shiftType.findMany({ where: { id: { in: typeIds } } })
  ]);

  const empMap = new Map(employees.map(e => [e.id, e]));
  const typeMap = new Map(shiftTypes.map(t => [t.id, t]));

  const results = await prisma.$transaction(async (tx) => {
    const list = [];
    const monthsToTouch = new Set();

    for (const ass of assignments) {
      const emp = empMap.get(ass.employeeId);
      const shift = typeMap.get(ass.shiftTypeId);
      if (!emp || !shift) continue;

      const dateParts = String(ass.workDate).slice(0, 10).split('-').map(Number);
      const parsedDate = dateParts.length === 3 && !dateParts.some(isNaN)
        ? new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]))
        : new Date(ass.workDate);
      if (isNaN(parsedDate.getTime())) continue;

      const monthKey = `${parsedDate.getUTCFullYear()}-${String(parsedDate.getUTCMonth() + 1).padStart(2, '0')}`;
      monthsToTouch.add(monthKey);

      const record = await tx.shiftAssignment.upsert({
        where: {
          workDate_employeeId: {
            workDate: parsedDate,
            employeeId: ass.employeeId
          }
        },
        update: {
          shiftTypeId: ass.shiftTypeId,
          startTime: shift.startTime,
          endTime: shift.endTime,
          hours: shift.hours,
          employeeNameSnapshot: emp.displayName || `${emp.firstName} ${emp.lastName}`,
          departmentSnapshot: emp.department,
          remark: ass.remark || null,
          locked: true
        },
        create: {
          employeeId: ass.employeeId,
          shiftTypeId: ass.shiftTypeId,
          workDate: parsedDate,
          startTime: shift.startTime,
          endTime: shift.endTime,
          hours: shift.hours,
          employeeNameSnapshot: emp.displayName || `${emp.firstName} ${emp.lastName}`,
          departmentSnapshot: emp.department,
          remark: ass.remark || null,
          locked: true,
          source: 'SMS_V3'
        }
      });
      list.push(record);
    }

    for (const mStr of monthsToTouch) {
      const [y, m] = mStr.split('-').map(Number);
      const monthDate = new Date(Date.UTC(y, m - 1, 1));
      const latestApproved = await tx.scheduleApproval.findFirst({
        where: { month: monthDate, status: 'APPROVED' },
        orderBy: { revision: 'desc' },
        select: { revision: true }
      });
      const currentRevision = latestApproved ? latestApproved.revision : 1;
      const existingPending = await tx.scheduleApproval.findFirst({
        where: { month: monthDate, status: 'PENDING' },
        orderBy: { updatedAt: 'desc' }
      });

      if (existingPending) {
        await tx.scheduleApproval.update({
          where: { id: existingPending.id },
          data: {
            changedByLegacyRef: actorUserId || 'SYSTEM',
            changedAt: new Date(),
            changeType: 'BATCH_UPDATE_SHIFT'
          }
        });
      } else {
        await tx.scheduleApproval.create({
          data: {
            month: monthDate,
            status: 'PENDING',
            revision: currentRevision,
            changedByLegacyRef: actorUserId || 'SYSTEM',
            changedAt: new Date(),
            changeType: 'BATCH_UPDATE_SHIFT',
            approvedAt: null,
            approvedByLegacyRef: null,
            scheduleHash: null
          }
        });
      }
    }

    return list;
  });

  return { count: results.length, data: results };
}

async function autoPlanMonth(yearMonth) {
  const { startDate, daysInMonth, year, month } = parseMonthDates(yearMonth);

  const [employees, shiftTypes] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, isActive: true } }),
    prisma.shiftType.findMany()
  ]);

  if (employees.length === 0 || shiftTypes.length === 0) {
    throw new HttpError(400, 'Employees and Shift Types are required for auto-planning.');
  }

  const shiftMap = new Map(shiftTypes.map((s) => [s.code, s]));
  const morning = shiftMap.get('M') || shiftTypes[0];
  const afternoon = shiftMap.get('A') || shiftTypes[0];
  const night = shiftMap.get('N') || shiftTypes[0];
  const off = shiftMap.get('OFF') || shiftTypes[shiftTypes.length - 1];

  const rotation = [morning, afternoon, night, off];
  const assignmentsToSave = [];

  employees.forEach((emp, empIdx) => {
    for (let day = 1; day <= daysInMonth; day++) {
      const workDate = new Date(Date.UTC(year, month - 1, day));
      const shiftIndex = (empIdx + day) % rotation.length;
      const assignedShift = rotation[shiftIndex];

      assignmentsToSave.push({
        employeeId: emp.id,
        shiftTypeId: assignedShift.id,
        workDate: workDate.toISOString()
      });
    }
  });

  return saveBatchAssignments(assignmentsToSave);
}

async function approveMonth(yearMonth, note, actorUserId) {
  const { startDate } = parseMonthDates(yearMonth);

  const lastApproved = await prisma.scheduleApproval.findFirst({
    where: { month: startDate, status: 'APPROVED' },
    orderBy: { revision: 'desc' },
    select: { revision: true }
  });
  const nextRevision = (lastApproved?.revision || 0) + 1;

  const existingPending = await prisma.scheduleApproval.findFirst({
    where: { month: startDate, status: 'PENDING' },
    orderBy: { updatedAt: 'desc' }
  });

  if (existingPending) {
    return prisma.scheduleApproval.update({
      where: { id: existingPending.id },
      data: {
        status: 'APPROVED',
        revision: nextRevision,
        approvalNote: note || 'Approved by administrator',
        approvedByLegacyRef: actorUserId,
        approvedAt: new Date()
      }
    });
  }

  return prisma.scheduleApproval.create({
    data: {
      month: startDate,
      revision: nextRevision,
      status: 'APPROVED',
      approvalNote: note || 'Approved by administrator',
      approvedByLegacyRef: actorUserId,
      approvedAt: new Date()
    }
  });
}

module.exports = {
  getMonthlyGrid,
  saveBatchAssignments,
  autoPlanMonth,
  approveMonth
};
