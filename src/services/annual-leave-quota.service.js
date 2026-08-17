'use strict';

const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');

const ANNUAL_LEAVE_ENTITLEMENT = Object.freeze({ sickLeave: 30, personalLeave: 3, vacationLeave: 6 });
const MIN_QUOTA_YEAR = 2000;
const MAX_QUOTA_YEAR = 2200;
const LEAVE_QUOTA_ALREADY_EXISTS = 'LEAVE_QUOTA_ALREADY_EXISTS';
const LEAVE_QUOTA_STATE_CONFLICT = 'LEAVE_QUOTA_STATE_CONFLICT';
const LEAVE_QUOTA_LEGACY_AMBIGUOUS = 'LEAVE_QUOTA_LEGACY_AMBIGUOUS';

function validateQuotaYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < MIN_QUOTA_YEAR || year > MAX_QUOTA_YEAR) {
    throw new HttpError(400, 'Invalid leave quota year.', { code: 'LEAVE_QUOTA_YEAR_INVALID' });
  }
  return year;
}

function bangkokQuotaYear(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).formatToParts(now);
  return Number(parts.find((part) => part.type === 'year')?.value || now.getUTCFullYear());
}

function annualFingerprint(employeeId, quotaYear) {
  return crypto.createHash('sha256').update(`v3:annual-leave-quota:${employeeId}:${quotaYear}:${crypto.randomUUID()}`).digest('hex');
}

async function resolveAnnualQuotaState(tx, employeeId, quotaYear) {
  const year = validateQuotaYear(quotaYear);
  const [annual, legacy] = await Promise.all([
    tx.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId, quotaYear: year } } }),
    tx.leaveQuota.findMany({ where: { employeeId, quotaYear: null }, select: { id: true, matchStatus: true } })
  ]);
  if (annual) return { state: 'ANNUAL_EXISTS', quota: annual, quotaYear: year };
  if (legacy.length) return { state: 'LEGACY_AMBIGUOUS', legacyCount: legacy.length, quotaYear: year };
  return { state: 'NO_QUOTA', quotaYear: year };
}

async function ensureEmployeeEligible(tx, employeeId) {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, deletedAt: null, isActive: true },
    select: { id: true, firstName: true, lastName: true, displayName: true }
  });
  if (!employee) throw new HttpError(404, 'Selected employee is unavailable.');
  return employee;
}

async function ensureAnnualQuotaInTransaction(tx, { employeeId, quotaYear, source = 'ON_DEMAND', auditService = audit }) {
  const year = validateQuotaYear(quotaYear);
  const employee = await ensureEmployeeEligible(tx, employeeId);
  const state = await resolveAnnualQuotaState(tx, employeeId, year);
  if (state.state === 'ANNUAL_EXISTS') return { quota: state.quota, created: false };
  if (state.state === 'LEGACY_AMBIGUOUS') {
    throw new HttpError(409, 'Legacy leave quota must be classified before annual provisioning.', {
      code: LEAVE_QUOTA_LEGACY_AMBIGUOUS,
      quotaYear: year
    });
  }
  const employeeNameSnapshot = String(employee.displayName || `${employee.firstName} ${employee.lastName}`).trim();
  const sourceFingerprint = annualFingerprint(employeeId, year);
  const inserted = await tx.leaveQuota.createMany({
    data: [{
      sourceFingerprint,
      employeeId,
      quotaYear: year,
      employeeNameSnapshot,
      sickLeave: ANNUAL_LEAVE_ENTITLEMENT.sickLeave,
      personalLeave: ANNUAL_LEAVE_ENTITLEMENT.personalLeave,
      vacationLeave: ANNUAL_LEAVE_ENTITLEMENT.vacationLeave,
      matchStatus: 'MATCHED'
    }],
    skipDuplicates: true
  });
  const quota = await tx.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId, quotaYear: year } } });
  if (!quota) throw new HttpError(409, 'Leave quota state changed. Refresh and try again.', { code: LEAVE_QUOTA_STATE_CONFLICT });
  if (!inserted.count) return { quota, created: false, raceRecovered: true };
  await auditService.log({
    actorUserId: null,
    action: 'CREATE',
    entityType: 'LeaveQuota',
    entityId: quota.id,
    metadata: {
      event: 'AUTO_ANNUAL_QUOTA_PROVISIONED',
      employeeId,
      quotaYear: year,
      source,
      entitlement: { ...ANNUAL_LEAVE_ENTITLEMENT }
    }
  }, tx);
  return { quota, created: true };
}

async function ensureAnnualQuota({ employeeId, quotaYear, source = 'ON_DEMAND', prismaClient = prisma, auditService = audit }) {
  const year = validateQuotaYear(quotaYear);
  const run = () => prismaClient.$transaction(
    (tx) => ensureAnnualQuotaInTransaction(tx, { employeeId, quotaYear: year, source, auditService }),
    { isolationLevel: 'Serializable' }
  );
  const rereadWinner = () => prismaClient.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId, quotaYear: year } } });
  try {
    return await run();
  } catch (error) {
    if (error?.code === 'P2002' || error?.code === 'P2034') {
      const winner = await rereadWinner();
      if (winner) return { quota: winner, created: false, raceRecovered: true };
      if (error?.code === 'P2034') {
        try {
          return await run();
        } catch (retryError) {
          if (retryError?.code === 'P2002' || retryError?.code === 'P2034') {
            const retryWinner = await rereadWinner();
            if (retryWinner) return { quota: retryWinner, created: false, raceRecovered: true };
          }
          if (retryError?.code === 'P2034') throw new HttpError(409, 'Leave quota state changed. Refresh and try again.', { code: LEAVE_QUOTA_STATE_CONFLICT });
          throw retryError;
        }
      }
    }
    throw error;
  }
}

async function lockAnnualQuotas(tx, employeeId, quotaYears) {
  const years = [...new Set(quotaYears.map(validateQuotaYear))].sort((a, b) => a - b);
  for (const quotaYear of years) {
    await tx.$queryRaw`SELECT id FROM leave_quotas WHERE employee_id = ${employeeId}::uuid AND quota_year = ${quotaYear} FOR UPDATE`;
  }
  return years;
}

module.exports = {
  ANNUAL_LEAVE_ENTITLEMENT,
  MIN_QUOTA_YEAR,
  MAX_QUOTA_YEAR,
  LEAVE_QUOTA_ALREADY_EXISTS,
  LEAVE_QUOTA_STATE_CONFLICT,
  LEAVE_QUOTA_LEGACY_AMBIGUOUS,
  validateQuotaYear,
  bangkokQuotaYear,
  annualFingerprint,
  resolveAnnualQuotaState,
  ensureAnnualQuotaInTransaction,
  ensureAnnualQuota,
  lockAnnualQuotas
};
