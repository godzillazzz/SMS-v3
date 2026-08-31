'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RETENTION_TIMEZONE,
  CLEANUP_DELAY_HOURS,
  POLICY_KEYS,
  DEFAULT_POLICY,
  calendarMonthCutoff,
  normalizePolicyInput,
  createDataRetentionService
} = require('../src/services/data-retention.service');

function fakeDb() {
  const settings = new Map([
    [POLICY_KEYS.operationalUsageMonths, '6'],
    [POLICY_KEYS.attendanceRawMonths, '12'],
    [POLICY_KEYS.patrolRawMonths, '3'],
    [POLICY_KEYS.timezone, RETENTION_TIMEZONE]
  ]);
  const state = { settings, pending: null, changes: [], runs: [] };
  const db = {
    systemSetting: {
      findMany: async () => [...settings.entries()].map(([key, value]) => ({ key, value, updatedAt: new Date('2026-08-31T00:00:00Z') })),
      updateMany: async ({ where, data }) => {
        if (!settings.has(where.key)) return { count: 0 };
        settings.set(where.key, data.value);
        return { count: 1 };
      }
    },
    rateLimitBucket: {
      count: async () => 0,
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 })
    },
    alertDeduplicationState: {
      count: async () => 0,
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 })
    },
    retentionPolicyChange: {
      findFirst: async ({ where }) => where?.status === 'SCHEDULED' ? state.pending : null,
      findUnique: async ({ where }) => state.changes.find((row) => row.id === where.id) || null,
      create: async ({ data }) => {
        const row = { id: '11111111-1111-4111-8111-111111111111', ...data };
        state.changes.push(row);
        if (row.status === 'SCHEDULED') state.pending = row;
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.changes.find((item) => item.id === where.id);
        Object.assign(row, data);
        if (row.status !== 'SCHEDULED') state.pending = null;
        return row;
      }
    },
    retentionCleanupRun: {
      findMany: async () => state.runs,
      create: async ({ data }) => {
        const row = { id: '22222222-2222-4222-8222-222222222222', ...data };
        state.runs.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.runs.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      }
    },
    $queryRaw: async (query) => {
      const sql = Array.isArray(query?.strings) ? query.strings.join('?') : String(query || '');
      if (sql.includes('COUNT(*)::integer AS "totalCandidates"')) return [{ totalCandidates: 0, protectedByCorrection: 0, blockedUncertified: 0, eligible: 0 }];
      if (sql.includes("to_char(date_trunc('month'")) return [];
      if (sql.includes('DELETE FROM attendance_events')) return [];
      return [{ locked: 1 }];
    },
    $transaction: async (callback) => callback(db)
  };
  return { db, state };
}

test('CFG-07 defaults and protected timezone match Owner retention policy', () => {
  assert.deepEqual(DEFAULT_POLICY, {
    operationalUsageMonths: 6,
    attendanceRawMonths: 12,
    patrolRawMonths: 3,
    timezone: 'Asia/Bangkok'
  });
  assert.equal(CLEANUP_DELAY_HOURS, 24);
  assert.equal(RETENTION_TIMEZONE, 'Asia/Bangkok');
});

test('CFG-07 calendar cutoffs retain complete Bangkok calendar months including current month', () => {
  const now = new Date('2026-08-31T08:00:00.000Z');
  assert.equal(calendarMonthCutoff(now, 6).toISOString(), '2026-02-28T17:00:00.000Z');
  assert.equal(calendarMonthCutoff(now, 12).toISOString(), '2025-08-31T17:00:00.000Z');
  assert.equal(calendarMonthCutoff(now, 3).toISOString(), '2026-05-31T17:00:00.000Z');
});

test('CFG-07 validates retention months and fixes timezone authority', () => {
  assert.deepEqual(normalizePolicyInput({ operationalUsageMonths: 8, attendanceRawMonths: 18, patrolRawMonths: 4, timezone: 'UTC' }), {
    operationalUsageMonths: 8,
    attendanceRawMonths: 18,
    patrolRawMonths: 4,
    timezone: 'Asia/Bangkok'
  });
  assert.throws(() => normalizePolicyInput({ operationalUsageMonths: 0, attendanceRawMonths: 12, patrolRawMonths: 3 }), /between 1 and 120/);
  assert.throws(() => normalizePolicyInput({ operationalUsageMonths: 6, attendanceRawMonths: 121, patrolRawMonths: 3 }), /between 1 and 120/);
});

