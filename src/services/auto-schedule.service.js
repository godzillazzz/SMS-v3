'use strict';

const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { validateScheduleRowsOperational } = require('./employee-operational-eligibility.service');
const { licenseStateForWorkDate } = require('./license-state.service');
const {
  canonicalMode,
  canonicalPatternCode,
  listAutoSchedulePatterns,
  normalizePatternSteps,
  patternForTargetGroup
} = require('./auto-schedule-pattern.service');

const DAY_MS = 86400000;
const isoDate = (value) => new Date(value).toISOString().slice(0, 10);

const monthBounds = (month) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw new HttpError(400, 'Month must use YYYY-MM.');
  const [year, number] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1));
  const end = new Date(Date.UTC(year, number, 1));
  const dates = Array.from({ length: Math.round((end - start) / DAY_MS) }, (_, index) => new Date(start.getTime() + index * DAY_MS));
  return { start, end, dates };
};

const displayName = (employee) => employee.displayName || `${employee.firstName} ${employee.lastName}`.trim();

const ruleValue = (rules, id, fallback) => {
  const rule = rules.find((item) => item.ruleId === id && item.enabled);
  return rule ? rule.value : fallback;
};

const truthyRule = (value) => value === true || Number(value) === 1 || String(value).trim().toLowerCase() === 'true';

const isSupervisor = (employee) => {
  const position = String(employee.jobTitle || '').trim().toLowerCase();
  return position === 'supervisor' || position.includes('supervisor') || position.includes('หัวหน้า');
};

const licenseForDate = (records, date) => {
  const state = licenseStateForWorkDate(records, date);
  return { ...state, code: state.status };
};

function runtimePattern(pattern) {
  const mode = canonicalMode(pattern?.mode);
  return {
    ...pattern,
    code: canonicalPatternCode(pattern?.code),
    mode,
    steps: normalizePatternSteps(pattern?.steps, mode)
  };
}

function historyShiftCodes(history, maxLength) {
  return (Array.isArray(history) ? history : [])
    .map((row) => String(row?.shiftType?.code || '').trim().toUpperCase())
    .filter((code) => code && code !== 'AL')
    .slice(0, Math.max(1, maxLength));
}

function getPhaseAnalysis(history, patternInput) {
  if (!patternInput) {
    throw new HttpError(503, 'Auto Schedule Pattern Master is required for phase analysis.', {
      code: 'AUTO_SCHEDULE_PATTERN_MASTER_REQUIRED'
    });
  }
  const pattern = runtimePattern(patternInput);
  if (pattern.mode !== 'CYCLE') {
    return {
      code: 'WEEKLY',
      label: 'ตามวันในสัปดาห์',
      text: `แพทเทิร์น ${pattern.name} กำหนดกะตามวันจันทร์-อาทิตย์ จึงไม่ต้องเลือก Phase`
    };
  }

  const steps = pattern.steps;
  const first = steps[0];
  const codes = historyShiftCodes(history, steps.length);
  if (!codes.length) {
    return {
      code: first.phaseCode,
      label: first.label,
      text: `วิเคราะห์จากประวัติ: เริ่มที่ ${first.label}`
    };
  }

  let bestIndex = -1;
  let bestScore = -1;
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index].shiftCode !== codes[0]) continue;
    let score = 0;
    for (let offset = 0; offset < codes.length; offset += 1) {
      const expected = steps[(index - offset + steps.length) % steps.length].shiftCode;
      if (codes[offset] !== expected) break;
      score += 1;
    }
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  if (bestIndex < 0) {
    return {
      code: first.phaseCode,
      label: first.label,
      text: `วิเคราะห์จากประวัติ: ไม่พบลำดับที่ตรงกับแพทเทิร์น จึงเริ่มที่ ${first.label}`
    };
  }

  const next = steps[(bestIndex + 1) % steps.length];
  return {
    code: next.phaseCode,
    label: next.label,
    text: `วิเคราะห์จากประวัติ: ต่อแพทเทิร์นจาก ${steps[bestIndex].label} → ${next.label}`
  };
}

