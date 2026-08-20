const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { evaluateRulesForAssignments } = require('./schedule-rules.service');
const audit = require('./audit.service');
const { licenseStateForWorkDate } = require('./license-state.service');

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

async function saveBatchAssignments(assignments, actorUserId, actorRole = 'ADMIN') {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { count: 0 };
  }

  const empIds = [...new Set(assignments.map(a => a.employeeId).filter(Boolean))];
  const typeIds = [...new Set(assignments.map(a => a.shiftTypeId).filter(Boolean))];
  const siteIds = [...new Set(assignments.map(a => a.securitySiteId).filter(Boolean))];
  const dutyIds = [...new Set(assignments.map(a => a.dutyId).filter(Boolean))];

  const [employees, shiftTypes, licenses, securitySites, duties] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: empIds } } }),
    prisma.shiftType.findMany({ where: { id: { in: typeIds } } }),
    prisma.employeeLicense.findMany({ where: { employeeId: { in: empIds } } }),
    siteIds.length ? prisma.securitySite.findMany({ where: { id: { in: siteIds }, isActive: true } }) : Promise.resolve([]),
    dutyIds.length ? prisma.duty.findMany({ where: { id: { in: dutyIds }, isActive: true } }) : Promise.resolve([])
  ]);

  const empMap = new Map(employees.map(e => [e.id, e]));
  const typeMap = new Map(shiftTypes.map(t => [t.id, t]));
  const siteMap = new Map(securitySites.map(site => [site.id, site]));
  const dutyMap = new Map(duties.map(duty => [duty.id, duty]));
  const licMap = new Map();
  licenses.forEach(l => {
    const list = licMap.get(l.employeeId) || [];
    list.push(l);
    licMap.set(l.employeeId, list);
  });

  const results = await prisma.$transaction(async (tx) => {
    const list = [];
    const monthsToTouch = new Set();

    // Keep every database operation in this interactive transaction on the
    // transaction client.  Calling the global client here requires a second
    // connection and can exhaust a serverless Transaction Pooler even for a
    // single schedule item.
    const existingAssList = await tx.shiftAssignment.findMany({
      where: {
        OR: assignments.map(a => {
          const pDate = new Date(String(a.workDate).slice(0, 10) + 'T00:00:00.000Z');
          return { employeeId: a.employeeId, workDate: pDate };
        })
      },
      include: { shiftType: { select: { code: true } } }
    });
    const existingAssMap = new Map(existingAssList.map(a => [`${a.workDate.toISOString().slice(0, 10)}|${a.employeeId}`, a]));

    const monthChangeStats = {};

    for (const ass of assignments) {
      const emp = empMap.get(ass.employeeId);
      const shift = typeMap.get(ass.shiftTypeId);
      if (!emp) throw new HttpError(400, 'Employee not found for schedule assignment.');
      if (!shift) throw new HttpError(400, 'Shift type not found for schedule assignment.');
      if (shift.isActive === false) throw new HttpError(400, 'Active Shift Type not found for schedule assignment.');
      if (ass.securitySiteId && !siteMap.has(ass.securitySiteId)) throw new HttpError(400, 'Active Security Site not found for schedule assignment.');
      if (ass.dutyId && !dutyMap.has(ass.dutyId)) throw new HttpError(400, 'Active Duty not found for schedule assignment.');

      const dateParts = String(ass.workDate).slice(0, 10).split('-').map(Number);
      const parsedDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
      const mStr = `${dateParts[0]}-${String(dateParts[1]).padStart(2, '0')}`;
      monthsToTouch.add(mStr);

      if (!monthChangeStats[mStr]) {
        monthChangeStats[mStr] = { totalChanged: 0, nonAlChanged: 0 };
      }

      const key = `${parsedDate.toISOString().slice(0, 10)}|${ass.employeeId}`;
      const beforeAss = existingAssMap.get(key);
      const codeBefore = beforeAss ? String(beforeAss.shiftType.code || '').toUpperCase() : null;
      const codeAfter = String(shift.code || '').toUpperCase();

      const isAssChanged = !beforeAss ||
        beforeAss.shiftTypeId !== ass.shiftTypeId ||
        Number(beforeAss.hours) !== Number(shift.hours) ||
        beforeAss.startTime !== shift.startTime ||
        beforeAss.endTime !== shift.endTime ||
        (beforeAss.remark || null) !== (ass.remark || null);

      if (isAssChanged) {
        monthChangeStats[mStr].totalChanged += 1;
        const isAlOnlyChange = (codeBefore !== 'AL' && codeAfter === 'AL');
        if (!isAlOnlyChange) {
          monthChangeStats[mStr].nonAlChanged += 1;
        }
      }

      const shiftCode = String(shift.code || '').toUpperCase();
      let licenseStatus = 'VALID';
      let licenseExpiryDate = null;
      let licenseOverride = Boolean(ass.licenseOverride);
      let overrideReason = ass.overrideReason || null;
      let overrideAt = licenseOverride ? new Date() : null;

      if (['OFF', 'AL'].includes(shiftCode)) {
        licenseStatus = 'NOT_REQUIRED';
      } else {
        const empLicenses = licMap.get(ass.employeeId) || [];
        const licenseState = licenseStateForWorkDate(empLicenses, parsedDate);
        if (licenseState.valid) {
          licenseStatus = 'VALID';
          licenseExpiryDate = licenseState.expiryDate;
        } else if (actorRole === 'ADMIN' && licenseOverride && String(overrideReason || '').trim().length >= 5) {
          licenseStatus = 'OVERRIDDEN';
          licenseExpiryDate = licenseState.expiryDate;
        } else {
          const status = licenseState.status;
          throw new HttpError(400, actorRole === 'ADMIN'
            ? `License Block: employee license is ${status.toLowerCase()}. Select OFF/AL or provide an Admin override reason.`
            : `License Block: employee license is ${status.toLowerCase()}. Only an Admin may override this restriction.`);
        }
      }

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
          locked: true,
          licenseStatus,
          licenseExpiryDate,
          licenseOverride,
          overrideReason,
          overrideAt,
          securitySiteId: ass.securitySiteId || null,
          dutyId: ass.dutyId || null
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
          source: 'SMS_V3',
          licenseStatus,
          licenseExpiryDate,
          licenseOverride,
          overrideReason,
          overrideAt,
          securitySiteId: ass.securitySiteId || null,
          dutyId: ass.dutyId || null
        }
      });
      if (licenseStatus === 'OVERRIDDEN') {
        await audit.log({ actorUserId, action: 'UPDATE', entityType: 'LicenseOverride', entityId: record.id, metadata: { employeeId: ass.employeeId, workDate: parsedDate.toISOString().slice(0, 10), reasonProvided: true } }, tx);
      }
      list.push(record);
    }

    for (const mStr of monthsToTouch) {
      const [y, m] = mStr.split('-').map(Number);
      const monthDate = new Date(Date.UTC(y, m - 1, 1));
      const stats = monthChangeStats[mStr] || { totalChanged: 0, nonAlChanged: 0 };
      const isNoOp = stats.totalChanged === 0;
      const isAlOnly = !isNoOp && stats.nonAlChanged === 0;

      await updateScheduleApprovalState(tx, {
        month: monthDate,
        actorUserId: actorUserId || 'SYSTEM',
        isAlOnly,
        isNoOp,
        changeType: 'BATCH_UPDATE_SHIFT'
      });
    }

    return list;
  }, { maxWait: 10000, timeout: 60000 });

  return { count: results.length, data: results };
}

