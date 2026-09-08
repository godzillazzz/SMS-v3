'use strict';

const { z } = require('zod');
const prisma = require('../config/prisma');
const { currentBangkokPeriod, monthBounds, resolveReportScope } = require('./executive-report.service');

const reportSummaryQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  department: z.string().trim().min(1).max(100).optional()
});

function summaryPeriod(filters = {}, now = new Date()) {
  const fallback = currentBangkokPeriod(now);
  const year = filters.year || fallback.year;
  const month = filters.month || fallback.month;
  return { year, month, ...monthBounds(year, month) };
}

function scopedEmployeeWhere(scope) {
  const where = { deletedAt: null };
  if (scope.department) where.department = scope.department;
  if (scope.employeeId) where.id = scope.employeeId;
  return where;
}

function buildReportSummaryWhere({ scope, period }) {
  const employee = scopedEmployeeWhere(scope);
  const employeeRelation = { is: employee };
  const historicalScope = {
    ...(scope.department ? { departmentSnapshot: scope.department } : {}),
    ...(scope.employeeId ? { employeeId: scope.employeeId } : {})
  };
  return {
    employees: employee,
    activeEmployees: { ...employee, isActive: true },
    licenses: { employee: employeeRelation },
    shifts: {
      workDate: { gte: period.startDate, lt: period.nextMonthStart },
      ...historicalScope
    },
    leaveRequests: {
      startDate: { lt: period.nextMonthStart },
      endDate: { gte: period.startDate },
      ...historicalScope
    },
    leaveQuotas: {
      quotaYear: period.year,
      ...((scope.department || scope.employeeId) ? { employee: employeeRelation } : {})
    },
    users: {
      ...(scope.department ? { department: scope.department } : {}),
      ...(scope.employeeId ? { employeeId: scope.employeeId } : {})
    }
  };
}

async function getReportSummary({ prismaClient = prisma, requestUser, filters = {}, now = new Date() } = {}) {
  const parsed = reportSummaryQuery.parse(filters);
  const scope = resolveReportScope(requestUser, parsed.department);
  const period = summaryPeriod(parsed, now);
  const where = buildReportSummaryWhere({ scope, period });
  const [employees, activeEmployees, licenses, shifts, leaveRequests, leaveQuotas, users] = await prismaClient.$transaction([
    prismaClient.employee.count({ where: where.employees }),
    prismaClient.employee.count({ where: where.activeEmployees }),
    prismaClient.employeeLicense.count({ where: where.licenses }),
    prismaClient.shiftAssignment.count({ where: where.shifts }),
    prismaClient.leaveRequest.count({ where: where.leaveRequests }),
    prismaClient.leaveQuota.count({ where: where.leaveQuotas }),
    prismaClient.user.count({ where: where.users })
  ]);
  return {
    employees, activeEmployees, licenses, shifts, leaveRequests, leaveQuotas, users,
    period: { year: period.year, month: period.month, startDate: period.startDate.toISOString().slice(0, 10), endDate: period.endDate.toISOString().slice(0, 10) },
    scope: { department: scope.department, employeeId: scope.employeeId, label: scope.label }
  };
}

module.exports = { reportSummaryQuery, summaryPeriod, scopedEmployeeWhere, buildReportSummaryWhere, getReportSummary };
