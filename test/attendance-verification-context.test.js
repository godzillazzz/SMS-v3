'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  CONTEXT_VERSION,
  buildAttendanceContextDigest,
  bangkokParts,
  isOvernightAssignment,
  createAttendanceVerificationContextService
} = require('../src/services/attendance-verification-context.service');

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  employee: '22222222-2222-4222-8222-222222222222',
  device: '33333333-3333-4333-8333-333333333333',
  photo: '44444444-4444-4444-8444-444444444444',
  assignmentToday: '55555555-5555-4555-8555-555555555555',
  assignmentYesterday: '66666666-6666-4666-8666-666666666666',
  shift: '77777777-7777-4777-8777-777777777777',
  approval: '88888888-8888-4888-8888-888888888888',
  capture: '99999999-9999-4999-8999-999999999999',
  site: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  qrCredential: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};

const attendanceEvidence = {
  qrToken: 'site-qr-token-for-server-validation-only',
  location: {
    latitude: 13.7241000,
    longitude: 100.5701000,
    accuracyMeters: 8,
    capturedAt: '2026-08-24T03:00:00.000Z'
  }
};

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function assignment({ id = ids.assignmentToday, workDate = '2026-08-24', startTime = '07:00', endTime = '19:00', code = 'D', securitySiteId = ids.site, locked = true } = {}) {
  return {
    id,
    employeeId: ids.employee,
    shiftTypeId: ids.shift,
    securitySiteId,
    workDate: new Date(`${workDate}T00:00:00.000Z`),
    startTime,
    endTime,
    hours: 12,
    locked,
    shiftType: { id: ids.shift, code, name: code, startTime, endTime, hours: 12 },
    securitySite: securitySiteId ? { id: securitySiteId, isActive: true } : null
  };
}

function fakeDb({ now = new Date('2026-08-24T03:00:00.000Z'), rows = [assignment()], approvalStatus = 'APPROVED', sessionRow = null, attendanceEvents = [] } = {}) {
  const state = { rows, approvalStatus, sessionRow, attendanceEvents };
  const db = {
    user: {
      findUnique: async () => ({
        id: ids.user,
        employeeId: ids.employee,
        isActive: true,
        accountStatus: 'ACTIVE',
        employee: { id: ids.employee, isActive: true, deletedAt: null }
      })
    },
    attendanceDeviceEnrollment: {
      findMany: async () => [{ id: ids.device, employeeId: ids.employee, status: 'ACTIVE', credentialFingerprint: 'd'.repeat(64), activatedAt: now }]
    },
    employeeReferencePhoto: {
      findMany: async () => [{ id: ids.photo, employeeId: ids.employee, status: 'ACTIVE', checksum: 'a'.repeat(64), activatedAt: now, storageDeletedAt: null, storageDeletionRequestedAt: null }]
    },
    shiftAssignment: {
      findMany: async ({ where }) => {
        const wanted = new Set((where.workDate.in || []).map((value) => new Date(value).toISOString().slice(0, 10)));
        return state.rows.filter((row) => wanted.has(row.workDate.toISOString().slice(0, 10)));
      },
      findUnique: async ({ where }) => state.rows.find((row) => row.id === where.id) || null
    },
    scheduleApproval: {
      findFirst: async () => ({ id: ids.approval, status: state.approvalStatus, revision: 3, updatedAt: now })
    },
    attendanceSession: {
      findUnique: async ({ where }) => state.sessionRow?.shiftAssignmentId === where.shiftAssignmentId ? state.sessionRow : null
    },
    attendanceEvent: {
      findMany: async ({ where }) => state.attendanceEvents
        .filter((row) => row.sessionId === where.sessionId && (!where.eventType?.in || where.eventType.in.includes(row.eventType)))
        .map((row) => ({ eventType: row.eventType }))
    }
  };
  return { db, state, clock: () => now };
}

function evidenceDecision(location = attendanceEvidence.location) {
  const normalizedLocation = {
    latitude: Number(location.latitude).toFixed(7),
    longitude: Number(location.longitude).toFixed(7),
    accuracyMeters: Number(location.accuracyMeters).toFixed(2),
    capturedAt: new Date(location.capturedAt).toISOString()
  };
  return {
    siteBindingDigest: '1'.repeat(64),
    qrBindingDigest: '2'.repeat(64),
    locationBindingDigest: digest(JSON.stringify(normalizedLocation)),
    evidenceRef: {
      siteId: ids.site,
      qrMode: 'STEP_UP_QR',
      qrCredentialId: ids.qrCredential,
      location: normalizedLocation
    },
    decision: { siteId: ids.site, insideGeofence: true, distanceMeters: 3.2 }
  };
}

