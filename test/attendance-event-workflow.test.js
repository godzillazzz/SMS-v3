'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildExpectationSnapshot,
  sha256Json,
  createAttendanceEventService
} = require('../src/services/attendance-event.service');

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  employee: '22222222-2222-4222-8222-222222222222',
  assignment: '33333333-3333-4333-8333-333333333333',
  shift: '44444444-4444-4444-8444-444444444444',
  site: '55555555-5555-4555-8555-555555555555',
  faceSession: '66666666-6666-4666-8666-666666666666',
  device: '77777777-7777-4777-8777-777777777777',
  photo: '88888888-8888-4888-8888-888888888888',
  captureIn: '99999999-9999-4999-8999-999999999999',
  captureOut: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  attendanceSession: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  eventIn: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  eventOut: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  approval: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
};
const now = new Date('2026-08-24T03:00:00.000Z');

function assignment(overrides = {}) {
  return {
    id: ids.assignment,
    employeeId: ids.employee,
    shiftTypeId: ids.shift,
    securitySiteId: ids.site,
    workDate: new Date('2026-08-24T00:00:00.000Z'),
    employeeNameSnapshot: 'Attendance Event Test',
    departmentSnapshot: 'SECURITY',
    startTime: '07:00',
    endTime: '19:00',
    hours: 12,
    locked: true,
    shiftType: { id: ids.shift, code: 'D', name: 'Day', startTime: '07:00', endTime: '19:00', hours: 12 },
    securitySite: { id: ids.site, code: 'HQ', name: 'HQ', latitude: '13.7241000', longitude: '100.5701000', geofenceRadiusMeters: 120, isActive: true },
    ...overrides
  };
}

function approval(overrides = {}) {
  return { id: ids.approval, month: new Date('2026-08-01T00:00:00.000Z'), status: 'APPROVED', revision: 4, approvedAt: new Date('2026-08-20T00:00:00.000Z'), updatedAt: now, ...overrides };
}

function contextRef(captureId, eventIntent) {
  return {
    captureId,
    eventIntent,
    shiftAssignmentId: ids.assignment,
    evidence: {
      siteId: ids.site,
      qrCredentialId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      location: { latitude: '13.7241000', longitude: '100.5701000', accuracyMeters: '8.00', capturedAt: now.toISOString() }
    }
  };
}

function resolved(captureId, eventIntent) {
  return {
    contextDigest: sha256Json({ captureId, eventIntent, authority: 'test' }),
    contextRef: contextRef(captureId, eventIntent),
    authority: {
      userId: ids.user,
      employeeId: ids.employee,
      deviceEnrollmentId: ids.device,
      referencePhotoId: ids.photo,
      shiftAssignmentId: ids.assignment,
      securitySiteId: ids.site,
      workDate: '2026-08-24'
    }
  };
}

function fakeVerification() {
  const calls = { resolve: [], consume: [] };
  return {
    calls,
    resolveContextRef: async ({ ref }, client) => {
      calls.resolve.push({ ref, client });
      return resolved(ref.captureId, ref.eventIntent);
    },
    consumeVerificationInTransaction: async ({ tx, attendanceContext }) => {
      calls.consume.push({ tx, attendanceContext });
      const r = resolved(attendanceContext.captureId, attendanceContext.eventIntent);
      return {
        sessionId: ids.faceSession,
        employeeId: ids.employee,
        userId: ids.user,
        deviceEnrollmentId: ids.device,
        referencePhotoId: ids.photo,
        contextDigest: r.contextDigest,
        verifiedAt: new Date('2026-08-24T02:59:55.000Z'),
        provider: 'TEST_PROVIDER',
        policyProfileId: 'policy-v1',
        engineVersion: 'engine-v1'
      };
    }
  };
}

function fakeDb({ initialSession = null, initialEvents = [], assignmentRow = assignment(), approvalRow = approval() } = {}) {
  const state = { session: initialSession, events: [...initialEvents], assignment: assignmentRow, approval: approvalRow };
  const db = {
    $transaction: async (fn) => fn(db),
    user: { findUnique: async () => ({ id: ids.user, employeeId: ids.employee, isActive: true, accountStatus: 'ACTIVE', employee: { id: ids.employee, isActive: true, deletedAt: null } }) },
    shiftAssignment: { findUnique: async ({ where }) => where.id === state.assignment.id ? state.assignment : null },
    scheduleApproval: { findFirst: async () => state.approval },
    attendanceSession: {
      findUnique: async ({ where }) => where.shiftAssignmentId === state.session?.shiftAssignmentId ? state.session : null,
      create: async ({ data }) => {
        state.session = { id: ids.attendanceSession, ...data, closedAt: null, createdAt: now, updatedAt: now };
        return state.session;
      },
      update: async ({ data }) => { state.session = { ...state.session, ...data, updatedAt: now }; return state.session; }
    },
    attendanceEvent: {
      findUnique: async ({ where }) => {
        if (where.captureId) {
          const row = state.events.find((event) => event.captureId === where.captureId);
          return row ? { ...row, session: state.session } : null;
        }
        if (where.sessionId_eventType) return state.events.find((event) => event.sessionId === where.sessionId_eventType.sessionId && event.eventType === where.sessionId_eventType.eventType) || null;
        return null;
      },
      create: async ({ data }) => {
        const id = data.eventType === 'CHECK_IN' ? ids.eventIn : ids.eventOut;
        const row = { id, ...data, createdAt: now };
        state.events.push(row);
        return row;
      }
    }
  };
  return { db, state };
}

