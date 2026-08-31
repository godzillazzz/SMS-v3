'use strict';

const crypto = require('node:crypto');
const { Prisma } = require('@prisma/client');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

const RETENTION_TIMEZONE = 'Asia/Bangkok';
const CLEANUP_DELAY_HOURS = 24;
const POLICY_KEYS = Object.freeze({
  operationalUsageMonths: 'RETENTION.OPERATIONAL_USAGE.MONTHS',
  attendanceRawMonths: 'RETENTION.ATTENDANCE_RAW.MONTHS',
  patrolRawMonths: 'RETENTION.PATROL_RAW.MONTHS',
  timezone: 'RETENTION.TIMEZONE'
});
const DEFAULT_POLICY = Object.freeze({
  operationalUsageMonths: 6,
  attendanceRawMonths: 12,
  patrolRawMonths: 3,
  timezone: RETENTION_TIMEZONE
});
const DATA_CLASSES = Object.freeze({
  OPERATIONAL_USAGE: 'OPERATIONAL_USAGE',
  ATTENDANCE_RAW: 'ATTENDANCE_RAW',
  PATROL_RAW: 'PATROL_RAW'
});

function http(statusCode, code, message, extra = {}) {
  return new HttpError(statusCode, message, { code, ...extra });
}
function assertAdmin(actor) {
  if (String(actor?.role || '').toUpperCase() !== 'ADMIN') throw http(403, 'RETENTION_ADMIN_REQUIRED', 'Data retention policy requires Admin authority.');
}
function normalizeMonths(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 120) throw http(400, 'RETENTION_MONTHS_INVALID', field + ' must be an integer between 1 and 120 months.', { field });
  return number;
}
function normalizePolicyInput(input = {}) {
  return Object.freeze({
    operationalUsageMonths: normalizeMonths(input.operationalUsageMonths, 'operationalUsageMonths'),
    attendanceRawMonths: normalizeMonths(input.attendanceRawMonths, 'attendanceRawMonths'),
    patrolRawMonths: normalizeMonths(input.patrolRawMonths, 'patrolRawMonths'),
    timezone: RETENTION_TIMEZONE
  });
}
function bangkokYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: RETENTION_TIMEZONE, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month) };
}
function calendarMonthCutoff(now, months) {
  const normalized = normalizeMonths(months, 'months');
  const { year, month } = bangkokYearMonth(now);
  const currentIndex = year * 12 + (month - 1);
  const cutoffIndex = currentIndex - (normalized - 1);
  const cutoffYear = Math.floor(cutoffIndex / 12);
  const cutoffMonthZero = ((cutoffIndex % 12) + 12) % 12;
  return new Date(Date.UTC(cutoffYear, cutoffMonthZero, 1) - 7 * 60 * 60 * 1000);
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]).filter(([, nested]) => nested !== undefined));
  return null;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function safeErrorCode(error) {
  const text = String(error?.details?.code || error?.code || error?.name || 'RETENTION_CLEANUP_FAILED').replace(/[^A-Z0-9_-]/gi, '_').toUpperCase().slice(0, 80);
  return text || 'RETENTION_CLEANUP_FAILED';
}
function policyReductions(current, proposed) {
  return {
    operationalUsageMonths: proposed.operationalUsageMonths < current.operationalUsageMonths,
    attendanceRawMonths: proposed.attendanceRawMonths < current.attendanceRawMonths,
    patrolRawMonths: proposed.patrolRawMonths < current.patrolRawMonths
  };
}
function hasReduction(reductions) { return Object.values(reductions).some(Boolean); }

