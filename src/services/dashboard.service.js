'use strict';

const { performance } = require('node:perf_hooks');
const { logger } = require('../utils/logger');

const EMPTY_ID = '00000000-0000-0000-0000-000000000000';
const LICENSE_STATUSES = ['PENDING', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'REJECTED', 'EXPIRED', 'SUPERSEDED'];
const ACTIVE_LEAVE_STATUSES = ['PENDING', 'APPROVED'];
const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const TECHNICAL_AUDIT_ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'REFRESH', 'LOGOUT', 'LOGOUT_ALL', 'TOKEN_REUSE'];

function employeeScope(user, relation = false) {
  if (user.role === 'ADMIN') return relation ? { employee: { is: { isActive: true, deletedAt: null } } } : {};
  if (user.role === 'MANAGER' && user.department) {
    return relation ? { employee: { is: { department: user.department, isActive: true, deletedAt: null } } } : { department: user.department };
  }
  return relation ? { employee: { is: { id: user.employeeId || EMPTY_ID, isActive: true, deletedAt: null } } } : { id: user.employeeId || EMPTY_ID };
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
    relationScope: requested ? { employee: { is: { department: requested, isActive: true, deletedAt: null } } } : relation
  };
}

function actionableQuotaWhere(scope) {
  return {
    OR: [
      { employeeId: null },
      scope?.employee?.is ? scope : { employee: { is: { isActive: true, deletedAt: null } } }
    ]
  };
}

function pendingUserWhere(requestUser) {
  return {
    accountStatus: 'PENDING',
    ...(requestUser.role === 'MANAGER' ? { department: requestUser.department } : {}),
    OR: [
      { employeeId: null },
      { employee: { is: { isActive: true, deletedAt: null } } }
    ]
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

// Keep per-request DB concurrency aligned with the conservative Prisma/Supabase Pooler floor.
// Higher fan-out only queues behind connection_limit=2 and increases cross-request contention.
const DASHBOARD_QUERY_CONCURRENCY = 2;

async function settleDashboardQueries(tasks, context = {}) {
  const results = new Array(tasks.length);
  const stageTimings = new Map();
  let cursor = 0;
  const requestedConcurrency = Number(context.maxConcurrency || DASHBOARD_QUERY_CONCURRENCY);
  const concurrency = Math.max(1, Math.min(
    DASHBOARD_QUERY_CONCURRENCY,
    Number.isFinite(requestedConcurrency) ? Math.floor(requestedConcurrency) : DASHBOARD_QUERY_CONCURRENCY,
    tasks.length || 1
  ));
  const runNext = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      const task = tasks[index];
      const descriptor = typeof task === 'function' ? { run: task, stage: null } : task;
      const startedAt = performance.now();
      let status = 'ok';
      try { results[index] = { status: 'fulfilled', value: await descriptor.run() }; }
      catch (reason) { status = 'error'; results[index] = { status: 'rejected', reason }; }
      finally {
        if (descriptor.stage) {
          const current = stageTimings.get(descriptor.stage) || { durationMs: 0, status: 'ok' };
          current.durationMs += performance.now() - startedAt;
          if (status === 'error') current.status = 'error';
          stageTimings.set(descriptor.stage, current);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => runNext()));
  if (context.requestId) stageTimings.forEach((timing, stage) => logger.info('performance_stage', {
    requestId: context.requestId, operation: 'dashboard', stage, durationMs: Number(timing.durationMs.toFixed(2)), status: timing.status
  }));
  return results;
}
function countGroupedRows(rows, predicate = () => true) {
  return rows.reduce((sum, row) => predicate(row) ? sum + Number(row._count?._all || 0) : sum, 0);
}

async function workforceAggregate(client, employeeWhere) {
  if (typeof client.employee?.groupBy === 'function') {
    try {
      const rows = await client.employee.groupBy({ by: ['isActive'], where: employeeWhere, _count: { _all: true } });
      return { total: countGroupedRows(rows), active: countGroupedRows(rows, (row) => row.isActive === true), partialError: false };
    } catch (_) { /* legacy fallback below */ }
  }
  const results = await settleDashboardQueries([
    () => client.employee.count({ where: employeeWhere }),
    () => client.employee.count({ where: { ...employeeWhere, isActive: true } })
  ], { maxConcurrency: 1 });
  return { total: results[0]?.status === 'fulfilled' ? results[0].value : 0, active: results[1]?.status === 'fulfilled' ? results[1].value : 0, partialError: results.some((result) => result.status === 'rejected') };
}

async function monthlyLeaveAggregate(client, leaveWhere, monthStart, nextMonth) {
  const where = { ...leaveWhere, startDate: { lt: nextMonth }, endDate: { gte: monthStart } };
  if (typeof client.leaveRequest?.groupBy !== 'function') {
    try { return { total: await client.leaveRequest.count({ where }), rows: [], partialError: false }; }
    catch (_) { return { total: 0, rows: [], partialError: true }; }
  }
  try {
    const rows = await client.leaveRequest.groupBy({ by: ['status'], where, _count: { _all: true } });
    return { total: countGroupedRows(rows), rows, partialError: false };
  } catch (_) {
    try { return { total: await client.leaveRequest.count({ where }), rows: [], partialError: true }; }
    catch (_) { return { total: 0, rows: [], partialError: true }; }
  }
}
function summarizeLicenseGroups(rows, { todayStart, expiry30, expiry90 }) {
  const statusRows = LICENSE_STATUSES.map((status) => ({ status, _count: { _all: countGroupedRows(rows, (row) => row.status === status) } })).filter((row) => row._count._all > 0);
  const approvedCurrent = (row) => row.status === 'APPROVED' && row.isCurrent === true;
  const dateOf = (row) => new Date(row.proposedExpiryDate);
  const expiredByDate = countGroupedRows(rows, (row) => approvedCurrent(row) && dateOf(row) < todayStart);
  const expiringWithin30 = countGroupedRows(rows, (row) => approvedCurrent(row) && dateOf(row) >= todayStart && dateOf(row) <= expiry30);
  const expiringWithin90 = countGroupedRows(rows, (row) => approvedCurrent(row) && dateOf(row) > expiry30 && dateOf(row) <= expiry90);
  const valid = countGroupedRows(rows, (row) => approvedCurrent(row) && dateOf(row) > expiry90);
  const expiredStatus = countGroupedRows(rows, (row) => row.status === 'EXPIRED' && row.isCurrent === true);
  const pendingReview = countGroupedRows(rows, (row) => row.status === 'PENDING');
  const expiringTotal = countGroupedRows(rows, (row) => approvedCurrent(row) && dateOf(row) <= expiry30);
  return { statusRows, categoryCounts: [expiredByDate, expiringWithin30, expiringWithin90, valid, expiredStatus, pendingReview], expiringTotal, partialError: false };
}

async function legacyLicenseAggregate(client, licenseWhere, approvedCurrentWhere, todayStart, expiry30, expiry90) {
  const results = await settleDashboardQueries([
    () => groupByIfAvailable(client.employeeLicenseDocument, { by: ['status'], where: licenseWhere, _count: { _all: true } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...approvedCurrentWhere, proposedExpiryDate: { lt: todayStart } } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...approvedCurrentWhere, proposedExpiryDate: { gte: todayStart, lte: expiry30 } } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...approvedCurrentWhere, proposedExpiryDate: { gt: expiry30, lte: expiry90 } } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...approvedCurrentWhere, proposedExpiryDate: { gt: expiry90 } } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...licenseWhere, status: 'EXPIRED', isCurrent: true } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: { ...licenseWhere, status: 'PENDING' } }),
    () => countIfAvailable(client.employeeLicenseDocument, { where: expiringLicenseWhere(licenseWhere, expiry30) })
  ], { maxConcurrency: 1 });
  return {
    statusRows: results[0]?.status === 'fulfilled' ? results[0].value : [],
    categoryCounts: results.slice(1, 7).map((result) => result?.status === 'fulfilled' ? result.value : null),
    expiringTotal: results[7]?.status === 'fulfilled' ? results[7].value : null,
    partialError: results.some((result) => result.status === 'rejected')
  };
}

