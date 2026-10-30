'use strict';

const { performance } = require('node:perf_hooks');
const { Prisma } = require('@prisma/client');
const { logger } = require('../utils/logger');
const { leaveMonthWhere } = require('../utils/leave-month-filter');
const { getDataQualitySummary, CUSTOM_RULES } = require('./data-quality.service');
const HttpError = require('../utils/http-error');
const { leaveTypeDisplayName } = require('./leave-type.service');
const { resolveDepartmentScope, departmentWhere, scopedDepartmentValues } = require('./report-scope');
const { buildAttendanceMetrics, buildDepartmentRoundCoverage } = require('./report-analytics.service');

const LICENSE_APPROVED = { status: 'APPROVED', isCurrent: true };
// Fixed sequential reads; the approved-leave lookup (only when assignments exist) and system-wide
// custom data-quality rules (ADMIN, all departments) are conditional extras.
const QUERY_OPERATION_COUNT = 14;
const PATROL_SCAN_LIMIT = 60000;
const SCOPE_UNAVAILABLE_LABEL = 'ไม่พร้อมใน scope';

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

// S2: a non-ADMIN without a department fails closed (403); it never falls back to a wider or per-employee scope.
function resolveReportScope(requestUser, requestedDepartment) {
  if (String(requestUser?.role || '').toUpperCase() !== 'ADMIN' && requestedDepartment) throw new HttpError(403, 'Department report scope is not permitted.');
  const scope = resolveDepartmentScope(requestUser, requestedDepartment || null);
  return { department: scope.department || null, employeeId: null, label: scope.label, allowsDepartmentFilter: scope.allowsDepartmentFilter };
}

// Exact per-value department match ("AN1,AN2" -> AN1 | AN2 | the literal string); never substring.
function departmentFilter(scope) {
  return scope.department ? departmentWhere(scope) : undefined;
}