function fakeSiteEvidence() {
  const calls = { validate: [], revalidate: [] };
  return {
    calls,
    validateForAssignment: async (input, client) => {
      calls.validate.push({ input, client });
      const result = evidenceDecision(input.location);
      if (!input.qrToken) {
        result.evidenceRef.qrMode = 'GPS_ASSURED';
        result.evidenceRef.qrCredentialId = null;
      }
      return result;
    },
    revalidateRef: async ({ ref }, client) => {
      calls.revalidate.push({ ref, client });
      return evidenceDecision(ref.location);
    }
  };
}

function fakeFace() {
  const calls = { create: [], consume: [], consumeTx: [], failed: [] };
  return {
    calls,
    createSession: async ({ actor, purpose, contextDigest }) => {
      calls.create.push({ actor, purpose, contextDigest });
      return {
        session: {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          userId: ids.user,
          employeeId: ids.employee,
          deviceEnrollmentId: ids.device,
          referencePhotoId: ids.photo,
          purpose,
          contextDigest,
          status: 'CREATED'
        },
        challengeId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        challenge: 'challenge-value',
        keyAlgorithm: 'ECDSA_P256_SHA256'
      };
    },
    consumeReceipt: async (input) => { calls.consume.push(input); return { ok: true, ...input.expected }; },
    consumeReceiptInTransaction: async (input) => { calls.consumeTx.push(input); return { ok: true, ...input.expected }; },
    failSession: async (id, code) => { calls.failed.push({ id, code }); }
  };
}

test('attendance context digest is canonical and versioned', () => {
  const a = { version: CONTEXT_VERSION, nested: { b: 2, a: 1 }, z: true };
  const b = { z: true, nested: { a: 1, b: 2 }, version: CONTEXT_VERSION };
  assert.equal(buildAttendanceContextDigest(a), buildAttendanceContextDigest(b));
  assert.match(buildAttendanceContextDigest(a), /^[0-9a-f]{64}$/);
});

test('Bangkok time and overnight detection preserve the prior-day shift tail', () => {
  assert.deepEqual(bangkokParts(new Date('2026-08-23T18:30:00.000Z')), { date: '2026-08-24', minutes: 90 });
  assert.equal(isOvernightAssignment(assignment({ startTime: '19:00', endTime: '07:00' })), true);
  assert.equal(isOvernightAssignment(assignment({ startTime: '07:00', endTime: '19:00' })), false);
});

test('server resolves CHECK_IN when the authoritative current shift has no AttendanceSession', async () => {
  const { db, clock } = fakeDb();
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock });
  const resolved = await service.resolveEventIntent({ actor: { sub: ids.user } });
  assert.deepEqual(resolved, { eventIntent: 'CHECK_IN', shiftAssignmentId: ids.assignmentToday, workDate: '2026-08-24' });
});

test('approved auto-schedule row is actionable even when it is not manually locked', async () => {
  const { db, clock } = fakeDb({ rows: [assignment({ locked: false })] });
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock });
  const resolved = await service.resolveEventIntent({ actor: { sub: ids.user } });
  assert.deepEqual(resolved, { eventIntent: 'CHECK_IN', shiftAssignmentId: ids.assignmentToday, workDate: '2026-08-24' });
});

test('server resolves CHECK_OUT only after a committed CHECK_IN on the current open session', async () => {
  const session = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccd', employeeId: ids.employee, shiftAssignmentId: ids.assignmentToday, state: 'OPEN', closedAt: null };
  const { db, clock } = fakeDb({ sessionRow: session, attendanceEvents: [{ sessionId: session.id, eventType: 'CHECK_IN' }] });
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock });
  const resolved = await service.resolveEventIntent({ actor: { sub: ids.user } });
  assert.equal(resolved.eventIntent, 'CHECK_OUT');
  assert.equal(resolved.shiftAssignmentId, ids.assignmentToday);
});

test('server blocks a shift that already has a committed CHECK_OUT', async () => {
  const session = { id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccce', employeeId: ids.employee, shiftAssignmentId: ids.assignmentToday, state: 'CLOSED', closedAt: new Date('2026-08-24T10:00:00.000Z') };
  const { db, clock } = fakeDb({ sessionRow: session, attendanceEvents: [{ sessionId: session.id, eventType: 'CHECK_IN' }, { sessionId: session.id, eventType: 'CHECK_OUT' }] });
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock });
  await assert.rejects(() => service.resolveEventIntent({ actor: { sub: ids.user } }), (error) => error.details?.code === 'ATTENDANCE_ALREADY_CHECKED_OUT');
});

