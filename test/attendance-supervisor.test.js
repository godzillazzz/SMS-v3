'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bangkokDateText,
  scopeForActor,
  operationalStatus,
  summaryFor,
  parseHistoryRange,
  createAttendanceSupervisorService
} = require('../src/services/attendance-supervisor.service');

function shiftAssignment({ id, employeeId, name, department, code = 'DAY', startTime = '07:00', endTime = '19:00', events = [] }) {
  return {
    id,
    employeeId,
    shiftTypeId: `${id}-shift`,
    securitySiteId: `${id}-site`,
    workDate: new Date('2026-08-25T00:00:00.000Z'),
    employeeNameSnapshot: name,
    departmentSnapshot: department,
    startTime,
    endTime,
    locked: true,
    employee: { id: employeeId, employeeCode: `E-${employeeId}`, firstName: name, lastName: '', displayName: name, department },
    shiftType: { id: `${id}-shift`, code, name: code, startTime, endTime },
    securitySite: { id: `${id}-site`, code: `S-${id}`, name: `Site ${id}` },
    attendanceSession: events.length ? {
      id: `${id}-session`,
      expectedSite: { id: `${id}-site`, code: `S-${id}`, name: `Site ${id}` },
      events
    } : null
  };
}

function event(eventType, at, siteId) {
  return { eventType, effectiveEventAt: new Date(at), locationEvidence: { siteId } };
}

test('Bangkok date authority does not depend on UTC calendar date', () => {
  assert.equal(bangkokDateText(new Date('2026-08-24T18:00:00.000Z')), '2026-08-25');
});

test('Manager is locked to own Department and Admin may filter Department', () => {
  assert.deepEqual(scopeForActor({ role: 'MANAGER', department: 'OPS' }, {}), { role: 'MANAGER', department: 'OPS', employeeId: null });
  assert.throws(() => scopeForActor({ role: 'MANAGER', department: 'OPS' }, { department: 'OTHER' }), /another Department/);
  assert.deepEqual(scopeForActor({ role: 'ADMIN' }, { department: 'OPS' }), { role: 'ADMIN', department: 'OPS', employeeId: null });
});

test('operational status preserves explicit risk/business outcomes before generic complete state', () => {
  assert.equal(operationalStatus({ status: 'COMPLETE' }, ['ASSIST_OTHER_SITE']), 'ASSIST_OTHER_SITE');
  assert.equal(operationalStatus({ status: 'COMPLETE' }, ['EARLY_OUT']), 'EARLY_OUT');
  assert.equal(operationalStatus({ status: 'IN_PROGRESS' }, ['LATE']), 'LATE');
  assert.equal(operationalStatus({ status: 'AWAITING_CHECK_IN' }, []), 'NOT_CHECKED_IN_YET');
});

test('summary distinguishes not checked in yet from absent and counts missing time as abnormal', () => {
  const result = summaryFor([
    { attendanceStatus: 'NOT_CHECKED_IN_YET', checkInAt: null, checkOutAt: null, flags: [] },
    { attendanceStatus: 'ABSENT', checkInAt: null, checkOutAt: null, flags: ['ABSENT', 'MISSING_CHECK_IN'] },
    { attendanceStatus: 'LATE', checkInAt: new Date(), checkOutAt: null, flags: ['LATE'] },
    { attendanceStatus: 'COMPLETE', checkInAt: new Date(), checkOutAt: new Date(), flags: [] }
  ]);
  assert.equal(result.scheduledToday, 4);
  assert.equal(result.notCheckedInYet, 1);
  assert.equal(result.absent, 1);
  assert.equal(result.currentlyWorking, 1);
  assert.equal(result.timeAbnormal, 1);
});

