'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAttendanceDay, ATTENDANCE_RESULT_FLAGS } = require('../src/services/attendance-result.service');
const {
  DEFAULT_ATTENDANCE_TIME_POLICY,
  normalizeAttendanceTimePolicy
} = require('../src/services/attendance-time-policy.contract');
const {
  validateAttendanceTime,
  classifyAttendanceEventTime,
  snapshotFor,
  createAttendanceTimePolicyService
} = require('../src/services/attendance-time-policy.service');
const { reportRowProjection } = require('../src/services/attendance-report.service');

function assignment({ code = 'D', startTime = '07:00', endTime = '19:00', siteId = 'site-a', shiftTypeId = 'shift-d' } = {}) {
  return {
    id: 'assignment-1',
    employeeId: 'employee-1',
    shiftTypeId,
    securitySiteId: siteId,
    workDate: new Date('2026-10-02T00:00:00.000Z'),
    startTime,
    endTime,
    shiftType: { id: shiftTypeId, code, startTime, endTime }
  };
}

function instant(value) { return new Date(value); }
function event(eventType, effectiveEventAt, timePolicySnapshot = null) { return { eventType, effectiveEventAt: instant(effectiveEventAt), timePolicySnapshot }; }

function source(scopeType, scopeId, values, policyId) {
  return { id: policyId, scopeType, siteId: scopeType === 'SITE' ? scopeId : null,
    shiftTypeId: scopeType === 'SHIFT_TYPE' ? scopeId : null, policy: values,
    effectiveFrom: instant('2026-10-01T00:00:00.000Z') };
}

