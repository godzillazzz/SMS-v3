const isoDate = (value) => new Date(value).toISOString().slice(0, 10);
const isoWeek = (value) => {
  const date = new Date(`${isoDate(value)}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil((((date - yearStart) / 86400000) + 1) / 7)).padStart(2, '0')}`;
};
const minutes = (value) => { const match = String(value || '').match(/^(\d{1,2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : undefined; };
const violation = (severity, rule, title, description, extra = {}) => ({ severity, ruleId: rule.ruleId, ruleName: rule.name, title, description, ...extra });
const isLeader = (employee) => ['supervisor', 'team leader', 'act.team leader'].includes(String(employee.jobTitle || '').trim().toLowerCase());

function evaluateScheduleRules({ rules, employees, shifts, leaves, dates }) {
  const normalized = shifts.map((shift) => ({
    ...shift, date: isoDate(shift.workDate), hours: Number(shift.hours || 0), code: String(shift.shiftType?.code || '').toUpperCase(),
    employee: employees.find((employee) => employee.id === shift.employeeId)
  }));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const leaveKeys = new Set();
  leaves.forEach((leave) => { for (let day = new Date(leave.startDate); day <= leave.endDate; day.setUTCDate(day.getUTCDate() + 1)) leaveKeys.add(`${leave.employeeId}|${isoDate(day)}`); });

  const check = (rule) => {
    const value = Number(rule.value || 0);
    if (rule.ruleId === 'RULE001') {
      const weeks = new Map();
      normalized.forEach((shift) => { const key = `${shift.employeeId}|${isoWeek(shift.workDate)}`; const item = weeks.get(key) || { employeeId: shift.employeeId, week: isoWeek(shift.workDate), hours: 0 }; item.hours += shift.hours; weeks.set(key, item); });
      return [...weeks.values()].filter((item) => item.hours > value).map((item) => violation('error', rule, employeeById.get(item.employeeId)?.displayName || employeeById.get(item.employeeId)?.employeeCode || 'พนักงาน', `ทำงาน ${item.hours} ชม. ในสัปดาห์ ${item.week} (สูงสุด ${value} ชม.)`, { employeeId: item.employeeId }));
    }
    if (rule.ruleId === 'RULE002') {
      const results = [];
      employees.forEach((employee) => {
        const rows = normalized.filter((shift) => shift.employeeId === employee.id && shift.hours > 0).map((shift) => { const startMinutes = minutes(shift.startTime); const start = startMinutes === undefined ? undefined : Date.parse(`${shift.date}T00:00:00Z`) + startMinutes * 60000; return { ...shift, start, end: start === undefined ? undefined : start + shift.hours * 3600000 }; }).filter((shift) => shift.start !== undefined).sort((a, b) => a.start - b.start);
        rows.forEach((shift, index) => { const next = rows[index + 1]; if (!next || shift.code !== 'N') return; const rest = (next.start - shift.end) / 3600000; if (rest < value) results.push(violation('error', rule, employee.displayName || employee.employeeCode, `${next.date} พักหลังกะดึก ${rest.toFixed(1)} ชม. (ขั้นต่ำ ${value} ชม.)`, { employeeId: employee.id, date: next.date })); });
      });
      return results;
    }
    if (rule.ruleId === 'RULE003' || rule.ruleId === 'RULE004') {
      const code = rule.ruleId === 'RULE003' ? 'D' : 'N'; const results = []; const departments = [...new Set(employees.map((employee) => employee.department).filter(Boolean))];
      dates.forEach((date) => departments.forEach((department) => { const count = normalized.filter((shift) => shift.date === date && shift.code === code && shift.employee?.department === department).length; if (count < value) results.push(violation('warn', rule, `แผนก ${department} · กะ ${code}`, `${date} มีคน ${count} คน (ขั้นต่ำ ${value} คน)`, { date, department })); }));
      return results;
    }
    if (rule.ruleId === 'RULE005') return normalized.filter((shift) => shift.hours > 0 && !['AL', 'OFF'].includes(shift.code) && leaveKeys.has(`${shift.employeeId}|${shift.date}`)).map((shift) => violation('error', rule, shift.employee?.displayName || shift.employee?.employeeCode || 'พนักงาน', `${shift.date} ถูกจัดกะ ${shift.code} ทั้งที่มีวันลา`, { employeeId: shift.employeeId, date: shift.date }));
    if (rule.ruleId === 'RULE006') return normalized.filter((shift) => String(shift.employee?.jobTitle || '').trim().toLowerCase() === 'supervisor' && shift.hours > 0 && ((new Date(`${shift.date}T00:00:00Z`).getUTCDay() === 0 && shift.code !== 'OFF') || (new Date(`${shift.date}T00:00:00Z`).getUTCDay() !== 0 && !['D', 'OFF'].includes(shift.code)))).map((shift) => violation('error', rule, shift.employee?.displayName || shift.employee?.employeeCode || 'Supervisor', `${shift.date} ถูกจัดกะ ${shift.code}; Supervisor ต้องกะ D และหยุดวันอาทิตย์`, { employeeId: shift.employeeId, date: shift.date }));
    if (rule.ruleId === 'RULE007' || rule.ruleId === 'RULE008') {
      const code = rule.ruleId === 'RULE007' ? 'D' : 'N'; const results = [];
      dates.forEach((date) => ['PO11', 'WCS'].forEach((department) => { const count = normalized.filter((shift) => shift.date === date && shift.code === code && shift.employee?.department === department && isLeader(shift.employee)).length; if (count < value) results.push(violation('warn', rule, `แผนก ${department} · ขาด Leader กะ ${code}`, `${date} มี Leader ${count} คน (ขั้นต่ำ ${value} คน)`, { date, department })); }));
      return results;
    }
    if (rule.ruleId === 'RULE009') return [];
    return normalized.filter((shift) => /violation/i.test(String(shift.remark || ''))).map((shift) => violation('warn', rule, shift.employee?.displayName || shift.employee?.employeeCode || 'พนักงาน', `${shift.date} · ${shift.remark}`, { employeeId: shift.employeeId, date: shift.date }));
  };

  const ruleResults = rules.map((rule) => { if (!rule.enabled) return { id: rule.ruleId, name: rule.name, enabled: false, passed: true, summary: 'ปิดการตรวจสอบ', violations: [] }; const violations = check(rule); return { id: rule.ruleId, name: rule.name, enabled: true, passed: violations.length === 0, summary: violations.length ? `${violations.length} รายการ` : 'ผ่าน', violations }; });
  const licenseViolations = normalized.filter((shift) => shift.hours > 0 && !['AL', 'OFF'].includes(shift.code) && !['VALID', 'OVERRIDDEN'].includes(String(shift.licenseStatus || ''))).map((shift) => ({ severity: 'error', ruleId: 'LICENSE', ruleName: 'ใบอนุญาตต้องมีผลในวันที่ทำงาน', title: shift.employee?.displayName || shift.employee?.employeeCode || 'พนักงาน', description: `${shift.date} · กะ ${shift.code} ไม่มีสถานะใบอนุญาตที่ผ่าน`, employeeId: shift.employeeId, date: shift.date }));
  ruleResults.push({ id: 'LICENSE', name: 'ใบอนุญาตต้องมีผลในวันที่ทำงาน', enabled: true, passed: licenseViolations.length === 0, summary: licenseViolations.length ? `${licenseViolations.length} รายการ` : 'ผ่าน', violations: licenseViolations });
  const violations = ruleResults.flatMap((result) => result.violations);
  return { ruleResults: ruleResults.map(({ violations: _violations, ...result }) => result), violations, metrics: { violations: violations.length, rulesPassed: ruleResults.filter((result) => result.enabled && result.passed).length, rulesChecked: ruleResults.filter((result) => result.enabled).length, activeEmployees: employees.length, totalHours: normalized.reduce((sum, shift) => sum + shift.hours, 0) } };
}

module.exports = { evaluateScheduleRules, isoWeek };