const suggestedPhase = (history, pattern) => getPhaseAnalysis(history, pattern).code;

function phaseIndexFor(pattern, startPhase, analysis) {
  if (pattern.mode !== 'CYCLE') return 0;
  const phaseCode = String(startPhase === 'AUTO' ? analysis.code : startPhase || '').trim().toUpperCase();
  const index = pattern.steps.findIndex((step) => step.phaseCode === phaseCode);
  if (index < 0) {
    throw new HttpError(400, `Unsupported phase ${phaseCode} for pattern ${pattern.code}.`, {
      code: 'AUTO_SCHEDULE_PHASE_NOT_FOUND',
      patternCode: pattern.code,
      phaseCode
    });
  }
  return index;
}

function weeklyStepForDate(pattern, dateText) {
  const day = new Date(`${dateText}T00:00:00Z`).getUTCDay();
  const mondayFirstIndex = (day + 6) % 7;
  return pattern.steps[mondayFirstIndex];
}

function requireShiftTemplate(shiftTypeMap, shiftCode, patternCode) {
  const template = shiftTypeMap.get(String(shiftCode || '').toUpperCase());
  if (!template) {
    throw new HttpError(409, `Pattern ${patternCode} references inactive or missing Shift Type ${shiftCode}.`, {
      code: 'AUTO_SCHEDULE_PATTERN_SHIFT_TYPE_UNAVAILABLE',
      patternCode,
      shiftCode
    });
  }
  return template;
}

const applyEmployeePattern = ({ rows, history, shiftTypeMap, startPhase = 'AUTO', pattern: patternInput }) => {
  const pattern = runtimePattern(patternInput);
  const analysis = getPhaseAnalysis(history, pattern);
  const phaseIndex = phaseIndexFor(pattern, startPhase, analysis);
  const effectivePhase = pattern.mode === 'CYCLE'
    ? pattern.steps[phaseIndex].phaseCode
    : 'WEEKLY';
  const warnings = [];
  const offType = shiftTypeMap.get('OFF');
  if (!offType) throw new HttpError(409, 'Active OFF Shift Type is required for automatic scheduling.');

  const patternedRows = rows.map((row, index) => {
    const step = pattern.mode === 'WEEKLY'
      ? weeklyStepForDate(pattern, row.date)
      : pattern.steps[(phaseIndex + index) % pattern.steps.length];

    // One shared magic-wand engine is authoritative for this employee/month.
    // Approved leave and an explicit Admin license override remain authoritative evidence.
    if (row.code === 'AL' || row.licenseOverride) {
      return {
        ...row,
        patternCode: pattern.code,
        patternName: pattern.name,
        phaseCode: null
      };
    }

    const targetCode = step.shiftCode;
    let template = requireShiftTemplate(shiftTypeMap, targetCode, pattern.code);
    const intendedTemplate = template;
    const normalRemark = targetCode === 'OFF'
      ? `วันหยุดตามแพทเทิร์น ${pattern.name}`
      : `แพทเทิร์น ${pattern.name}${pattern.mode === 'CYCLE' ? ` (${effectivePhase})` : ''}`;
    const blockedRemark = `แพทเทิร์น ${pattern.name} · ${step.label}`;
    const licenseBlocked = template.code !== 'OFF' && !row.licenseValidForWorkDate;

    if (licenseBlocked) {
      warnings.push(`${row.employeeName}: วันที่ ${row.date} ถูกจัดเป็น ${template.code} ไม่ได้เนื่องจากใบอนุญาตไม่ผ่าน (เปลี่ยนเป็น OFF)`);
      template = offType;
    }

    return {
      ...row,
      shiftTypeId: template.id || row.shiftTypeId,
      code: template.code,
      name: template.name,
      startTime: template.startTime,
      endTime: template.endTime,
      hours: Number(template.hours || 0),
      color: template.color,
      remark: licenseBlocked ? 'License Block: ใบอนุญาตไม่ผ่าน' : normalRemark,
      source: 'AUTO',
      locked: false,
      patternCode: pattern.code,
      patternName: pattern.name,
      phaseCode: step.phaseCode,
      licenseStatus: licenseBlocked ? row.licenseStateForWorkDate : (template.code === 'OFF' ? 'NOT_REQUIRED' : 'VALID'),
      licenseOverride: false,
      overrideReason: '',
      licenseBlockedFromShiftTypeId: licenseBlocked ? intendedTemplate.id : null,
      licenseBlockedFromRemark: licenseBlocked ? blockedRemark : null,
      licenseBlockedAt: licenseBlocked ? new Date().toISOString() : null
    };
  });

  return {
    rows: patternedRows,
    warnings: [...new Set(warnings)],
    analysis,
    pattern,
    patternType: pattern.code,
    effectivePhase,
    phaseOptions: pattern.mode === 'CYCLE' ? pattern.steps.map((step) => ({ ...step })) : []
  };
};