test('default policy keeps late CHECK_IN allowed and classifies D shift at 07:00 / 07:01', () => {
  const assigned = assignment();
  assert.doesNotThrow(() => validateAttendanceTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T00:01:00.000Z'), policy: DEFAULT_ATTENDANCE_TIME_POLICY }));
  const onTime = classifyAttendanceEventTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T00:00:00.000Z'), policy: DEFAULT_ATTENDANCE_TIME_POLICY });
  const late = classifyAttendanceEventTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T00:01:00.000Z'), policy: DEFAULT_ATTENDANCE_TIME_POLICY });
  assert.equal(onTime.punctuality, 'ON_TIME');
  assert.equal(late.punctuality, 'LATE');
  assert.equal(late.lateMinutes, 1);
});

test('grace period keeps 07:10 on time and marks 07:11 late', () => {
  const policy = normalizeAttendanceTimePolicy({ lateGraceMinutes: 10 });
  const assigned = assignment();
  assert.equal(classifyAttendanceEventTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T00:10:00.000Z'), policy }).punctuality, 'ON_TIME');
  assert.equal(classifyAttendanceEventTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T00:11:00.000Z'), policy }).punctuality, 'LATE');
  assert.equal(classifyAttendanceEventTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T00:10:00.000Z'), policy }).lateMinutes, 10);
  assert.equal(classifyAttendanceEventTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T00:11:00.000Z'), policy }).lateMinutes, 11);
});

test('latest CHECK_IN only rejects when Admin explicitly enables its limit', () => {
  const assigned = assignment();
  assert.doesNotThrow(() => validateAttendanceTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T05:00:00.000Z'), policy: DEFAULT_ATTENDANCE_TIME_POLICY }));
  const policy = normalizeAttendanceTimePolicy({ latestCheckInEnabled: true, latestCheckInMinutesAfterStart: 30 });
  assert.throws(
    () => validateAttendanceTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T00:31:00.000Z'), policy }),
    (error) => error.details?.code === 'ATTENDANCE_CHECK_IN_LATEST_WINDOW_EXCEEDED'
  );
});

test('optional earliest check-in and checkout acceptance windows are enforced by server policy', () => {
  const assigned = assignment();
  const policy = normalizeAttendanceTimePolicy({ earliestCheckInEnabled: true, earliestCheckInMinutesBeforeStart: 60,
    earliestCheckOutEnabled: true, earliestCheckOutMinutesAfterStart: 240 });
  assert.throws(
    () => validateAttendanceTime({ assignment: assigned, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-01T22:59:00.000Z'), policy }),
    (error) => error.details?.code === 'ATTENDANCE_CHECK_IN_TOO_EARLY'
  );
  assert.throws(
    () => validateAttendanceTime({ assignment: assigned, eventIntent: 'CHECK_OUT', effectiveAt: instant('2026-10-02T03:59:00.000Z'), policy }),
    (error) => error.details?.code === 'ATTENDANCE_CHECK_OUT_TOO_EARLY'
  );
  assert.doesNotThrow(() => validateAttendanceTime({ assignment: assigned, eventIntent: 'CHECK_OUT', effectiveAt: instant('2026-10-02T04:00:00.000Z'), policy }));
});

test('night shift uses Asia/Bangkok cross-midnight boundaries for late entry and checkout', () => {
  const night = assignment({ code: 'N', startTime: '19:00', endTime: '07:00' });
  assert.equal(classifyAttendanceEventTime({ assignment: night, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T12:00:00.000Z'), policy: DEFAULT_ATTENDANCE_TIME_POLICY }).punctuality, 'ON_TIME');
  const late = classifyAttendanceEventTime({ assignment: night, eventIntent: 'CHECK_IN', effectiveAt: instant('2026-10-02T12:01:00.000Z'), policy: DEFAULT_ATTENDANCE_TIME_POLICY });
  assert.equal(late.punctuality, 'LATE');
  assert.doesNotThrow(() => validateAttendanceTime({ assignment: night, eventIntent: 'CHECK_OUT', effectiveAt: instant('2026-10-03T00:01:00.000Z'), policy: DEFAULT_ATTENDANCE_TIME_POLICY }));
  const result = classifyAttendanceDay({ assignment: night, events: [
    event('CHECK_IN', '2026-10-02T12:01:00.000Z'),
    event('CHECK_OUT', '2026-10-03T00:01:00.000Z')
  ], asOf: instant('2026-10-03T00:02:00.000Z') });
  assert.deepEqual(result.expectedEndAt, instant('2026-10-03T00:00:00.000Z'));
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.punctuality, 'LATE');
  assert.equal(result.checkoutCondition, 'NORMAL');
});

test('missing checkout remains unflagged before threshold and becomes abnormal at threshold', () => {
  const assigned = assignment();
  const policy = { ...DEFAULT_ATTENDANCE_TIME_POLICY, missingCheckoutAfterMinutes: 120 };
  const snapshot = { version: 'ATTENDANCE_TIME_POLICY_V1', values: policy };
  const checkIn = event('CHECK_IN', '2026-10-02T00:03:00.000Z', snapshot);
  const before = classifyAttendanceDay({ assignment: assigned, events: [checkIn], policy, asOf: instant('2026-10-02T13:59:59.000Z') });
  const after = classifyAttendanceDay({ assignment: assigned, events: [checkIn], policy, asOf: instant('2026-10-02T14:00:00.000Z') });
  assert.equal(before.flags.includes(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_OUT), false);
  assert.equal(after.flags.includes(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_OUT), true);
  assert.equal(after.checkoutCondition, 'MISSING_CHECK_OUT');
  assert.equal(after.abnormalTime, true);
  assert.deepEqual(after.abnormalReasons, ['MISSING_CHECK_OUT']);
  assert.deepEqual(classifyAttendanceDay({ assignment: assigned, events: [checkIn], policy, asOf: instant('2026-10-02T14:00:00.000Z') }), after,
    're-running dynamic missing-checkout reconciliation produces the same result without duplicate writes');
});

test('early checkout tolerance and anomaly toggle are applied independently', () => {
  const assigned = assignment();
  const checkIn = event('CHECK_IN', '2026-10-02T00:00:00.000Z');
  const early = classifyAttendanceDay({ assignment: assigned, events: [checkIn, event('CHECK_OUT', '2026-10-02T11:55:00.000Z')],
    policy: { ...DEFAULT_ATTENDANCE_TIME_POLICY, earlyCheckoutToleranceMinutes: 10 }, asOf: instant('2026-10-02T12:00:00.000Z') });
  assert.equal(early.checkoutCondition, 'NORMAL');
  assert.equal(early.earlyOutMinutes, 5);
  assert.equal(early.flags.includes(ATTENDANCE_RESULT_FLAGS.EARLY_OUT), false);
  const disabled = classifyAttendanceDay({ assignment: assigned, events: [checkIn, event('CHECK_OUT', '2026-10-02T10:00:00.000Z')],
    policy: { ...DEFAULT_ATTENDANCE_TIME_POLICY, earlyLeaveEnabled: false }, asOf: instant('2026-10-02T12:00:00.000Z') });
  assert.equal(disabled.checkoutCondition, 'NORMAL');
});

test('effective policy resolution selects Shift Type then Site then Company', async () => {
  const assigned = assignment();
  const company = source('COMPANY', null, { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 1 }, 'company-policy');
  const site = source('SITE', 'site-a', { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 5 }, 'site-policy');
  const shift = source('SHIFT_TYPE', 'shift-d', { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 10 }, 'shift-policy');
  const rows = [company, site, shift];
  const client = { attendanceTimePolicy: { findFirst: async (query) => rows
    .filter((row) => row.scopeType === query.where.scopeType && row.siteId === query.where.siteId && row.shiftTypeId === query.where.shiftTypeId && row.effectiveFrom <= query.where.effectiveFrom.lte)
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0] || null } };
  const service = createAttendanceTimePolicyService({ prisma: client });
  const result = await service.resolveForAssignment({ assignment: assigned, at: instant('2026-10-02T00:00:00.000Z') });
  assert.equal(result.values.lateGraceMinutes, 10);
  assert.equal(result.source.policyId, 'shift-policy');
  assert.equal(snapshotFor(result).scopeType, 'SHIFT_TYPE');

  const siteOnlyService = createAttendanceTimePolicyService({ prisma: { attendanceTimePolicy: { findFirst: async (query) => rows
    .filter((row) => row.scopeType !== 'SHIFT_TYPE' && row.scopeType === query.where.scopeType && row.siteId === query.where.siteId && row.effectiveFrom <= query.where.effectiveFrom.lte)
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0] || null } } });
  assert.equal((await siteOnlyService.resolveForAssignment({ assignment: assigned, at: instant('2026-10-02T00:00:00.000Z') })).values.lateGraceMinutes, 5);

  const companyOnlyService = createAttendanceTimePolicyService({ prisma: { attendanceTimePolicy: { findFirst: async (query) => query.where.scopeType === 'COMPANY' ? company : null } } });
  assert.equal((await companyOnlyService.resolveForAssignment({ assignment: assigned, at: instant('2026-10-02T00:00:00.000Z') })).values.lateGraceMinutes, 1);
});

test('event policy snapshot keeps historical lateness classification after a later policy change', () => {
  const assigned = assignment();
  const captured = event('CHECK_IN', '2026-10-02T00:05:00.000Z', {
    version: 'ATTENDANCE_TIME_POLICY_V1', policyId: 'old-policy', scopeType: 'COMPANY', scopeId: null,
    effectiveFrom: '2026-10-01T00:00:00.000Z', values: { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 0 }
  });
  const result = classifyAttendanceDay({ assignment: assigned, events: [captured], policy: { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 10 }, asOf: instant('2026-10-02T01:00:00.000Z') });
  assert.equal(result.punctuality, 'LATE');
  assert.equal(result.lateMinutes, 5);
  assert.equal(result.effectivePolicy.policyId, 'old-policy');
});

test('max shift duration flags stale open attendance without fabricating a checkout', () => {
  const assigned = assignment();
  const policy = { ...DEFAULT_ATTENDANCE_TIME_POLICY, maxShiftDurationEnabled: true, maxShiftDurationMinutes: 720 };
  const result = classifyAttendanceDay({ assignment: assigned, policy,
    events: [event('CHECK_IN', '2026-10-02T00:03:00.000Z')], asOf: instant('2026-10-02T12:03:00.000Z') });
  assert.equal(result.abnormalTime, true);
  assert.ok(result.abnormalReasons.includes('MAX_SHIFT_DURATION_EXCEEDED'));
  assert.equal(result.checkOutAt, null);
  assert.equal(result.workedMinutes, null);
});

test('support Site, late and foreign-device flags remain separate dimensions in report projection', () => {
  const row = reportRowProjection({
    assignedSite: { id: 'site-a', code: 'A', name: 'Site A' },
    actualSite: { id: 'site-b', code: 'B', name: 'Site B' }, workSiteContext: 'SUPPORT_SITE',
    punctuality: 'LATE', flags: ['LATE', 'ASSIST_OTHER_SITE', 'DEVICE_MISMATCH']
  });
  assert.equal(row.workSiteContext, 'SUPPORT_SITE');
  assert.equal(row.punctuality, 'LATE');
  assert.deepEqual(row.flags, ['LATE', 'ASSIST_OTHER_SITE', 'DEVICE_MISMATCH']);
});

test('policy validation rejects negative, extreme, contradictory, and incomplete limits', () => {
  assert.throws(() => normalizeAttendanceTimePolicy({ lateGraceMinutes: -1 }), { code: 'ATTENDANCE_TIME_POLICY_INVALID' });
  assert.throws(() => normalizeAttendanceTimePolicy({ missingCheckoutAfterMinutes: 99999 }), { code: 'ATTENDANCE_TIME_POLICY_INVALID' });
  assert.throws(() => normalizeAttendanceTimePolicy({ latestCheckInEnabled: true }), { code: 'ATTENDANCE_TIME_POLICY_INVALID' });
  assert.throws(() => normalizeAttendanceTimePolicy({ lateGraceMinutes: 10, latestCheckInEnabled: true, latestCheckInMinutesAfterStart: 5 }), { code: 'ATTENDANCE_TIME_POLICY_INVALID' });
  assert.throws(() => normalizeAttendanceTimePolicy({ lateGraceMinutes: 10, latestCheckInEnabled: true, latestCheckInMinutesAfterStart: 5, earliestCheckInEnabled: false }), { code: 'ATTENDANCE_TIME_POLICY_INVALID' });
  assert.throws(() => normalizeAttendanceTimePolicy({ lateGraceMinutes: null }), { code: 'ATTENDANCE_TIME_POLICY_INVALID' });
  assert.throws(() => normalizeAttendanceTimePolicy({ maxShiftDurationEnabled: true, maxShiftDurationMinutes: 600, earliestCheckOutEnabled: true, earliestCheckOutMinutesAfterStart: 600 }), { code: 'ATTENDANCE_TIME_POLICY_INVALID' });
});

test('Admin-only policy changes are effective-dated, immutable, and audited with old/new values', async () => {
  const rows = [];
  const auditRows = [];
  const now = instant('2026-10-02T05:00:00.000Z');
  let nextId = 0;
  const prisma = {
    securitySite: { findUnique: async () => ({ id: 'site-a', isActive: true }) },
    shiftType: { findUnique: async () => ({ id: 'shift-d', isActive: true }) },
    attendanceTimePolicy: {
      findFirst: async ({ where }) => {
        const matches = rows.filter((row) => row.scopeType === where.scopeType && row.siteId === where.siteId && row.shiftTypeId === where.shiftTypeId
          && (where.effectiveFrom instanceof Date ? row.effectiveFrom.getTime() === where.effectiveFrom.getTime() : row.effectiveFrom <= where.effectiveFrom.lte));
        return matches.sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0] || null;
      },
      create: async ({ data }) => { const row = { id: `policy-${++nextId}`, ...data, createdAt: now }; rows.push(row); return row; }
    },
    $transaction: async (callback) => callback(prisma)
  };
  const service = createAttendanceTimePolicyService({ prisma, audit: { log: async (entry) => { auditRows.push(entry); } }, clock: () => now });
  await assert.rejects(() => service.save({ actor: { sub: 'user-viewer', role: 'VIEWER' }, input: { scopeType: 'COMPANY', policy: DEFAULT_ATTENDANCE_TIME_POLICY } }), { statusCode: 403 });
  assert.equal(rows.length, 0);
  const first = await service.save({ actor: { sub: 'user-admin', role: 'ADMIN' }, input: { scopeType: 'COMPANY', policy: { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 5 } } });
  const secondEffectiveFrom = instant('2026-10-03T00:00:00.000Z');
  const second = await service.save({ actor: { sub: 'user-admin', role: 'ADMIN' }, input: { scopeType: 'COMPANY', effectiveFrom: secondEffectiveFrom.toISOString(), policy: { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 10 } } });
  assert.notEqual(first.id, second.id);
  assert.equal(rows.length, 2);
  assert.equal(auditRows.length, 2);
  assert.equal(auditRows[1].actorUserId, 'user-admin');
  assert.equal(auditRows[1].metadata.scopeType, 'COMPANY');
  assert.equal(auditRows[1].metadata.oldValues.lateGraceMinutes, 5);
  assert.equal(auditRows[1].metadata.newValues.lateGraceMinutes, 10);
  const resolvedAtOldTime = await service.resolveForAssignment({ assignment: assignment(), at: instant('2026-10-02T06:00:00.000Z') });
  const resolvedAtNewTime = await service.resolveForAssignment({ assignment: assignment(), at: instant('2026-10-03T00:01:00.000Z') });
  assert.equal(resolvedAtOldTime.values.lateGraceMinutes, 5);
  assert.equal(resolvedAtNewTime.values.lateGraceMinutes, 10);
});
