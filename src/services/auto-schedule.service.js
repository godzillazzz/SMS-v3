const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { validateScheduleRowsOperational } = require('./employee-operational-eligibility.service');
const { isoWeek } = require('./schedule-rules.service');
const { licenseStateForWorkDate } = require('./license-state.service');

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
const suggestedPhase = (history) => {
  if (!history.length) return 'D1';
  const lastCode = String(history[0].shiftType.code || '').toUpperCase();
  if (lastCode === 'OFF') {
    const previousWorked = history.slice(1).find((item) => !['OFF', 'AL'].includes(String(item.shiftType.code).toUpperCase()));
    return String(previousWorked?.shiftType.code || 'N').toUpperCase() === 'D' ? 'N1' : 'D1';
  }
  if (['D', 'N'].includes(lastCode)) {
    let consecutive = 0;
    for (const row of history) {
      if (String(row.shiftType.code).toUpperCase() !== lastCode) break;
      consecutive += 1;
    }
    consecutive = Math.min(6, consecutive);
    return consecutive < 6 ? `${lastCode}${consecutive + 1}` : (lastCode === 'D' ? 'OFF-D' : 'OFF-N');
  }
  return 'D1';
};

async function buildAutoSchedulePlan(client, month) {
  const { start, end, dates } = monthBounds(month);
  const historyStart = new Date(start.getTime() - 14 * DAY_MS);
  const [rules, allEmployees, shiftTypes, currentShifts, historyRows, licenses] = await Promise.all([
    client.schedulingRule.findMany({ select: { ruleId: true, value: true, enabled: true } }),
    client.employee.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true, jobTitle: true }, orderBy: { employeeCode: 'asc' } }),
    client.shiftType.findMany({ select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, color: true } }),
    client.shiftAssignment.findMany({ where: { workDate: { gte: start, lt: end } }, include: { shiftType: { select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, color: true } } } }),
    client.shiftAssignment.findMany({ where: { workDate: { gte: historyStart, lt: start } }, orderBy: { workDate: 'desc' }, include: { shiftType: { select: { code: true } } } }),
    client.employeeLicense.findMany({ select: { employeeId: true, issueDate: true, expiryDate: true, status: true } })
  ]);
  const excludeSpare = truthyRule(ruleValue(rules, 'RULE009', false));
  const employees = allEmployees.filter((employee) => !(excludeSpare && String(employee.department || '').trim().toLowerCase() === 'spare'));
  if (!employees.length) throw new HttpError(400, 'No active eligible employees were found.');
  const shifts = new Map(shiftTypes.map((shift) => [String(shift.code).toUpperCase(), shift]));
  for (const code of ['D', 'N', 'OFF']) if (!shifts.has(code)) throw new HttpError(409, `Shift Types must contain ${code}.`);

  const maxWeeklyHours = Number(ruleValue(rules, 'RULE001', 72)) || 72;
  const dayMinimum = Math.max(0, Number(ruleValue(rules, 'RULE003', 0)) || 0);
  const nightMinimum = Math.max(0, Number(ruleValue(rules, 'RULE004', 0)) || 0);
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const existing = new Map(currentShifts.filter((row) => employeeIds.has(row.employeeId) && (String(row.shiftType.code).toUpperCase() === 'AL' || row.licenseOverride)).map((row) => [`${row.employeeId}|${isoDate(row.workDate)}`, row]));
  const previousMonthLastDate = isoDate(new Date(start.getTime() - DAY_MS));
  const histories = new Map();
  historyRows.forEach((row) => { const list = histories.get(row.employeeId) || []; if (list.length < 14) list.push(row); histories.set(row.employeeId, list); });
  const licensesByEmployee = new Map();
  licenses.forEach((license) => { const list = licensesByEmployee.get(license.employeeId) || []; list.push(license); licensesByEmployee.set(license.employeeId, list); });

  const continuityWarnings = [];
  const weeklyHours = new Map();
  const planned = new Map();
  const licenseBlocked = new Map();
  const assign = (employee, date, shift, { source = 'AUTO', locked = false, remark = '', existingRow, licenseStatus, overrideReason, licenseBlockedFromShiftTypeId, licenseBlockedFromRemark, licenseBlockedAt } = {}) => {
    const dateText = isoDate(date); const key = `${employee.id}|${dateText}`;
    if (planned.has(key)) return false;
    const hours = Number(shift.hours || 0);
    const license = licenseForDate(licensesByEmployee.get(employee.id) || [], date);
    const allowedOverride = Boolean(locked && existingRow?.licenseOverride);
    if (hours > 0 && !license.valid && locked) licenseBlocked.set(key, license);
    if (hours > 0 && !license.valid && !locked) { licenseBlocked.set(key, license); return false; }
    const weekKey = `${employee.id}|${isoWeek(date)}`;
    const weekHours = weeklyHours.get(weekKey) || 0;
    if (!locked && hours > 0 && weekHours + hours > maxWeeklyHours) return false;
    planned.set(key, {
      date: dateText, employeeId: employee.id, employeeCode: employee.employeeCode, employeeName: displayName(employee), department: employee.department,
      shiftTypeId: shift.id, code: String(shift.code).toUpperCase(), name: shift.name, startTime: shift.startTime, endTime: shift.endTime,
      hours, color: shift.color, remark, source, locked, licenseStatus: allowedOverride ? 'OVERRIDDEN' : (licenseStatus || (hours === 0 ? 'NOT_REQUIRED' : license.code)),
      licenseExpiryDate: license.expiryDate ? isoDate(license.expiryDate) : null, licenseOverride: allowedOverride, overrideReason: allowedOverride ? String(overrideReason || existingRow?.overrideReason || '') : '',
      licenseValidForWorkDate: license.valid, licenseStateForWorkDate: license.code,
      licenseBlockedFromShiftTypeId: licenseBlockedFromShiftTypeId || null, licenseBlockedFromRemark: licenseBlockedFromRemark || null, licenseBlockedAt: licenseBlockedAt || null
    });
    weeklyHours.set(weekKey, weekHours + hours);
    return true;
  };

  employees.forEach((employee) => dates.forEach((date) => {
    const row = existing.get(`${employee.id}|${isoDate(date)}`);
    if (row) assign(employee, date, row.shiftType, {
      source: row.source || 'MANUAL', locked: true, remark: row.remark || '', existingRow: row,
      licenseStatus: row.licenseStatus, overrideReason: row.overrideReason, licenseBlockedFromShiftTypeId: row.licenseBlockedFromShiftTypeId,
      licenseBlockedFromRemark: row.licenseBlockedFromRemark, licenseBlockedAt: row.licenseBlockedAt
    });
  }));

  employees.forEach((employee) => {
    const supervisor = isSupervisor(employee);
    const employeeHistory = histories.get(employee.id) || [];
    const anchoredHistory = employeeHistory.length && isoDate(employeeHistory[0].workDate) === previousMonthLastDate ? employeeHistory : [];
    if (!supervisor && !anchoredHistory.length) continuityWarnings.push(`${displayName(employee)}: ไม่พบกะในวันสุดท้ายของเดือนก่อน ใช้ D1 เป็นจุดเริ่มต้น`);
    const phaseCode = suggestedPhase(anchoredHistory);
    const empCycle = ['D', 'D', 'D', 'D', 'D', 'D', 'OFF', 'N', 'N', 'N', 'N', 'N', 'N', 'OFF'];
    const phaseOffsetMap = { D1: 0, D2: 1, D3: 2, D4: 3, D5: 4, D6: 5, 'OFF-D': 6, N1: 7, N2: 8, N3: 9, N4: 10, N5: 11, N6: 12, 'OFF-N': 13 };
    let cycleIndex = supervisor ? 0 : (phaseOffsetMap[phaseCode] ?? 0);
    dates.forEach((date) => {
      const key = `${employee.id}|${isoDate(date)}`;
      if (planned.has(key)) { if (!supervisor) cycleIndex += 1; return; }
      const code = supervisor ? (date.getUTCDay() === 0 ? 'OFF' : 'D') : empCycle[cycleIndex % empCycle.length];
      const license = licenseForDate(licensesByEmployee.get(employee.id) || [], date);
      if (code !== 'OFF' && !license.valid) {
        licenseBlocked.set(key, license);
        assign(employee, date, shifts.get('OFF'), { remark: 'License Block', licenseStatus: license.code, licenseBlockedFromShiftTypeId: shifts.get(code).id, licenseBlockedFromRemark: supervisor ? 'Auto Supervisor Pattern' : `Auto Rotating Pattern (${phaseCode})`, licenseBlockedAt: new Date().toISOString() });
        if (!supervisor) cycleIndex += 1;
        return;
      }
      const assigned = assign(employee, date, shifts.get(code), { remark: supervisor ? 'Auto Supervisor Pattern' : `Auto Rotating Pattern (${phaseCode})` });
      if (!assigned) assign(employee, date, shifts.get('OFF'), { remark: 'Weekly hour limit' });
      if (!supervisor) cycleIndex += 1;
    });
  });

  const rows = [...planned.values()].sort((first, second) => first.date.localeCompare(second.date) || first.employeeCode.localeCompare(second.employeeCode));
  const counts = rows.reduce((result, row) => ({ ...result, [row.code]: (result[row.code] || 0) + 1 }), {});
  const blockedCounts = {};
  licenseBlocked.forEach((_value, key) => { const employeeId = key.split('|')[0]; blockedCounts[employeeId] = (blockedCounts[employeeId] || 0) + 1; });
  const warnings = [...continuityWarnings, ...Object.entries(blockedCounts).map(([employeeId, count]) => `${displayName(employees.find((item) => item.id === employeeId) || { firstName: employeeId, lastName: '' })}: ถูกป้องกันกะทำงาน ${count} วัน เนื่องจากใบอนุญาตไม่ผ่าน`)];
  return { month, startDate: isoDate(start), endDate: isoDate(new Date(end.getTime() - DAY_MS)), dates: dates.map(isoDate), rows, warnings, summary: { employees: employees.length, days: dates.length, totalRows: rows.length, manualLocked: rows.filter((row) => row.locked).length, counts, maxWeeklyHours, dayMinimum, nightMinimum } };
}

