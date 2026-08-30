'use strict';

const HttpError = require('../utils/http-error');
const {
  validateQuotaYear,
  ensureAnnualQuotaInTransaction,
  lockAnnualQuotas
} = require('./annual-leave-quota.service');

const AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT = 'AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT';
const LEAVE_QUOTA_INSUFFICIENT = 'LEAVE_QUOTA_INSUFFICIENT';

function utcDateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Invalid leave date.');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function nativeUsageByQuotaYear(startDate, endDate) {
  const start = utcDateOnly(startDate);
  const end = utcDateOnly(endDate);
  if (end < start) throw new HttpError(400, 'Start date must not be after end date.');
  const usage = {};
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const year = cursor.getUTCFullYear();
    usage[year] = (usage[year] || 0) + 1;
  }
  return usage;
}

function usageTotal(usage) {
  return Object.values(usage).reduce((sum, value) => sum + Number(value || 0), 0);
}

function persistedUsageByQuotaYear(leave) {
  const start = utcDateOnly(leave.startDate);
  const end = utcDateOnly(leave.endDate);
  const persisted = Number(leave.dayCount);
  if (!Number.isFinite(persisted) || persisted < 0) {
    throw new HttpError(409, 'Historical leave day count is invalid.', { code: AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT });
  }
  if (start.getUTCFullYear() === end.getUTCFullYear()) return { [start.getUTCFullYear()]: persisted };
  const reconstructed = nativeUsageByQuotaYear(start, end);
  if (Math.abs(usageTotal(reconstructed) - persisted) > 0.000001) {
    throw new HttpError(409, 'Historical cross-year leave cannot be attributed safely.', {
      code: AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT,
      leaveRequestId: leave.id || undefined
    });
  }
  return reconstructed;
}

function yearBounds(quotaYears) {
  const years = [...new Set(quotaYears.map(validateQuotaYear))].sort((a, b) => a - b);
  return {
    years,
    start: new Date(Date.UTC(years[0], 0, 1)),
    endExclusive: new Date(Date.UTC(years[years.length - 1] + 1, 0, 1))
  };
}

async function approvedUsageByYear(tx, { employeeId, leaveType, quotaYears, excludeId }) {
  const bounds = yearBounds(quotaYears);
  const rows = await tx.leaveRequest.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      startDate: { lt: bounds.endExclusive },
      endDate: { gte: bounds.start },
      ...(excludeId && { id: { not: excludeId } })
    },
    select: { id: true, leaveType: true, startDate: true, endDate: true, dayCount: true }
  });
  const usage = Object.fromEntries(bounds.years.map((year) => [year, 0]));
  const targetField = quotaFieldForLeaveType(leaveType);
  for (const row of rows) {
    if (quotaFieldForLeaveType(row.leaveType) !== targetField) continue;
    const allocated = persistedUsageByQuotaYear(row);
    for (const year of bounds.years) usage[year] += Number(allocated[year] || 0);
  }
  return usage;
}

function quotaFieldForLeaveType(leaveType) {
  const value = String(leaveType || '').trim().toLowerCase();
  if (value.includes('ป่วย') || value.includes('sick')) return 'sickLeave';
  if (value.includes('กิจ') || value.includes('personal')) return 'personalLeave';
  if (value.includes('พักร้อน') || value.includes('vacation')) return 'vacationLeave';
  throw new HttpError(400, 'Unsupported leave type.');
}

async function ensureQuotaRows(tx, { employeeId, quotaYears, source, leavePolicySnapshot }) {
  const result = new Map();
  for (const quotaYear of [...new Set(quotaYears)].sort((a, b) => a - b)) {
    const ensured = await ensureAnnualQuotaInTransaction(tx, { employeeId, quotaYear, source, leavePolicySnapshot });
    result.set(quotaYear, ensured.quota);
  }
  return result;
}

async function validateAnnualLeaveAvailability(tx, {
  employeeId,
  leaveType,
  requestedUsageByYear,
  excludeId,
  source = 'ON_DEMAND',
  lock = false,
  stageTimer = async (_stage, operation) => operation(),
  leavePolicySnapshot
}) {
  const quotaYears = Object.keys(requestedUsageByYear).map(Number).sort((a, b) => a - b);
  if (!quotaYears.length) throw new HttpError(400, 'Leave request has no chargeable days.');
  const quotas = await stageTimer('quota_ensure', () => ensureQuotaRows(tx, { employeeId, quotaYears, source, leavePolicySnapshot }));
  if (lock) await stageTimer('quota_lock', () => lockAnnualQuotas(tx, employeeId, quotaYears));
  const used = await stageTimer('approved_usage_lookup', () => approvedUsageByYear(tx, { employeeId, leaveType, quotaYears, excludeId }));
  const field = quotaFieldForLeaveType(leaveType);
  const balances = {};
  for (const quotaYear of quotaYears) {
    const entitlement = Number(quotas.get(quotaYear)?.[field]);
    const alreadyUsed = Number(used[quotaYear] || 0);
    const requested = Number(requestedUsageByYear[quotaYear] || 0);
    const remaining = entitlement - alreadyUsed;
    balances[quotaYear] = { entitlement, used: alreadyUsed, requested, remaining };
    if (requested > remaining + 0.000001) {
      throw new HttpError(400, `Insufficient leave quota for ${quotaYear}. Remaining: ${remaining} day(s).`, {
        code: LEAVE_QUOTA_INSUFFICIENT,
        quotaYear,
        leaveType,
        entitlement,
        used: alreadyUsed,
        requested,
        remaining
      });
    }
  }
  return { quotas, used, balances };
}

async function annualSummary(tx, { employeeId, quotaYear }) {
  const year = validateQuotaYear(quotaYear);
  const ensured = await ensureAnnualQuotaInTransaction(tx, { employeeId, quotaYear: year, source: 'ON_DEMAND' });
  const quota = ensured.quota;
  const entitlement = {
    sickLeave: Number(quota.sickLeave),
    personalLeave: Number(quota.personalLeave),
    vacationLeave: Number(quota.vacationLeave)
  };
  const used = { sickLeave: 0, personalLeave: 0, vacationLeave: 0 };
  for (const [leaveType, field] of [['SICK', 'sickLeave'], ['PERSONAL', 'personalLeave'], ['VACATION', 'vacationLeave']]) {
    const usage = await approvedUsageByYear(tx, { employeeId, leaveType, quotaYears: [year] });
    used[field] = Number(usage[year] || 0);
  }
  return {
    quotaYear: year,
    entitlement,
    used,
    remaining: {
      sickLeave: Math.max(0, entitlement.sickLeave - used.sickLeave),
      personalLeave: Math.max(0, entitlement.personalLeave - used.personalLeave),
      vacationLeave: Math.max(0, entitlement.vacationLeave - used.vacationLeave)
    }
  };
}

module.exports = {
  AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT,
  LEAVE_QUOTA_INSUFFICIENT,
  nativeUsageByQuotaYear,
  persistedUsageByQuotaYear,
  approvedUsageByYear,
  quotaFieldForLeaveType,
  validateAnnualLeaveAvailability,
  annualSummary
};