function auditFake() {
  const calls = [];
  return { calls, log: async (entry, client) => { calls.push({ entry, client }); } };
}

function sessionFromExpectation(overrides = {}) {
  const a = assignment();
  const ap = approval();
  const snapshot = buildExpectationSnapshot(a, ap);
  return {
    id: ids.attendanceSession,
    employeeId: ids.employee,
    shiftAssignmentId: ids.assignment,
    expectedShiftTypeId: ids.shift,
    expectedSiteId: ids.site,
    workDate: a.workDate,
    expectationSnapshot: snapshot,
    expectationDigest: sha256Json(snapshot),
    state: 'OPEN',
    openedAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function checkInEvent(overrides = {}) {
  return {
    id: ids.eventIn,
    sessionId: ids.attendanceSession,
    faceVerificationSessionId: ids.faceSession,
    captureId: ids.captureIn,
    eventType: 'CHECK_IN',
    provenance: 'ONLINE',
    receivedAt: now,
    effectiveEventAt: now,
    timeBasis: 'SERVER_RECEIVED',
    contextDigest: resolved(ids.captureIn, 'CHECK_IN').contextDigest,
    createdAt: now,
    ...overrides
  };
}

test('expectation snapshot/digest are deterministic and bind approved schedule + shift + site authority', () => {
  const first = buildExpectationSnapshot(assignment(), approval());
  const second = buildExpectationSnapshot(assignment(), approval());
  assert.equal(sha256Json(first), sha256Json(second));
  assert.match(sha256Json(first), /^[0-9a-f]{64}$/);
  assert.equal(first.scheduleApproval.revision, 4);
  assert.equal(first.site.id, ids.site);
  assert.equal(first.shift.id, ids.shift);
});

test('CHECK_IN creates one OPEN AttendanceSession and one ONLINE server-time event after receipt consume', async () => {
  const { db, state } = fakeDb();
  const verification = fakeVerification();
  const audit = auditFake();
  const service = createAttendanceEventService({ prisma: db, audit, verificationContextService: verification, clock: () => now });
  const result = await service.acceptVerifiedEvent({ actor: { sub: ids.user }, receipt: 'receipt-secret', attendanceContext: contextRef(ids.captureIn, 'CHECK_IN') });
  assert.equal(result.idempotent, false);
  assert.equal(result.session.state, 'OPEN');
  assert.equal(result.event.eventType, 'CHECK_IN');
  assert.equal(result.event.provenance, 'ONLINE');
  assert.equal(result.event.timeBasis, 'SERVER_RECEIVED');
  assert.equal(result.event.receivedAt.toISOString(), now.toISOString());
  assert.equal(state.events.length, 1);
  assert.equal(verification.calls.consume.length, 1);
  assert.equal(audit.calls.length, 1);
  assert.equal(audit.calls[0].entry.entityType, 'AttendanceEvent');
  assert.equal(JSON.stringify(audit.calls[0].entry).includes('receipt-secret'), false);
});

test('CHECK_OUT without committed CHECK_IN fails before receipt consumption', async () => {
  const session = sessionFromExpectation();
  const { db } = fakeDb({ initialSession: session });
  const verification = fakeVerification();
  const service = createAttendanceEventService({ prisma: db, audit: auditFake(), verificationContextService: verification, clock: () => now });
  await assert.rejects(
    () => service.acceptVerifiedEvent({ actor: { sub: ids.user }, receipt: 'receipt-secret', attendanceContext: contextRef(ids.captureOut, 'CHECK_OUT') }),
    (error) => error.details?.code === 'ATTENDANCE_CHECK_IN_REQUIRED'
  );
  assert.equal(verification.calls.consume.length, 0);
});

test('CHECK_OUT after CHECK_IN consumes receipt, creates event and closes the AttendanceSession atomically', async () => {
  const session = sessionFromExpectation();
  const { db, state } = fakeDb({ initialSession: session, initialEvents: [checkInEvent()] });
  const verification = fakeVerification();
  const service = createAttendanceEventService({ prisma: db, audit: auditFake(), verificationContextService: verification, clock: () => now });
  const result = await service.acceptVerifiedEvent({ actor: { sub: ids.user }, receipt: 'receipt-secret-2', attendanceContext: contextRef(ids.captureOut, 'CHECK_OUT') });
  assert.equal(result.event.eventType, 'CHECK_OUT');
  assert.equal(result.session.state, 'CLOSED');
  assert.equal(result.session.closedAt.toISOString(), now.toISOString());
  assert.equal(state.events.length, 2);
  assert.equal(verification.calls.consume.length, 1);
});

test('same captureId retry returns committed event idempotently without re-consuming receipt', async () => {
  const session = sessionFromExpectation();
  const existing = checkInEvent();
  const { db } = fakeDb({ initialSession: session, initialEvents: [existing] });
  const verification = fakeVerification();
  const service = createAttendanceEventService({ prisma: db, audit: auditFake(), verificationContextService: verification, clock: () => now });
  const result = await service.acceptVerifiedEvent({ actor: { sub: ids.user }, receipt: 'already-consumed-receipt', attendanceContext: contextRef(ids.captureIn, 'CHECK_IN') });
  assert.equal(result.idempotent, true);
  assert.equal(result.event.id, ids.eventIn);
  assert.equal(verification.calls.resolve.length, 0);
  assert.equal(verification.calls.consume.length, 0);
});

test('session expectation drift fails closed before receipt consumption', async () => {
  const stale = sessionFromExpectation({ expectationDigest: 'f'.repeat(64) });
  const { db } = fakeDb({ initialSession: stale });
  const verification = fakeVerification();
  const service = createAttendanceEventService({ prisma: db, audit: auditFake(), verificationContextService: verification, clock: () => now });
  await assert.rejects(
    () => service.acceptVerifiedEvent({ actor: { sub: ids.user }, receipt: 'receipt-secret', attendanceContext: contextRef(ids.captureIn, 'CHECK_IN') }),
    (error) => error.details?.code === 'ATTENDANCE_SESSION_STALE'
  );
  assert.equal(verification.calls.consume.length, 0);
});

test('second CHECK_IN with a different captureId is rejected before receipt consumption', async () => {
  const session = sessionFromExpectation();
  const { db } = fakeDb({ initialSession: session, initialEvents: [checkInEvent()] });
  const verification = fakeVerification();
  const service = createAttendanceEventService({ prisma: db, audit: auditFake(), verificationContextService: verification, clock: () => now });
  await assert.rejects(
    () => service.acceptVerifiedEvent({ actor: { sub: ids.user }, receipt: 'new-receipt', attendanceContext: contextRef(ids.captureOut, 'CHECK_IN') }),
    (error) => error.details?.code === 'ATTENDANCE_ALREADY_CHECKED_IN'
  );
  assert.equal(verification.calls.consume.length, 0);
});

test('schema/migration enforce one session per shift, one event type per session, one face verification per event and server-time semantics', () => {
  const root = path.resolve(__dirname, '..');
  const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'prisma', 'migrations', '202608240004_g06_attendance_event_workflow_v1', 'migration.sql'), 'utf8');
  assert.match(schema, /model AttendanceSession \{/);
  assert.match(schema, /shiftAssignmentId\s+String\s+@unique/);
  assert.match(schema, /expectationDigest\s+String/);
  assert.match(schema, /model AttendanceEvent \{/);
  assert.match(schema, /faceVerificationSessionId\s+String\s+@unique/);
  assert.match(schema, /captureId\s+String\s+@unique/);
  assert.match(schema, /@@unique\(\[sessionId, eventType\]\)/);
  assert.match(migration, /attendance_sessions_closed_state_check/);
  assert.match(migration, /attendance_sessions_expectation_digest_format/);
  assert.match(migration, /attendance_events_server_time_check/);
  assert.match(migration, /attendance_events_context_digest_format/);
});

test('Attendance event service remains behind the gated API contract with no direct route coupling', () => {
  const root = path.resolve(__dirname, '..');
  const routesRoot = path.join(root, 'src', 'routes');
  const routeSource = fs.readdirSync(routesRoot).filter((name) => name.endsWith('.js')).map((name) => fs.readFileSync(path.join(routesRoot, name), 'utf8')).join('\n');
  assert.doesNotMatch(routeSource, /attendance-event\.service|\/attendance-events|\/attendance\/events/);
  const source = fs.readFileSync(path.join(root, 'src', 'services', 'attendance-event.service.js'), 'utf8');
  assert.doesNotMatch(source, /OFFLINE|DEVICE_CAPTURED|MANAGER_ON_BEHALF|ADMIN_ON_BEHALF/);
  assert.doesNotMatch(source, /imageBytes|videoBytes|embedding|template|faceCollection/i);
});
