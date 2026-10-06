const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { evaluateRulesForAssignments } = require('./schedule-rules.service');
const audit = require('./audit.service');
const { licenseStateForWorkDate, loadLicenseAuthorityByEmployee } = require('./license-state.service');
const { NON_OPERATIONAL_SHIFT_CODES, createEmployeeProjectedStateResolver, ensureEmployeeOperationalForShift } = require('./employee-operational-eligibility.service');
const { createSchedulePersonnelResolver, enrichScheduleAssignments } = require('./schedule-personnel-history.service');
const { loadCalendarRoster } = require('./schedule-roster.service');

const SCHEDULE_BATCH_WRITE_CHUNK_SIZE = 500;

function typedSqlArray(rows, readValue, cast) {
  const elements = rows.map((row) => Prisma.sql`${readValue(row)}::${Prisma.raw(cast)}`);
  return Prisma.sql`ARRAY[${Prisma.join(elements)}]::${Prisma.raw(cast)}[]`;
}

async function writeScheduleAssignmentChunk(tx, rows) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "shift_assignments" (
      "id", "employee_id", "shift_type_id", "work_date", "employee_name_snapshot",
      "department_snapshot", "start_time", "end_time", "hours", "remark", "locked",
      "source", "license_status", "license_expiry_date", "license_override",
      "override_reason", "override_at", "created_at", "updated_at"
    )
    SELECT batch."id", batch."employee_id", batch."shift_type_id", batch."work_date",
      batch."employee_name_snapshot", batch."department_snapshot", batch."start_time",
      batch."end_time", batch."hours", batch."remark", batch."locked", batch."source",
      batch."license_status", batch."license_expiry_date", batch."license_override",
      batch."override_reason", batch."override_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM unnest(
      ${typedSqlArray(rows, (row) => row.id, 'uuid')},
      ${typedSqlArray(rows, (row) => row.employeeId, 'uuid')},
      ${typedSqlArray(rows, (row) => row.shiftTypeId, 'uuid')},
      ${typedSqlArray(rows, (row) => row.workDate, 'date')},
      ${typedSqlArray(rows, (row) => row.employeeNameSnapshot, 'text')},
      ${typedSqlArray(rows, (row) => row.departmentSnapshot, 'text')},
      ${typedSqlArray(rows, (row) => row.startTime, 'text')},
      ${typedSqlArray(rows, (row) => row.endTime, 'text')},
      ${typedSqlArray(rows, (row) => row.hours, 'numeric')},
      ${typedSqlArray(rows, (row) => row.remark, 'text')},
      ${typedSqlArray(rows, (row) => row.locked, 'boolean')},
      ${typedSqlArray(rows, (row) => row.source, 'text')},
      ${typedSqlArray(rows, (row) => row.licenseStatus, 'text')},
      ${typedSqlArray(rows, (row) => row.licenseExpiryDate, 'date')},
      ${typedSqlArray(rows, (row) => row.licenseOverride, 'boolean')},
      ${typedSqlArray(rows, (row) => row.overrideReason, 'text')},
      ${typedSqlArray(rows, (row) => row.overrideAt, 'timestamptz')}
    ) AS batch(
      "id", "employee_id", "shift_type_id", "work_date", "employee_name_snapshot",
      "department_snapshot", "start_time", "end_time", "hours", "remark", "locked",
      "source", "license_status", "license_expiry_date", "license_override",
      "override_reason", "override_at"
    )
    ON CONFLICT ("work_date", "employee_id") DO UPDATE SET
      "shift_type_id" = EXCLUDED."shift_type_id",
      "start_time" = EXCLUDED."start_time",
      "end_time" = EXCLUDED."end_time",
      "hours" = EXCLUDED."hours",
      "employee_name_snapshot" = EXCLUDED."employee_name_snapshot",
      "department_snapshot" = EXCLUDED."department_snapshot",
      "remark" = EXCLUDED."remark",
      "locked" = EXCLUDED."locked",
      "license_status" = EXCLUDED."license_status",
      "license_expiry_date" = EXCLUDED."license_expiry_date",
      "license_override" = EXCLUDED."license_override",
      "override_reason" = EXCLUDED."override_reason",
      "override_at" = EXCLUDED."override_at",
      "updated_at" = CURRENT_TIMESTAMP
  `);
}

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

  const [shiftTypes, rawAssignments, approval] = await Promise.all([
    prisma.shiftType.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
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

  const roster = await loadCalendarRoster(prisma, startDate);
  const rawEmployees = roster.employees;
  const historicalAssignments = await enrichScheduleAssignments(prisma, rawAssignments, rawEmployees);

  const assignmentsByEmp = new Map();
  for (const ass of historicalAssignments) {
    if (!assignmentsByEmp.has(ass.employeeId)) {
      assignmentsByEmp.set(ass.employeeId, []);
    }
    assignmentsByEmp.get(ass.employeeId).push(ass);
  }

  const employees = rawEmployees.map((emp) => ({ ...emp, shifts: assignmentsByEmp.get(emp.id) || [] }));

  const rulesViolations = await evaluateRulesForAssignments(rawAssignments);

  return {
    yearMonth,
    daysInMonth,
    dates,
    approval: approval || { status: 'PENDING', month: startDate },
    employees,
    shiftTypes,
    assignments: historicalAssignments,
    violations: rulesViolations
  };
}

async function saveBatchAssignments(assignments, actorUserId, actorRole = 'ADMIN', deletes = []) {
  const inputAssignments = Array.isArray(assignments) ? assignments : [];
  const requestedDeleteIds = Array.isArray(deletes) ? [...new Set(deletes.filter(Boolean))] : [];
  if (!inputAssignments.length && !requestedDeleteIds.length) {
    return { count: 0, months: [], revision: [] };
  }

  const empIds = [...new Set(inputAssignments.map((assignment) => assignment.employeeId).filter(Boolean))];
  const typeIds = [...new Set(inputAssignments.map((assignment) => assignment.shiftTypeId).filter(Boolean))];

  const [employees, shiftTypes, licMap] = await Promise.all([
    empIds.length ? prisma.employee.findMany({ where: { id: { in: empIds } } }) : Promise.resolve([]),
    typeIds.length ? prisma.shiftType.findMany({ where: { id: { in: typeIds } } }) : Promise.resolve([]),
    loadLicenseAuthorityByEmployee(prisma, empIds)
  ]);

  const empMap = new Map(employees.map((employee) => [employee.id, employee]));
  const typeMap = new Map(shiftTypes.map((shiftType) => [shiftType.id, shiftType]));

  const result = await prisma.$transaction(async (tx) => {
    const monthsToTouch = new Set();
    const monthChangeStats = {};
    const upsertRowsByKey = new Map();
    const overrideAuditDrafts = [];

    // Keep every database operation in this interactive transaction on the
    // transaction client.  Calling the global client here requires a second
    // connection and can exhaust a serverless Transaction Pooler.
    const existingAssList = inputAssignments.length
      ? await tx.shiftAssignment.findMany({
        where: {
          OR: inputAssignments.map((assignment) => ({
            employeeId: assignment.employeeId,
            workDate: new Date(String(assignment.workDate).slice(0, 10) + 'T00:00:00.000Z')
          }))
        },
        include: { shiftType: { select: { code: true } } }
      })
      : [];
    const existingAssMap = new Map(existingAssList.map((assignment) => [
      `${assignment.workDate.toISOString().slice(0, 10)}|${assignment.employeeId}`,
      assignment
    ]));
    const deletedRows = requestedDeleteIds.length
      ? await tx.shiftAssignment.findMany({
        where: { id: { in: requestedDeleteIds } },
        select: { id: true, employeeId: true, shiftTypeId: true, workDate: true }
      })
      : [];

    const resolvePersonnel = await createSchedulePersonnelResolver(tx, employees);
    const operationalRows = inputAssignments
      .map((assignment) => {
        const shift = typeMap.get(assignment.shiftTypeId);
        return shift ? { employeeId: assignment.employeeId, workDate: assignment.workDate, shiftCode: String(shift.code || '').toUpperCase() } : null;
      })
      .filter((row) => row && !NON_OPERATIONAL_SHIFT_CODES.has(row.shiftCode));
    const resolveProjectedState = operationalRows.length
      ? await createEmployeeProjectedStateResolver(tx, operationalRows)
      : null;

    for (const assignment of inputAssignments) {
      const employee = empMap.get(assignment.employeeId);
      const shift = typeMap.get(assignment.shiftTypeId);
      if (!employee) throw new HttpError(400, 'Employee not found for schedule assignment.');
      if (!shift) throw new HttpError(400, 'Shift type not found for schedule assignment.');

      const dateParts = String(assignment.workDate).slice(0, 10).split('-').map(Number);
      const workDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
      const monthKey = `${dateParts[0]}-${String(dateParts[1]).padStart(2, '0')}`;
      const key = `${workDate.toISOString().slice(0, 10)}|${assignment.employeeId}`;
      monthsToTouch.add(monthKey);
      if (!monthChangeStats[monthKey]) monthChangeStats[monthKey] = { totalChanged: 0, nonAlChanged: 0 };

      const personnelState = resolvePersonnel(assignment.employeeId, workDate);
      if (!personnelState) throw new HttpError(400, 'Employee historical state not found for schedule assignment.');
      const beforeAssignment = existingAssMap.get(key);
      if (shift.isActive === false && (!beforeAssignment || beforeAssignment.shiftTypeId !== assignment.shiftTypeId)) {
        throw new HttpError(409, 'Shift type is inactive and cannot be assigned to a new schedule.');
      }
      const codeBefore = beforeAssignment ? String(beforeAssignment.shiftType.code || '').toUpperCase() : null;
      const shiftCode = String(shift.code || '').toUpperCase();
      const isAssignmentChanged = !beforeAssignment ||
        beforeAssignment.shiftTypeId !== assignment.shiftTypeId ||
        Number(beforeAssignment.hours) !== Number(shift.hours) ||
        beforeAssignment.startTime !== shift.startTime ||
        beforeAssignment.endTime !== shift.endTime ||
        (beforeAssignment.remark || null) !== (assignment.remark || null);

      if (isAssignmentChanged) {
        monthChangeStats[monthKey].totalChanged += 1;
        if (!(codeBefore !== 'AL' && shiftCode === 'AL')) monthChangeStats[monthKey].nonAlChanged += 1;
      }

      await ensureEmployeeOperationalForShift(tx, {
        employeeId: assignment.employeeId,
        workDate,
        shiftCode,
        projectedStateResolver: resolveProjectedState
      });

      let licenseStatus = 'VALID';
      let licenseExpiryDate = null;
      const licenseOverride = Boolean(assignment.licenseOverride);
      const overrideReason = assignment.overrideReason || null;
      const overrideAt = licenseOverride ? new Date() : null;

      if (['OFF', 'AL'].includes(shiftCode)) {
        licenseStatus = 'NOT_REQUIRED';
      } else {
        const employeeLicenses = licMap.get(assignment.employeeId) || [];
        const licenseState = licenseStateForWorkDate(employeeLicenses, workDate);
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

      const row = {
        id: beforeAssignment?.id || randomUUID(),
        employeeId: assignment.employeeId,
        shiftTypeId: assignment.shiftTypeId,
        workDate,
        employeeNameSnapshot: personnelState.displayName,
        departmentSnapshot: personnelState.department ?? null,
        startTime: shift.startTime ?? null,
        endTime: shift.endTime ?? null,
        hours: String(shift.hours),
        remark: assignment.remark || null,
        locked: true,
        source: 'SMS_V3',
        licenseStatus,
        licenseExpiryDate,
        licenseOverride,
        overrideReason,
        overrideAt
      };
      upsertRowsByKey.set(key, row);
      if (licenseStatus === 'OVERRIDDEN') {
        overrideAuditDrafts.push({
          key,
          employeeId: assignment.employeeId,
          workDate: workDate.toISOString().slice(0, 10)
        });
      }
    }

    const deletedByKey = new Map(deletedRows.map((row) => [
      `${row.workDate.toISOString().slice(0, 10)}|${row.employeeId}`,
      row
    ]));
    for (const [key, row] of deletedByKey) {
      if (upsertRowsByKey.has(key)) {
        throw new HttpError(400, 'ไม่สามารถแก้ไขและลบกะช่องเดียวกันในคำขอเดียว');
      }
      const monthKey = row.workDate.toISOString().slice(0, 7);
      monthsToTouch.add(monthKey);
      if (!monthChangeStats[monthKey]) monthChangeStats[monthKey] = { totalChanged: 0, nonAlChanged: 0 };
      // The existing single-row DELETE path always invalidates normal approval state.
      monthChangeStats[monthKey].totalChanged += 1;
      monthChangeStats[monthKey].nonAlChanged += 1;
    }

    const rowsToWrite = [...upsertRowsByKey.values()];
    for (let start = 0; start < rowsToWrite.length; start += SCHEDULE_BATCH_WRITE_CHUNK_SIZE) {
      await writeScheduleAssignmentChunk(tx, rowsToWrite.slice(start, start + SCHEDULE_BATCH_WRITE_CHUNK_SIZE));
    }

    let deletedCount = 0;
    if (deletedRows.length) {
      const deletion = await tx.shiftAssignment.deleteMany({ where: { id: { in: deletedRows.map((row) => row.id) } } });
      if (deletion.count !== deletedRows.length) {
        throw new HttpError(409, 'มีการเปลี่ยนแปลงกะระหว่างบันทึก กรุณาโหลดตารางใหม่');
      }
      deletedCount = deletion.count;
    }

    const auditRows = deletedRows.map((row) => ({
      actorUserId: actorUserId || null,
      action: 'DELETE',
      entityType: 'ShiftAssignment',
      entityId: row.id,
      metadata: audit.safeMetadata({ before: { employeeId: row.employeeId, shiftTypeId: row.shiftTypeId, workDate: row.workDate } })
    }));

    if (overrideAuditDrafts.length) {
      const uniqueTargets = [...new Map(overrideAuditDrafts.map((draft) => [draft.key, draft])).values()];
      const assignmentIds = await tx.$queryRaw(Prisma.sql`
        SELECT saved."id", saved."employee_id" AS "employeeId", saved."work_date" AS "workDate"
        FROM "shift_assignments" AS saved
        JOIN unnest(
          ${typedSqlArray(uniqueTargets, (target) => target.employeeId, 'uuid')},
          ${typedSqlArray(uniqueTargets, (target) => target.workDate, 'date')}
        ) AS requested("employee_id", "work_date")
          ON requested."employee_id" = saved."employee_id"
          AND requested."work_date" = saved."work_date"
      `);
      const idByKey = new Map(assignmentIds.map((row) => [
        `${row.workDate.toISOString().slice(0, 10)}|${row.employeeId}`,
        row.id
      ]));
      for (const draft of overrideAuditDrafts) {
        const entityId = idByKey.get(draft.key);
        if (!entityId) throw new Error('License override audit target was not saved.');
        auditRows.push({
          actorUserId: actorUserId || null,
          action: 'UPDATE',
          entityType: 'LicenseOverride',
          entityId,
          metadata: audit.safeMetadata({ employeeId: draft.employeeId, workDate: draft.workDate, reasonProvided: true })
        });
      }
    }
    if (auditRows.length) await tx.auditLog.createMany({ data: auditRows });

    const revisionRows = [];
    for (const monthKey of [...monthsToTouch].sort()) {
      const [year, month] = monthKey.split('-').map(Number);
      const monthDate = new Date(Date.UTC(year, month - 1, 1));
      const stats = monthChangeStats[monthKey] || { totalChanged: 0, nonAlChanged: 0 };
      const isNoOp = stats.totalChanged === 0;
      const isAlOnly = !isNoOp && stats.nonAlChanged === 0;
      const approval = await updateScheduleApprovalState(tx, {
        month: monthDate,
        actorUserId: actorUserId || 'SYSTEM',
        isAlOnly,
        isNoOp,
        changeType: 'BATCH_UPDATE_SHIFT'
      });
      revisionRows.push({ month: monthKey, revision: approval?.revision ?? null });
    }

    return {
      count: inputAssignments.length + deletedCount,
      months: [...monthsToTouch].sort(),
      revision: revisionRows
    };
  }, { maxWait: 10000, timeout: 60000 });

  return result;
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
  if (!['ADMIN', 'SUPERVISOR'].includes(actorUser.role)) {
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
    throw new HttpError(403, 'Only an Admin or Manager may approve monthly schedules.', { code: 'SCHEDULE_APPROVAL_AUTHORITY_REQUIRED' });
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
      action: 'SCHEDULE_APPROVED',
      approvalAuthority: actorUser.role,
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
    prisma.shiftType.findMany({ where: { isActive: true } })
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
