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
      orderBy: [{ department: 'asc' }, { lastName: 'asc' }]
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

async function saveBatchAssignments(assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { count: 0 };
  }

  const results = [];
  for (const ass of assignments) {
    const { employeeId, shiftTypeId, workDate, remark } = ass;

    const [emp, shift] = await Promise.all([
      prisma.employee.findUnique({ where: { id: employeeId } }),
      prisma.shiftType.findUnique({ where: { id: shiftTypeId } })
    ]);

    if (!emp || !shift) continue;

    const parsedDate = new Date(workDate);

    const record = await prisma.shiftAssignment.upsert({
      where: {
        workDate_employeeId: {
          workDate: parsedDate,
          employeeId
        }
      },
      update: {
        shiftTypeId,
        startTime: shift.startTime,
        endTime: shift.endTime,
        hours: shift.hours,
        employeeNameSnapshot: `${emp.firstName} ${emp.lastName}`,
        departmentSnapshot: emp.department,
        remark: remark || null
      },
      create: {
        employeeId,
        shiftTypeId,
        workDate: parsedDate,
        startTime: shift.startTime,
        endTime: shift.endTime,
        hours: shift.hours,
        employeeNameSnapshot: `${emp.firstName} ${emp.lastName}`,
        departmentSnapshot: emp.department,
        remark: remark || null
      }
    });

    results.push(record);
  }

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

  const existing = await prisma.scheduleApproval.findFirst({
    where: { month: startDate }
  });

  if (existing) {
    return prisma.scheduleApproval.update({
      where: { id: existing.id },
      data: {
        status: 'APPROVED',
        approvalNote: note || 'Approved by administrator',
        approvedByLegacyRef: actorUserId,
        approvedAt: new Date()
      }
    });
  }

  return prisma.scheduleApproval.create({
    data: {
      month: startDate,
      revision: 1,
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