const employeePhaseIndexes = { D1: 0, D2: 1, D3: 2, D4: 3, D5: 4, D6: 5, 'OFF-D': 6, N1: 7, N2: 8, N3: 9, N4: 10, N5: 11, N6: 12, 'OFF-N': 13 };
const employeeCycle = ['D', 'D', 'D', 'D', 'D', 'D', 'OFF', 'N', 'N', 'N', 'N', 'N', 'N', 'OFF'];

const getPhaseAnalysis = (history) => {
  if (!history || !history.length) return { code: 'D1', label: 'กะเช้า วันที่ 1 (D1)', text: 'วิเคราะห์จากประวัติ: เริ่มกะเช้าวันที่ 1 (D1)' };
  const lastCode = String(history[0].shiftType?.code || '').toUpperCase();
  if (lastCode === 'OFF') {
    const previousWorked = history.slice(1).find((item) => !['OFF', 'AL'].includes(String(item.shiftType?.code).toUpperCase()));
    const nextCode = String(previousWorked?.shiftType?.code || 'N').toUpperCase() === 'D' ? 'N1' : 'D1';
    const shiftName = nextCode === 'N1' ? 'กะดึก' : 'กะเช้า';
    return { code: nextCode, label: `${shiftName} วันที่ 1 (${nextCode})`, text: `วิเคราะห์จากประวัติ: ล่าสุดหยุดกะ -> เริ่ม${shiftName}วันที่ 1 (${nextCode})` };
  }
  if (['D', 'N'].includes(lastCode)) {
    let consecutive = 0;
    for (const row of history) {
      if (String(row.shiftType?.code).toUpperCase() !== lastCode) break;
      consecutive += 1;
    }
    consecutive = Math.min(6, consecutive);
    const shiftName = lastCode === 'D' ? 'กะเช้า' : 'กะดึก';
    if (consecutive < 6) {
      const code = `${lastCode}${consecutive + 1}`;
      const label = `${shiftName} วันที่ ${consecutive + 1} (${code})`;
      const text = `วิเคราะห์จากประวัติ: ล่าสุดทำ${shiftName}ติดต่อกัน ${consecutive} วัน -> เริ่ม${shiftName}วันที่ ${consecutive + 1} (${code})`;
      return { code, label, text };
    }
    const code = lastCode === 'D' ? 'OFF-D' : 'OFF-N';
    return { code, label: 'วันหยุด (OFF)', text: `วิเคราะห์จากประวัติ: ล่าสุดทำ${shiftName}ติดต่อกัน 6 วัน -> เริ่มวันหยุด (OFF)` };
  }
  return { code: 'D1', label: 'กะเช้า วันที่ 1 (D1)', text: 'วิเคราะห์จากประวัติ: เริ่มกะเช้าวันที่ 1 (D1)' };
};