async function updateScheduleApprovalState(tx, { workDate, month, actorUserId, isAlOnly = false, isNoOp = false, changeType = 'UPDATE_SHIFT' }) {
  const monthDate = month ? new Date(month) : new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), 1));

  if (isNoOp) {
    return tx.scheduleApproval.findFirst({
      where: { month: monthDate },
      orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }]
    });
  }

  const currentApproval = await tx.scheduleApproval.findFirst({
    where: { month: monthDate },
    orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }]
  });

  if (isAlOnly) {
    let result;
    if (currentApproval) {
      result = await tx.scheduleApproval.update({
        where: { id: currentApproval.id },
        data: {
          changedByLegacyRef: actorUserId || 'SYSTEM',
          changedAt: new Date(),
          changeType
        }
      });
    } else {
      result = await tx.scheduleApproval.create({
        data: {
          month: monthDate,
          status: 'PENDING',
          revision: 1,
          changedByLegacyRef: actorUserId || 'SYSTEM',
          changedAt: new Date(),
          changeType,
          approvedAt: null,
          approvedByLegacyRef: null
        }
      });
    }

    await audit.log({
      actorUserId: actorUserId || null,
      action: 'UPDATE',
      entityType: 'ScheduleApproval',
      entityId: result.id,
      metadata: {
        changeType: 'AL_ONLY_CHANGE',
        month: monthDate.toISOString().slice(0, 7),
        status: result.status,
        revision: result.revision
      }
    }, tx);

    return result;
  }

  let result;
  if (currentApproval) {
    result = await tx.scheduleApproval.update({
      where: { id: currentApproval.id },
      data: {
        status: 'PENDING',
        approvedAt: null,
        approvedByLegacyRef: null,
        changedByLegacyRef: actorUserId || 'SYSTEM',
        changedAt: new Date(),
        changeType
      }
    });
  } else {
    result = await tx.scheduleApproval.create({
      data: {
        month: monthDate,
        status: 'PENDING',
        revision: 1,
        changedByLegacyRef: actorUserId || 'SYSTEM',
        changedAt: new Date(),
        changeType,
        approvedAt: null,
        approvedByLegacyRef: null
      }
    });
  }

  await audit.log({
    actorUserId: actorUserId || null,
    action: 'UPDATE',
    entityType: 'ScheduleApproval',
    entityId: result.id,
    metadata: {
      changeType: 'REAPPROVAL_REQUIRED',
      month: monthDate.toISOString().slice(0, 7),
      status: 'PENDING',
      revision: result.revision
    }
  }, tx);

  return result;
}

