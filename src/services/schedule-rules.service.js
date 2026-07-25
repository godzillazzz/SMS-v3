const prisma = require('../config/prisma');

function isoWeek(value) {
  const d = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function evaluateScheduleRules({ rules = [], employees = [], shifts = [], leaves = [], dates = [] } = {}) {
  const violations = [];
  const activeRuleIds = new Set(rules.filter((r) => r.enabled).map((r) => r.ruleId));

  const isSupervisor = (emp) => {
    const title = String(emp.jobTitle || '').toLowerCase();
    return title.includes('supervisor') || title.includes('หัวหน้า');
  };

  // Group shifts by employee
  const shiftsByEmp = new Map();
  for (const s of shifts) {
    if (!shiftsByEmp.has(s.employeeId)) shiftsByEmp.set(s.employeeId, []);
    shiftsByEmp.get(s.employeeId).push(s);
  }

  // Check 1: Weekly Hours (RULE001)
  if (activeRuleIds.has('RULE001')) {
    const rule = rules.find((r) => r.ruleId === 'RULE001');
    const maxHours = Number(rule?.value || 72);

    for (const [empId, empShifts] of shiftsByEmp.entries()) {
      const byWeek = new Map();
      for (const s of empShifts) {
        const week = isoWeek(new Date(s.workDate));
        byWeek.set(week, (byWeek.get(week) || 0) + Number(s.hours || 0));
      }
      for (const [week, totalHours] of byWeek.entries()) {
        if (totalHours > maxHours) {
          const emp = employees.find((e) => e.id === empId) || { displayName: 'Employee' };
          violations.push({
            ruleId: 'RULE001',
            ruleName: 'Weekly Hours',
            title: `Weekly hours exceeded (${totalHours}h > ${maxHours}h)`,
            description: `Employee ${emp.displayName || emp.firstName} exceeded weekly hours limit in ${week}.`,
            severity: 'error'
          });
        }
      }
    }
  }

  // Check 2: Supervisor Rule (RULE006)
  if (activeRuleIds.has('RULE006')) {
    const supervisorIds = new Set(employees.filter(isSupervisor).map((e) => e.id));
    for (const s of shifts) {
      if (supervisorIds.has(s.employeeId) && s.shiftType?.code !== 'OFF') {
        const d = new Date(s.workDate);
        if (d.getUTCDay() === 0) {
          violations.push({
            ruleId: 'RULE006',
            ruleName: 'Supervisor Schedule',
            title: `Supervisor working on Sunday ${d.toISOString().slice(0, 10)}`,
            description: `Supervisor scheduled on Sunday contrary to standard pattern.`,
            severity: 'warning'
          });
        }
      }
    }
    for (const d of dates) {
      const dateShifts = shifts.filter((s) => new Date(s.workDate).toISOString().slice(0, 10) === d && s.shiftType?.code !== 'OFF');
      const hasSupervisor = dateShifts.some((s) => supervisorIds.has(s.employeeId));
      if (!hasSupervisor && dateShifts.length > 0) {
        violations.push({
          ruleId: 'RULE006',
          ruleName: 'Supervisor Schedule',
          title: `No Supervisor scheduled on ${d}`,
          description: `Date ${d} has working shifts but no supervisor assigned.`,
          severity: 'warning'
        });
      }
    }
  }

  // Check 3: Leave Conflict (RULE005)
  if (activeRuleIds.has('RULE005')) {
    for (const l of leaves) {
      const start = new Date(l.startDate);
      const end = new Date(l.endDate);

      for (const s of shifts) {
        if (s.employeeId === l.employeeId && s.shiftType?.code !== 'OFF' && s.shiftType?.code !== 'LEAVE') {
          const wDate = new Date(s.workDate);
          if (wDate >= start && wDate <= end) {
            violations.push({
              ruleId: 'RULE005',
              ruleName: 'Leave Conflict',
              title: `Shift conflicts with approved leave on ${wDate.toISOString().slice(0, 10)}`,
              description: `Working shift assigned on approved leave date.`,
              severity: 'error'
            });
          }
        }
      }
    }
  }

  // Check 4: License Status
  for (const s of shifts) {
    if (s.licenseStatus === 'INVALID' && s.shiftType?.code !== 'OFF') {
      violations.push({
        ruleId: 'LICENSE',
        ruleName: 'Invalid License',
        title: `Invalid License on ${new Date(s.workDate).toISOString().slice(0, 10)}`,
        description: `Employee shift assigned with invalid license status.`,
        severity: 'error'
      });
    }
  }

  return {
    violations,
    metrics: {
      violations: violations.length,
      rulesChecked: rules.length,
      rulesPassed: Math.max(0, rules.length - violations.length),
      activeEmployees: employees.length,
      totalHours: shifts.reduce((sum, s) => sum + Number(s.hours || 0), 0)
    }
  };
}

async function evaluateRulesForAssignments(assignments) {
  const rules = await prisma.schedulingRule.findMany();
  const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];
  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds } } });
  const leaves = await prisma.leaveRequest.findMany({ where: { employeeId: { in: employeeIds }, status: 'APPROVED' } });
  const dates = [...new Set(assignments.map((a) => new Date(a.workDate).toISOString().slice(0, 10)))];

  const evalResult = evaluateScheduleRules({ rules, employees, shifts: assignments, leaves, dates });

  return evalResult.violations.map((v) => ({
    ruleId: v.ruleId,
    ruleName: v.ruleName,
    employeeId: v.employeeId,
    date: v.date,
    severity: v.severity.toUpperCase(),
    message: `${v.title}: ${v.description}`
  }));
}

module.exports = {
  isoWeek,
  evaluateScheduleRules,
  evaluateRulesForAssignments
};