async function buildAutoSchedulePlan(client, month) {
  const { start, end, dates } = monthBounds(month);
  const historyStart = new Date(start.getTime() - 366 * DAY_MS);
  const [rules, allEmployees, shiftTypes, currentShifts, historyRows, licenses, patternRows] = await Promise.all([
    client.schedulingRule.findMany({ select: { ruleId: true, value: true, enabled: true } }),
    client.employee.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true, jobTitle: true }, orderBy: { employeeCode: 'asc' } }),
    client.shiftType.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, color: true } }),
    client.shiftAssignment.findMany({ where: { workDate: { gte: start, lt: end } }, include: { shiftType: { select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, color: true } } } }),
    client.shiftAssignment.findMany({ where: { workDate: { gte: historyStart, lt: start } }, orderBy: { workDate: 'desc' }, include: { shiftType: { select: { code: true } } } }),
    client.employeeLicense.findMany({ select: { employeeId: true, issueDate: true, expiryDate: true, status: true } }),
    listAutoSchedulePatterns(client, { includeInactive: false })
  ]);

  const patterns = patternRows.map(runtimePattern);
  const supervisorPattern = patternForTargetGroup(patterns, 'SUPERVISOR');
  const generalPattern = patternForTargetGroup(patterns, 'GENERAL');
  const excludeSpare = truthyRule(ruleValue(rules, 'RULE009', false));
  const employees = allEmployees.filter((employee) => !(excludeSpare && String(employee.department || '').trim().toLowerCase() === 'spare'));
  if (!employees.length) throw new HttpError(400, 'No active eligible employees were found.');

  const shifts = new Map(shiftTypes.map((shift) => [String(shift.code).toUpperCase(), shift]));
  for (const code of ['D', 'N', 'OFF']) if (!shifts.has(code)) throw new HttpError(409, `Shift Types must contain ${code}.`);

  const maxWeeklyHours = Number(ruleValue(rules, 'RULE001', 72)) || 72;
  const dayMinimum = Math.max(0, Number(ruleValue(rules, 'RULE003', 0)) || 0);
  const nightMinimum = Math.max(0, Number(ruleValue(rules, 'RULE004', 0)) || 0);
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const existing = new Map(
    currentShifts
      .filter((row) => employeeIds.has(row.employeeId) && (String(row.shiftType.code).toUpperCase() === 'AL' || row.licenseOverride))
      .map((row) => [`${row.employeeId}|${isoDate(row.workDate)}`, row])
  );
  const histories = new Map();
  historyRows.forEach((row) => {
    const list = histories.get(row.employeeId) || [];
    list.push(row);
    histories.set(row.employeeId, list);
  });
  const licensesByEmployee = new Map();
  licenses.forEach((license) => {
    const list = licensesByEmployee.get(license.employeeId) || [];
    list.push(license);
    licensesByEmployee.set(license.employeeId, list);
  });

  const makeBaseRow = (employee, date) => {
    const dateText = isoDate(date);
    const preserved = existing.get(`${employee.id}|${dateText}`);
    const license = licenseForDate(licensesByEmployee.get(employee.id) || [], date);
    const shift = preserved?.shiftType || shifts.get('OFF');
    const hours = Number(shift.hours || 0);
    const allowedOverride = Boolean(preserved?.licenseOverride);
    return {
      date: dateText,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: displayName(employee),
      department: employee.department,
      shiftTypeId: shift.id,
      code: String(shift.code).toUpperCase(),
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      hours,
      color: shift.color,
      remark: String(preserved?.remark || ''),
      source: preserved?.source || 'AUTO',
      locked: Boolean(preserved),
      licenseStatus: allowedOverride ? 'OVERRIDDEN' : (preserved?.licenseStatus || (hours === 0 ? 'NOT_REQUIRED' : license.code)),
      licenseExpiryDate: license.expiryDate ? isoDate(license.expiryDate) : null,
      licenseOverride: allowedOverride,
      overrideReason: allowedOverride ? String(preserved?.overrideReason || '') : '',
      licenseValidForWorkDate: license.valid,
      licenseStateForWorkDate: license.code,
      licenseBlockedFromShiftTypeId: preserved?.licenseBlockedFromShiftTypeId || null,
      licenseBlockedFromRemark: preserved?.licenseBlockedFromRemark || null,
      licenseBlockedAt: preserved?.licenseBlockedAt || null
    };
  };

  const rows = [];
  const warnings = [];
  for (const employee of employees) {
    const baseRows = dates.map((date) => makeBaseRow(employee, date));
    const pattern = isSupervisor(employee) ? supervisorPattern : generalPattern;
    const applied = applyEmployeePattern({
      rows: baseRows,
      history: histories.get(employee.id) || [],
      shiftTypeMap: shifts,
      startPhase: 'AUTO',
      pattern
    });
    rows.push(...applied.rows);
    warnings.push(...applied.warnings);
  }

  rows.sort((first, second) => first.date.localeCompare(second.date) || first.employeeCode.localeCompare(second.employeeCode));
  const counts = rows.reduce((result, row) => ({ ...result, [row.code]: (result[row.code] || 0) + 1 }), {});
  const patternsUsed = [...new Map(
    rows
      .filter((row) => row.patternCode)
      .map((row) => [row.patternCode, { code: row.patternCode, name: row.patternName }])
  ).values()];

  return {
    month,
    startDate: isoDate(start),
    endDate: isoDate(new Date(end.getTime() - DAY_MS)),
    dates: dates.map(isoDate),
    rows,
    patterns: patterns.map((pattern) => ({
      id: pattern.id,
      code: pattern.code,
      name: pattern.name,
      mode: pattern.mode,
      steps: pattern.steps,
      isActive: pattern.isActive,
      isSystem: pattern.isSystem,
      targetGroup: pattern.targetGroup,
      sortOrder: pattern.sortOrder
    })),
    warnings: [...new Set(warnings)],
    summary: {
      employees: employees.length,
      days: dates.length,
      totalRows: rows.length,
      manualLocked: rows.filter((row) => row.locked).length,
      counts,
      maxWeeklyHours,
      dayMinimum,
      nightMinimum,
      patternsUsed
    }
  };
}