async function approveMonthlySchedule(tx, { month, approvalNote, actorUser }) {
  if (actorUser.role !== 'ADMIN') {
    await audit.log({
      actorUserId: actorUser.sub,
      action: 'REJECTED',
      entityType: 'ScheduleApproval',
      entityId: month instanceof Date ? month.toISOString().slice(0, 7) : String(month),
      metadata: {
        reason: 'UNAUTHORIZED_APPROVAL_ATTEMPT',
        role: actorUser.role
      }
    }, tx);
    throw new HttpError(403, 'Only an Admin may approve monthly schedules.');
  }

  const monthDate = month instanceof Date ? month : new Date(month);

  const currentApproval = await tx.scheduleApproval.findFirst({
    where: { month: monthDate },
    orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }]
  });

  if (currentApproval && currentApproval.status === 'APPROVED') {
    return currentApproval;
  }

  const nextRevision = (currentApproval?.revision || 0) + 1;

  let result;
  if (currentApproval) {
    result = await tx.scheduleApproval.update({
      where: { id: currentApproval.id },
      data: {
        status: 'APPROVED',
        revision: nextRevision,
        approvedAt: new Date(),
        approvedByLegacyRef: actorUser.sub,
        ...(approvalNote !== undefined && { approvalNote })
      }
    });
  } else {
    result = await tx.scheduleApproval.create({
      data: {
        month: monthDate,
        status: 'APPROVED',
        revision: nextRevision,
        changedByLegacyRef: actorUser.sub,
        changedAt: new Date(),
        approvedAt: new Date(),
        approvedByLegacyRef: actorUser.sub,
        changeType: 'MANUAL_SCHEDULE',
        approvalNote: approvalNote || 'อนุมัติตารางกะประจำเดือน'
      }
    });
  }

  await audit.log({
    actorUserId: actorUser.sub,
    action: 'UPDATE',
    entityType: 'ScheduleApproval',
    entityId: result.id,
    metadata: {
      action: 'ADMIN_SCHEDULE_APPROVED',
      status: 'APPROVED',
      revision: result.revision,
      approvedAt: result.approvedAt
    }
  }, tx);

  return result;
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

async function approveMonth(yearMonth, note, actorUser) {
  const { startDate } = parseMonthDates(yearMonth);
  return approveMonthlySchedule(prisma, { month: startDate, approvalNote: note, actorUser });
}

module.exports = {
  getMonthlyGrid,
  saveBatchAssignments,
  autoPlanMonth,
  approveMonth,
  updateScheduleApprovalState,
  approveMonthlySchedule
};