async function buildEmployeeAutoSchedulePlan(client, month, employeeId, startPhase = 'AUTO', patternType = 'AUTO') {
  const plan = await buildAutoSchedulePlan(client, month);
  let rows = plan.rows.filter((row) => row.employeeId === employeeId);
  if (!rows.length) throw new HttpError(404, 'Eligible employee was not found for automatic scheduling.');

  const { start } = monthBounds(month);
  const historyStart = new Date(start.getTime() - 14 * DAY_MS);
  const [history, allShiftTypes] = await Promise.all([
    client.shiftAssignment.findMany({
      where: { employeeId, workDate: { gte: historyStart, lt: start } },
      orderBy: { workDate: 'desc' },
      include: { shiftType: { select: { code: true } } }
    }),
    client.shiftType.findMany({ select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, color: true } })
  ]);
  const shiftTypeMap = new Map(allShiftTypes.map((st) => [String(st.code).toUpperCase(), st]));
  const previousMonthLastDate = isoDate(new Date(start.getTime() - DAY_MS));
  const continuityHistory = history.length && isoDate(history[0].workDate) === previousMonthLastDate ? history : [];
  const analysis = getPhaseAnalysis(continuityHistory);

  const customWarnings = [];
  const offType = shiftTypeMap.get('OFF') || { id: '', code: 'OFF', name: 'วันหยุด', startTime: '00:00', endTime: '00:00', hours: 0, color: '#64748b' };
  const dType = shiftTypeMap.get('D') || { id: '', code: 'D', name: 'กะเช้า', startTime: '07:00', endTime: '19:00', hours: 12, color: '#2563eb' };

  if (patternType === 'SUPERVISOR') {
    rows = rows.map((row) => {
      // A new magic-wand action is authoritative for this employee/month.
      // Only approved leave and an explicit Admin license override survive it.
      if (row.code === 'AL' || row.licenseOverride) return row;
      const dateValue = new Date(`${row.date}T00:00:00Z`);
      const isSunday = dateValue.getUTCDay() === 0;
      let template = isSunday ? offType : dType;

      const licenseBlocked = template.code !== 'OFF' && !row.licenseValidForWorkDate;
      if (licenseBlocked) {
        customWarnings.push(`${row.employeeName}: วันที่ ${row.date} ไม่ถูกจัดกะ ${template.code} เนื่องจากใบอนุญาตไม่ผ่าน (เปลี่ยนเป็น OFF)`);
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
        remark: licenseBlocked ? 'License Block: ใบอนุญาตไม่ผ่าน' : (template.code === 'OFF' ? 'Weekly off' : 'Supervisor Pattern (Mon-Sat D, Sun OFF)'),
        source: 'AUTO', locked: false, licenseStatus: licenseBlocked ? row.licenseStateForWorkDate : (template.code === 'OFF' ? 'NOT_REQUIRED' : 'VALID'),
        licenseOverride: false, licenseBlockedFromShiftTypeId: licenseBlocked ? (shiftTypeMap.get('D') || dType).id : null,
        licenseBlockedFromRemark: licenseBlocked ? 'Supervisor Pattern (Mon-Sat D, Sun OFF)' : null,
        licenseBlockedAt: licenseBlocked ? new Date().toISOString() : null
      };
    });
  } else {
    const effectivePhase = startPhase === 'AUTO' ? (analysis.code || 'D1') : startPhase;
    const targetCycle = ['D', 'D', 'D', 'D', 'D', 'D', 'OFF', 'N', 'N', 'N', 'N', 'N', 'N', 'OFF'];
    const phaseOffsetMap = { D1: 0, D2: 1, D3: 2, D4: 3, D5: 4, D6: 5, 'OFF-D': 6, N1: 7, N2: 8, N3: 9, N4: 10, N5: 11, N6: 12, 'OFF-N': 13 };
    const phaseIndex = phaseOffsetMap[effectivePhase] ?? 0;

    rows = rows.map((row, index) => {
      // A new magic-wand action is authoritative for this employee/month.
      // Only approved leave and an explicit Admin license override survive it.
      if (row.code === 'AL' || row.licenseOverride) return row;
      const targetCode = targetCycle[(phaseIndex + index) % targetCycle.length];
      let template = shiftTypeMap.get(targetCode) || offType;

      const licenseBlocked = template.code !== 'OFF' && !row.licenseValidForWorkDate;
      if (licenseBlocked) {
        customWarnings.push(`${row.employeeName}: วันที่ ${row.date} ไม่ถูกจัดกะ ${template.code} เนื่องจากใบอนุญาตไม่ผ่าน (เปลี่ยนเป็น OFF)`);
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
        remark: licenseBlocked ? 'License Block: ใบอนุญาตไม่ผ่าน' : (template.code === 'OFF' ? 'Weekly off' : `Auto rotating pattern (${effectivePhase})`),
        source: 'AUTO', locked: false, licenseStatus: licenseBlocked ? row.licenseStateForWorkDate : (template.code === 'OFF' ? 'NOT_REQUIRED' : 'VALID'),
        licenseOverride: false, licenseBlockedFromShiftTypeId: licenseBlocked ? (shiftTypeMap.get(targetCode) || template).id : null,
        licenseBlockedFromRemark: licenseBlocked ? `Auto rotating pattern (${effectivePhase})` : null,
        licenseBlockedAt: licenseBlocked ? new Date().toISOString() : null
      };
    });
  }

  const allWarnings = [...new Set([...plan.warnings.filter((warning) => warning.includes(rows[0]?.employeeName || '')), ...customWarnings])];

  return {
    ...plan,
    analysis,
    rows,
    warnings: allWarnings,
    summary: { ...plan.summary, employees: 1, totalRows: rows.length, manualLocked: rows.filter((row) => row.locked).length }
  };
}

