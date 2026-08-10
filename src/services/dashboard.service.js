'use strict';

const EMPTY_ID = '00000000-0000-0000-0000-000000000000';
const LICENSE_STATUSES = ['PENDING', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'REJECTED', 'EXPIRED', 'SUPERSEDED'];
const ACTIVE_LEAVE_STATUSES = ['PENDING', 'APPROVED'];
const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const TECHNICAL_AUDIT_ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'REFRESH', 'LOGOUT', 'LOGOUT_ALL', 'TOKEN_REUSE'];

function employeeScope(user, relation = false) {
  if (user.role === 'ADMIN') return {};
  if (user.role === 'MANAGER' && user.department) {
    return relation ? { employee: { is: { department: user.department, deletedAt: null } } } : { department: user.department };
  }
  return relation ? { employee: { is: { id: user.employeeId || EMPTY_ID } } } : { id: user.employeeId || EMPTY_ID };
}

function licenseStatusSummary(rows) {
  const summary = Object.fromEntries(LICENSE_STATUSES.map((status) => [status, 0]));
  rows.forEach((row) => { if (Object.hasOwn(summary, row.status)) summary[row.status] = row._count._all; });
  return summary;
}

function leaveStatusSummary(rows) {
  const summary = Object.fromEntries(LEAVE_STATUSES.map((status) => [status, 0]));
  rows.forEach((row) => { if (Object.hasOwn(summary, row.status)) summary[row.status] = row._count._all; });
  return summary;
}

function expiringLicenseWhere(relationScope, expiry30) {
  return { ...relationScope, status: 'APPROVED', isCurrent: true, proposedExpiryDate: { lte: expiry30 } };
}

