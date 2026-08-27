'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAttendanceSelfService, MAX_HISTORY_DAYS } = require('../src/services/attendance-self.service');

function employee() {
  return {
    id: 'employee-1',
    employeeCode: 'EMP001',
    firstName: 'Employee',
    lastName: 'One',
    displayName: 'Employee One',
    department: 'SECURITY',
    jobTitle: 'Guard',
    isActive: true,
    deletedAt: null
  };
}

function activeUser() {
  return {
    id: 'user-1',
    isActive: true,
    accountStatus: 'ACTIVE',
    employeeId: 'employee-1',
    employee: employee()
  };
}

function approvedRevision(revision = 3) {
  return {
    id: 'approval-1',
    month: new Date('2026-08-01T00:00:00.000Z'),
    status: 'APPROVED',
    revision,
    updatedAt: new Date('2026-08-20T00:00:00.000Z')
  };
}

function assignment({
  id = 'assignment-1',
  workDate = '2026-08-27',
  startTime = '07:00',
  endTime = '19:00',
  shiftCode = 'DAY',
  events = [],
  siteId = 'site-1',
  siteName = 'Main Site'
} = {}) {
  return {
    id,
    employeeId: 'employee-1',
    shiftTypeId: 'shift-1',
    securitySiteId: siteId,
    workDate: new Date(`${workDate}T00:00:00.000Z`),
    employeeNameSnapshot: 'Employee One',
    departmentSnapshot: 'SECURITY',
    startTime,
    endTime,
    hours: 12,
    remark: null,
    locked: true,
    shiftType: {
      id: 'shift-1',
      code: shiftCode,
      name: shiftCode,
      startTime,
      endTime
    },
    securitySite: {
      id: siteId,
      code: 'SITE01',
      name: siteName
    },
    attendanceSession: events === null ? null : {
      id: 'session-1',
      expectedSiteId: siteId,
      expectedSite: {
        id: siteId,
        code: 'SITE01',
        name: siteName
      },
      events
    }
  };
}

function basePrisma(overrides = {}) {
  const calls = {
    userFindUnique: [],
    assignmentFindMany: [],
    approvalFindFirst: [],
    leaveFindFirst: [],
    siteFindUnique: []
  };
  const prisma = {
    user: {
      async findUnique(input) {
        calls.userFindUnique.push(input);
        return activeUser();
      }
    },
    shiftAssignment: {
      async findMany(input) {
        calls.assignmentFindMany.push(input);
        return [];
      }
    },
    scheduleApproval: {
      async findFirst(input) {
        calls.approvalFindFirst.push(input);
        return approvedRevision();
      }
    },
    leaveRequest: {
      async findFirst(input) {
        calls.leaveFindFirst.push(input);
        return null;
      }
    },
    securitySite: {
      async findUnique(input) {
        calls.siteFindUnique.push(input);
        return null;
      }
    }
  };

  for (const [key, value] of Object.entries(overrides)) prisma[key] = value;
  return { prisma, calls };
}

test('today is strictly actor-scoped and returns NO_ASSIGNMENT without accepting a client employee selector', async () => {
  const { prisma, calls } = basePrisma();
  const service = createAttendanceSelfService({
    prisma,
    clock: () => new Date('2026-08-27T02:00:00.000Z')
  });

  const result = await service.today({ actor: { sub: 'user-1', role: 'VIEWER' } });

  assert.equal(result.scheduleReady, false);
  assert.equal(result.reason, 'NO_ASSIGNMENT');
  assert.equal(result.employee.id, 'employee-1');
  assert.equal(calls.userFindUnique.length, 1);
  assert.equal(calls.assignmentFindMany.length, 1);
  assert.equal(calls.assignmentFindMany[0].where.employeeId, 'employee-1');
  assert.deepEqual(Object.keys(calls.assignmentFindMany[0].where).sort(), ['employeeId', 'workDate']);
});

test('history enforces a bounded date range before querying Attendance assignments', async () => {
  const { prisma, calls } = basePrisma();
  const service = createAttendanceSelfService({
    prisma,
    clock: () => new Date('2026-08-27T02:00:00.000Z')
  });

  await assert.rejects(
    () => service.history({
      actor: { sub: 'user-1', role: 'VIEWER' },
      from: '2026-05-01',
      to: '2026-08-27'
    }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, new RegExp(String(MAX_HISTORY_DAYS)));
      return true;
    }
  );

  assert.equal(calls.assignmentFindMany.length, 0);
});

