'use strict';

const HttpError = require('../utils/http-error');
const { leaveRequestListWhere } = require('../utils/leave-request-list-scope');

const BALANCE_FIELDS = Object.freeze({
  SICK: 'sickLeave',
  PERSONAL: 'personalLeave',
  VACATION: 'vacationLeave'
});
const PUBLIC_UNAVAILABLE = Object.freeze({ available: false, message: 'ไม่สามารถแสดงยอดคงเหลือได้ เนื่องจากข้อมูลโควตาหรือประวัติการลาไม่ครบถ้วน' });

function failClosed() {
  return { ...PUBLIC_UNAVAILABLE };
}

function utcDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isFiniteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function calendarDays(start, end) {
  const startDay = utcDate(start);
  const endDay = utcDate(end);
  if (!startDay || !endDay || endDay < startDay) return null;
  return Math.floor((endDay.getTime() - startDay.getTime()) / 86400000) + 1;
}

function safeApprovedUsageDays(row, requestedYear) {
  const days = calendarDays(row.startDate, row.endDate);
  if (!days || !isFiniteNonNegative(row.dayCount)) return null;
  const start = utcDate(row.startDate);
  const end = utcDate(row.endDate);
  const persisted = Number(row.dayCount);
  // Legacy rows can store half-day values or totals not derivable from dates.
  // Only trust those values when their inclusive date span matches exactly.
  if (persisted !== days) return null;
  const yearStart = new Date(Date.UTC(requestedYear, 0, 1));
  const yearEnd = new Date(Date.UTC(requestedYear, 11, 31));
  if (end < yearStart || start > yearEnd) return null;
  const targetYearStart = start > yearStart ? start : yearStart;
  const targetYearEnd = end < yearEnd ? end : yearEnd;
  return calendarDays(targetYearStart, targetYearEnd);
}

async function getLeavePrintLedger(prisma, id, actor) {
  if (!['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(actor?.role)) {
    throw new HttpError(403, 'You do not have permission for this action.');
  }
  const request = await prisma.leaveRequest.findFirst({
    where: { id, ...leaveRequestListWhere(actor) },
    select: {
      id: true,
      employeeId: true,
      status: true,
      leaveType: true,
      leaveQuotaBucketSnapshot: true,
      startDate: true,
      endDate: true,
      dayCount: true
    }
  });
  if (!request) throw new HttpError(404, 'Leave request not found.');
  if (!['PENDING', 'APPROVED'].includes(request.status)) return failClosed();

  const start = utcDate(request.startDate);
  const end = utcDate(request.endDate);
  if (!start || !end || start > end || start.getUTCFullYear() !== end.getUTCFullYear()) return failClosed();
  const quotaYear = start.getUTCFullYear();
  const requestDays = calendarDays(start, end);
  if (!requestDays || !isFiniteNonNegative(request.dayCount) || Number(request.dayCount) !== requestDays) return failClosed();

  const bucket = String(request.leaveQuotaBucketSnapshot || '').trim().toUpperCase();
  const field = BALANCE_FIELDS[bucket];
  if (!field) return failClosed();

  const quota = await prisma.leaveQuota.findUnique({
    where: { employeeId_quotaYear: { employeeId: request.employeeId, quotaYear } },
    select: { employeeId: true, quotaYear: true, matchStatus: true, [field]: true }
  });
  if (!quota || quota.employeeId !== request.employeeId || quota.quotaYear !== quotaYear || quota.matchStatus !== 'MATCHED' || !isFiniteNonNegative(quota[field])) return failClosed();
  const legacyQuotas = await prisma.leaveQuota.findMany({
    where: { employeeId: request.employeeId, quotaYear: null },
    select: { id: true, matchStatus: true }
  });
  if (legacyQuotas.length) return failClosed();

  const priorApproved = await prisma.leaveRequest.findMany({
    where: {
      employeeId: request.employeeId,
      status: 'APPROVED',
      id: { not: request.id },
      startDate: { lt: new Date(Date.UTC(quotaYear + 1, 0, 1)) },
      endDate: { gte: new Date(Date.UTC(quotaYear, 0, 1)) }
    },
    select: { id: true, leaveType: true, leaveQuotaBucketSnapshot: true, startDate: true, endDate: true, dayCount: true }
  });

  let previouslyApprovedDays = 0;
  for (const row of priorApproved) {
    const priorBucket = String(row.leaveQuotaBucketSnapshot || '').trim().toUpperCase();
    if (!Object.hasOwn(BALANCE_FIELDS, priorBucket)) return failClosed();
    const usage = safeApprovedUsageDays(row, quotaYear);
    if (usage === null) return failClosed();
    if (priorBucket === bucket) previouslyApprovedDays += usage;
  }

  const entitlement = Number(quota[field]);
  const remainingBeforeDays = entitlement - previouslyApprovedDays;
  const remainingAfterDays = remainingBeforeDays - requestDays;
  return {
    available: true,
    bucket,
    entitlementDays: entitlement,
    previouslyApprovedDays,
    requestDays,
    remainingBeforeDays,
    remainingAfterDays,
    unit: 'วัน (ปฏิทิน)'
  };
}

module.exports = { getLeavePrintLedger };