function employeeWhere(scope, additional = {}) {
  const where = { deletedAt: null, ...additional };
  if (scope.department) where.department = departmentFilter(scope);
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
    ...(scope.department && { departmentSnapshot: departmentFilter(scope) }),
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

function buildAttention({ license, dataQuality, leave, role, attendance = null, patrol = null }) {
  const rows = [];
  const add = (severity, title, description, count, targetPath) => {
    if (count > 0) rows.push({ severity, title, description, count, targetPath });
  };
  if (attendance) add('critical', 'กะที่ขาด / ไม่มีเช็กอิน', `ตรวจสอบ ${attendance.absentAssignments} กะที่สิ้นสุดแล้วแต่ไม่มีเช็กอิน (ไม่รวม OFF และลาที่อนุมัติ)`, attendance.absentAssignments, 'attendanceSupervisor');
  if (patrol) add('warning', 'จุดตรวจตกหล่น', 'รอบตรวจที่สิ้นสุดแล้วแต่ยังไม่มีการสแกนในช่วงรายงาน', patrol.missedRounds, 'patrolCenter');
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
  const departmentFilter = scope.department ? Prisma.sql`WHERE department = ANY(${scopedDepartmentValues(scope)}::text[])` : Prisma.empty;
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

function assignmentRowsWhere(scope, period, asOfDate) {
  const lastDay = period.nextMonthStart <= asOfDate ? period.nextMonthStart : new Date(asOfDate.getTime() + 86400000);
  return {
    workDate: { gte: period.startDate, lt: lastDay },
    ...(scope.department && { departmentSnapshot: departmentFilter(scope) }),
    ...(scope.employeeId && { employeeId: scope.employeeId })
  };
}

const ASSIGNMENT_SELECT = {
  id: true, employeeId: true, workDate: true, startTime: true, endTime: true,
  shiftType: { select: { code: true, startTime: true, endTime: true } },
  attendanceSession: { select: { state: true, voidedAt: true, expectedSiteId: true, events: { select: { eventType: true, state: true, voidedAt: true, effectiveEventAt: true, reviewReasons: true, locationEvidence: true } } } }
};

async function patrolCoverage(prismaClient, scope, period, now) {
  const from = period.startDate.toISOString().slice(0, 10);
  const to = period.endDate.toISOString().slice(0, 10);
  const filter = departmentFilter(scope);
  const checkpoints = await prismaClient.patrolCheckpoint.findMany({ where: { isActive: true, ...(filter ? { department: filter } : {}) }, select: { id: true, department: true } });
  // Scans after midnight belong to the previous patrol day; read one extra calendar day.
  const scans = await prismaClient.patrolScan.findMany({
    where: { workDate: { gte: period.startDate, lte: new Date(period.endDate.getTime() + 86400000) }, ...(filter ? { checkpointDepartment: filter } : {}) },
    select: { checkpointId: true, scannedAt: true },
    take: PATROL_SCAN_LIMIT + 1
  });
  if (scans.length > PATROL_SCAN_LIMIT) return { available: false, reason: 'PATROL_SCAN_LIMIT_EXCEEDED' };
  return { available: true, ...buildDepartmentRoundCoverage({ checkpoints, scans, from, to, asOf: now }) };
}

function kpi(key, label, value, unit, status, extra = {}) {
  return { key, label, value, unit, status, ...extra };
}

async function getExecutiveReport({ prismaClient, requestUser, filters, now = new Date(), requestId, pendingQueue = null }) {
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
  const assignmentCount = await timedExecutiveStage(requestId, 'EXEC_SCHEDULE', 1, () => prismaClient.shiftAssignment.count({ where: { workDate: { gte: period.startDate, lt: period.nextMonthStart }, ...(scope.department && { departmentSnapshot: departmentFilter(scope) }), ...(scope.employeeId && { employeeId: scope.employeeId }) } }));
  const leaveByStatusRows = await timedExecutiveStage(requestId, 'EXEC_LEAVE', 1, () => prismaClient.leaveRequest.groupBy({ by: ['status'], where: leaveWhere, _count: { _all: true } }));
  const leaveByTypeRows = await timedExecutiveStage(requestId, 'EXEC_LEAVE', 1, () => prismaClient.leaveRequest.groupBy({ by: ['leaveType', 'leaveTypeNameSnapshot'], where: leaveWhere, _count: { _all: true }, orderBy: { leaveType: 'asc' } }));
  const actionablePendingCount = await timedExecutiveStage(requestId, 'EXEC_LEAVE', 1, () => prismaClient.leaveRequest.count({ where: { status: 'PENDING', ...operationalLeaveWhere } }));
  const assignments = await timedExecutiveStage(requestId, 'EXEC_ATTENDANCE', 1, () => prismaClient.shiftAssignment.findMany({ where: assignmentRowsWhere(scope, period, asOfDate), select: ASSIGNMENT_SELECT }));
  const assignmentEmployeeIds = [...new Set(assignments.map((row) => row.employeeId).filter(Boolean))];
  const approvedLeaves = assignmentEmployeeIds.length ? await timedExecutiveStage(requestId, 'EXEC_ATTENDANCE', 1, () => prismaClient.leaveRequest.findMany({ where: { status: 'APPROVED', employeeId: { in: assignmentEmployeeIds }, ...leaveMonthWhere({ monthStart: period.startDate, nextMonthStart: period.nextMonthStart }) }, select: { employeeId: true, startDate: true, endDate: true } })) : [];
  const attendance = { ...buildAttendanceMetrics({ assignments, approvedLeaves, from: period.startDate, nextMonthStart: period.nextMonthStart, asOf: now }), asOf: now.toISOString(), basis: 'NON_OFF_ASSIGNMENTS_DUE_BY_AS_OF' };
  const patrol = await timedExecutiveStage(requestId, 'EXEC_PATROL', 2, () => patrolCoverage(prismaClient, scope, period, now));
  let pending = { available: false, total: null, byType: null };
  if (typeof pendingQueue === 'function') {
    const result = await timedExecutiveStage(requestId, 'EXEC_PENDING_QUEUE', 1, () => pendingQueue());
    pending = { available: true, total: Number(result?.summary?.total || 0), byType: result?.summary?.byType || null };
  }

  // S3: ADMIN sees every rule. Department-scoped callers only receive rules that filter by department;
  // CUSTOM_RULES read system-wide rows and are withheld (never counted, never leaked across departments).
  const isAdmin = String(requestUser?.role || '').toUpperCase() === 'ADMIN';
  const includeUnscopedRules = isAdmin && !scope.department;
  const quality = await timedExecutiveStage(requestId, 'EXEC_DATA_QUALITY', 4, () => getDataQualitySummary({ prismaClient, filters: { department: departmentFilter(scope), employeeId: scope.employeeId || undefined }, now: asOfDate, includeUnscopedRules }));
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
  const managementAttention = buildAttention({ license, dataQuality: quality, leave, role: requestUser.role, attendance, patrol: patrol.available ? patrol : null });
  const unscopedRules = includeUnscopedRules ? [] : CUSTOM_RULES.filter((rule) => rule.severity === 'CRITICAL').map((rule) => rule.name);
  const dataQualityAvailability = unscopedRules.length ? 'PARTIAL_SCOPE' : 'AVAILABLE';
  const licenseAttention = license.expired + license.expiringWithin30Days;
  const kpis = [
    kpi('attendanceRate', 'อัตราการมาปฏิบัติงาน', attendance.attendanceRate, '%', attendance.attendanceRate === null ? 'neutral' : attendance.attendanceRate < 95 ? 'warning' : 'success', { numerator: attendance.checkedInAssignments, denominator: attendance.scheduledAssignments, group: 'operations', targetPath: 'attendanceSupervisor' }),
    kpi('absentAssignments', 'ขาด / ไม่ได้เช็กอิน', attendance.absentAssignments, 'กะ', attendance.absentAssignments > 0 ? 'critical' : 'success', { group: 'operations', targetPath: 'attendanceSupervisor' }),
    kpi('patrolCoverage', 'ความครบถ้วนการตรวจจุด', patrol.available ? patrol.coveragePercent : null, '%', !patrol.available || patrol.coveragePercent === null ? 'neutral' : patrol.coveragePercent < 90 ? 'warning' : 'success', { numerator: patrol.available ? patrol.scannedRounds : null, denominator: patrol.available ? patrol.expectedRounds : null, group: 'operations', targetPath: 'patrolCenter', ...(patrol.available ? {} : { unavailableLabel: 'ข้อมูลเกินขีดจำกัด' }) }),
    kpi('assistOtherSite', 'ช่วยปฏิบัติงานต่าง Site', attendance.assistOtherSiteCheckIns, 'เช็กอิน', 'neutral', { group: 'operations', targetPath: 'attendanceSupervisor' }),
    kpi('licenseAttention', 'ใบอนุญาตหมดอายุ / ใกล้หมดอายุ 30 วัน', licenseAttention, 'รายการ', license.expired > 0 ? 'critical' : licenseAttention > 0 ? 'warning' : 'success', { breakdown: { expired: license.expired, expiringWithin30Days: license.expiringWithin30Days }, group: 'action', targetPath: 'licenses' }),
    kpi('pendingLeave', 'คำขอลารออนุมัติ', actionablePendingCount, 'รายการ', actionablePendingCount > 0 ? 'warning' : 'success', { group: 'action', targetPath: 'leavePending' }),
    kpi('pendingQueue', 'รายการรอดำเนินการ', pending.total, 'รายการ', pending.total > 0 ? 'warning' : 'neutral', { asOf: 'CURRENT', group: 'action', targetPath: 'approvalCenter', ...(pending.available ? {} : { unavailableLabel: 'ไม่พร้อมใช้งาน' }) }),
    kpi('criticalDataQuality', 'ประเด็นคุณภาพข้อมูลวิกฤต', quality.summary.critical, 'รายการ', quality.summary.critical > 0 ? 'critical' : 'success', { group: 'action', targetPath: isAdmin ? 'dataQuality' : null, ...(unscopedRules.length ? { unavailableLabel: SCOPE_UNAVAILABLE_LABEL, unavailableRules: unscopedRules } : {}) })
  ];

  return {
    period: { year, month, startDate: period.startDate.toISOString().slice(0, 10), endDate: period.endDate.toISOString().slice(0, 10), label: thaiMonthLabel(year, month) },
    scope: { departmentId: null, departmentName: scope.label, allowsDepartmentFilter: scope.allowsDepartmentFilter, availableDepartments: workforceByDepartment.map((item) => item.label).filter((item) => item !== 'ไม่ระบุหน่วยงาน') },
    executiveSummary: kpis,
    attendance,
    patrol: patrol.available ? { available: true, expectedRounds: patrol.expectedRounds, scannedRounds: patrol.scannedRounds, missedRounds: patrol.missedRounds, coveragePercent: patrol.coveragePercent, byDepartment: patrol.byDepartment, config: patrol.config, checkpointBasis: 'CURRENT_ACTIVE_CHECKPOINTS' } : { available: false, reason: patrol.reason, byDepartment: [] },
    pendingQueue: { ...pending, asOf: 'CURRENT' },
    dataQualityAvailability,
    workforce: { totalEmployees, activeEmployees, byDepartment: workforceByDepartment, asOfDate: workforceAsOfDate.toISOString().slice(0, 10) },
    schedule: { assignmentCount, periodNote: 'จำนวนรายการจัดเวรตามหน่วยงานที่บันทึกไว้ในเวลาจัดเวร ไม่ใช่ตัวชี้วัด Coverage หรือกำลังคนขาด' },
    leave,
    license,
    dataQuality: { ...quality.summary, categories: quality.categories, asOfDate: asOfDate.toISOString().slice(0, 10) },
    managementAttention,
    generatedAt: now.toISOString(),
    meta: { queryOperationCount: QUERY_OPERATION_COUNT, queryStrategy: 'sequential', historicalSemantics: { workforce: 'AS_OF_PERIOD_END_OR_TODAY', schedule: 'DEPARTMENT_SNAPSHOT', attendance: 'DEPARTMENT_SNAPSHOT_AS_OF_NOW', patrol: 'CURRENT_ACTIVE_CHECKPOINTS', leave: 'DEPARTMENT_SNAPSHOT', license: 'CURRENT_STATE', dataQuality: 'CURRENT_STATE', pendingQueue: 'CURRENT_STATE' } }
  };
}

module.exports = { QUERY_OPERATION_COUNT, departmentFilter, bangkokDateStart, currentBangkokPeriod, monthBounds, resolveReportScope, leaveScopeWhere, historicalLeaveScopeWhere, operationalLeaveScopeWhere, buildAttention, workforceSnapshot, getExecutiveReport };