async function commitAutoSchedule(prisma, month, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const plan = await buildAutoSchedulePlan(tx, month);
    const employeeIds = [...new Set(plan.rows.map((row) => row.employeeId))];
    const al = await tx.shiftType.findUniqueOrThrow({ where: { code: 'AL' }, select: { id: true } });
    const { start, end } = monthBounds(month);
    const generated = plan.rows.filter((row) => !row.locked);
    await validateScheduleRowsOperational(tx, generated.map((row) => ({ employeeId: row.employeeId, workDate: new Date(`${row.date}T00:00:00Z`), code: row.code })));
    const deleted = await tx.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds }, workDate: { gte: start, lt: end }, locked: false, shiftTypeId: { not: al.id } } });
    if (generated.length) await tx.shiftAssignment.createMany({ data: generated.map((row) => ({
      employeeId: row.employeeId, shiftTypeId: row.shiftTypeId, workDate: new Date(`${row.date}T00:00:00Z`), employeeNameSnapshot: row.employeeName,
      departmentSnapshot: row.department, startTime: row.startTime, endTime: row.endTime, hours: row.hours, remark: row.remark, source: 'AUTO', locked: false,
      updatedByLegacyRef: actorUserId, licenseStatus: row.licenseStatus, licenseExpiryDate: row.licenseExpiryDate ? new Date(`${row.licenseExpiryDate}T00:00:00Z`) : null, licenseOverride: false,
      licenseBlockedFromShiftTypeId: row.licenseBlockedFromShiftTypeId, licenseBlockedFromRemark: row.licenseBlockedFromRemark, licenseBlockedAt: row.licenseBlockedAt ? new Date(row.licenseBlockedAt) : null
    })) });
    const latest = await tx.scheduleApproval.findFirst({ where: { month: start }, orderBy: { revision: 'desc' }, select: { revision: true } });
    const approval = await tx.scheduleApproval.create({ data: { month: start, status: 'PENDING', revision: (latest?.revision || 0) + 1, changedByLegacyRef: actorUserId, changedAt: new Date(), changeType: 'AUTO_SCHEDULE' } });
    await audit.log({ actorUserId, action: 'CREATE', entityType: 'AutoSchedule', entityId: month, metadata: { generatedRows: generated.length, replacedRows: deleted.count, preservedRows: plan.summary.manualLocked, revision: approval.revision, warningCount: plan.warnings.length } }, tx);
    return { writtenRows: generated.length, replacedRows: deleted.count, preservedRows: plan.summary.manualLocked, warnings: plan.warnings, startDate: plan.startDate, endDate: plan.endDate, approval: { id: approval.id, status: approval.status, revision: approval.revision } };
  }, { timeout: 15000 });
}

