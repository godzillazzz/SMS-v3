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
  test('foreign-device selfie concurrency requires the explicit disposable local target', { skip: true }, () => {});
} else {
  const { PrismaClient, AuditAction } = require('@prisma/client');
  const { createAttendanceSimpleService, canonicalJson, signedEventPayload } = require('../../src/services/attendance-simple.service');
  const AUDIT_ACTION_VALUES = new Set(Object.values(AuditAction));
  const { createAttendanceSiteEvidenceService } = require('../../src/services/attendance-site-evidence.service');
  const audit = require('../../src/services/audit.service');

  const prisma = new PrismaClient();
  const secondPrisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const ids = {
    employee: crypto.randomUUID(), employeeB: crypto.randomUUID(), user: crypto.randomUUID(), shiftType: crypto.randomUUID(),
    site: crypto.randomUUID(), assignment: crypto.randomUUID(), approval: crypto.randomUUID(),
    primaryEnrollment: crypto.randomUUID(), foreignEnrollment: crypto.randomUUID(),
    challengeOne: crypto.randomUUID(), challengeTwo: crypto.randomUUID()
  };
  const captureId = crypto.randomUUID();
  const captureIdTwo = crypto.randomUUID();
  const now = new Date('2026-10-02T03:00:00.000Z');
  const policy = { maxAccuracyMeters: 50, maxAgeMs: 180000, futureSkewMs: 30000, offlineConfirmAfterMs: 5 * 60 * 1000, offlineBundleTtlMs: 24 * 60 * 60 * 1000 };
  const selfieBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////2wBDAf//////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIAAwAAAB//2gAIAQEAAT8h/9k=';
  const actor = { sub: ids.user, role: 'VIEWER' };
  const material = keyMaterial();
  const storage = { uploads: [], removed: [], objects: new Map(), waiters: [] };
  const transactionSignals = { clientOne: [], clientTwo: [] };
  const finalizationBarrier = { entered: 0, releases: [] };

  async function awaitFinalizationBarrier() {
    finalizationBarrier.entered += 1;
    if (finalizationBarrier.entered === 2) for (const release of finalizationBarrier.releases.splice(0)) release();
    if (finalizationBarrier.entered < 2) await new Promise((resolve) => finalizationBarrier.releases.push(resolve));
  }

  function keyMaterial() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return { pair, publicKeySpkiBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  }

  function challengeHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

  function signedInput({ deviceMaterial, nonce, capture = captureId }) {
    const selfie = { mimeType: 'image/jpeg', base64: selfieBase64, captureMode: 'LIVE_CAMERA', overlay: { capturedAt: now.toISOString() } };
    const input = {
      captureId: capture, eventIntent: 'CHECK_IN', shiftAssignmentId: ids.assignment, capturedAt: now.toISOString(),
      location: { latitude: 13.7241, longitude: 100.5701, accuracyMeters: 8, capturedAt: now.toISOString() },
      device: { publicKeySpkiBase64: deviceMaterial.publicKeySpkiBase64, keyAlgorithm: 'ECDSA_P256_SHA256', displayName: 'Concurrent foreign device',
        signals: { secureContext: true, webCrypto: true, indexedDb: true, privateKeyNonExportable: true }, signatureBase64: '' },
      selfie, selfieNonce: nonce
    };
    input.device.signatureBase64 = crypto.sign('sha256', Buffer.from(canonicalJson(signedEventPayload(input)), 'utf8'), {
      key: deviceMaterial.pair.privateKey, dsaEncoding: 'ieee-p1363'
    }).toString('base64');
    return input;
  }

  function storageFor(label) {
    return {
      put: async ({ captureId: id, selfie }) => {
        const objectKey = `selfie/${id}/${label}`;
        storage.uploads.push({ label, objectKey, captureId: id });
        storage.objects.set(objectKey, { captureId: id, checksum: selfie.checksum });
        if (storage.uploads.length === 2) for (const release of storage.waiters.splice(0)) release();
        if (storage.uploads.length < 2) await new Promise((resolve) => storage.waiters.push(resolve));
        return { provider: 'test', bucket: 'test-bucket', objectKey, mimeType: selfie.mimeType, sizeBytes: selfie.buffer.length, checksum: selfie.checksum };
      },
      remove: async ({ objectKey }) => {
        storage.removed.push(objectKey);
        storage.objects.delete(objectKey);
      }
    };
  }

  function serviceFor(client, label) {
    const siteEvidence = createAttendanceSiteEvidenceService({ prisma: client, clock: () => now, policyOverride: policy });
    return createAttendanceSimpleService({ prisma: client, audit, clock: () => now, siteEvidenceService: siteEvidence,
      policyService: { getPolicy: async () => policy }, selfieStorage: storageFor(label), bundleSecret: () => 'disposable-integration-only-signing-secret-32-bytes' });
  }

  function observeTransactions(client, label) {
    const signals = transactionSignals[label];
    const raw = client.$transaction.bind(client);
    client.$transaction = async (callback, options) => {
      if (typeof callback !== 'function') return raw(callback, options);
      return raw(async (tx) => {
        if (options?.isolationLevel === 'Serializable') await awaitFinalizationBarrier();
        try { return await callback(tx); } catch (error) {
          if (error?.code === 'P2034' || error?.code === 'P2002') signals.push(error.code);
          throw error;
        }
      }, options);
    };
  }

  async function cleanup() {
    const rows = await prisma.attendanceEvent.findMany({ where: { session: { employeeId: ids.employee } }, select: { id: true } }).catch(() => []);
    await prisma.auditLog.deleteMany({ where: { OR: [
      { actorUserId: ids.user }, { entityId: { in: rows.map((row) => row.id) } }
    ] } }).catch(() => {});
    await prisma.attendancePendingEvent.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceSelfie.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceEvent.deleteMany({ where: { session: { employeeId: ids.employee } } }).catch(() => {});
    await prisma.attendanceSession.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceChangeRequest.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceChallenge.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceEnrollment.deleteMany({ where: { employeeId: { in: [ids.employee, ids.employeeB] } } }).catch(() => {});
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.scheduleApproval.deleteMany({ where: { id: ids.approval } }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: ids.site } }).catch(() => {});
    await prisma.shiftType.deleteMany({ where: { id: ids.shiftType } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: ids.user } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employeeB } }).catch(() => {});
  }

  async function seed() {
    await cleanup();
    await prisma.employee.create({ data: { id: ids.employee, employeeCode: `FOREIGN-${marker}`, firstName: 'Foreign', lastName: 'Concurrency', department: 'SECURITY' } });
    await prisma.employee.create({ data: { id: ids.employeeB, employeeCode: `BOUND-${marker}`, firstName: 'Bound', lastName: 'Owner', department: 'SECURITY' } });
    await prisma.user.create({ data: { id: ids.user, email: `foreign-concurrency-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Foreign Concurrency User', role: 'VIEWER', employeeId: ids.employee } });
    await prisma.attendanceSelfiePolicy.upsert({ where: { role: 'VIEWER' }, update: { clockInRequired: true, clockOutRequired: false, updatedByUserId: ids.user }, create: { role: 'VIEWER', clockInRequired: true, clockOutRequired: false, updatedByUserId: ids.user } });
    await prisma.shiftType.create({ data: { id: ids.shiftType, code: `FC${marker.slice(0, 4)}`, name: 'Foreign Concurrency Day', startTime: '07:00', endTime: '19:00', hours: 12, color: '#D9E1F2' } });
    await prisma.securitySite.create({ data: { id: ids.site, code: `FC-${marker}`, name: 'Foreign Concurrency Site', latitude: 13.7241, longitude: 100.5701, geofenceRadiusMeters: 100, isActive: true } });
    await prisma.shiftAssignment.create({ data: { id: ids.assignment, employeeId: ids.employee, shiftTypeId: ids.shiftType, securitySiteId: ids.site,
      workDate: new Date('2026-10-02T00:00:00.000Z'), employeeNameSnapshot: 'Foreign Concurrency', departmentSnapshot: 'SECURITY', startTime: '07:00', endTime: '19:00', hours: 12, source: 'FOREIGN_SELFIE_CONCURRENCY_TEST', locked: true, licenseStatus: 'VALID' } });
    await prisma.scheduleApproval.create({ data: { id: ids.approval, month: new Date('2026-10-01T00:00:00.000Z'), status: 'APPROVED', revision: 1, changedAt: now, approvedAt: now, changedByLegacyRef: ids.user, approvedByLegacyRef: ids.user, changeType: 'TEST', approvalNote: 'Disposable concurrency test' } });
    const primary = keyMaterial();
    await prisma.attendanceDeviceEnrollment.create({ data: { id: ids.primaryEnrollment, employeeId: ids.employee, publicKey: Buffer.from(primary.publicKeySpkiBase64, 'base64'), keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: crypto.createHash('sha256').update(Buffer.from(primary.publicKeySpkiBase64, 'base64')).digest('hex'), displayName: 'Primary test device', status: 'ACTIVE', proofVerifiedAt: now, activatedAt: now, createdByUserId: ids.user } });
    for (const [id, nonce] of [[ids.challengeOne, crypto.randomBytes(32).toString('hex')], [ids.challengeTwo, crypto.randomBytes(32).toString('hex')]]) {
      await prisma.attendanceDeviceChallenge.create({ data: { id, employeeId: ids.employee, purpose: 'ATTENDANCE_EVENT', challengeHash: challengeHash(nonce), expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000) } });
      if (id === ids.challengeOne) ids.nonceOne = nonce; else ids.nonceTwo = nonce;
    }
    return { primaryConnection: await prisma.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'), secondConnection: await secondPrisma.$queryRawUnsafe('SELECT pg_backend_pid() AS pid') };
  }

  test('real PostgreSQL legacy enrollment statuses are passive and nonblocking', async () => {
    await seed();
    await prisma.attendanceEvent.deleteMany({ where: { session: { employeeId: ids.employee } } });
    await prisma.attendanceSession.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.attendanceDeviceSelfie.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.attendanceDeviceEnrollment.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.attendanceDeviceChangeRequest.deleteMany({ where: { employeeId: ids.employee } });
    const passiveService = createAttendanceSimpleService({
      prisma, audit, clock: () => now,
      siteEvidenceService: createAttendanceSiteEvidenceService({ prisma, clock: () => now, policyOverride: policy }),
      policyService: { getPolicy: async () => policy },
      selfiePolicyService: { resolve: async () => ({ required: false, sourceRole: 'VIEWER', action: 'CHECK_IN', policy: { role: 'VIEWER', clockInRequired: false, clockOutRequired: false } }) },
      selfieStorage: storageFor('legacy-passive'), bundleSecret: () => 'disposable-integration-only-signing-secret-32-bytes'
    });
    for (const [index, status] of ['REVOKED', 'REJECTED', 'CANCELLED', 'PENDING_APPROVAL'].entries()) {
      await prisma.attendanceSession.deleteMany({ where: { employeeId: ids.employee } });
      await prisma.attendanceEvent.deleteMany({ where: { session: { employeeId: ids.employee } } });
      const device = keyMaterial();
      const fingerprint = crypto.createHash('sha256').update(Buffer.from(device.publicKeySpkiBase64, 'base64')).digest('hex');
      const enrollment = await prisma.attendanceDeviceEnrollment.create({ data: {
        employeeId: ids.employee, publicKey: Buffer.from(device.publicKeySpkiBase64, 'base64'), keyAlgorithm: 'ECDSA_P256_SHA256',
        credentialFingerprint: fingerprint, displayName: `Legacy ${status}`, status, observationOnly: status === 'PENDING_APPROVAL', createdByUserId: ids.user
      } });
      const result = await passiveService.submit({ actor, input: signedInput({ deviceMaterial: device, nonce: '', capture: crypto.randomUUID() }) });
      assert.equal(result.counted, true, `${status} legacy enrollment must not block Attendance`);
      const unchanged = await prisma.attendanceDeviceEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      assert.equal(unchanged.status, status);
      const auditRow = await prisma.auditLog.findFirst({ where: { actorUserId: ids.user, entityType: 'AttendanceDeviceEnrollment', entityId: enrollment.id }, orderBy: { createdAt: 'desc' } });
      assert.ok(auditRow, `${status} legacy observation must write an enrollment audit`);
      assert.equal(AUDIT_ACTION_VALUES.has(auditRow.action), true, `${status} audit action must be generated AuditAction`);
      assert.equal(auditRow.action, 'UPDATE');
      assert.deepEqual(auditRow.metadata, { event: 'OBSERVED_LEGACY_DEVICE_STATUS', employeeId: ids.employee, status, credentialFingerprint: fingerprint });
      assert.equal(await prisma.attendanceDeviceChangeRequest.count({ where: { employeeId: ids.employee } }), 0);
      assert.equal(await prisma.attendanceEvent.count({ where: { session: { employeeId: ids.employee } } }), 1);
      await prisma.attendanceEvent.deleteMany({ where: { session: { employeeId: ids.employee } } });
      await prisma.attendanceSession.deleteMany({ where: { employeeId: ids.employee } });
      await prisma.attendanceDeviceEnrollment.deleteMany({ where: { id: enrollment.id } });
      assert.equal(index < 4, true);
    }
    await cleanup();
  });

  test('real PostgreSQL passive observation audit failure cannot rollback Attendance or required event audit', async () => {
    await seed();
    await prisma.attendanceDeviceEnrollment.deleteMany({ where: { employeeId: ids.employee } });
    const failingPassiveAudit = {
      log: async (entry, client) => {
        if (entry.entityType === 'AttendanceDeviceEnrollment') throw new Error('SIMULATED_PASSIVE_AUDIT_FAILURE');
        return audit.log(entry, client);
      }
    };
    const service = createAttendanceSimpleService({
      prisma, audit: failingPassiveAudit, clock: () => now,
      siteEvidenceService: createAttendanceSiteEvidenceService({ prisma, clock: () => now, policyOverride: policy }),
      policyService: { getPolicy: async () => policy },
      selfiePolicyService: { resolve: async () => ({ required: false, sourceRole: 'VIEWER', action: 'CHECK_IN', policy: { role: 'VIEWER', clockInRequired: false, clockOutRequired: false } }) },
      selfieStorage: storageFor('passive-audit-failure'), bundleSecret: () => 'disposable-integration-only-signing-secret-32-bytes'
    });
    const result = await service.submit({ actor, input: signedInput({ deviceMaterial: material, nonce: '', capture: crypto.randomUUID() }) });
    assert.equal(result.counted, true);
    assert.equal(await prisma.attendanceEvent.count({ where: { session: { employeeId: ids.employee } } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entityType: 'AttendanceEvent', actorUserId: ids.user } }), 1);
    assert.equal(await prisma.attendanceDeviceEnrollment.count({ where: { employeeId: ids.employee } }), 1);
    await cleanup();
  });

  test('real PostgreSQL two-connection foreign selfie finalization races on one captureId', async () => {
    try {
      const connections = await seed();
      const pidOne = Number(connections.primaryConnection[0].pid);
      const pidTwo = Number(connections.secondConnection[0].pid);
      console.log(`FOREIGN_SELFIE_CONNECTIONS clientOne=${pidOne} clientTwo=${pidTwo}`);
      assert.notEqual(pidOne, pidTwo, 'the two Prisma clients must use independent PostgreSQL connections');
      observeTransactions(prisma, 'clientOne');
      observeTransactions(secondPrisma, 'clientTwo');
      const first = serviceFor(prisma, 'clientOne');
      const second = serviceFor(secondPrisma, 'clientTwo');
      const results = await Promise.allSettled([
        first.submit({ actor, input: signedInput({ deviceMaterial: material, nonce: ids.nonceOne, capture: captureId }) }),
        second.submit({ actor, input: signedInput({ deviceMaterial: material, nonce: ids.nonceTwo, capture: captureIdTwo }) })
      ]);
      assert.equal(storage.uploads.length, 2, 'both independently validated captures must upload before finalization');
      assert.deepEqual(new Set(storage.uploads.map((row) => row.captureId)), new Set([captureId, captureIdTwo]));
      assert.equal(finalizationBarrier.entered, 2, 'both DB finalization transactions entered the barrier before either was released');
      const consumedChallenges = await prisma.attendanceDeviceChallenge.count({ where: { employeeId: ids.employee, consumedAt: { not: null } } });
      assert.equal(consumedChallenges, 0, 'role-policy selfie does not consume legacy device challenges');
      assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1, JSON.stringify(results));
      assert.equal(results.filter((row) => row.status === 'rejected' && row.reason?.details?.code === 'ATTENDANCE_ALREADY_CHECKED_IN').length, 1, JSON.stringify(results));
      const conflictSignals = [...transactionSignals.clientOne, ...transactionSignals.clientTwo];
      assert.equal(conflictSignals.includes('P2002'), false, `fingerprint observation must not reject through P2002: ${conflictSignals.join(',')}`);
      console.log(`FOREIGN_SELFIE_UPLOADS count=${storage.uploads.length} removed=${storage.removed.length} dbConflict=${conflictSignals.join(',')}`);
      const [events, pending, selfies, sessions, changes, audits, observations] = await Promise.all([
        prisma.attendanceEvent.findMany({ where: { captureId } }), prisma.attendancePendingEvent.findMany({ where: { captureId } }),
        prisma.attendanceDeviceSelfie.findMany({ where: { captureId } }), prisma.attendanceSession.findMany({ where: { shiftAssignmentId: ids.assignment } }),
        prisma.attendanceDeviceChangeRequest.findMany({ where: { employeeId: ids.employee } }), prisma.auditLog.findMany({ where: { actorUserId: ids.user } }),
        prisma.attendanceDeviceEnrollment.findMany({ where: { credentialFingerprint: crypto.createHash('sha256').update(Buffer.from(material.publicKeySpkiBase64, 'base64')).digest('hex') } })
      ]);
      assert.equal(events.length, 1); assert.equal(pending.length, 0); assert.equal(selfies.length, 1); assert.equal(sessions.length, 1); assert.equal(changes.length, 0);
      assert.equal(observations.length, 1, 'concurrent first observation creates at most one enrollment');
      assert.equal(observations[0].employeeId, ids.employee, 'observation ownership belongs to the Attendance actor');
      assert.equal(observations[0].observationOnly, true);
      assert.equal(audits.filter((row) => row.entityType === 'AttendanceDeviceEnrollment').length >= 1, true, 'observation must write telemetry audit');
      assert.equal(events[0].deviceEnrollmentId === observations[0].id, true);
      assert.equal(selfies[0].deviceEnrollmentId === observations[0].id, true);
      assert.equal((events[0].reviewReasons || []).includes('DEVICE_MISMATCH'), false);
      assert.equal(audits.filter((row) => row.entityType === 'AttendanceEvent').length, 1);
      assert.equal(storage.objects.size, 1);
      assert.equal(storage.removed.length, 1);
      assert.equal(storage.objects.has(selfies[0].storageObjectKey), true);
      assert.equal(storage.removed.includes(selfies[0].storageObjectKey), false);
    } finally {
      await cleanup();
    }
  });

  test.after(async () => {
    await cleanup().catch(() => {});
    await Promise.all([prisma.$disconnect(), secondPrisma.$disconnect()]);
  });
}
