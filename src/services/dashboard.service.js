'use strict';

const EMPTY_ID = '00000000-0000-0000-0000-000000000000';
const LICENSE_STATUSES = ['PENDING', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'REJECTED', 'EXPIRED', 'SUPERSEDED'];
const ACTIVE_LEAVE_STATUSES = ['PENDING', 'APPROVED'];

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
  return rows.filter((row) => row.count > 0);
}

async function getDashboardSummary({ prismaClient, requestUser, now = new Date() }) {
  const client = prismaClient || require('../config/prisma');
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowStart = new Date(todayStart); tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const expiry30 = new Date(todayStart); expiry30.setUTCDate(expiry30.getUTCDate() + 30);
  const employeeWhere = { deletedAt: null, ...employeeScope(requestUser) };
  const relationScope = employeeScope(requestUser, true);
  const canManage = ['ADMIN', 'MANAGER'].includes(requestUser.role);
  const canAdmin = requestUser.role === 'ADMIN';
  const licenseWhere = { ...relationScope };
  const leaveWhere = { ...relationScope };
  const shiftWhere = { ...relationScope };
  const quotaWhere = canAdmin ? {} : relationScope;

  const [totalEmployees, activeEmployees, organizationalUnits, todayAssignments, monthShifts, leaveToday, leaveMonth, pendingLeaves, pendingUsers, pendingApprovals, licenseStatusRows, expiringLicenseRows, unmatchedQuotas, recentActivity] = await Promise.all([
    client.employee.count({ where: employeeWhere }),
    client.employee.count({ where: { ...employeeWhere, isActive: true } }),
    client.employee.findMany({ where: employeeWhere, select: { department: true }, distinct: ['department'] }),
    client.shiftAssignment.findMany({ where: { ...shiftWhere, workDate: { gte: todayStart, lt: tomorrowStart } }, select: { employeeId: true }, distinct: ['employeeId'] }),
    client.shiftAssignment.count({ where: { ...shiftWhere, workDate: { gte: monthStart, lt: nextMonth } } }),
    client.leaveRequest.count({ where: { ...leaveWhere, status: { in: ACTIVE_LEAVE_STATUSES }, startDate: { lte: todayStart }, endDate: { gte: todayStart } } }),
    client.leaveRequest.count({ where: { ...leaveWhere, startDate: { lt: nextMonth }, endDate: { gte: monthStart } } }),
    client.leaveRequest.count({ where: { ...leaveWhere, status: 'PENDING' } }),
    canAdmin || (requestUser.role === 'MANAGER' && requestUser.department) ? client.user.count({ where: { accountStatus: 'PENDING', ...(requestUser.role === 'MANAGER' ? { department: requestUser.department } : {}) } }) : 0,
    canManage ? client.scheduleApproval.count({ where: { status: { in: ['DRAFT', 'PENDING'] } } }) : 0,
    client.employeeLicenseDocument.groupBy({ by: ['status'], where: licenseWhere, _count: { _all: true } }),
    client.employeeLicenseDocument.findMany({
      where: expiringLicenseWhere(licenseWhere, expiry30),
      select: { employeeId: true, licenseId: true, proposedExpiryDate: true, employee: { select: { employeeCode: true, firstName: true, lastName: true, displayName: true } } },
      orderBy: { proposedExpiryDate: 'asc' }
    }),
    canAdmin ? client.leaveQuota.count({ where: { matchStatus: { in: ['UNMATCHED', 'DUPLICATE_UNMATCHED'] } } }) : client.leaveQuota.count({ where: { ...quotaWhere, matchStatus: { in: ['UNMATCHED', 'DUPLICATE_UNMATCHED'] } } }),
    canAdmin ? client.auditLog.findMany({ take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, action: true, entityType: true, createdAt: true, actor: { select: { displayName: true, role: true } } } }) : []
  ]);

  const workingToday = todayAssignments.length;
  const expiringLicenses = buildExpiringLicenseDetails(expiringLicenseRows, todayStart);
  const licenseSummary = licenseStatusSummary(licenseStatusRows);
  const summary = {
    totalEmployees,
    activeEmployees,
    organizationalUnits: organizationalUnits.map((row) => row.department).filter(Boolean).length,
    workingToday,
    leaveToday,
    leaveMonth,
    monthShifts,
    notScheduledToday: Math.max(0, activeEmployees - workingToday),
    incompleteSites: null,
    expiringLicenses: expiringLicenses.length,
    expiringLicenseDetails: expiringLicenses,
    pendingLicenseDocuments: licenseSummary.PENDING,
    pendingLeaves,
    pendingUsers,
    pendingApprovals,
    unmatchedQuotas,
    licenseSummary,
    leaveSummary: { today: leaveToday, month: leaveMonth, pending: pendingLeaves, unmatchedQuotas },
    shiftSummary: { workingToday, monthShifts, notScheduledToday: Math.max(0, activeEmployees - workingToday), incompleteSites: null },
    actionRequired: [],
    recentActivity,
    generatedAt: new Date().toISOString(),
    role: requestUser.role
  };
  summary.actionRequired = actionRequired(summary, canManage, canAdmin);
  return summary;
}

module.exports = { LICENSE_STATUSES, actionRequired, buildExpiringLicenseDetails, employeeScope, expiringLicenseWhere, getDashboardSummary, licenseStatusSummary };