async function readPolicy(client) {
  const rows = await client.systemSetting.findMany({ where: { key: { in: Object.values(POLICY_KEYS) } }, select: { key: true, value: true, updatedAt: true } });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const missing = Object.values(POLICY_KEYS).filter((key) => !byKey.has(key));
  if (missing.length) throw http(503, 'RETENTION_POLICY_SEED_MISSING', 'Data retention policy seed is incomplete.', { missingKeys: missing });
  if (byKey.get(POLICY_KEYS.timezone)?.value !== RETENTION_TIMEZONE) throw http(503, 'RETENTION_TIMEZONE_INVALID', 'Retention timezone authority must be Asia/Bangkok.');
  try {
    return Object.freeze({
      operationalUsageMonths: normalizeMonths(byKey.get(POLICY_KEYS.operationalUsageMonths).value, 'operationalUsageMonths'),
      attendanceRawMonths: normalizeMonths(byKey.get(POLICY_KEYS.attendanceRawMonths).value, 'attendanceRawMonths'),
      patrolRawMonths: normalizeMonths(byKey.get(POLICY_KEYS.patrolRawMonths).value, 'patrolRawMonths'),
      timezone: RETENTION_TIMEZONE
    });
  } catch {
    throw http(503, 'RETENTION_POLICY_VALUE_INVALID', 'Stored data retention policy is invalid.');
  }
}
async function writePolicy(client, policy) {
  const pairs = [
    [POLICY_KEYS.operationalUsageMonths, String(policy.operationalUsageMonths)],
    [POLICY_KEYS.attendanceRawMonths, String(policy.attendanceRawMonths)],
    [POLICY_KEYS.patrolRawMonths, String(policy.patrolRawMonths)]
  ];
  for (const [key, value] of pairs) {
    const result = await client.systemSetting.updateMany({ where: { key }, data: { value } });
    if (result.count !== 1) throw http(503, 'RETENTION_POLICY_SEED_MISSING', 'Data retention policy seed is incomplete.', { key });
  }
}
function monthLabel(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 7);
  return new Date(value).toISOString().slice(0, 7);
}
async function operationalImpact(client, cutoff, now) {
  const [rateLimitBuckets, alertDeduplicationStates] = await Promise.all([
    client.rateLimitBucket.count({ where: { OR: [{ expiresAt: { lte: now } }, { createdAt: { lt: cutoff } }] } }),
    client.alertDeduplicationState.count({ where: { OR: [{ expiresAt: { lte: now } }, { createdAt: { lt: cutoff } }] } })
  ]);
  return {
    adapterStatus: 'ACTIVE', cutoff: cutoff.toISOString(),
    eligible: rateLimitBuckets + alertDeduplicationStates,
    rateLimitBuckets, alertDeduplicationStates,
    intrinsicTtlMayPurgeEarlier: true, protectedAuditLog: true, emailDeliveryReservationExcluded: true
  };
}
async function attendanceImpact(client, cutoff) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT
      COUNT(*)::integer AS "totalCandidates",
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.original_event_id = e.id))::integer AS "protectedByCorrection",
      COUNT(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.original_event_id = e.id)
          AND NOT EXISTS (
            SELECT 1 FROM attendance_month_certifications cert
            WHERE cert.month = date_trunc('month', s.work_date)::date AND cert.status = 'CERTIFIED'
          )
      )::integer AS "blockedUncertified",
      COUNT(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.original_event_id = e.id)
          AND EXISTS (
            SELECT 1 FROM attendance_month_certifications cert
            WHERE cert.month = date_trunc('month', s.work_date)::date AND cert.status = 'CERTIFIED'
          )
      )::integer AS "eligible"
    FROM attendance_events e
    JOIN attendance_sessions s ON s.id = e.session_id
    WHERE e.received_at < ${cutoff}
  `);
  const blockedMonths = await client.$queryRaw(Prisma.sql`
    SELECT to_char(date_trunc('month', s.work_date), 'YYYY-MM') AS month, COUNT(*)::integer AS count
    FROM attendance_events e
    JOIN attendance_sessions s ON s.id = e.session_id
    WHERE e.received_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.original_event_id = e.id)
      AND NOT EXISTS (
        SELECT 1 FROM attendance_month_certifications cert
        WHERE cert.month = date_trunc('month', s.work_date)::date AND cert.status = 'CERTIFIED'
      )
    GROUP BY date_trunc('month', s.work_date)
    ORDER BY date_trunc('month', s.work_date)
    LIMIT 24
  `);
  const impact = rows[0] || {};
  return {
    adapterStatus: 'ACTIVE', cutoff: cutoff.toISOString(),
    totalCandidates: Number(impact.totalCandidates || 0),
    eligible: Number(impact.eligible || 0),
    blockedUncertified: Number(impact.blockedUncertified || 0),
    protectedByCorrection: Number(impact.protectedByCorrection || 0),
    blockedMonths: blockedMonths.map((row) => ({ month: monthLabel(row.month), count: Number(row.count || 0) })),
    certifiedSummariesProtected: true, correctionsProtected: true, auditLogProtected: true
  };
}
function patrolImpact(cutoff) {
  return { adapterStatus: 'NOT_AVAILABLE', cutoff: cutoff.toISOString(), eligible: 0, blocked: true, reason: 'G07 Patrol raw scan adapter is not present in the current SMS V3 authority model.' };
}

function createDataRetentionService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date() } = {}) {
  async function preview({ actor, proposedPolicy } = {}) {
    assertAdmin(actor);
    const now = clock();
    const current = await readPolicy(prisma);
    const proposed = normalizePolicyInput(proposedPolicy);
    const reductions = policyReductions(current, proposed);
    const cutoffs = {
      operationalUsage: calendarMonthCutoff(now, proposed.operationalUsageMonths),
      attendanceRaw: calendarMonthCutoff(now, proposed.attendanceRawMonths),
      patrolRaw: calendarMonthCutoff(now, proposed.patrolRawMonths)
    };
    const [operationalUsage, attendanceRaw] = await Promise.all([
      operationalImpact(prisma, cutoffs.operationalUsage, now),
      attendanceImpact(prisma, cutoffs.attendanceRaw)
    ]);
    const snapshot = {
      current, proposed, reductions, reduction: hasReduction(reductions),
      cleanupDelayHours: CLEANUP_DELAY_HOURS, timezone: RETENTION_TIMEZONE,
      impacts: {
        [DATA_CLASSES.OPERATIONAL_USAGE]: operationalUsage,
        [DATA_CLASSES.ATTENDANCE_RAW]: attendanceRaw,
        [DATA_CLASSES.PATROL_RAW]: patrolImpact(cutoffs.patrolRaw)
      },
      protectedInvariants: [
        'Security/Governance Audit is never a CFG-07 deletion target.',
        'Attendance month certification snapshots are never a CFG-07 deletion target.',
        'Attendance raw events referenced by corrections remain protected governance evidence.',
        'Uncertified Attendance months are blocked from raw-event cleanup.',
        'Patrol cleanup is fail-closed until an authoritative Patrol adapter exists.'
      ]
    };
    return { ...snapshot, previewDigest: digest(snapshot) };
  }

  async function current({ actor } = {}) {
    assertAdmin(actor);
    const [policy, pendingChange, recentRuns] = await Promise.all([
      readPolicy(prisma),
      prisma.retentionPolicyChange.findFirst({ where: { status: 'SCHEDULED' }, orderBy: { requestedAt: 'desc' } }),
      prisma.retentionCleanupRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 })
    ]);
    const now = clock();
    return {
      policy,
      cutoffs: {
        operationalUsage: calendarMonthCutoff(now, policy.operationalUsageMonths),
        attendanceRaw: calendarMonthCutoff(now, policy.attendanceRawMonths),
        patrolRaw: calendarMonthCutoff(now, policy.patrolRawMonths)
      },
      timezone: RETENTION_TIMEZONE, cleanupDelayHours: CLEANUP_DELAY_HOURS,
      pendingChange: pendingChange || null, recentRuns,
      protectedInvariants: [
        'Security/Governance Audit is retained.',
        'Certified Attendance summaries are retained.',
        'Corrected Attendance raw evidence is retained.',
        'Patrol cleanup is unavailable until G07 Patrol authority exists.'
      ]
    };
  }

  async function createChange({ actor, proposedPolicy, expectedPreviewDigest, acknowledgeImpact = false, reason } = {}) {
    assertAdmin(actor);
    const normalizedReason = String(reason || '').trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 1000) throw http(400, 'RETENTION_REASON_INVALID', 'Retention change reason must contain 5-1000 characters.');
    const fresh = await preview({ actor, proposedPolicy });
    if (!/^[a-f0-9]{64}$/.test(String(expectedPreviewDigest || '')) || expectedPreviewDigest !== fresh.previewDigest) {
      throw http(409, 'RETENTION_PREVIEW_STALE', 'Retention impact preview is stale. Run preview again.', { expectedPreviewDigest: fresh.previewDigest });
    }
    if (fresh.reduction && acknowledgeImpact !== true) throw http(400, 'RETENTION_IMPACT_ACK_REQUIRED', 'Retention reduction requires explicit impact acknowledgement.');
    const now = clock();
    const effectiveAt = fresh.reduction ? new Date(now.getTime() + CLEANUP_DELAY_HOURS * 3600000) : now;
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtext('cfg07-retention-policy-change'))`);
      const scheduled = await tx.retentionPolicyChange.findFirst({ where: { status: 'SCHEDULED' }, select: { id: true } });
      if (scheduled) throw http(409, 'RETENTION_CHANGE_ALREADY_SCHEDULED', 'A retention reduction is already scheduled.');
      const beforePolicy = await readPolicy(tx);
      if (digest(beforePolicy) !== digest(fresh.current)) throw http(409, 'RETENTION_POLICY_CHANGED', 'Retention policy changed after preview. Run preview again.');
      if (!fresh.reduction) await writePolicy(tx, fresh.proposed);
      const created = await tx.retentionPolicyChange.create({
        data: {
          status: fresh.reduction ? 'SCHEDULED' : 'APPLIED',
          beforePolicy, proposedPolicy: fresh.proposed, previewSnapshot: fresh, previewDigest: fresh.previewDigest,
          reason: normalizedReason, requestedByUserId: actor.sub, requestedAt: now, effectiveAt,
          ...(fresh.reduction ? {} : { appliedAt: now })
        }
      });
      await audit.log({
        actorUserId: actor.sub, action: 'CREATE', entityType: 'RetentionPolicyChange', entityId: created.id,
        metadata: { event: fresh.reduction ? 'RETENTION_CHANGE_SCHEDULED' : 'RETENTION_CHANGE_APPLIED', reduction: fresh.reduction, effectiveAt, beforePolicy, proposedPolicy: fresh.proposed, previewDigest: fresh.previewDigest }
      }, tx);
      return created;
    });
  }

  async function cancelChange({ actor, id, reason } = {}) {
    assertAdmin(actor);
    const normalizedReason = String(reason || '').trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 1000) throw http(400, 'RETENTION_CANCEL_REASON_INVALID', 'Cancellation reason must contain 5-1000 characters.');
    const now = clock();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtext('cfg07-retention-policy-change'))`);
      const row = await tx.retentionPolicyChange.findUnique({ where: { id } });
      if (!row || row.status !== 'SCHEDULED') throw http(409, 'RETENTION_CHANGE_NOT_SCHEDULED', 'Retention change is not scheduled.');
      const updated = await tx.retentionPolicyChange.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: normalizedReason } });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'RetentionPolicyChange', entityId: id, metadata: { event: 'RETENTION_CHANGE_CANCELLED', reason: normalizedReason } }, tx);
      return updated;
    });
  }

  async function applyDueChanges({ actorUserId = null } = {}) {
    const now = clock();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtext('cfg07-retention-policy-change'))`);
      const row = await tx.retentionPolicyChange.findFirst({ where: { status: 'SCHEDULED', effectiveAt: { lte: now } }, orderBy: { effectiveAt: 'asc' } });
      if (!row) return { applied: false };
      const proposed = normalizePolicyInput(row.proposedPolicy);
      await writePolicy(tx, proposed);
      const updated = await tx.retentionPolicyChange.update({ where: { id: row.id }, data: { status: 'APPLIED', appliedAt: now } });
      await audit.log({
        actorUserId, action: 'UPDATE', entityType: 'RetentionPolicyChange', entityId: row.id,
        metadata: { event: 'RETENTION_CHANGE_EFFECTIVE', requestedByUserId: row.requestedByUserId, effectiveAt: row.effectiveAt, proposedPolicy: proposed }
      }, tx);
      return { applied: true, change: updated };
    });
  }

  async function cleanupOperational(policy, { batchSize, maxBatches }) {
    const now = clock();
    const cutoff = calendarMonthCutoff(now, policy.operationalUsageMonths);
    let removedRateLimitBuckets = 0;
    let removedAlertStates = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const [rateRows, alertRows] = await Promise.all([
        prisma.rateLimitBucket.findMany({ where: { OR: [{ expiresAt: { lte: now } }, { createdAt: { lt: cutoff } }] }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: batchSize }),
        prisma.alertDeduplicationState.findMany({ where: { OR: [{ expiresAt: { lte: now } }, { createdAt: { lt: cutoff } }] }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: batchSize })
      ]);
      if (!rateRows.length && !alertRows.length) break;
      const [rateDeleted, alertDeleted] = await Promise.all([
        rateRows.length ? prisma.rateLimitBucket.deleteMany({ where: { id: { in: rateRows.map((row) => row.id) } } }) : { count: 0 },
        alertRows.length ? prisma.alertDeduplicationState.deleteMany({ where: { id: { in: alertRows.map((row) => row.id) } } }) : { count: 0 }
      ]);
      removedRateLimitBuckets += Number(rateDeleted.count || 0);
      removedAlertStates += Number(alertDeleted.count || 0);
      if (rateRows.length < batchSize && alertRows.length < batchSize) break;
    }
    return {
      adapterStatus: 'ACTIVE', cutoff: cutoff.toISOString(),
      removed: removedRateLimitBuckets + removedAlertStates,
      removedRateLimitBuckets, removedAlertDeduplicationStates: removedAlertStates,
      auditLogProtected: true, emailDeliveryReservationExcluded: true
    };
  }

  async function cleanupAttendance(policy, { batchSize, maxBatches }) {
    const cutoff = calendarMonthCutoff(clock(), policy.attendanceRawMonths);
    let removed = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await prisma.$queryRaw(Prisma.sql`
        WITH candidates AS (
          SELECT e.id
          FROM attendance_events e
          JOIN attendance_sessions s ON s.id = e.session_id
          WHERE e.received_at < ${cutoff}
            AND NOT EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.original_event_id = e.id)
            AND EXISTS (
              SELECT 1 FROM attendance_month_certifications cert
              WHERE cert.month = date_trunc('month', s.work_date)::date AND cert.status = 'CERTIFIED'
            )
          ORDER BY e.received_at ASC, e.id ASC
          LIMIT ${batchSize}
        )
        DELETE FROM attendance_events e
        USING candidates c
        WHERE e.id = c.id
        RETURNING e.id
      `);
      removed += rows.length;
      if (rows.length < batchSize) break;
    }
    const impact = await attendanceImpact(prisma, cutoff);
    return {
      adapterStatus: 'ACTIVE', cutoff: cutoff.toISOString(), removed,
      remainingEligible: impact.eligible, blockedUncertified: impact.blockedUncertified,
      protectedByCorrection: impact.protectedByCorrection, blockedMonths: impact.blockedMonths,
      certifiedSummariesProtected: true, auditLogProtected: true
    };
  }

  async function runCleanup({ trigger = 'ADMIN', actorUserId = null, batchSize = 200, maxBatches = 5 } = {}) {
    const normalizedTrigger = String(trigger || '').toUpperCase();
    if (!['CRON', 'ADMIN'].includes(normalizedTrigger)) throw http(400, 'RETENTION_CLEANUP_TRIGGER_INVALID', 'Retention cleanup trigger is invalid.');
    const normalizedBatchSize = Math.max(1, Math.min(200, Number(batchSize) || 200));
    const normalizedMaxBatches = Math.max(1, Math.min(5, Number(maxBatches) || 5));
    await applyDueChanges({ actorUserId });
    const policy = await readPolicy(prisma);
    const run = await prisma.retentionCleanupRun.create({ data: { trigger: normalizedTrigger, status: 'RUNNING', policySnapshot: policy, actorUserId, startedAt: clock() } });
    const results = {};
    const failures = [];
    for (const [name, worker] of [
      [DATA_CLASSES.OPERATIONAL_USAGE, () => cleanupOperational(policy, { batchSize: normalizedBatchSize, maxBatches: normalizedMaxBatches })],
      [DATA_CLASSES.ATTENDANCE_RAW, () => cleanupAttendance(policy, { batchSize: normalizedBatchSize, maxBatches: normalizedMaxBatches })],
      [DATA_CLASSES.PATROL_RAW, async () => patrolImpact(calendarMonthCutoff(clock(), policy.patrolRawMonths))]
    ]) {
      try { results[name] = await worker(); }
      catch (error) {
        const code = safeErrorCode(error);
        failures.push({ dataClass: name, code });
        results[name] = { adapterStatus: 'FAILED', errorCode: code };
      }
    }
    const status = failures.length ? (failures.length === 3 ? 'FAILED' : 'PARTIAL') : 'SUCCESS';
    const completedAt = clock();
    let updated = await prisma.retentionCleanupRun.update({
      where: { id: run.id },
      data: { status, resultSnapshot: { results, failures, batchSize: normalizedBatchSize, maxBatches: normalizedMaxBatches }, completedAt, errorCode: failures[0]?.code || null }
    });
    try {
      await audit.log({
        actorUserId, action: 'DELETE', entityType: 'DataRetentionCleanupRun', entityId: run.id,
        metadata: {
          status, trigger: normalizedTrigger, batchSize: normalizedBatchSize, maxBatches: normalizedMaxBatches,
          aggregate: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, {
            adapterStatus: value.adapterStatus, removed: Number(value.removed || 0),
            blockedUncertified: Number(value.blockedUncertified || 0),
            protectedByCorrection: Number(value.protectedByCorrection || 0)
          }]))
        }
      });
    } catch (error) {
      const code = safeErrorCode(error);
      updated = await prisma.retentionCleanupRun.update({
        where: { id: run.id },
        data: { status: status === 'FAILED' ? 'FAILED' : 'PARTIAL', errorCode: code }
      });
    }
    return { ...updated, results, failures };
  }

  async function recentRuns({ actor, limit = 10 } = {}) {
    assertAdmin(actor);
    const take = Math.max(1, Math.min(50, Number(limit) || 10));
    return prisma.retentionCleanupRun.findMany({ orderBy: { startedAt: 'desc' }, take });
  }

  return Object.freeze({ current, preview, createChange, cancelChange, applyDueChanges, runCleanup, recentRuns });
}

module.exports = {
  RETENTION_TIMEZONE, CLEANUP_DELAY_HOURS, POLICY_KEYS, DEFAULT_POLICY, DATA_CLASSES,
  normalizePolicyInput, bangkokYearMonth, calendarMonthCutoff, digest, policyReductions, hasReduction, createDataRetentionService
};