test('server fails closed when an existing AttendanceSession is missing its committed CHECK_IN', async () => {
  const session = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccf', employeeId: ids.employee, shiftAssignmentId: ids.assignmentToday, state: 'OPEN', closedAt: null };
  const { db, clock } = fakeDb({ sessionRow: session, attendanceEvents: [] });
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock });
  await assert.rejects(() => service.resolveEventIntent({ actor: { sub: ids.user } }), (error) => error.details?.code === 'ATTENDANCE_SESSION_INCONSISTENT');
});

test('prepareContext derives Site/QR/GPS digests from raw evidence through the server validator', async () => {
  const { db, clock } = fakeDb();
  const face = fakeFace();
  const siteEvidence = fakeSiteEvidence();
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: face, siteEvidenceService: siteEvidence, clock });
  const prepared = await service.prepareContext({ actor: { sub: ids.user }, captureId: ids.capture, eventIntent: 'CHECK_IN', attendanceEvidence });
  assert.equal(prepared.authority.employeeId, ids.employee);
  assert.equal(prepared.authority.deviceEnrollmentId, ids.device);
  assert.equal(prepared.authority.referencePhotoId, ids.photo);
  assert.equal(prepared.authority.shiftAssignmentId, ids.assignmentToday);
  assert.equal(prepared.authority.securitySiteId, ids.site);
  assert.equal(siteEvidence.calls.validate.length, 1);
  assert.equal(siteEvidence.calls.validate[0].input.qrToken, attendanceEvidence.qrToken);
  assert.deepEqual(siteEvidence.calls.validate[0].input.location, attendanceEvidence.location);
  assert.equal(prepared.contextRef.evidence.siteId, ids.site);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared.contextRef, 'siteBindingDigest'), false);
  assert.equal(JSON.stringify(prepared.contextRef).includes(attendanceEvidence.qrToken), false);
  assert.match(prepared.contextDigest, /^[0-9a-f]{64}$/);
});

test('strong GPS evidence may prepare a context without QR and records the GPS_ASSURED mode', async () => {
  const { db, clock } = fakeDb();
  const face = fakeFace();
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: face, siteEvidenceService: fakeSiteEvidence(), clock });
  const prepared = await service.prepareContext({ actor: { sub: ids.user }, captureId: ids.capture, eventIntent: 'CHECK_IN', attendanceEvidence: { location: attendanceEvidence.location } });
  assert.equal(prepared.contextRef.evidence.qrMode, 'GPS_ASSURED');
  assert.equal(prepared.contextRef.evidence.qrCredentialId, null);
  assert.match(prepared.contextDigest, /^[0-9a-f]{64}$/);
  assert.equal(face.calls.create.length, 0);
});

test('server resolves previous-day overnight assignment after midnight in Bangkok', async () => {
  const previous = assignment({ id: ids.assignmentYesterday, workDate: '2026-08-23', startTime: '19:00', endTime: '07:00', code: 'N' });
  const today = assignment({ id: ids.assignmentToday, workDate: '2026-08-24', startTime: '19:00', endTime: '07:00', code: 'N' });
  const { db } = fakeDb({ now: new Date('2026-08-23T18:00:00.000Z'), rows: [previous, today] });
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock: () => new Date('2026-08-23T18:00:00.000Z') });
  const prepared = await service.prepareContext({ actor: { sub: ids.user }, captureId: ids.capture, eventIntent: 'CHECK_OUT', attendanceEvidence: { ...attendanceEvidence, location: { ...attendanceEvidence.location, capturedAt: '2026-08-23T18:00:00.000Z' } } });
  assert.equal(prepared.authority.shiftAssignmentId, ids.assignmentYesterday);
  assert.equal(prepared.authority.workDate, '2026-08-23');
});

test('unapproved or non-actionable schedule cannot mint an Attendance-bound context', async () => {
  const unapproved = fakeDb({ approvalStatus: 'PENDING' });
  const serviceA = createAttendanceVerificationContextService({ prisma: unapproved.db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock: unapproved.clock });
  await assert.rejects(
    () => serviceA.prepareContext({ actor: { sub: ids.user }, captureId: ids.capture, eventIntent: 'CHECK_IN', attendanceEvidence }),
    (error) => error.details?.code === 'ATTENDANCE_SCHEDULE_NOT_APPROVED'
  );

  const off = fakeDb({ rows: [assignment({ code: 'OFF', startTime: '00:00', endTime: '00:00' })] });
  const serviceB = createAttendanceVerificationContextService({ prisma: off.db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock: off.clock });
  await assert.rejects(
    () => serviceB.prepareContext({ actor: { sub: ids.user }, captureId: ids.capture, eventIntent: 'CHECK_IN', attendanceEvidence }),
    (error) => error.details?.code === 'ATTENDANCE_SHIFT_NOT_ACTIONABLE'
  );
});

