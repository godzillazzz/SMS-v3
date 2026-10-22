'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'g06-attendance-event-disposable-local'
  && target.hostname === '127.0.0.1'
  && target.port === '55438'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('G06 Attendance Event integration requires the explicit disposable local target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createFaceVerificationSessionService } = require('../../src/services/face-verification-session.service');
  const { createAttendanceVerificationContextService } = require('../../src/services/attendance-verification-context.service');
  const { createAttendanceEventService } = require('../../src/services/attendance-event.service');
  const { createAttendanceVoidService } = require('../../src/services/attendance-void.service');
  const { createAttendanceSelfService } = require('../../src/services/attendance-self.service');
  const { createAttendanceSupervisorService } = require('../../src/services/attendance-supervisor.service');
  const { tokenHash } = require('../../src/services/attendance-site-evidence.service');
  const audit = require('../../src/services/audit.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    user: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    shiftType: crypto.randomUUID(),
    site: crypto.randomUUID(),
    qrCredential: crypto.randomUUID(),
    assignment: crypto.randomUUID(),
    approval: crypto.randomUUID(),
    device: crypto.randomUUID(),
    reference: crypto.randomUUID(),
    captureIn: crypto.randomUUID(),
    captureOut: crypto.randomUUID(),
    captureReentry: crypto.randomUUID(),
    captureRetry: crypto.randomUUID()
  };
  const actor = { sub: ids.user, role: 'VIEWER' };
  let now = new Date('2026-08-24T03:00:00.000Z'); // 10:00 Asia/Bangkok
  const qrToken = `attendance-event-qr-${marker}-trusted-site-proof`;

  function evidence() {
    return {
      qrToken,
      location: {
        latitude: 13.7241200,
        longitude: 100.5701200,
        accuracyMeters: 8,
        capturedAt: now.toISOString()
      }
    };
  }

  function keyMaterial() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return { ...pair, spki: pair.publicKey.export({ type: 'spki', format: 'der' }) };
  }

  async function cleanup() {
    const attendanceEvents = await prisma.attendanceEvent.findMany({
      where: { session: { employeeId: ids.employee } },
      select: { id: true }
    }).catch(() => []);
    const attendanceSessions = await prisma.attendanceSession.findMany({
      where: { employeeId: ids.employee },
      select: { id: true }
    }).catch(() => []);
    const faceSessions = await prisma.faceVerificationSession.findMany({
      where: { employeeId: ids.employee },
      select: { id: true }
    }).catch(() => []);
    const auditEntityIds = [
      ...attendanceEvents.map((row) => row.id),
      ...attendanceSessions.map((row) => row.id),
      ...faceSessions.map((row) => row.id)
    ];
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: [ids.user, ids.admin] } },
          ...(auditEntityIds.length ? [{ entityId: { in: auditEntityIds } }] : [])
        ]
      }
    }).catch(() => {});
    await prisma.attendanceEvent.deleteMany({ where: { session: { employeeId: ids.employee } } }).catch(() => {});
    await prisma.attendanceSession.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.faceVerificationReceipt.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.faceVerificationSession.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceChallenge.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.employeeReferencePhoto.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceEnrollment.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.securitySiteQrCredential.deleteMany({ where: { id: ids.qrCredential } }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: ids.site } }).catch(() => {});
    await prisma.scheduleApproval.deleteMany({ where: { id: ids.approval } }).catch(() => {});
    await prisma.shiftType.deleteMany({ where: { id: ids.shiftType } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.admin] } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  async function seed(material) {
    await cleanup();
    now = new Date('2026-08-24T03:00:00.000Z');
    await prisma.employee.create({
      data: { id: ids.employee, employeeCode: `ATEVT-${marker}`, firstName: 'Attendance', lastName: 'Event', department: 'SECURITY' }
    });
    await prisma.user.createMany({ data: [
      { id: ids.user, email: `attendance-event-user-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Attendance Event User', role: 'VIEWER', employeeId: ids.employee },
      { id: ids.admin, email: `attendance-event-admin-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Attendance Event Admin', role: 'ADMIN' }
    ] });
    await prisma.shiftType.create({
      data: { id: ids.shiftType, code: `EV${marker.slice(0, 4).toUpperCase()}`, name: 'Attendance Event Day', startTime: '07:00', endTime: '19:00', hours: 12, color: '#D9E1F2' }
    });
    await prisma.securitySite.create({
      data: { id: ids.site, code: `EVSITE-${marker.toUpperCase()}`, name: 'Attendance Event Test Site', latitude: 13.7241000, longitude: 100.5701000, geofenceRadiusMeters: 120, isActive: true }
    });
    await prisma.securitySiteQrCredential.create({
      data: { id: ids.qrCredential, securitySiteId: ids.site, tokenHash: tokenHash(qrToken), version: 1, validFrom: new Date('2026-08-24T00:00:00.000Z'), validUntil: new Date('2026-08-25T00:00:00.000Z') }
    });
    await prisma.shiftAssignment.create({
      data: {
        id: ids.assignment,
        employeeId: ids.employee,
        shiftTypeId: ids.shiftType,
        securitySiteId: ids.site,
        workDate: new Date('2026-08-24T00:00:00.000Z'),
        employeeNameSnapshot: 'Attendance Event',
        departmentSnapshot: 'SECURITY',
        startTime: '07:00',
        endTime: '19:00',
        hours: 12,
        source: 'G06_ATTENDANCE_EVENT_TEST',
        locked: true,
        licenseStatus: 'VALID'
      }
    });
    await prisma.scheduleApproval.create({
      data: {
        id: ids.approval,
        month: new Date('2026-08-01T00:00:00.000Z'),
        status: 'APPROVED',
        revision: 1,
        changedAt: now,
        approvedAt: now,
        changedByLegacyRef: ids.admin,
        approvedByLegacyRef: ids.admin,
        changeType: 'TEST',
        approvalNote: 'G06 Attendance Event disposable integration'
      }
    });
    await prisma.attendanceDeviceEnrollment.create({
      data: {
        id: ids.device,
        employeeId: ids.employee,
        publicKey: material.spki,
        keyAlgorithm: 'ECDSA_P256_SHA256',
        credentialFingerprint: crypto.createHash('sha256').update(material.spki).digest('hex'),
        displayName: 'Attendance Event Test Device',
        status: 'ACTIVE',
        proofVerifiedAt: now,
        activatedAt: now,
        createdByUserId: ids.user,
        approvedByUserId: ids.admin
      }
    });
    await prisma.employeeReferencePhoto.create({
      data: {
        id: ids.reference,
        employeeId: ids.employee,
        status: 'ACTIVE',
        storageProvider: 'fake',
        storageBucket: 'attendance-event-test',
        storageObjectKey: `attendance-event/${marker}/reference.png`,
        originalFileName: 'reference.png',
        safeDisplayFileName: 'reference.png',
        mimeType: 'image/png',
        fileSize: 1024,
        checksum: 'a'.repeat(64),
        imageWidth: 512,
        imageHeight: 512,
        uploadedByUserId: ids.admin,
        uploadedByRoleSnapshot: 'ADMIN',
        reviewedByUserId: ids.admin,
        reviewedAt: now,
        activatedAt: now
      }
    });
  }

  async function trustedReceipt({ face, context, material, captureId, eventIntent }) {
    const prepared = await context.prepareVerification({
      actor,
      captureId,
      eventIntent,
      attendanceEvidence: evidence()
    });
    const signature = crypto.sign('sha256', Buffer.from(prepared.challenge, 'base64url'), {
      key: material.privateKey,
      dsaEncoding: 'ieee-p1363'
    });
    await face.verifyDeviceProof({
      actor,
      sessionId: prepared.session.id,
      challengeId: prepared.challengeId,
      challenge: prepared.challenge,
      signatureBase64: signature.toString('base64')
    });
    const providerRef = `trusted-event-provider-${eventIntent}-${crypto.randomUUID()}`;
    await face.bindProviderSession({
      sessionId: prepared.session.id,
      provider: 'TEST_TRUSTED_PROVIDER',
      providerSessionRef: providerRef,
      policyProfileId: 'attendance-event-test-v1',
      engineVersion: 'test-engine-v1'
    });
    const verified = await face.recordTrustedProviderResult({
      sessionId: prepared.session.id,
      providerSessionRef: providerRef,
      padPassed: true,
      faceMatchPassed: true,
      injectionRiskDetected: false,
      resultCode: 'TEST_PASS'
    });
    assert.ok(verified.receipt.length >= 32);
    return { prepared, verified };
  }

  test('real DB CHECK_IN is authoritative, single-event and idempotent without re-consuming the receipt', async () => {
    const material = keyMaterial();
    await seed(material);
    const face = createFaceVerificationSessionService({ prisma, audit, clock: () => now });
    const context = createAttendanceVerificationContextService({ prisma, faceSessionService: face, clock: () => now });
    const events = createAttendanceEventService({ prisma, audit, verificationContextService: context, clock: () => now });

    const intentBeforeCheckIn = await context.resolveEventIntent({ actor });
    assert.equal(intentBeforeCheckIn.eventIntent, 'CHECK_IN');

    const flow = await trustedReceipt({ face, context, material, captureId: ids.captureIn, eventIntent: intentBeforeCheckIn.eventIntent });
    const accepted = await events.acceptVerifiedEvent({ actor, receipt: flow.verified.receipt, attendanceContext: flow.prepared.attendanceContext });
    assert.equal(accepted.idempotent, false);
    assert.equal(accepted.event.eventType, 'CHECK_IN');
    assert.equal(accepted.event.provenance, 'ONLINE');
    assert.equal(accepted.event.timeBasis, 'SERVER_RECEIVED');
    assert.equal(accepted.session.state, 'OPEN');

    const [sessionRow, eventRows, receiptRow, faceRow] = await Promise.all([
      prisma.attendanceSession.findFirstOrThrow({ where: { shiftAssignmentId: ids.assignment, state: { not: 'VOIDED' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      prisma.attendanceEvent.findMany({ where: { session: { employeeId: ids.employee } } }),
      prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: flow.prepared.session.id } }),
      prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: flow.prepared.session.id } })
    ]);
    assert.equal(eventRows.length, 1);
    assert.equal(eventRows[0].sessionId, sessionRow.id);
    assert.equal(eventRows[0].receivedAt.toISOString(), eventRows[0].effectiveEventAt.toISOString());
    assert.ok(receiptRow.consumedAt);
    assert.equal(faceRow.status, 'CONSUMED');
    const intentAfterCheckIn = await context.resolveEventIntent({ actor });
    assert.equal(intentAfterCheckIn.eventIntent, 'CHECK_OUT');

    const retry = await events.acceptVerifiedEvent({ actor, receipt: flow.verified.receipt, attendanceContext: flow.prepared.attendanceContext });
    assert.equal(retry.idempotent, true);
    assert.equal(retry.event.id, accepted.event.id);
    assert.equal(await prisma.attendanceEvent.count({ where: { sessionId: sessionRow.id } }), 1);
  });

  test('real DB audit failure rolls CHECK_OUT event, session close and receipt consumption back together, then retry commits once', async () => {
    const material = keyMaterial();
    await cleanup();
    await seed(material);
    const face = createFaceVerificationSessionService({ prisma, audit, clock: () => now });
    const context = createAttendanceVerificationContextService({ prisma, faceSessionService: face, clock: () => now });
    const normalEvents = createAttendanceEventService({ prisma, audit, verificationContextService: context, clock: () => now });

    const checkIn = await trustedReceipt({ face, context, material, captureId: ids.captureIn, eventIntent: 'CHECK_IN' });
    await normalEvents.acceptVerifiedEvent({ actor, receipt: checkIn.verified.receipt, attendanceContext: checkIn.prepared.attendanceContext });

    now = new Date('2026-08-24T03:05:00.000Z');
    const checkOut = await trustedReceipt({ face, context, material, captureId: ids.captureOut, eventIntent: 'CHECK_OUT' });
    const failingAudit = {
      log: async (entry, tx) => {
        assert.equal(entry.entityType, 'AttendanceEvent');
        assert.ok(tx);
        throw new Error('SIMULATED_ATTENDANCE_AUDIT_FAILURE');
      }
    };
    const failingEvents = createAttendanceEventService({ prisma, audit: failingAudit, verificationContextService: context, clock: () => now });

    await assert.rejects(
      () => failingEvents.acceptVerifiedEvent({ actor, receipt: checkOut.verified.receipt, attendanceContext: checkOut.prepared.attendanceContext }),
      /SIMULATED_ATTENDANCE_AUDIT_FAILURE/
    );

    const sessionAfterRollback = await prisma.attendanceSession.findFirstOrThrow({ where: { shiftAssignmentId: ids.assignment, state: { not: 'VOIDED' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const receiptAfterRollback = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: checkOut.prepared.session.id } });
    const faceAfterRollback = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: checkOut.prepared.session.id } });
    assert.equal(sessionAfterRollback.state, 'OPEN');
    assert.equal(sessionAfterRollback.closedAt, null);
    assert.equal(receiptAfterRollback.consumedAt, null);
    assert.equal(faceAfterRollback.status, 'VERIFIED');
    assert.equal(await prisma.attendanceEvent.count({ where: { sessionId: sessionAfterRollback.id, eventType: 'CHECK_OUT' } }), 0);

    const accepted = await normalEvents.acceptVerifiedEvent({ actor, receipt: checkOut.verified.receipt, attendanceContext: checkOut.prepared.attendanceContext });
    assert.equal(accepted.idempotent, false);
    assert.equal(accepted.event.eventType, 'CHECK_OUT');
    assert.equal(accepted.session.state, 'CLOSED');
    const finalReceipt = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: checkOut.prepared.session.id } });
    const finalFace = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: checkOut.prepared.session.id } });
    assert.ok(finalReceipt.consumedAt);
    assert.equal(finalFace.status, 'CONSUMED');
    assert.equal(await prisma.attendanceEvent.count({ where: { sessionId: accepted.session.id } }), 2);
    await assert.rejects(() => context.resolveEventIntent({ actor }), (error) => error.details?.code === 'ATTENDANCE_ALREADY_CHECKED_OUT');
  });

  test('voided session history is preserved and same-capture re-entry retry creates one fresh live session', async () => {
    const material = keyMaterial();
    await cleanup();
    await seed(material);
    const face = createFaceVerificationSessionService({ prisma, audit, clock: () => now });
    const context = createAttendanceVerificationContextService({ prisma, faceSessionService: face, clock: () => now });
    const events = createAttendanceEventService({ prisma, audit, verificationContextService: context, clock: () => now });
    const voids = createAttendanceVoidService({ prisma, audit, clock: () => now });
    const self = createAttendanceSelfService({ prisma, audit, clock: () => now });
    const supervisor = createAttendanceSupervisorService({ prisma, audit, clock: () => now });

    const first = await trustedReceipt({ face, context, material, captureId: ids.captureIn, eventIntent: 'CHECK_IN' });
    const acceptedFirst = await events.acceptVerifiedEvent({ actor, receipt: first.verified.receipt, attendanceContext: first.prepared.attendanceContext });
    const oldSessionId = acceptedFirst.session.id;
    const oldEventId = acceptedFirst.event.id;
    const voided = await voids.voidSession({ actor: { sub: ids.admin, role: 'ADMIN' }, sessionId: oldSessionId, reason: 'Replace invalid first entry' });
    assert.equal(voided.session.state, 'VOIDED');
    assert.equal(voided.events[0].state, 'VOIDED');
    assert.ok(voided.events[0].voidedAt);
    const persistedVoidedSession = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: oldSessionId } });
    const persistedVoidedEvent = await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: oldEventId } });
    assert.equal(persistedVoidedSession.state, 'VOIDED');
    assert.ok(persistedVoidedSession.voidedAt);
    assert.equal(persistedVoidedSession.voidedByUserId, ids.admin);
    assert.equal(persistedVoidedSession.voidReason, 'Replace invalid first entry');
    assert.equal(persistedVoidedEvent.state, 'VOIDED');
    assert.ok(persistedVoidedEvent.voidedAt);
    assert.equal(persistedVoidedEvent.voidedByUserId, ids.admin);
    assert.equal(persistedVoidedEvent.voidReason, 'Replace invalid first entry');
    const voidAudit = await prisma.auditLog.findMany({ where: { entityId: oldSessionId } });
    assert.ok(voidAudit.some((row) => row.metadata?.event === 'ATTENDANCE_SESSION_VOIDED'));
    assert.equal((await context.resolveEventIntent({ actor })).eventIntent, 'CHECK_IN');

    const reentry = await trustedReceipt({ face, context, material, captureId: ids.captureReentry, eventIntent: 'CHECK_IN' });
    const acceptedReentry = await events.acceptVerifiedEvent({ actor, receipt: reentry.verified.receipt, attendanceContext: reentry.prepared.attendanceContext });
    assert.notEqual(acceptedReentry.session.id, oldSessionId);
    const selfToday = await self.today({ actor });
    assert.equal(selfToday.assignment.sessionId, acceptedReentry.session.id);
    assert.equal(selfToday.assignment.checkInEventId, acceptedReentry.event.id);
    const selfHistory = await self.history({ actor, from: '2026-08-24', to: '2026-08-24' });
    assert.equal(selfHistory.rows.length, 1);
    assert.equal(selfHistory.rows[0].sessionId, acceptedReentry.session.id);
    const selfSchedule = await self.schedule({ actor, month: '2026-08' });
    assert.equal(selfSchedule.rows.length, 1);
    assert.equal(selfSchedule.rows[0].assignmentId, ids.assignment);
    const supervisorDaily = await supervisor.daily({ actor: { sub: ids.admin, role: 'ADMIN' }, filters: { date: '2026-08-24' } });
    assert.equal(supervisorDaily.rows.length, 1);
    assert.equal(supervisorDaily.rows[0].sessionId, acceptedReentry.session.id);
    const supervisorDetail = await supervisor.detail({ actor: { sub: ids.admin, role: 'ADMIN' }, assignmentId: ids.assignment });
    assert.equal(supervisorDetail.sessionId, acceptedReentry.session.id);
    assert.equal((await prisma.attendanceSession.findUniqueOrThrow({ where: { id: oldSessionId } })).state, 'VOIDED');
    assert.equal((await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: oldEventId } })).state, 'VOIDED');
    assert.equal(await prisma.attendanceSession.count({ where: { shiftAssignmentId: ids.assignment, state: { not: 'VOIDED' } } }), 1);

    const concurrentVoidRequests = [
      { actor: { sub: ids.admin, role: 'ADMIN' }, reason: 'Concurrent first actor reason' },
      { actor: { sub: ids.user, role: 'ADMIN' }, reason: 'Concurrent second actor reason' }
    ];
    const concurrentVoid = await Promise.all(concurrentVoidRequests.map(({ actor: voidActor, reason: voidReason }) =>
      voids.voidSession({ actor: voidActor, sessionId: acceptedReentry.session.id, reason: voidReason })));
    assert.deepEqual(concurrentVoid.map((result) => result.idempotent).sort(), [false, true]);
    const winnerIndex = concurrentVoid.findIndex((result) => result.idempotent === false);
    const winnerRequest = concurrentVoidRequests[winnerIndex];
    const persistedConcurrentVoid = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: acceptedReentry.session.id } });
    assert.equal(persistedConcurrentVoid.state, 'VOIDED');
    assert.equal(persistedConcurrentVoid.voidedByUserId, winnerRequest.actor.sub);
    assert.equal(persistedConcurrentVoid.voidReason, winnerRequest.reason);
    assert.equal(persistedConcurrentVoid.voidedAt.toISOString(), concurrentVoid[winnerIndex].session.voidedAt.toISOString());
    assert.equal(concurrentVoid[winnerIndex].session.voidedByUserId, winnerRequest.actor.sub);
    assert.equal(concurrentVoid[winnerIndex].session.voidReason, winnerRequest.reason);
    assert.equal(await prisma.auditLog.count({
      where: { entityType: 'AttendanceSession', entityId: acceptedReentry.session.id, metadata: { path: ['event'], equals: 'ATTENDANCE_SESSION_VOIDED' } }
    }), 1);
    await voids.voidSession({ actor: { sub: ids.admin, role: 'ADMIN' }, sessionId: acceptedReentry.session.id, reason: 'Prepare same-capture retry test' });

    const preservedVoidedSession = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: oldSessionId } });
    const preservedVoidedEvent = await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: oldEventId } });
    const preservedVoidAudit = await prisma.auditLog.findMany({ where: { entityId: oldSessionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const concurrentReceipt = await trustedReceipt({ face, context, material, captureId: ids.captureRetry, eventIntent: 'CHECK_IN' });
    const concurrent = await Promise.allSettled([
      events.acceptVerifiedEvent({ actor, receipt: concurrentReceipt.verified.receipt, attendanceContext: concurrentReceipt.prepared.attendanceContext }),
      events.acceptVerifiedEvent({ actor, receipt: concurrentReceipt.verified.receipt, attendanceContext: concurrentReceipt.prepared.attendanceContext })
    ]);
    const fulfilled = concurrent.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    const rejected = concurrent.filter((result) => result.status === 'rejected');
    assert.equal(concurrent.length, 2);
    assert.equal(fulfilled.length, 2, 'same capture must be idempotent for both concurrent callers');
    assert.equal(rejected.length, 0);
    assert.equal(new Set(fulfilled.map((result) => result.event.id)).size, 1);
    assert.equal(new Set(fulfilled.map((result) => result.session.id)).size, 1);
    assert.ok(fulfilled.every((result) => result.event.eventType === 'CHECK_IN' && result.event.state === 'ACTIVE'));
    assert.deepEqual(fulfilled.map((result) => result.idempotent).sort(), [false, true]);
    assert.deepEqual(await prisma.attendanceSession.findUniqueOrThrow({ where: { id: oldSessionId } }), preservedVoidedSession);
    assert.deepEqual(await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: oldEventId } }), preservedVoidedEvent);
    assert.deepEqual(await prisma.auditLog.findMany({ where: { entityId: oldSessionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }), preservedVoidAudit);
    assert.equal(await prisma.attendanceSession.count({ where: { shiftAssignmentId: ids.assignment, state: { not: 'VOIDED' } } }), 1);
    assert.equal(await prisma.attendanceEvent.count({ where: { session: { shiftAssignmentId: ids.assignment }, eventType: 'CHECK_IN', state: 'ACTIVE' } }), 1);
  });

  test('real DB constraints reject impossible closed-session state and malformed Attendance event digest', async () => {
    const material = keyMaterial();
    await cleanup();
    await seed(material);
    const face = createFaceVerificationSessionService({ prisma, audit, clock: () => now });
    const context = createAttendanceVerificationContextService({ prisma, faceSessionService: face, clock: () => now });
    const events = createAttendanceEventService({ prisma, audit, verificationContextService: context, clock: () => now });
    const checkIn = await trustedReceipt({ face, context, material, captureId: ids.captureIn, eventIntent: 'CHECK_IN' });
    await events.acceptVerifiedEvent({ actor, receipt: checkIn.verified.receipt, attendanceContext: checkIn.prepared.attendanceContext });
    now = new Date('2026-08-24T03:05:00.000Z');
    const checkOut = await trustedReceipt({ face, context, material, captureId: ids.captureOut, eventIntent: 'CHECK_OUT' });
    await events.acceptVerifiedEvent({ actor, receipt: checkOut.verified.receipt, attendanceContext: checkOut.prepared.attendanceContext });
    const session = await prisma.attendanceSession.findFirstOrThrow({ where: { employeeId: ids.employee, state: 'CLOSED' } });
    const event = await prisma.attendanceEvent.findFirstOrThrow({ where: { sessionId: session.id, eventType: 'CHECK_OUT' } });
    await assert.rejects(
      () => prisma.attendanceSession.update({ where: { id: session.id }, data: { state: 'OPEN', closedAt: session.closedAt } }),
      (error) => ['P2004', 'P2010'].includes(error.code) || /attendance_sessions_closed_state_check/.test(String(error.message))
    );
    await assert.rejects(
      () => prisma.attendanceEvent.update({ where: { id: event.id }, data: { contextDigest: 'x'.repeat(64) } }),
      (error) => ['P2004', 'P2010'].includes(error.code) || /attendance_events_context_digest_format/.test(String(error.message))
    );
  });

  test.after(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
}