async function licenseAggregate(client, licenseWhere, approvedCurrentWhere, todayStart, expiry30, expiry90) {
  if (typeof client.employeeLicenseDocument?.groupBy === 'function') {
    try {
      const rows = await client.employeeLicenseDocument.groupBy({ by: ['status', 'isCurrent', 'proposedExpiryDate'], where: licenseWhere, _count: { _all: true } });
      return summarizeLicenseGroups(rows, { todayStart, expiry30, expiry90 });
    } catch (_) { /* legacy fallback below */ }
  }
  return legacyLicenseAggregate(client, licenseWhere, approvedCurrentWhere, todayStart, expiry30, expiry90);
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

async function getDashboardSummary({ prismaClient, requestUser, now = new Date(), filters = {}, requestId }) {
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
  const quotaWhere = canAdmin ? actionableQuotaWhere(relationScope) : relationScope;
  const approvedCurrentWhere = { ...licenseWhere, status: 'APPROVED', isCurrent: true };
  const queryResults = await settleDashboardQueries([
    { stage: 'DASH_WORKFORCE', run: () => workforceAggregate(client, employeeWhere) },
    { stage: 'DASH_WORKFORCE', run: () => client.employee.findMany({ where: departmentWhere, select: { department: true }, distinct: ['department'] }) },
    { stage: 'DASH_TODAY_OPERATIONS', run: () => client.shiftAssignment.findMany({ where: { ...shiftWhere, workDate: { gte: todayStart, lt: tomorrowStart } }, select: { employeeId: true, shiftType: { select: { code: true, name: true, color: true } } }, distinct: ['employeeId'] }) },
    { stage: 'DASH_TODAY_OPERATIONS', run: () => client.shiftAssignment.count({ where: { ...shiftWhere, workDate: { gte: monthStart, lt: nextMonth } } }) },
    { stage: 'DASH_LEAVE', run: () => typeof client.leaveRequest?.findMany === 'function' ? Promise.resolve(null) : client.leaveRequest.count({ where: { ...leaveWhere, status: { in: ACTIVE_LEAVE_STATUSES }, startDate: { lte: todayStart }, endDate: { gte: todayStart } } }) },
    { stage: 'DASH_TODAY_OPERATIONS', run: () => findManyIfAvailable(client.leaveRequest, { where: { ...leaveWhere, status: { in: ACTIVE_LEAVE_STATUSES }, startDate: { lte: todayStart }, endDate: { gte: todayStart } }, select: { employeeId: true }, distinct: ['employeeId'] }) },
    { stage: 'DASH_LEAVE', run: () => monthlyLeaveAggregate(client, leaveWhere, monthStart, nextMonth) },
    { stage: 'DASH_LEAVE', run: () => client.leaveRequest.count({ where: { ...leaveWhere, status: 'PENDING' } }) },
    { stage: 'DASH_ATTENTION', run: () => canAdmin || (requestUser.role === 'MANAGER' && requestUser.department) ? client.user.count({ where: pendingUserWhere(requestUser) }) : 0 },
    { stage: 'DASH_ATTENTION', run: () => canManage ? client.scheduleApproval.count({ where: { status: { in: ['DRAFT', 'PENDING'] } } }) : 0 },
    { stage: 'DASH_LICENSE', run: () => licenseAggregate(client, licenseWhere, approvedCurrentWhere, todayStart, expiry30, expiry90) },
    { stage: 'DASH_LICENSE', run: () => client.employeeLicenseDocument.findMany({
      where: expiringLicenseWhere(licenseWhere, expiry30),
      select: { employeeId: true, licenseId: true, proposedExpiryDate: true, employee: { select: { employeeCode: true, firstName: true, lastName: true, displayName: true } } },
      orderBy: { proposedExpiryDate: 'asc' }, take: 100
    }) },
    { stage: 'DASH_ATTENTION', run: () => client.leaveQuota.count({ where: { ...quotaWhere, matchStatus: { in: ['UNMATCHED', 'DUPLICATE_UNMATCHED'] } } }) },
    { stage: 'DASH_AUDIT', run: () => canAdmin ? client.auditLog.findMany({ where: { action: { notIn: TECHNICAL_AUDIT_ACTIONS } }, take: 12, orderBy: { createdAt: 'desc' }, select: { id: true, action: true, entityType: true, createdAt: true, actor: { select: { displayName: true, role: true } } } }) : [] }
  ], { requestId });
  const queryErrors = [];
  const workforce = settledValue(queryResults, 0, { total: 0, active: 0, partialError: true }, 'workforce', queryErrors);
  if (workforce.partialError) queryErrors.push('workforce');
  const totalEmployees = Number(workforce.total || 0);
  const activeEmployees = Number(workforce.active || 0);
  const organizationalUnits = settledValue(queryResults, 1, [], 'workforce', queryErrors);
  const todayAssignments = settledValue(queryResults, 2, [], 'todayOperations', queryErrors);
  const monthShifts = settledValue(queryResults, 3, 0, 'todayOperations', queryErrors);
  const leaveTodayFallback = settledValue(queryResults, 4, 0, 'leaveOverview', queryErrors);
  const leaveTodayEmployeeRows = settledValue(queryResults, 5, null, 'todayOperations', queryErrors);
  const leaveToday = Array.isArray(leaveTodayEmployeeRows) ? leaveTodayEmployeeRows.length : Number(leaveTodayFallback || 0);
  const monthlyLeave = settledValue(queryResults, 6, { total: 0, rows: [], partialError: true }, 'leaveOverview', queryErrors);
  if (monthlyLeave.partialError) queryErrors.push('leaveOverview');
  const leaveMonth = Number(monthlyLeave.total || 0);
  const leaveStatusRows = monthlyLeave.rows || [];
  const pendingLeaves = settledValue(queryResults, 7, 0, 'leaveOverview', queryErrors);
  const pendingUsers = settledValue(queryResults, 8, 0, 'attention', queryErrors);
  const pendingApprovals = settledValue(queryResults, 9, 0, 'attention', queryErrors);
  const licenseAggregateResult = settledValue(queryResults, 10, { statusRows: [], categoryCounts: [null, null, null, null, null, null], expiringTotal: null, partialError: true }, 'licenseOverview', queryErrors);
  if (licenseAggregateResult.partialError) queryErrors.push('licenseOverview');
  const licenseStatusRows = licenseAggregateResult.statusRows || [];
  const licenseCategoryCounts = licenseAggregateResult.categoryCounts || [null, null, null, null, null, null];
  const expiringLicenseCount = licenseAggregateResult.expiringTotal;
  const expiringLicenseRows = settledValue(queryResults, 11, [], 'licenseExpiry', queryErrors);
  const unmatchedQuotas = settledValue(queryResults, 12, 0, 'leaveQuota', queryErrors);
  const recentActivity = settledValue(queryResults, 13, [], 'recentActivity', queryErrors);

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

module.exports = { DASHBOARD_QUERY_CONCURRENCY, LICENSE_STATUSES, actionRequired, buildExpiringLicenseDetails, employeeScope, expiringLicenseWhere, getDashboardSummary, licenseStatusSummary, settleDashboardQueries };
