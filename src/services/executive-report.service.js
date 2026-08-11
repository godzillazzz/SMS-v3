'use strict';

const { leaveMonthWhere } = require('../utils/leave-month-filter');
const { getDataQualitySummary } = require('./data-quality.service');
const HttpError = require('../utils/http-error');

const EMPTY_ID = '00000000-0000-0000-0000-000000000000';
const LICENSE_APPROVED = { status: 'APPROVED', isCurrent: true };
const QUERY_OPERATION_COUNT = 12;

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

function leaveScopeWhere(scope, period) {
  return {
    ...leaveMonthWhere({ monthStart: period.startDate, nextMonthStart: period.nextMonthStart }),
    employee: employeeRelation(scope)
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
  add('follow-up', 'คำขอลารอพิจารณา', 'พบคำขอลาที่ทับซ้อนกับช่วงเวลารายงานและยังรอการพิจารณา', leave.statusCounts.PENDING, 'leavePending');
  return rows.slice(0, 5);
}

function thaiMonthLabel(year, month) {
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

async function getExecutiveReport({ prismaClient, requestUser, filters, now = new Date() }) {
  const fallback = currentBangkokPeriod(now);
  const year = filters.year || fallback.year;
  const month = filters.month || fallback.month;
  const period = monthBounds(year, month);
  const scope = resolveReportScope(requestUser, filters.department);
  const activeEmployeeWhere = employeeWhere(scope, { isActive: true });
  const documentScope = { employee: employeeRelation(scope) };
  const asOfDate = bangkokDateStart(now);
  const expiry30 = new Date(asOfDate.getTime() + (30 * 86400000));
  const leaveWhere = leaveScopeWhere(scope, period);

  const totalEmployees = await prismaClient.employee.count({ where: employeeWhere(scope) });
  const activeEmployees = await prismaClient.employee.count({ where: activeEmployeeWhere });
  const departments = await prismaClient.employee.groupBy({ by: ['department'], where: activeEmployeeWhere, _count: { _all: true }, orderBy: { department: 'asc' } });
  const assignmentCount = await prismaClient.shiftAssignment.count({ where: { workDate: { gte: period.startDate, lt: period.nextMonthStart }, employee: employeeRelation(scope) } });
  const leaveByStatusRows = await prismaClient.leaveRequest.groupBy({ by: ['status'], where: leaveWhere, _count: { _all: true } });
  const leaveByTypeRows = await prismaClient.leaveRequest.groupBy({ by: ['leaveType'], where: leaveWhere, _count: { _all: true }, orderBy: { leaveType: 'asc' } });
  const quality = await getDataQualitySummary({ prismaClient, filters: { department: scope.department || undefined, employeeId: scope.employeeId || undefined }, now: asOfDate });
  const validBeyond30Days = await prismaClient.employeeLicenseDocument.count({ where: { ...LICENSE_APPROVED, ...documentScope, proposedExpiryDate: { gt: expiry30 } } });
  const pendingReview = await prismaClient.employeeLicenseDocument.count({ where: { status: 'PENDING', isCurrent: true, ...documentScope } });

  const statusCounts = numberFromGroup(leaveByStatusRows, 'status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
  const byType = leaveByTypeRows.map((row) => ({ label: row.leaveType, count: row._count?._all || 0 }));
  const workforceByDepartment = departments.map((row) => ({ label: row.department || 'ไม่ระบุหน่วยงาน', count: row._count?._all || 0 }));
  const qualityCategory = (rule) => quality.categories.find((item) => item.rule === rule)?.count || 0;
  const license = {
    expired: qualityCategory('LICENSE_EXPIRED'),
    expiringWithin30Days: qualityCategory('LICENSE_EXPIRING_WITHIN_30_DAYS'),
    validBeyond30Days,
    pendingReview,
    asOfDate: asOfDate.toISOString().slice(0, 10)
  };
  const leave = { totalRequests: Object.values(statusCounts).reduce((sum, value) => sum + value, 0), statusCounts, byType, overlapRule: 'นับคำขอลาที่มีช่วงวันลาทับซ้อนกับเดือนที่เลือก' };
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
    workforce: { totalEmployees, activeEmployees, byDepartment: workforceByDepartment },
    schedule: { assignmentCount, periodNote: 'จำนวนรายการจัดเวรในเดือนที่เลือก ไม่ใช่ตัวชี้วัด Coverage หรือกำลังคนขาด' },
    leave,
    license,
    dataQuality: { ...quality.summary, categories: quality.categories, asOfDate: asOfDate.toISOString().slice(0, 10) },
    managementAttention,
    generatedAt: now.toISOString(),
    meta: { queryOperationCount: QUERY_OPERATION_COUNT, queryStrategy: 'sequential' }
  };
}

module.exports = { QUERY_OPERATION_COUNT, bangkokDateStart, currentBangkokPeriod, monthBounds, resolveReportScope, leaveScopeWhere, buildAttention, getExecutiveReport };
