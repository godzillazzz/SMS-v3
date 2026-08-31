'use strict';

const { performance } = require('node:perf_hooks');
const { Prisma } = require('@prisma/client');
const { logger } = require('../utils/logger');
const { leaveMonthWhere } = require('../utils/leave-month-filter');
const { getDataQualitySummary } = require('./data-quality.service');
const HttpError = require('../utils/http-error');
const { leaveTypeDisplayName } = require('./leave-type.service');

const EMPTY_ID = '00000000-0000-0000-0000-000000000000';
const LICENSE_APPROVED = { status: 'APPROVED', isCurrent: true };
const QUERY_OPERATION_COUNT = 11;

async function timedExecutiveStage(requestId, stage, queryCount, task) {
  const startedAt = performance.now();
  let status = 'ok';
  try { return await task(); }
  catch (error) { status = 'error'; throw error; }
  finally {
    if (requestId) logger.info('performance_stage', { requestId, operation: 'executive-report', stage, durationMs: Number((performance.now() - startedAt).toFixed(2)), status, queryCount });
  }
}

function bangkokDateStart(now = new Date()) {
  const bangkok = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  return new Date(Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth(), bangkok.getUTCDate()));
}

function monthBounds(year, month) {
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  return { startDate, nextMonthStart, endDate: new Date(nextMonthStart.getTime() - 1) };
}