test('CFG-07 retention reduction requires preview acknowledgement and schedules the whole policy for 24 hours', async () => {
  const { db, state } = fakeDb();
  const now = new Date('2026-08-31T08:00:00.000Z');
  const service = createDataRetentionService({ prisma: db, audit: { log: async () => undefined }, clock: () => now });
  const actor = { sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'ADMIN' };
  const proposedPolicy = { operationalUsageMonths: 5, attendanceRawMonths: 12, patrolRawMonths: 3 };
  const preview = await service.preview({ actor, proposedPolicy });
  assert.equal(preview.reduction, true);
  assert.equal(preview.impacts.PATROL_RAW.adapterStatus, 'NOT_AVAILABLE');
  await assert.rejects(
    () => service.createChange({ actor, proposedPolicy, expectedPreviewDigest: preview.previewDigest, acknowledgeImpact: false, reason: 'Reduce transient data retention safely' }),
    (error) => error.details?.code === 'RETENTION_IMPACT_ACK_REQUIRED'
  );
  const created = await service.createChange({ actor, proposedPolicy, expectedPreviewDigest: preview.previewDigest, acknowledgeImpact: true, reason: 'Reduce transient data retention safely' });
  assert.equal(created.status, 'SCHEDULED');
  assert.equal(new Date(created.effectiveAt).toISOString(), '2026-09-01T08:00:00.000Z');
  assert.equal(state.settings.get(POLICY_KEYS.operationalUsageMonths), '6', 'scheduled reduction must not change active setting early');
});

test('CFG-07 increases apply immediately after a current preview', async () => {
  const { db, state } = fakeDb();
  const now = new Date('2026-08-31T08:00:00.000Z');
  const service = createDataRetentionService({ prisma: db, audit: { log: async () => undefined }, clock: () => now });
  const actor = { sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'ADMIN' };
  const proposedPolicy = { operationalUsageMonths: 7, attendanceRawMonths: 13, patrolRawMonths: 4 };
  const preview = await service.preview({ actor, proposedPolicy });
  assert.equal(preview.reduction, false);
  const created = await service.createChange({ actor, proposedPolicy, expectedPreviewDigest: preview.previewDigest, reason: 'Extend retention for operational review' });
  assert.equal(created.status, 'APPLIED');
  assert.equal(state.settings.get(POLICY_KEYS.operationalUsageMonths), '7');
  assert.equal(state.settings.get(POLICY_KEYS.attendanceRawMonths), '13');
  assert.equal(state.settings.get(POLICY_KEYS.patrolRawMonths), '4');
});

test('CFG-07 cleanup reports PARTIAL consistently when aggregate Audit persistence fails', async () => {
  const { db, state } = fakeDb();
  const now = new Date('2026-08-31T08:00:00.000Z');
  const service = createDataRetentionService({
    prisma: db,
    audit: { log: async () => { throw Object.assign(new Error('audit unavailable'), { code: 'AUDIT_WRITE_FAILED' }); } },
    clock: () => now
  });
  const result = await service.runCleanup({
    trigger: 'ADMIN',
    actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    batchSize: 50,
    maxBatches: 2
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.errorCode, 'AUDIT_WRITE_FAILED');
  assert.equal(state.runs[0].status, 'PARTIAL');
  assert.equal(state.runs[0].errorCode, 'AUDIT_WRITE_FAILED');
  assert.equal(result.results.PATROL_RAW.adapterStatus, 'NOT_AVAILABLE');
});

test('CFG-07 service source protects Governance Audit, certified summaries and corrected Attendance evidence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'data-retention.service.js'), 'utf8');
  assert.match(source, /attendance_month_certifications/);
  assert.match(source, /cert\.status = 'CERTIFIED'/);
  assert.match(source, /attendance_corrections c WHERE c\.original_event_id = e\.id/);
  assert.match(source, /DELETE FROM attendance_events/);
  assert.doesNotMatch(source, /auditLog\.delete|DELETE FROM audit_logs/i);
  assert.doesNotMatch(source, /emailDeliveryReservation\.delete|DELETE FROM email_delivery_reservations/i);
  assert.match(source, /PATROL_RAW[\s\S]*NOT_AVAILABLE/);
  assert.match(source, /Math\.min\(200/);
  assert.match(source, /Math\.min\(5/);
});