test('schedule exposes no rows when the latest monthly authority is not APPROVED', async () => {
  const { prisma, calls } = basePrisma({
    scheduleApproval: {
      async findFirst(input) {
        calls.approvalFindFirst.push(input);
        return {
          ...approvedRevision(4),
          status: 'PENDING'
        };
      }
    }
  });
  const service = createAttendanceSelfService({
    prisma,
    clock: () => new Date('2026-08-27T02:00:00.000Z')
  });

  const result = await service.schedule({
    actor: { sub: 'user-1', role: 'VIEWER' },
    month: '2026-08'
  });

  assert.equal(result.approved, false);
  assert.equal(result.revision, 4);
  assert.deepEqual(result.rows, []);
  assert.equal(calls.assignmentFindMany.length, 0);
});

test('history classifies only immutable raw AttendanceEvent rows and labels the authority explicitly', async () => {
  const raw = [
    {
      id: 'event-in',
      eventType: 'CHECK_IN',
      effectiveEventAt: new Date('2026-08-27T00:00:00.000Z'),
      receivedAt: new Date('2026-08-27T00:00:00.000Z'),
      locationEvidence: { actualSiteId: 'site-1' }
    },
    {
      id: 'event-out',
      eventType: 'CHECK_OUT',
      effectiveEventAt: new Date('2026-08-27T12:00:00.000Z'),
      receivedAt: new Date('2026-08-27T12:00:00.000Z'),
      locationEvidence: { actualSiteId: 'site-1' }
    }
  ];
  const row = assignment({ events: raw });
  const { prisma, calls } = basePrisma({
    shiftAssignment: {
      async findMany(input) {
        calls.assignmentFindMany.push(input);
        return [row];
      }
    }
  });
  const service = createAttendanceSelfService({
    prisma,
    clock: () => new Date('2026-08-27T13:00:00.000Z')
  });

  const result = await service.history({
    actor: { sub: 'user-1', role: 'VIEWER' },
    from: '2026-08-27',
    to: '2026-08-27'
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, 'COMPLETE');
  assert.equal(result.rows[0].workedMinutes, 720);
  assert.equal(result.rows[0].checkInEventId, 'event-in');
  assert.equal(result.rows[0].checkOutEventId, 'event-out');
  assert.equal(result.rows[0].authority, 'RAW_ATTENDANCE_EVENT');
  assert.equal(result.rows[0].expectedSite.name, 'Main Site');
  assert.equal(result.rows[0].actualSite.name, 'Main Site');
});

test('today preserves overnight work-date authority and prefers the prior overnight assignment before its end time', async () => {
  const overnight = assignment({
    id: 'assignment-night',
    workDate: '2026-08-27',
    startTime: '19:00',
    endTime: '07:00',
    shiftCode: 'NIGHT',
    events: [{
      id: 'event-night-in',
      eventType: 'CHECK_IN',
      effectiveEventAt: new Date('2026-08-27T12:00:00.000Z'),
      receivedAt: new Date('2026-08-27T12:00:00.000Z'),
      locationEvidence: { actualSiteId: 'site-1' }
    }]
  });
  const nextDay = assignment({
    id: 'assignment-day',
    workDate: '2026-08-28',
    startTime: '07:00',
    endTime: '19:00',
    shiftCode: 'DAY',
    events: []
  });
  const { prisma, calls } = basePrisma({
    shiftAssignment: {
      async findMany(input) {
        calls.assignmentFindMany.push(input);
        return [overnight, nextDay];
      }
    }
  });
  const service = createAttendanceSelfService({
    prisma,
    clock: () => new Date('2026-08-27T18:00:00.000Z')
  });

  const result = await service.today({ actor: { sub: 'user-1', role: 'VIEWER' } });

  assert.equal(result.scheduleReady, true);
  assert.equal(result.assignment.assignmentId, 'assignment-night');
  assert.equal(result.assignment.date, '2026-08-27');
  assert.equal(result.assignment.shift.code, 'NIGHT');
  assert.equal(result.assignment.status, 'IN_PROGRESS');
  assert.equal(result.assignment.checkInEventId, 'event-night-in');
});