async function buildEmployeeAutoSchedulePlan(client, month, employeeId, startPhase = 'AUTO', patternType = 'AUTO') {
  const plan = await buildAutoSchedulePlan(client, month);
  const rows = plan.rows.filter((row) => row.employeeId === employeeId);
  if (!rows.length) throw new HttpError(404, 'Eligible employee was not found for automatic scheduling.');

  const requestedPatternCode = String(patternType || 'AUTO').trim().toUpperCase() === 'AUTO'
    ? String(rows.find((row) => row.patternCode)?.patternCode || '').toUpperCase()
    : canonicalPatternCode(patternType);
  const pattern = plan.patterns.find((item) => item.code === requestedPatternCode);
  if (!pattern) {
    throw new HttpError(404, 'Active Auto Schedule pattern was not found.', {
      code: 'AUTO_SCHEDULE_PATTERN_NOT_FOUND',
      patternCode: requestedPatternCode
    });
  }

  const { start } = monthBounds(month);
  const historyStart = new Date(start.getTime() - 366 * DAY_MS);
  const [history, allShiftTypes] = await Promise.all([
    client.shiftAssignment.findMany({
      where: { employeeId, workDate: { gte: historyStart, lt: start } },
      orderBy: { workDate: 'desc' },
      include: { shiftType: { select: { code: true } } }
    }),
    client.shiftType.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, color: true } })
  ]);
  const shiftTypeMap = new Map(allShiftTypes.map((shift) => [String(shift.code).toUpperCase(), shift]));
  const applied = applyEmployeePattern({ rows, history, shiftTypeMap, startPhase, pattern });

  return {
    ...plan,
    analysis: applied.analysis,
    pattern: applied.pattern,
    phaseOptions: applied.phaseOptions,
    effectivePhase: applied.effectivePhase,
    rows: applied.rows,
    warnings: applied.warnings,
    summary: {
      ...plan.summary,
      employees: 1,
      totalRows: applied.rows.length,
      manualLocked: applied.rows.filter((row) => row.locked).length,
      patternsUsed: [{ code: applied.pattern.code, name: applied.pattern.name }]
    }
  };
}