test('prepareVerification ignores any client digest and passes only the server-built digest to the face session service', async () => {
  const { db, clock } = fakeDb();
  const face = fakeFace();
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: face, siteEvidenceService: fakeSiteEvidence(), clock });
  const result = await service.prepareVerification({
    actor: { sub: ids.user },
    captureId: ids.capture,
    eventIntent: 'CHECK_IN',
    attendanceEvidence,
    contextDigest: 'f'.repeat(64),
    validatedEvidence: { siteBindingDigest: 'e'.repeat(64), qrBindingDigest: 'e'.repeat(64), locationBindingDigest: 'e'.repeat(64) }
  });
  assert.equal(face.calls.create.length, 1);
  assert.notEqual(face.calls.create[0].contextDigest, 'f'.repeat(64));
  assert.notEqual(face.calls.create[0].contextDigest, 'e'.repeat(64));
  assert.equal(face.calls.create[0].contextDigest, result.session.contextDigest);
  assert.equal(result.attendanceContext.shiftAssignmentId, ids.assignmentToday);
});

test('receipt consumption re-resolves current Site/QR/GPS authority and transaction-aware path reuses the caller transaction', async () => {
  const { db, clock } = fakeDb();
  const face = fakeFace();
  const siteEvidence = fakeSiteEvidence();
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: face, siteEvidenceService: siteEvidence, clock });
  const prepared = await service.prepareContext({ actor: { sub: ids.user }, captureId: ids.capture, eventIntent: 'CHECK_OUT', attendanceEvidence });
  const normal = await service.consumeVerification({ actor: { sub: ids.user }, receipt: 'r'.repeat(40), attendanceContext: prepared.contextRef });
  assert.equal(normal.employeeId, ids.employee);
  assert.equal(face.calls.consume[0].expected.contextDigest, prepared.contextDigest);
  assert.equal(siteEvidence.calls.revalidate.length, 1);

  const tx = { ...db };
  const inTx = await service.consumeVerificationInTransaction({ tx, actor: { sub: ids.user }, receipt: 's'.repeat(40), attendanceContext: prepared.contextRef });
  assert.equal(inTx.deviceEnrollmentId, ids.device);
  assert.equal(face.calls.consumeTx[0].tx, tx);
  assert.equal(face.calls.consumeTx[0].expected.referencePhotoId, ids.photo);
  assert.equal(siteEvidence.calls.revalidate[1].client, tx);
});

test('changing raw GPS evidence changes the server-built Attendance context digest', async () => {
  const { db, clock } = fakeDb();
  const service = createAttendanceVerificationContextService({ prisma: db, faceSessionService: fakeFace(), siteEvidenceService: fakeSiteEvidence(), clock });
  const first = await service.prepareContext({ actor: { sub: ids.user }, captureId: ids.capture, eventIntent: 'CHECK_IN', attendanceEvidence });
  const second = await service.prepareContext({ actor: { sub: ids.user }, captureId: ids.capture, eventIntent: 'CHECK_IN', attendanceEvidence: { ...attendanceEvidence, location: { ...attendanceEvidence.location, latitude: 13.7242 } } });
  assert.notEqual(first.contextDigest, second.contextDigest);
});

test('Attendance context source has no prevalidated-digest input path and orchestration remains internal', () => {
  const contextSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'attendance-verification-context.service.js'), 'utf8');
  assert.match(contextSource, /prepareContext\(\{ actor, captureId, eventIntent, attendanceEvidence \}/);
  assert.doesNotMatch(contextSource, /prepareContext\(\{ actor, captureId, eventIntent, validatedEvidence \}/);
  assert.match(contextSource, /siteEvidence\.validateForAssignment/);
  assert.match(contextSource, /siteEvidence\.revalidateRef/);

  const routesRoot = path.join(__dirname, '..', 'src', 'routes');
  const routeSource = fs.readdirSync(routesRoot)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(routesRoot, name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(routeSource, /attendance-verification-context\.service|attendance-site-evidence\.service/);
  assert.doesNotMatch(routeSource, /\/attendance-verification(?:\/|['"])/);
});