function buildExpiringLicenseDetails(rows, todayStart) {
  return rows.map((row) => {
    const expiryDate = new Date(row.proposedExpiryDate);
    const daysRemaining = Math.round((Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate()) - todayStart.getTime()) / 86400000);
    const urgency = daysRemaining < 0 ? 'expired' : daysRemaining <= 7 ? 'urgent' : 'warning';
    const employee = row.employee || {};
    const employeeName = String(employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`).trim();
    return {
      employeeId: row.employeeId,
      employeeCode: employee.employeeCode || null,
      employeeName,
      licenseId: row.licenseId,
      expiryDate: expiryDate.toISOString(),
      daysRemaining,
      urgency
    };
  }).sort((left, right) => {
    const urgencyOrder = (value) => value === 'expired' ? 0 : 1;
    return urgencyOrder(left.urgency) - urgencyOrder(right.urgency)
      || left.daysRemaining - right.daysRemaining
      || new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime();
  });
}

function buildShiftSummary(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const shiftType = row.shiftType || {};
    const key = String(shiftType.code || shiftType.name || 'UNSPECIFIED');
    const current = groups.get(key) || { code: shiftType.code || null, name: shiftType.name || 'ไม่ระบุกะ', color: shiftType.color || null, count: 0 };
    current.count += 1;
    groups.set(key, current);
  });
  return [...groups.values()].sort((left, right) => right.count - left.count || String(left.name).localeCompare(String(right.name), 'th'));
}

function parseDashboardDate(value, fallback) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function parseDashboardMonth(value, fallback) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function scopeForDashboard(requestUser, requestedDepartment) {
  const requested = requestUser.role === 'ADMIN' && requestedDepartment ? requestedDepartment : undefined;
  const employee = employeeScope(requestUser);
  const relation = employeeScope(requestUser, true);
  return {
    employeeWhere: { deletedAt: null, ...employee, ...(requested ? { department: requested } : {}) },
    relationScope: requested ? { employee: { is: { department: requested, deletedAt: null } } } : relation
  };
}

function countIfAvailable(model, args) {
  return typeof model?.count === 'function' ? model.count(args) : Promise.resolve(null);
}

function groupByIfAvailable(model, args) {
  return typeof model?.groupBy === 'function' ? model.groupBy(args) : Promise.resolve([]);
}

function findManyIfAvailable(model, args) {
  return typeof model?.findMany === 'function' ? model.findMany(args) : Promise.resolve(null);
}

function settledValue(results, index, fallback, label, errors) {
  const result = results[index];
  if (result?.status === 'rejected') {
    errors.push(label);
    return fallback;
  }
  return result?.value ?? fallback;
}

async function settleDashboardQueries(tasks) {
  const results = [];
  for (const task of tasks) {
    try {
      results.push({ status: 'fulfilled', value: await task() });
    } catch (reason) {
      results.push({ status: 'rejected', reason });
    }
  }
  return results;
}

function actionRequired(summary, canManage, canAdmin) {
  const rows = [
    { key: 'licensePending', title: 'เอกสารใบอนุญาตรอตรวจสอบ', count: summary.licenseSummary.PENDING, severity: 'urgent', page: 'licenses' },
    { key: 'licenseReturned', title: 'เอกสารถูกส่งกลับแก้ไข', count: summary.licenseSummary.RETURNED_FOR_CORRECTION, severity: 'follow-up', page: 'licenses' },
    { key: 'licenseExpired', title: 'ใบอนุญาตหมดอายุ', count: summary.licenseSummary.EXPIRED, severity: 'urgent', page: 'licenses' },
    { key: 'licenseExpiring', title: 'ใบอนุญาตใกล้หมดอายุภายใน 30 วัน', count: summary.expiringLicenses, severity: 'warning', page: 'licenses' },
    ...(canManage ? [{ key: 'pendingLeaves', title: 'คำขอลารออนุมัติ', count: summary.pendingLeaves, severity: 'follow-up', page: 'leavePending' }] : []),
    ...(canManage ? [{ key: 'pendingUsers', title: 'บัญชีผู้ใช้รอตรวจสอบ', count: summary.pendingUsers, severity: 'follow-up', page: 'users' }] : []),
    { key: 'missingSchedule', title: 'พนักงานไม่มีกะวันนี้', count: summary.notScheduledToday, severity: 'warning', page: 'schedule' },
    ...(canAdmin ? [{ key: 'unmatchedQuota', title: 'โควต้าวันลายังไม่จับคู่', count: summary.unmatchedQuotas, severity: 'urgent', page: 'quota' }] : [])
  ];
  const priority = { urgent: 0, warning: 1, 'follow-up': 2 };
  return rows.filter((row) => row.count > 0).sort((left, right) => priority[left.severity] - priority[right.severity]);
}

async function getDashboardSummary({ prismaClient, requestUser, now = new Date(), filters = {} }) {
  const client = prismaClient || require('../config/prisma');
  const defaultDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayStart = parseDashboardDate(filters.date, defaultDate);
  const tomorrowStart = new Date(todayStart); tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
  const defaultMonth = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1));
  const monthStart = parseDashboardMonth(filters.month, defaultMonth);
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const expiry30 = new Date(todayStart); expiry30.setUTCDate(expiry30.getUTCDate() + 30);
  const expiry90 = new Date(todayStart); expiry90.setUTCDate(expiry90.getUTCDate() + 90);
  const { employeeWhere, relationScope } = scopeForDashboard(requestUser, filters.department);
  const departmentWhere = { deletedAt: null, ...employeeScope(requestUser) };
  const canManage = ['ADMIN', 'MANAGER'].includes(requestUser.role);
  const canAdmin = requestUser.role === 'ADMIN';
  const licenseWhere = { ...relationScope };
  const leaveWhere = { ...relationScope };
  const shiftWhere = { ...relationScope };
  const quotaWhere = canAdmin ? {} : relationScope;
  const approvedCurrentWhere = { ...licenseWhere, status: 'APPROVED', isCurrent: true };
  const licenseCategoryTasks = [
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...approvedCurrentWhere, proposedExpiryDate: { lt: todayStart } } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...approvedCurrentWhere, proposedExpiryDate: { gte: todayStart, lte: expiry30 } } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...approvedCurrentWhere, proposedExpiryDate: { gt: expiry30, lte: expiry90 } } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...approvedCurrentWhere, proposedExpiryDate: { gt: expiry90 } } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...licenseWhere, status: 'EXPIRED', isCurrent: true } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...licenseWhere, status: 'PENDING' } })
  ];

  const queryResults = await settleDashboardQueries([
    () => client.employee.count({ where: employeeWhere }),
    () => client.employee.count({ where: { ...employeeWhere, isActive: true } }),
    () => client.employee.findMany({ where: departmentWhere, select: { department: true }, distinct: ['department'] }),
    () => client.shiftAssignment.findMany({ where: { ...shiftWhere, workDate: { gte: todayStart, lt: tomorrowStart } }, select: { employeeId: true, shiftType: { select: { code: true, name: true, color: true } } }, distinct: ['employeeId'] }),
    () => client.shiftAssignment.count({ where: { ...shiftWhere, workDate: { gte: monthStart, lt: nextMonth } } }),
    () => client.leaveRequest.count({ where: { ...leaveWhere, status: { in: ACTIVE_LEAVE_STATUSES }, startDate: { lte: todayStart }, endDate: { gte: todayStart } } }),
    () => findManyIfAvailable(client.leaveRequest, { where: { ...leaveWhere, status: { in: ACTIVE_LEAVE_STATUSES }, startDate: { lte: todayStart }, endDate: { gte: todayStart } }, select: { employeeId: true }, distinct: ['employeeId'] }),
    () => client.leaveRequest.count({ where: { ...leaveWhere, startDate: { lt: nextMonth }, endDate: { gte: monthStart } } }),
    () => groupByIfAvailable(client.leaveRequest, { by: ['status'], where: { ...leaveWhere, startDate: { lt: nextMonth }, endDate: { gte: monthStart } }, _count: { _all: true } }),
    () => client.leaveRequest.count({ where: { ...leaveWhere, status: 'PENDING' } }),
    () => canAdmin || (requestUser.role === 'MANAGER' && requestUser.department) ? client.user.count({ where: { accountStatus: 'PENDING', ...(requestUser.role === 'MANAGER' ? { department: requestUser.department } : {}) } }) : 0,
    () => canManage ? client.scheduleApproval.count({ where: { status: { in: ['DRAFT', 'PENDING'] } } }) : 0,
    () => groupByIfAvailable(client.employeeLicenseDocument, { by: ['status'], where: licenseWhere, _count: { _all: true } }),
    () => client.employeeLicenseDocument.findMany({
      where: expiringLicenseWhere(licenseWhere, expiry30),
      select: { employeeId: true, licenseId: true, proposedExpiryDate: true, employee: { select: { employeeCode: true, firstName: true, lastName: true, displayName: true } } },
      orderBy: { proposedExpiryDate: 'asc' },
      take: 100
    }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: expiringLicenseWhere(licenseWhere, expiry30) }),
    async () => {
      const values = [];
      for (const task of licenseCategoryTasks) values.push(await task());
      return values;
    },
    () => canAdmin ? client.leaveQuota.count({ where: { matchStatus: { in: ['UNMATCHED', 'DUPLICATE_UNMATCHED'] } } }) : client.leaveQuota.count({ where: { ...quotaWhere, matchStatus: { in: ['UNMATCHED', 'DUPLICATE_UNMATCHED'] } } }),
    () => canAdmin ? client.auditLog.findMany({ where: { action: { notIn: TECHNICAL_AUDIT_ACTIONS } }, take: 12, orderBy: { createdAt: 'desc' }, select: { id: true, action: true, entityType: true, createdAt: true, actor: { select: { displayName: true, role: true } } } }) : []
  ]);
  const queryErrors = [];
  const totalEmployees = settledValue(queryResults, 0, 0, 'workforce', queryErrors);
  const activeEmployees = settledValue(queryResults, 1, 0, 'workforce', queryErrors);
  const organizationalUnits = settledValue(queryResults, 2, [], 'workforce', queryErrors);
  const todayAssignments = settledValue(queryResults, 3, [], 'todayOperations', queryErrors);
  const monthShifts = settledValue(queryResults, 4, 0, 'todayOperations', queryErrors);
  const leaveToday = settledValue(queryResults, 5, 0, 'leaveOverview', queryErrors);
  const leaveTodayEmployeeRows = settledValue(queryResults, 6, null, 'todayOperations', queryErrors);
  const leaveMonth = settledValue(queryResults, 7, 0, 'leaveOverview', queryErrors);
  const leaveStatusRows = settledValue(queryResults, 8, [], 'leaveOverview', queryErrors);
  const pendingLeaves = settledValue(queryResults, 9, 0, 'leaveOverview', queryErrors);
  const pendingUsers = settledValue(queryResults, 10, 0, 'attention', queryErrors);
  const pendingApprovals = settledValue(queryResults, 11, 0, 'attention', queryErrors);
  const licenseStatusRows = settledValue(queryResults, 12, [], 'licenseOverview', queryErrors);
  const expiringLicenseRows = settledValue(queryResults, 13, [], 'licenseExpiry', queryErrors);
  const expiringLicenseCount = settledValue(queryResults, 14, null, 'licenseExpiry', queryErrors);
  const licenseCategoryCounts = settledValue(queryResults, 15, [null, null, null, null, null, null], 'licenseOverview', queryErrors);
  const unmatchedQuotas = settledValue(queryResults, 16, 0, 'leaveQuota', queryErrors);
  const recentActivity = settledValue(queryResults, 17, [], 'recentActivity', queryErrors);

  const workingToday = todayAssignments.length;
  const expiringLicenses = buildExpiringLicenseDetails(expiringLicenseRows, todayStart);
  const licenseSummary = licenseStatusSummary(licenseStatusRows);
  const hasLicenseCount = typeof client.employeeLicenseDocument.count === 'function';
  const [expiredByDate = 0, expiringWithin30 = 0, expiringWithin90 = 0, valid = 0, expiredStatus = 0, pendingReview = 0] = licenseCategoryCounts;
  const licenseOverview = hasLicenseCount ? {
    valid,
    expiringWithin30,
    expiringWithin90,
    expired: Number(expiredByDate || 0) + Number(expiredStatus || 0),
    pendingReview
  } : {
    valid: Math.max(0, licenseSummary.APPROVED - expiringLicenses.length),
    expiringWithin30: expiringLicenses.filter((row) => row.daysRemaining >= 0).length,
    expiringWithin90: expiringLicenses.filter((row) => row.daysRemaining > 30).length,
    expired: licenseSummary.EXPIRED + expiringLicenses.filter((row) => row.daysRemaining < 0).length,
    pendingReview: licenseSummary.PENDING
  };
  const leaveOverview = leaveStatusSummary(leaveStatusRows);
  const leaveTodayEmployeeIds = Array.isArray(leaveTodayEmployeeRows) ? new Set(leaveTodayEmployeeRows.map((row) => row.employeeId)) : null;
  const onDutyToday = leaveTodayEmployeeIds ? todayAssignments.filter((row) => !leaveTodayEmployeeIds.has(row.employeeId)).length : workingToday;
  const todayOperations = {
    totalScheduled: workingToday,
    onDuty: onDutyToday,
    onLeave: leaveToday,
    noShift: Math.max(0, activeEmployees - workingToday),
    byShift: buildShiftSummary(todayAssignments)
  };
  const summary = {
    totalEmployees,
    activeEmployees,
    organizationalUnits: organizationalUnits.map((row) => row.department).filter(Boolean).length,
    workingToday,
    onDutyToday,
    leaveToday,
    leaveMonth,
    monthShifts,
    notScheduledToday: Math.max(0, activeEmployees - workingToday),
    incompleteSites: null,
    expiringLicenses: typeof expiringLicenseCount === 'number' ? expiringLicenseCount : expiringLicenses.length,
    expiringLicenseDetails: expiringLicenses,
    pendingLicenseDocuments: licenseSummary.PENDING,
    pendingLeaves,
    pendingUsers,
    pendingApprovals,
    unmatchedQuotas,
    licenseSummary,
    leaveSummary: { today: leaveToday, month: leaveMonth, pending: pendingLeaves, unmatchedQuotas, ...leaveOverview },
    leaveOverview: { total: leaveMonth, ...leaveOverview },
    licenseOverview,
    todayOperations,
    context: {
      date: todayStart.toISOString().slice(0, 10),
      month: monthStart.toISOString().slice(0, 7),
      department: requestUser.role === 'ADMIN' ? (filters.department || '') : (requestUser.department || ''),
      departments: organizationalUnits.map((row) => row.department).filter(Boolean).sort((left, right) => String(left).localeCompare(String(right), 'th'))
    },
    shiftSummary: { workingToday, monthShifts, notScheduledToday: Math.max(0, activeEmployees - workingToday), incompleteSites: null },
    actionRequired: [],
    recentActivity,
    partialErrors: [...new Set(queryErrors)],
    generatedAt: new Date().toISOString(),
    role: requestUser.role
  };
  summary.actionRequired = actionRequired(summary, canManage, canAdmin);
  return summary;
}

module.exports = { LICENSE_STATUSES, actionRequired, buildExpiringLicenseDetails, employeeScope, expiringLicenseWhere, getDashboardSummary, licenseStatusSummary };