async function commitEmployeeAutoSchedule(prisma, month, employeeId, actorUserId, startPhase = 'AUTO', patternType = 'AUTO') {
  return prisma.$transaction(async (tx) => {
    const plan = await buildEmployeeAutoSchedulePlan(tx, month, employeeId, startPhase, patternType);
    const al = await tx.shiftType.findUniqueOrThrow({ where: { code: 'AL' }, select: { id: true } });
    const { start, end } = monthBounds(month);
    const generated = plan.rows.filter((row) => !row.locked);
    await validateScheduleRowsOperational(tx, generated.map((row) => ({ employeeId: row.employeeId, workDate: new Date(`${row.date}T00:00:00Z`), code: row.code })));
    const deleted = await tx.shiftAssignment.deleteMany({
      where: {
        employeeId, workDate: { gte: start, lt: end }, shiftTypeId: { not: al.id },
        licenseOverride: false
      }
    });
    if (generated.length) await tx.shiftAssignment.createMany({ data: generated.map((row) => ({
      employeeId: row.employeeId, shiftTypeId: row.shiftTypeId, workDate: new Date(`${row.date}T00:00:00Z`), employeeNameSnapshot: row.employeeName,
      departmentSnapshot: row.department, startTime: row.startTime, endTime: row.endTime, hours: row.hours, remark: row.remark, source: 'AUTO', locked: false,
      updatedByLegacyRef: actorUserId, licenseStatus: row.licenseStatus, licenseExpiryDate: row.licenseExpiryDate ? new Date(`${row.licenseExpiryDate}T00:00:00Z`) : null, licenseOverride: false,
      licenseBlockedFromShiftTypeId: row.licenseBlockedFromShiftTypeId, licenseBlockedFromRemark: row.licenseBlockedFromRemark, licenseBlockedAt: row.licenseBlockedAt ? new Date(row.licenseBlockedAt) : null
    })) });
    const latest = await tx.scheduleApproval.findFirst({ where: { month: start }, orderBy: { revision: 'desc' }, select: { revision: true } });
    const approval = await tx.scheduleApproval.create({ data: { month: start, status: 'PENDING', revision: (latest?.revision || 0) + 1, changedByLegacyRef: actorUserId, changedAt: new Date(), changeType: 'AUTO_SCHEDULE_EMPLOYEE' } });
    await audit.log({ actorUserId, action: 'CREATE', entityType: 'EmployeeAutoSchedule', entityId: `${month}:${employeeId}`, metadata: { month, startPhase, patternType, generatedRows: generated.length, replacedRows: deleted.count, preservedRows: plan.summary.manualLocked, revision: approval.revision, warningCount: plan.warnings.length } }, tx);
    return { writtenRows: generated.length, replacedRows: deleted.count, preservedRows: plan.summary.manualLocked, warnings: plan.warnings, startDate: plan.startDate, endDate: plan.endDate, approval: { id: approval.id, status: approval.status, revision: approval.revision } };
  }, { timeout: 15000 });
}

module.exports = { buildAutoSchedulePlan, buildEmployeeAutoSchedulePlan, commitAutoSchedule, commitEmployeeAutoSchedule, monthBounds, suggestedPhase };
