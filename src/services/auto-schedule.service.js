const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { isoWeek } = require('./schedule-rules.service');

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
  const active = records.filter((license) => ['active', 'valid'].includes(String(license.status || '').trim().toLowerCase()));
  const valid = active.find((license) => license.issueDate && license.expiryDate && license.issueDate <= date && license.expiryDate >= date);
  if (valid) return { valid: true, code: 'VALID', expiryDate: valid.expiryDate };
  const record = active[0] || records[0];
  return { valid: false, code: String(record?.status || 'MISSING').toUpperCase(), expiryDate: record?.expiryDate || null, reason: record ? 'ใบอนุญาตไม่มีผลในวันที่จัดกะ' : 'ไม่พบข้อมูลใบอนุญาต' };
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
  const historyStart = new Date(start.getTime() - 366 * DAY_MS);
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
  const existing = new Map(currentShifts.filter((row) => employeeIds.has(row.employeeId) && (row.locked || String(row.shiftType.code).toUpperCase() === 'AL')).map((row) => [`${row.employeeId}|${isoDate(row.workDate)}`, row]));
  const histories = new Map();
  historyRows.forEach((row) => { const list = histories.get(row.employeeId) || []; if (list.length < 14) list.push(row); histories.set(row.employeeId, list); });
  const licensesByEmployee = new Map();
  licenses.forEach((license) => { const list = licensesByEmployee.get(license.employeeId) || []; list.push(license); licensesByEmployee.set(license.employeeId, list); });

  const weeklyHours = new Map();
  const planned = new Map();
  const licenseBlocked = new Map();
  const assign = (employee, date, shift, { source = 'AUTO', locked = false, remark = '', existingRow } = {}) => {
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
      hours, color: shift.color, remark, source, locked, licenseStatus: allowedOverride ? 'OVERRIDDEN' : license.code,
      licenseExpiryDate: license.expiryDate ? isoDate(license.expiryDate) : null, licenseOverride: allowedOverride
    });
    weeklyHours.set(weekKey, weekHours + hours);
    return true;
  };

  employees.forEach((employee) => dates.forEach((date) => {
    const row = existing.get(`${employee.id}|${isoDate(date)}`);
    if (row) assign(employee, date, row.shiftType, { source: row.source || 'MANUAL', locked: true, remark: row.remark || '', existingRow: row });
  }));

  const cycle = ['D', 'D', 'D', 'D', 'D', 'D', 'OFF', 'N', 'N', 'N', 'N', 'N', 'N', 'OFF'];
  const phases = { D1: 0, D2: 1, D3: 2, D4: 3, D5: 4, D6: 5, 'OFF-D': 6, N1: 7, N2: 8, N3: 9, N4: 10, N5: 11, N6: 12, 'OFF-N': 13 };
  employees.forEach((employee) => {
    const supervisor = isSupervisor(employee);
    let cycleIndex = supervisor ? 0 : (phases[suggestedPhase(histories.get(employee.id) || [])] || 0);
    dates.forEach((date) => {
      const key = `${employee.id}|${isoDate(date)}`;
      if (planned.has(key)) { if (!supervisor) cycleIndex += 1; return; }
      const license = licenseForDate(licensesByEmployee.get(employee.id) || [], date);
      if (!license.valid) {
        licenseBlocked.set(key, license);
        assign(employee, date, shifts.get('OFF'), { remark: `License blocked: ${license.reason}` });
        if (!supervisor) cycleIndex += 1;
        return;
      }
      const code = supervisor ? (date.getUTCDay() === 0 ? 'OFF' : 'D') : cycle[cycleIndex % cycle.length];
      const assigned = assign(employee, date, shifts.get(code), { remark: supervisor ? 'Auto Supervisor Pattern' : 'Auto Rotating Pattern' });
      if (!assigned) assign(employee, date, shifts.get('OFF'), { remark: 'Weekly hour limit' });
      if (!supervisor) cycleIndex += 1;
    });
  });

  const rows = [...planned.values()].sort((first, second) => first.date.localeCompare(second.date) || first.employeeCode.localeCompare(second.employeeCode));
  const counts = rows.reduce((result, row) => ({ ...result, [row.code]: (result[row.code] || 0) + 1 }), {});
  const blockedCounts = {};
  licenseBlocked.forEach((_value, key) => { const employeeId = key.split('|')[0]; blockedCounts[employeeId] = (blockedCounts[employeeId] || 0) + 1; });
  const warnings = Object.entries(blockedCounts).map(([employeeId, count]) => `${displayName(employees.find((item) => item.id === employeeId) || { firstName: employeeId, lastName: '' })}: ถูกป้องกันกะทำงาน ${count} วัน เนื่องจากใบอนุญาตไม่ผ่าน`);
  return { month, startDate: isoDate(start), endDate: isoDate(new Date(end.getTime() - DAY_MS)), dates: dates.map(isoDate), rows, warnings, summary: { employees: employees.length, days: dates.length, totalRows: rows.length, manualLocked: rows.filter((row) => row.locked).length, counts, maxWeeklyHours, dayMinimum, nightMinimum } };
}

async function commitAutoSchedule(prisma, month, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const plan = await buildAutoSchedulePlan(tx, month);
    const employeeIds = [...new Set(plan.rows.map((row) => row.employeeId))];
    const al = await tx.shiftType.findUniqueOrThrow({ where: { code: 'AL' }, select: { id: true } });
    const { start, end } = monthBounds(month);
    const deleted = await tx.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds }, workDate: { gte: start, lt: end }, locked: false, shiftTypeId: { not: al.id } } });
    const generated = plan.rows.filter((row) => !row.locked);
    if (generated.length) await tx.shiftAssignment.createMany({ data: generated.map((row) => ({
      employeeId: row.employeeId, shiftTypeId: row.shiftTypeId, workDate: new Date(`${row.date}T00:00:00Z`), employeeNameSnapshot: row.employeeName,
      departmentSnapshot: row.department, startTime: row.startTime, endTime: row.endTime, hours: row.hours, remark: row.remark, source: 'AUTO', locked: false,
      updatedByLegacyRef: actorUserId, licenseStatus: row.licenseStatus, licenseExpiryDate: row.licenseExpiryDate ? new Date(`${row.licenseExpiryDate}T00:00:00Z`) : null, licenseOverride: false
    })) });
    const latest = await tx.scheduleApproval.findFirst({ where: { month: start }, orderBy: { revision: 'desc' }, select: { revision: true } });
    const approval = await tx.scheduleApproval.create({ data: { month: start, status: 'PENDING', revision: (latest?.revision || 0) + 1, changedByLegacyRef: actorUserId, changedAt: new Date(), changeType: 'AUTO_SCHEDULE' } });
    await audit.log({ actorUserId, action: 'CREATE', entityType: 'AutoSchedule', entityId: month, metadata: { generatedRows: generated.length, replacedRows: deleted.count, preservedRows: plan.summary.manualLocked, revision: approval.revision, warningCount: plan.warnings.length } }, tx);
    return { writtenRows: generated.length, replacedRows: deleted.count, preservedRows: plan.summary.manualLocked, warnings: plan.warnings, startDate: plan.startDate, endDate: plan.endDate, approval: { id: approval.id, status: approval.status, revision: approval.revision } };
  }, { timeout: 15000 });
}

module.exports = { buildAutoSchedulePlan, commitAutoSchedule, monthBounds, suggestedPhase };