test('daily read model derives server-authoritative today status without writing summary state', async () => {
  const assignments = [
    shiftAssignment({
      id: 'a', employeeId: 'emp-a', name: 'Alpha', department: 'OPS',
      events: [event('CHECK_IN', '2026-08-25T00:00:00.000Z', 'a-site')]
    }),
    shiftAssignment({ id: 'b', employeeId: 'emp-b', name: 'Beta', department: 'OPS', events: [] })
  ];
  const prisma = {
    shiftAssignment: { findMany: async () => assignments },
    leaveRequest: { findMany: async () => [] },
    securitySite: { findUnique: async () => null }
  };
  const service = createAttendanceSupervisorService({
    prisma,
    clock: () => new Date('2026-08-25T01:00:00.000Z'),
    siteAuthorityService: { resolve: async ({ assignment }) => ({ site: assignment.securitySite }) }
  });
  const result = await service.daily({ actor: { role: 'MANAGER', department: 'OPS' }, filters: { date: '2026-08-25' } });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].attendanceStatus, 'CURRENTLY_WORKING');
  assert.equal(result.rows[1].attendanceStatus, 'NOT_CHECKED_IN_YET');
  assert.equal(result.summary.currentlyWorking, 1);
  assert.equal(result.summary.notCheckedInYet, 1);
});


test('history range is bounded to protect serverless read cost', () => {
  const range = parseHistoryRange({ from: '2026-08-01', to: '2026-08-27' }, new Date('2026-08-27T01:00:00.000Z'));
  assert.equal(range.days, 27);
  assert.throws(
    () => parseHistoryRange({ from: '2026-06-01', to: '2026-08-27' }, new Date('2026-08-27T01:00:00.000Z')),
    /must not exceed/
  );
});

test('history returns paginated supervisor rows without writing Attendance state', async () => {
  const assignments = [
    shiftAssignment({
      id: 'h-a', employeeId: 'emp-a', name: 'Alpha', department: 'OPS',
      events: [event('CHECK_IN', '2026-08-25T00:00:00.000Z', 'h-a-site')]
    }),
    shiftAssignment({
      id: 'h-b', employeeId: 'emp-b', name: 'Beta', department: 'OPS',
      events: [event('CHECK_IN', '2026-08-25T00:05:00.000Z', 'h-b-site')]
    })
  ];
  assignments[0].workDate = new Date('2026-08-25T00:00:00.000Z');
  assignments[1].workDate = new Date('2026-08-24T00:00:00.000Z');

  const prisma = {
    shiftAssignment: { findMany: async () => assignments },
    leaveRequest: { findMany: async () => [] },
    securitySite: { findUnique: async () => null }
  };
  const service = createAttendanceSupervisorService({
    prisma,
    clock: () => new Date('2026-08-27T01:00:00.000Z'),
    siteAuthorityService: { resolve: async ({ assignment }) => ({ site: assignment.securitySite }) }
  });

  const result = await service.history({
    actor: { role: 'MANAGER', department: 'OPS' },
    filters: { from: '2026-08-01', to: '2026-08-27', page: 1, pageSize: 1 }
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.meta.total, 2);
  assert.equal(result.meta.totalPages, 2);
  assert.equal(result.scope.department, 'OPS');
  assert.equal(result.rows[0].correctionAuthority, 'RAW_ATTENDANCE_EVENT');
});

test('detail is Manager department-scoped and exposes original/effective authority metadata', async () => {
  const row = shiftAssignment({
    id: 'detail-a', employeeId: 'emp-a', name: 'Alpha', department: 'OPS',
    events: [event('CHECK_IN', '2026-08-25T00:00:00.000Z', 'detail-a-site')]
  });
  row.attendanceSession.events[0].id = 'event-detail-in';
  row.attendanceSession.events[0].receivedAt = new Date('2026-08-25T00:00:01.000Z');

  const prisma = {
    shiftAssignment: { findUnique: async () => row },
    leaveRequest: { findMany: async () => [] },
    securitySite: { findUnique: async () => null }
  };
  const service = createAttendanceSupervisorService({
    prisma,
    clock: () => new Date('2026-08-25T01:00:00.000Z'),
    siteAuthorityService: { resolve: async ({ assignment }) => ({ site: assignment.securitySite }) }
  });

  const detail = await service.detail({
    actor: { role: 'MANAGER', department: 'OPS' },
    assignmentId: 'detail-a'
  });
  assert.equal(detail.assignmentId, 'detail-a');
  assert.equal(detail.rawEvents[0].id, 'event-detail-in');
  assert.equal(detail.governance.canCreateAdjustmentRequest, true);
  assert.equal(detail.governance.canApproveAdjustmentRequest, false);
  assert.equal(detail.governance.directOverrideEnabled, false);

  await assert.rejects(
    () => service.detail({ actor: { role: 'MANAGER', department: 'OTHER' }, assignmentId: 'detail-a' }),
    /another Department/
  );
});
