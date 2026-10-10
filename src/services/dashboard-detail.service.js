'use strict';

const HttpError = require('../utils/http-error');
const { actionableQuotaWhere, pendingUserWhere, scopeForDashboard, securityGuardRelationScope } = require('./dashboard.service');

function normalizedEmployee(employee = {}) {
  return {
    employeeCode: employee.employeeCode || null,
    employeeName: String(employee.displayName || [employee.firstName, employee.lastName].filter(Boolean).join(' ')).trim() || 'ไม่ระบุชื่อ',
    department: employee.department || null,
    jobTitle: employee.jobTitle || null
  };
}

function serializeRecord(metric, row) {
  if (metric === 'activeEmployees' || metric === 'totalEmployees' || metric === 'schedule' || metric === 'leaveToday') {
    const person = normalizedEmployee(row);
    const assignment = row.shiftAssignments?.[0];
    const leave = row.leaveRequests?.[0];
    const shift = assignment?.shiftType || {};
    const leaveText = leave ? String(leave.leaveType || 'ลา') + ' · ' + new Date(leave.startDate).toISOString().slice(0, 10) + '–' + new Date(leave.endDate).toISOString().slice(0, 10) : '';
    return {
      id: row.id,
      ...person,
      title: person.employeeName,
      subtitle: metric === 'schedule' ? [shift.code || shift.name, assignment?.startTime && assignment?.endTime ? assignment.startTime + '–' + assignment.endTime : null].filter(Boolean).join(' · ') : metric === 'leaveToday' ? leaveText : person.jobTitle || '',
      status: metric === 'leaveToday' ? 'APPROVED' : row.isActive ? 'ACTIVE' : 'INACTIVE',
      workDate: assignment?.workDate || null,
      shiftCode: shift.code || null
    };
  }
  if (metric === 'pendingLeaves' || metric === 'leaveMonth' || metric === 'leaveMonthStatus') {
    const person = normalizedEmployee(row.employee || {});
    const startDate = new Date(row.startDate).toISOString().slice(0, 10);
    const endDate = new Date(row.endDate).toISOString().slice(0, 10);
    return {
      id: row.id,
      ...person,
      title: row.employeeNameSnapshot || person.employeeName || 'ไม่ระบุชื่อ',
      subtitle: String(row.leaveType || 'ลา') + ' · ' + startDate + '–' + endDate,
      status: row.status,
      startDate,
      endDate
    };
  }
  if (metric === 'licenseStatus' || metric === 'licenseExpiry') {
    const person = normalizedEmployee(row.employee || {});
    return {
      id: row.id,
      ...person,
      title: person.employeeName,
      subtitle: [row.license?.licenseType || 'ใบอนุญาต รปภ.', 'หมดอายุ ' + new Date(row.proposedExpiryDate).toISOString().slice(0, 10)].join(' · '),
      status: row.status,
      expiryDate: new Date(row.proposedExpiryDate).toISOString().slice(0, 10),
      licenseId: row.licenseId
    };
  }
  if (metric === 'pendingUsers') {
    return {
      id: row.id,
      title: row.displayName || 'บัญชีผู้ใช้',
      subtitle: [row.role, row.department].filter(Boolean).join(' · '),
      status: row.accountStatus,
      department: row.department || null
    };
  }
  const person = normalizedEmployee(row.employee || {});
  return {
    id: row.id,
    ...person,
    title: row.employeeNameSnapshot || person.employeeName,
    subtitle: ['ปี ' + (row.quotaYear || 'ไม่ระบุ'), row.matchStatus].filter(Boolean).join(' · '),
    status: row.matchStatus
  };
}