function currentBangkokPeriod(now = new Date()) {
  const today = bangkokDateStart(now);
  return { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
}

function resolveReportScope(requestUser, requestedDepartment) {
  if (requestUser.role === 'ADMIN') {
    return { department: requestedDepartment || null, employeeId: null, label: requestedDepartment || 'ทุกหน่วยงาน', allowsDepartmentFilter: true };
  }
  if (requestedDepartment) throw new HttpError(403, 'Department report scope is not permitted.');
  if (requestUser.department) {
    return { department: requestUser.department, employeeId: null, label: requestUser.department, allowsDepartmentFilter: false };
  }
  return { department: null, employeeId: requestUser.employeeId || EMPTY_ID, label: 'ขอบเขตของผู้ใช้งาน', allowsDepartmentFilter: false };
}

function employeeWhere(scope, additional = {}) {
  const where = { deletedAt: null, ...additional };
  if (scope.department) where.department = scope.department;
  if (scope.employeeId) where.id = scope.employeeId;
  return where;
}

function employeeRelation(scope) {
  return { is: employeeWhere(scope) };
}

function operationalEmployeeRelation(scope) {
  return { is: employeeWhere(scope, { isActive: true }) };
}

function leaveScopeWhere(scope, period) {
  return {
    ...leaveMonthWhere({ monthStart: period.startDate, nextMonthStart: period.nextMonthStart }),
    employee: employeeRelation(scope)
  };
}

function historicalLeaveScopeWhere(scope, period) {
  return {
    ...leaveMonthWhere({ monthStart: period.startDate, nextMonthStart: period.nextMonthStart }),
    ...(scope.department && { departmentSnapshot: scope.department }),
    ...(scope.employeeId && { employeeId: scope.employeeId })
  };
}

function operationalLeaveScopeWhere(scope, period) {
  return {
    ...leaveMonthWhere({ monthStart: period.startDate, nextMonthStart: period.nextMonthStart }),
    employee: operationalEmployeeRelation(scope)
  };
}

function numberFromGroup(rows, key, values) {
  const result = Object.fromEntries(values.map((value) => [value, 0]));
  rows.forEach((row) => { if (Object.hasOwn(result, row[key])) result[row[key]] = row._count?._all || 0; });
  return result;
}

function buildAttention({ license, dataQuality, leave, role }) {
  const rows = [];
  const add = (severity, title, description, count, targetPath) => {
    if (count > 0) rows.push({ severity, title, description, count, targetPath });
  };
  add('critical', 'ใบอนุญาตหมดอายุ', 'พบใบอนุญาตปัจจุบันที่หมดอายุและควรติดตาม', license.expired, 'licenses');
  if (role === 'ADMIN') add('critical', 'โควต้าวันลายังไม่จับคู่', 'พบข้อมูลโควต้าที่ต้องตรวจสอบการจับคู่กับพนักงาน', dataQuality.categories.find((item) => item.rule === 'LEAVE_QUOTA_UNMATCHED')?.count || 0, 'dataQuality');
  add('warning', 'ใบอนุญาตใกล้หมดอายุ', 'พบใบอนุญาตปัจจุบันที่ใกล้หมดอายุภายใน 30 วัน', license.expiringWithin30Days, 'licenses');
  add('follow-up', 'คำขอลารอพิจารณา', 'พบคำขอลาที่ทับซ้อนกับช่วงเวลารายงานและยังรอการพิจารณา', leave.actionablePendingCount ?? leave.statusCounts.PENDING, 'leavePending');
  return rows.slice(0, 5);
}

function thaiMonthLabel(year, month) {
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

async function workforceSnapshot(prismaClient, asOfDate, scope) {
  const employeeFilter = scope.employeeId ? Prisma.sql`AND e.id = ${scope.employeeId}::uuid` : Prisma.empty;
  const departmentFilter = scope.department ? Prisma.sql`WHERE department = ${scope.department}` : Prisma.empty;
  const rows = await prismaClient.$queryRaw(Prisma.sql`
    WITH latest_before AS (
      SELECT DISTINCT ON (employee_id)
        employee_id,
        new_value -> 'employee' AS state
      FROM employee_lifecycle_events
      WHERE status = 'APPLIED' AND effective_date <= ${asOfDate}::date
      ORDER BY employee_id, effective_date DESC, sequence DESC
    ),
    earliest_after AS (
      SELECT DISTINCT ON (employee_id)
        employee_id,
        old_value -> 'employee' AS state
      FROM employee_lifecycle_events
      WHERE status = 'APPLIED' AND effective_date > ${asOfDate}::date
      ORDER BY employee_id, effective_date ASC, sequence ASC
    ),
    workforce_state AS (
      SELECT
        COALESCE(latest_before.state ->> 'department', earliest_after.state ->> 'department', e.department) AS department,
        COALESCE(
          (latest_before.state ->> 'isActive')::boolean,
          (earliest_after.state ->> 'isActive')::boolean,
          e.is_active
        ) AS is_active
      FROM employees e
      LEFT JOIN latest_before ON latest_before.employee_id = e.id
      LEFT JOIN earliest_after ON earliest_after.employee_id = e.id
      WHERE e.deleted_at IS NULL
        AND (e.hired_at IS NULL OR e.hired_at <= ${asOfDate}::date)
        ${employeeFilter}
    )
    SELECT
      department,
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE is_active)::integer AS active
    FROM workforce_state
    ${departmentFilter}
    GROUP BY department
    ORDER BY department ASC NULLS LAST
  `);
  return rows.map((row) => ({ department: row.department || null, total: Number(row.total || 0), active: Number(row.active || 0) }));
}

async function getExecutiveReport({ prismaClient, requestUser, filters, now = new Date(), requestId }) {
  const fallback = currentBangkokPeriod(now);
  const year = filters.year || fallback.year;
  const month = filters.month || fallback.month;
  const period = monthBounds(year, month);
  const scope = resolveReportScope(requestUser, filters.department);
  const operationalDocumentScope = { employee: operationalEmployeeRelation(scope) };
  const asOfDate = bangkokDateStart(now);
  const workforceAsOfDate = period.endDate < asOfDate ? period.endDate : asOfDate;
  const expiry30 = new Date(asOfDate.getTime() + (30 * 86400000));
  const leaveWhere = historicalLeaveScopeWhere(scope, period);
  const operationalLeaveWhere = operationalLeaveScopeWhere(scope, period);

  const workforceRows = await timedExecutiveStage(requestId, 'EXEC_WORKFORCE_ASOF', 1, () => workforceSnapshot(prismaClient, workforceAsOfDate, scope));
  const totalEmployees = workforceRows.reduce((sum, row) => sum + row.total, 0);
  const activeEmployees = workforceRows.reduce((sum, row) => sum + row.active, 0);
  const assignmentCount = await timedExecutiveStage(requestId, 'EXEC_SCHEDULE', 1, () => prismaClient.shiftAssignment.count({ where: { workDate: { gte: period.startDate, lt: period.nextMonthStart }, ...(scope.department && { departmentSnapshot: scope.department }), ...(scope.employeeId && { employeeId: scope.employeeId }) } }));
  const leaveByStatusRows = await timedExecutiveStage(requestId, 'EXEC_LEAVE', 1, () => prismaClient.leaveRequest.groupBy({ by: ['status'], where: leaveWhere, _count: { _all: true } }));
  const leaveByTypeRows = await timedExecutiveStage(requestId, 'EXEC_LEAVE', 1, () => prismaClient.leaveRequest.groupBy({ by: ['leaveType', 'leaveTypeNameSnapshot'], where: leaveWhere, _count: { _all: true }, orderBy: { leaveType: 'asc' } }));
  const actionablePendingCount = await timedExecutiveStage(requestId, 'EXEC_LEAVE', 1, () => prismaClient.leaveRequest.count({ where: { status: 'PENDING', ...operationalLeaveWhere } }));
  const quality = await timedExecutiveStage(requestId, 'EXEC_DATA_QUALITY', 4, () => getDataQualitySummary({ prismaClient, filters: { department: scope.department || undefined, employeeId: scope.employeeId || undefined }, now: asOfDate }));
  const validBeyond30Days = await timedExecutiveStage(requestId, 'EXEC_LICENSE', 1, () => prismaClient.employeeLicenseDocument.count({ where: { ...LICENSE_APPROVED, ...operationalDocumentScope, proposedExpiryDate: { gt: expiry30 } } }));
  const pendingReview = await timedExecutiveStage(requestId, 'EXEC_LICENSE', 1, () => prismaClient.employeeLicenseDocument.count({ where: { status: 'PENDING', isCurrent: true, ...operationalDocumentScope } }));

  const statusCounts = numberFromGroup(leaveByStatusRows, 'status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
  const byType = leaveByTypeRows.map((row) => ({ label: leaveTypeDisplayName(row.leaveType, row.leaveTypeNameSnapshot), code: row.leaveType, count: row._count?._all || 0 }));
  const workforceByDepartment = workforceRows.filter((row) => row.active > 0).map((row) => ({ label: row.department || 'ไม่ระบุหน่วยงาน', count: row.active }));
  const qualityCategory = (rule) => quality.categories.find((item) => item.rule === rule)?.count || 0;
  const license = {
    expired: qualityCategory('LICENSE_EXPIRED'),
    expiringWithin30Days: qualityCategory('LICENSE_EXPIRING_WITHIN_30_DAYS'),
    validBeyond30Days,
    pendingReview,
    asOfDate: asOfDate.toISOString().slice(0, 10)
  };
  const leave = { totalRequests: Object.values(statusCounts).reduce((sum, value) => sum + value, 0), statusCounts, actionablePendingCount, byType, overlapRule: 'นับคำขอลาที่มีช่วงวันลาทับซ้อนกับเดือนที่เลือก' };
  const managementAttention = buildAttention({ license, dataQuality: quality, leave, role: requestUser.role });

  return {
    period: { year, month, startDate: period.startDate.toISOString().slice(0, 10), endDate: period.endDate.toISOString().slice(0, 10), label: thaiMonthLabel(year, month) },
    scope: { departmentId: null, departmentName: scope.label, allowsDepartmentFilter: scope.allowsDepartmentFilter, availableDepartments: workforceByDepartment.map((item) => item.label).filter((item) => item !== 'ไม่ระบุหน่วยงาน') },
    executiveSummary: [
      { key: 'activeEmployees', label: 'พนักงานที่ปฏิบัติงาน', value: activeEmployees, unit: 'คน', status: 'neutral' },
      { key: 'assignments', label: 'รายการจัดเวร', value: assignmentCount, unit: 'รายการ', status: 'neutral' },
      { key: 'leaveRequests', label: 'คำขอลาในช่วงเวลา', value: leave.totalRequests, unit: 'รายการ', status: statusCounts.PENDING > 0 ? 'warning' : 'neutral' },
      { key: 'expiredLicenses', label: 'ใบอนุญาตหมดอายุ', value: license.expired, unit: 'รายการ', status: license.expired > 0 ? 'critical' : 'success' },
      { key: 'dataQualityIssues', label: 'ประเด็นคุณภาพข้อมูล', value: quality.summary.total, unit: 'รายการ', status: quality.summary.critical > 0 ? 'critical' : 'success' }
    ],
    workforce: { totalEmployees, activeEmployees, byDepartment: workforceByDepartment, asOfDate: workforceAsOfDate.toISOString().slice(0, 10) },
    schedule: { assignmentCount, periodNote: 'จำนวนรายการจัดเวรตามหน่วยงานที่บันทึกไว้ในเวลาจัดเวร ไม่ใช่ตัวชี้วัด Coverage หรือกำลังคนขาด' },
    leave,
    license,
    dataQuality: { ...quality.summary, categories: quality.categories, asOfDate: asOfDate.toISOString().slice(0, 10) },
    managementAttention,
    generatedAt: now.toISOString(),
    meta: { queryOperationCount: QUERY_OPERATION_COUNT, queryStrategy: 'sequential', historicalSemantics: { workforce: 'AS_OF_PERIOD_END_OR_TODAY', schedule: 'DEPARTMENT_SNAPSHOT', leave: 'DEPARTMENT_SNAPSHOT', license: 'CURRENT_STATE', dataQuality: 'CURRENT_STATE' } }
  };
}

module.exports = { QUERY_OPERATION_COUNT, bangkokDateStart, currentBangkokPeriod, monthBounds, resolveReportScope, leaveScopeWhere, historicalLeaveScopeWhere, operationalLeaveScopeWhere, buildAttention, workforceSnapshot, getExecutiveReport };