async function commitAutoSchedule(prisma, month, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const plan = await buildAutoSchedulePlan(tx, month);
    const employeeIds = [...new Set(plan.rows.map((row) => row.employeeId))];
    const al = await tx.shiftType.findUniqueOrThrow({ where: { code: 'AL' }, select: { id: true } });
    const { start, end } = monthBounds(month);
    const generated = plan.rows.filter((row) => !row.locked);
    await validateScheduleRowsOperational(tx, generated.map((row) => ({
      employeeId: row.employeeId,
      workDate: new Date(`${row.date}T00:00:00Z`),
      code: row.code
    })));
    const deleted = await tx.shiftAssignment.deleteMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: { gte: start, lt: end },
        locked: false,
        shiftTypeId: { not: al.id }
      }
    });
    if (generated.length) {
      await tx.shiftAssignment.createMany({
        data: generated.map((row) => ({
          employeeId: row.employeeId,
          shiftTypeId: row.shiftTypeId,
          workDate: new Date(`${row.date}T00:00:00Z`),
          employeeNameSnapshot: row.employeeName,
          departmentSnapshot: row.department,
          startTime: row.startTime,
          endTime: row.endTime,
          hours: row.hours,
          remark: row.remark,
          source: 'AUTO',
          locked: false,
          updatedByLegacyRef: actorUserId,
          licenseStatus: row.licenseStatus,
          licenseExpiryDate: row.licenseExpiryDate ? new Date(`${row.licenseExpiryDate}T00:00:00Z`) : null,
          licenseOverride: false,
          licenseBlockedFromShiftTypeId: row.licenseBlockedFromShiftTypeId,
          licenseBlockedFromRemark: row.licenseBlockedFromRemark,
          licenseBlockedAt: row.licenseBlockedAt ? new Date(row.licenseBlockedAt) : null
        }))
      });
    }
    const latest = await tx.scheduleApproval.findFirst({ where: { month: start }, orderBy: { revision: 'desc' }, select: { revision: true } });
    const approval = await tx.scheduleApproval.create({
      data: {
        month: start,
        status: 'PENDING',
        revision: (latest?.revision || 0) + 1,
        changedByLegacyRef: actorUserId,
        changedAt: new Date(),
        changeType: 'AUTO_SCHEDULE'
      }
    });
    await audit.log({
      actorUserId,
      action: 'CREATE',
      entityType: 'AutoSchedule',
      entityId: month,
      metadata: {
        generatedRows: generated.length,
        replacedRows: deleted.count,
        preservedRows: plan.summary.manualLocked,
        revision: approval.revision,
        warningCount: plan.warnings.length,
        patternsUsed: plan.summary.patternsUsed
      }
    }, tx);
    return {
      writtenRows: generated.length,
      replacedRows: deleted.count,
      preservedRows: plan.summary.manualLocked,
      warnings: plan.warnings,
      startDate: plan.startDate,
      endDate: plan.endDate,
      approval: { id: approval.id, status: approval.status, revision: approval.revision }
    };
  }, { timeout: 15000 });
}