function assertDashboardMetricAccess(requestUser, metric) {
  const role = requestUser?.role;
  if (!['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'].includes(role)) throw new HttpError(403, 'Dashboard metric access is not available.');
  if (metric === 'pendingLeaves' && !['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role)) throw new HttpError(403, 'Leave approval access is required.');
  if (metric === 'pendingUsers' && !['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role)) throw new HttpError(403, 'Pending account access is required.');
  if (metric === 'pendingUsers' && ['MANAGER', 'SUPERVISOR'].includes(role) && !requestUser?.department) throw new HttpError(403, 'A department scope is required for pending account access.');
  if (metric === 'unmatchedQuota' && role !== 'ADMIN') throw new HttpError(403, 'Administrator access is required.');
}

async function getDashboardDetails({ prismaClient, requestUser, filters, now = new Date() }) {
  assertDashboardMetricAccess(requestUser, filters.metric);
  const client = prismaClient || require('../config/prisma');
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  const selectedDate = typeof filters.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(filters.date)
    ? new Date(filters.date + 'T00:00:00.000Z')
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (Number.isNaN(selectedDate.getTime()) || (filters.date && selectedDate.toISOString().slice(0, 10) !== filters.date)) throw new HttpError(400, 'Dashboard date is invalid.');
  const tomorrow = new Date(selectedDate); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const monthValue = filters.month || selectedDate.toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue)) throw new HttpError(400, 'Dashboard month is invalid.');
  const [year, month] = monthValue.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const expiry30 = new Date(selectedDate); expiry30.setUTCDate(expiry30.getUTCDate() + 30);
  const expiry31 = new Date(selectedDate); expiry31.setUTCDate(expiry31.getUTCDate() + 31);
  const expiry90 = new Date(selectedDate); expiry90.setUTCDate(expiry90.getUTCDate() + 90);
  const { employeeWhere, relationScope } = scopeForDashboard(requestUser, filters.department);
  const activeEmployeeWhere = { ...employeeWhere, isActive: true, deletedAt: null };
  const leaveOnDateWhere = { status: 'APPROVED', startDate: { lte: selectedDate }, endDate: { gte: selectedDate } };
  let model;
  let where;
  let select;
  let orderBy;

  switch (filters.metric) {
    case 'activeEmployees':
      model = client.employee;
      where = { ...activeEmployeeWhere };
      select = { id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true, jobTitle: true, isActive: true };
      orderBy = [{ employeeCode: 'asc' }, { id: 'asc' }];
      break;
    case 'totalEmployees':
      model = client.employee;
      where = { ...employeeWhere };
      select = { id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true, jobTitle: true, isActive: true };
      orderBy = [{ employeeCode: 'asc' }, { id: 'asc' }];
      break;
    case 'schedule': {
      const workforce = filters.workforce || 'SCHEDULED';
      const shiftTypeFilter = filters.shiftTypeCode
        ? { code: filters.shiftTypeCode }
        : filters.shiftTypeName ? { name: filters.shiftTypeName } : undefined;
      const assignmentWhere = {
        workDate: { gte: selectedDate, lt: tomorrow },
        ...(shiftTypeFilter ? { shiftType: { is: shiftTypeFilter } } : {})
      };
      model = client.employee;
      where = workforce === 'NO_SHIFT'
        ? { ...activeEmployeeWhere, shiftAssignments: { none: { workDate: { gte: selectedDate, lt: tomorrow } } } }
        : {
            ...activeEmployeeWhere,
            shiftAssignments: { some: assignmentWhere },
            ...(workforce === 'ON_DUTY' ? { leaveRequests: { none: leaveOnDateWhere } } : {})
          };
      select = {
        id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true, jobTitle: true, isActive: true,
        shiftAssignments: { where: assignmentWhere, select: { workDate: true, startTime: true, endTime: true, shiftType: { select: { code: true, name: true } } }, take: 1 }
      };
      orderBy = [{ employeeCode: 'asc' }, { id: 'asc' }];
      break;
    }
    case 'leaveToday':
      model = client.employee;
      where = { ...activeEmployeeWhere, leaveRequests: { some: leaveOnDateWhere } };
      select = {
        id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true, jobTitle: true, isActive: true,
        leaveRequests: { where: leaveOnDateWhere, select: { leaveType: true, startDate: true, endDate: true }, orderBy: { startDate: 'asc' }, take: 1 }
      };
      orderBy = [{ employeeCode: 'asc' }, { id: 'asc' }];
      break;
    case 'pendingLeaves':
      model = client.leaveRequest;
      where = { ...relationScope, status: 'PENDING' };
      select = { id: true, employeeNameSnapshot: true, leaveType: true, status: true, startDate: true, endDate: true, employee: { select: { employeeCode: true, displayName: true, firstName: true, lastName: true, department: true } } };
      orderBy = [{ requestedAt: 'desc' }, { id: 'asc' }];
      break;
    case 'leaveMonth':
    case 'leaveMonthStatus':
      model = client.leaveRequest;
      where = {
        ...relationScope,
        startDate: { lt: nextMonth },
        endDate: { gte: monthStart },
        ...(filters.metric === 'leaveMonthStatus' ? { status: filters.status } : {})
      };
      select = { id: true, employeeNameSnapshot: true, leaveType: true, status: true, startDate: true, endDate: true, employee: { select: { employeeCode: true, displayName: true, firstName: true, lastName: true, department: true } } };
      orderBy = [{ startDate: 'asc' }, { id: 'asc' }];
      break;
    case 'licenseStatus':
    case 'licenseExpiry': {
      model = client.employeeLicenseDocument;
      const licenseScope = securityGuardRelationScope(relationScope);
      const base = { ...licenseScope };
      if (filters.metric === 'licenseStatus') {
        where = { ...base, status: filters.status };
      } else if (filters.expiryBucket === 'EXPIRED') {
        where = {
          ...base,
          OR: [
            { status: 'EXPIRED', isCurrent: true },
            { status: 'APPROVED', isCurrent: true, proposedExpiryDate: { lt: selectedDate } }
          ],
          ...(filters.licenseId ? { licenseId: filters.licenseId } : {})
        };
      } else if (filters.expiryBucket === 'EXPIRING_0_30') {
        where = { ...base, status: 'APPROVED', isCurrent: true, proposedExpiryDate: { gte: selectedDate, lte: expiry30 }, ...(filters.licenseId ? { licenseId: filters.licenseId } : {}) };
      } else if (filters.expiryBucket === 'EXPIRING_31_90') {
        where = { ...base, status: 'APPROVED', isCurrent: true, proposedExpiryDate: { gte: expiry31, lte: expiry90 }, ...(filters.licenseId ? { licenseId: filters.licenseId } : {}) };
      } else if (filters.expiryBucket === 'VALID') {
        where = { ...base, status: 'APPROVED', isCurrent: true, proposedExpiryDate: { gt: expiry90 } };
      } else if (filters.expiryBucket === 'PENDING_REVIEW') {
        where = { ...base, status: 'PENDING' };
      } else {
        throw new HttpError(400, 'License expiry bucket is invalid.');
      }
      select = {
        id: true, licenseId: true, status: true, proposedExpiryDate: true,
        employee: { select: { employeeCode: true, displayName: true, firstName: true, lastName: true, department: true, jobTitle: true } },
        license: { select: { licenseType: true } }
      };
      orderBy = [{ proposedExpiryDate: 'asc' }, { id: 'asc' }];
      break;
    }
    case 'pendingUsers':
      model = client.user;
      where = pendingUserWhere(requestUser, filters.department);
      select = { id: true, displayName: true, role: true, department: true, accountStatus: true };
      orderBy = [{ requestedAt: 'asc' }, { id: 'asc' }];
      break;
    case 'unmatchedQuota':
      model = client.leaveQuota;
      where = {
        ...actionableQuotaWhere(relationScope),
        matchStatus: { in: ['UNMATCHED', 'DUPLICATE_UNMATCHED'] }
      };
      select = { id: true, employeeNameSnapshot: true, quotaYear: true, matchStatus: true, employee: { select: { employeeCode: true, displayName: true, firstName: true, lastName: true, department: true } } };
      orderBy = [{ quotaYear: 'desc' }, { id: 'asc' }];
      break;
    default:
      throw new HttpError(400, 'Dashboard metric is invalid.');
  }

  if (!model || typeof model.count !== 'function' || typeof model.findMany !== 'function') throw new HttpError(503, 'Dashboard metric data is unavailable.');
  const [total, rows] = await client.$transaction([
    model.count({ where }),
    model.findMany({ where, select, orderBy, skip: (page - 1) * pageSize, take: pageSize })
  ]);
  return {
    metric: filters.metric,
    date: selectedDate.toISOString().slice(0, 10),
    month: monthValue,
    department: requestUser.role === 'ADMIN' ? (filters.department || '') : (requestUser.department || ''),
    status: filters.status || (filters.metric === 'pendingLeaves' ? 'PENDING' : filters.metric === 'leaveToday' ? 'APPROVED' : ''),
    expiryBucket: filters.expiryBucket || '',
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    records: rows.map((row) => serializeRecord(filters.metric, row))
  };
}

module.exports = { assertDashboardMetricAccess, getDashboardDetails, serializeRecord };