async function commitEmployeeAutoSchedule(prisma, month, employeeId, actorUserId, startPhase = 'AUTO', patternType = 'AUTO') {
  return prisma.$transaction(async (tx) => {
    const plan = await buildEmployeeAutoSchedulePlan(tx, month, employeeId, startPhase, patternType);
    const al = await tx.shiftType.findUniqueOrThrow({ where: { code: 'AL' }, select: { id: true } });
    const { start, end } = monthBounds(month);
    const generated = plan.rows.filter((row) => !row.locked);
    await validateScheduleRowsOperational(tx, generated.map((row) => ({
      employeeId: row.employeeId,
      workDate: new Date(`${row.date}T00:00:00Z`),
      code: row.code
    })));
    const deleted = await tx.shiftAssignment.deleteMany({
      where: {
        employeeId,
        workDate: { gte: start, lt: end },
        shiftTypeId: { not: al.id },
        licenseOverride: false
      }
    });
    if (generated.length) {
      await tx.shiftAssignment.createMany({
        data: generated.map((row) => ({
          employeeId: row.employeeId,
          shiftTypeId: row.shiftTypeId,
          workDate: new Date(`${row.date}T00:00:00Z`),
          employeeNameSnapshot: row.employeeName,
          departmentSnapshot: row.department,
          startTime: row.startTime,
          endTime: row.endTime,
          hours: row.hours,
          remark: row.remark,
          source: 'AUTO',
          locked: false,
          updatedByLegacyRef: actorUserId,
          licenseStatus: row.licenseStatus,
          licenseExpiryDate: row.licenseExpiryDate ? new Date(`${row.licenseExpiryDate}T00:00:00Z`) : null,
          licenseOverride: false,
          licenseBlockedFromShiftTypeId: row.licenseBlockedFromShiftTypeId,
          licenseBlockedFromRemark: row.licenseBlockedFromRemark,
          licenseBlockedAt: row.licenseBlockedAt ? new Date(row.licenseBlockedAt) : null
        }))
      });
    }
    const latest = await tx.scheduleApproval.findFirst({ where: { month: start }, orderBy: { revision: 'desc' }, select: { revision: true } });
    const approval = await tx.scheduleApproval.create({
      data: {
        month: start,
        status: 'PENDING',
        revision: (latest?.revision || 0) + 1,
        changedByLegacyRef: actorUserId,
        changedAt: new Date(),
        changeType: 'AUTO_SCHEDULE_EMPLOYEE'
      }
    });
    await audit.log({
      actorUserId,
      action: 'CREATE',
      entityType: 'EmployeeAutoSchedule',
      entityId: `${month}:${employeeId}`,
      metadata: {
        month,
        startPhase: plan.effectivePhase,
        patternType: plan.pattern?.code || patternType,
        patternName: plan.pattern?.name,
        generatedRows: generated.length,
        replacedRows: deleted.count,
        preservedRows: plan.summary.manualLocked,
        revision: approval.revision,
        warningCount: plan.warnings.length
      }
    }, tx);
    return {
      writtenRows: generated.length,
      replacedRows: deleted.count,
      preservedRows: plan.summary.manualLocked,
      warnings: plan.warnings,
      startDate: plan.startDate,
      endDate: plan.endDate,
      approval: { id: approval.id, status: approval.status, revision: approval.revision }
    };
  }, { timeout: 15000 });
}

module.exports = {
  applyEmployeePattern,
  buildAutoSchedulePlan,
  buildEmployeeAutoSchedulePlan,
  commitAutoSchedule,
  commitEmployeeAutoSchedule,
  getPhaseAnalysis,
  monthBounds,
  suggestedPhase
};
