'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'g06-face-verification-disposable-local'
  && target.hostname === '127.0.0.1'
  && target.port === '55437'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('G06 Face Verification integration requires the explicit disposable local target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createFaceVerificationSessionService, receiptHash, providerRefHash } = require('../../src/services/face-verification-session.service');
  const { createFaceVerificationPocService } = require('../../src/services/face-verification-poc.service');
  const { deriveActiveFaceChallenge } = require('../../src/services/active-face-challenge.service');
  const audit = require('../../src/services/audit.service');
  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = { employee: crypto.randomUUID(), user: crypto.randomUUID(), admin: crypto.randomUUID(), device: crypto.randomUUID(), reference: crypto.randomUUID() };
  const actor = { sub: ids.user, role: 'VIEWER' };
  const contextDigest = crypto.createHash('sha256').update('G06-FACE-UAT|' + marker).digest('hex');

  function keyMaterial() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return { ...pair, spki: pair.publicKey.export({ type: 'spki', format: 'der' }) };
  }

  async function cleanup() {
    const sessions = await prisma.faceVerificationSession.findMany({ where: { employeeId: ids.employee }, select: { id: true } }).catch(() => []);
    if (sessions.length) await prisma.auditLog.deleteMany({ where: { entityType: 'FaceVerificationSession', entityId: { in: sessions.map((row) => row.id) } } }).catch(() => {});
    await prisma.faceVerificationReceipt.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.faceVerificationSession.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceChallenge.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.employeeReferencePhoto.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceEnrollment.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.admin] } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  async function seed(material) {
    await cleanup();
    await prisma.employee.create({ data: { id: ids.employee, employeeCode: 'FACE-' + marker, firstName: 'Face', lastName: 'Verification', department: 'SECURITY', isActive: true } });
    await prisma.user.createMany({ data: [
      { id: ids.user, email: 'face-user-' + marker + '@example.test', passwordHash: 'test-only', displayName: 'Face Employee', role: 'VIEWER', employeeId: ids.employee },
      { id: ids.admin, email: 'face-admin-' + marker + '@example.test', passwordHash: 'test-only', displayName: 'Face Admin', role: 'ADMIN' }
    ] });
    await prisma.attendanceDeviceEnrollment.create({ data: { id: ids.device, employeeId: ids.employee, publicKey: material.spki, keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: crypto.createHash('sha256').update(material.spki).digest('hex'), displayName: 'Face UAT Phone', status: 'ACTIVE', proofVerifiedAt: new Date(), activatedAt: new Date(), createdByUserId: ids.user, approvedByUserId: ids.admin } });
    await prisma.employeeReferencePhoto.create({ data: { id: ids.reference, employeeId: ids.employee, status: 'ACTIVE', storageProvider: 'fake', storageBucket: 'face-uat', storageObjectKey: 'face/' + marker + '/reference.png', originalFileName: 'reference.png', safeDisplayFileName: 'reference.png', mimeType: 'image/png', fileSize: 1024, checksum: 'a'.repeat(64), imageWidth: 512, imageHeight: 512, uploadedByUserId: ids.admin, uploadedByRoleSnapshot: 'ADMIN', reviewedByUserId: ids.admin, reviewedAt: new Date(), activatedAt: new Date() } });
  }

  async function startAndProve(service, material, purpose = 'ATTENDANCE_EVENT') {
    const created = await service.createSession({ actor, purpose, contextDigest });
    const sig = crypto.sign('sha256', Buffer.from(created.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });
    const proved = await service.verifyDeviceProof({ actor, sessionId: created.session.id, challengeId: created.challengeId, challenge: created.challenge, signatureBase64: sig.toString('base64') });
    assert.equal(proved.status, 'DEVICE_PROOF_VERIFIED');
    return created;
  }

  test('real DB enforces trusted device/reference binding, PAD result, opaque receipt, single-use consume and stale fail-closed', async () => {
    const material = keyMaterial();
    await seed(material);
    const service = createFaceVerificationSessionService({ prisma, audit });

    const first = await service.createSession({ actor, purpose: 'ATTENDANCE_EVENT', contextDigest });
    assert.equal(first.session.status, 'CREATED');
    assert.equal(first.session.deviceEnrollmentId, ids.device);
    assert.equal(first.session.referencePhotoId, ids.reference);
    assert.equal(Object.prototype.hasOwnProperty.call(first.session, 'deviceCredentialFingerprint'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(first.session, 'referencePhotoChecksum'), false);
    const firstSessionRow = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: first.session.id } });
    assert.equal(firstSessionRow.deviceCredentialFingerprint, crypto.createHash('sha256').update(material.spki).digest('hex'));
    assert.equal(firstSessionRow.referencePhotoChecksum, 'a'.repeat(64));
    const challengeRow = await prisma.attendanceDeviceChallenge.findUniqueOrThrow({ where: { id: first.challengeId } });
    assert.notEqual(challengeRow.challengeHash, first.challenge);
    assert.equal(challengeRow.challengeHash.length, 64);
    await assert.rejects(() => service.createSession({ actor, purpose: 'ATTENDANCE_EVENT', contextDigest }), (error) => error.details?.code === 'FACE_VERIFICATION_SESSION_ALREADY_ACTIVE');

    const duplicateChallenge = await prisma.attendanceDeviceChallenge.create({ data: { employeeId: ids.employee, deviceEnrollmentId: ids.device, purpose: 'PATROL_EVENT', challengeHash: crypto.createHash('sha256').update('dup-' + marker).digest('hex'), expiresAt: new Date(Date.now() + 300000) } });
    const duplicateSessionData = { employeeId: ids.employee, userId: ids.user, deviceEnrollmentId: ids.device, deviceCredentialFingerprint: crypto.createHash('sha256').update(material.spki).digest('hex'), referencePhotoId: ids.reference, referencePhotoChecksum: 'a'.repeat(64), deviceChallengeId: duplicateChallenge.id, purpose: 'ATTENDANCE_EVENT', contextDigest, expiresAt: new Date(Date.now() + 300000) };
    await assert.rejects(() => prisma.faceVerificationSession.create({ data: duplicateSessionData }), (error) => error.code === 'P2002');
    await prisma.attendanceDeviceChallenge.delete({ where: { id: duplicateChallenge.id } });

    const signature = crypto.sign('sha256', Buffer.from(first.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });
    const proved = await service.verifyDeviceProof({ actor, sessionId: first.session.id, challengeId: first.challengeId, challenge: first.challenge, signatureBase64: signature.toString('base64') });
    assert.equal(proved.status, 'DEVICE_PROOF_VERIFIED');
    await assert.rejects(() => service.verifyDeviceProof({ actor, sessionId: first.session.id, challengeId: first.challengeId, challenge: first.challenge, signatureBase64: signature.toString('base64') }), (error) => error.details?.code === 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE');

    const providerRef1 = 'provider-fail-' + crypto.randomUUID();
    await service.bindProviderSession({ sessionId: first.session.id, provider: 'TEST_PROVIDER', providerSessionRef: providerRef1, policyProfileId: 'pilot-v1', engineVersion: 'test-1' });
    const storedFirst = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: first.session.id } });
    assert.equal(storedFirst.providerSessionRefHash, providerRefHash(providerRef1));
    assert.notEqual(storedFirst.providerSessionRefHash, providerRef1);
    const padFail = await service.recordTrustedProviderResult({ sessionId: first.session.id, providerSessionRef: providerRef1, padPassed: false, faceMatchPassed: true, injectionRiskDetected: false, resultCode: 'PAD_REJECT' });
    assert.equal(padFail.receipt, null);
    assert.equal(padFail.session.status, 'FAILED');
    assert.equal(padFail.session.failureCode, 'LIVENESS_FAILED');

    const second = await startAndProve(service, material);
    const providerRef2 = 'provider-pass-' + crypto.randomUUID();
    await service.bindProviderSession({ sessionId: second.session.id, provider: 'TEST_PROVIDER', providerSessionRef: providerRef2, policyProfileId: 'pilot-v1', engineVersion: 'test-1' });
    const accepted = await service.recordTrustedProviderResult({ sessionId: second.session.id, providerSessionRef: providerRef2, padPassed: true, faceMatchPassed: true, injectionRiskDetected: false, resultCode: 'PASS' });
    assert.ok(accepted.receipt.length >= 32);
    assert.equal(accepted.session.status, 'VERIFIED');
    const receiptRow = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: second.session.id } });
    assert.equal(receiptRow.receiptHash, receiptHash(accepted.receipt));
    assert.notEqual(receiptRow.receiptHash, accepted.receipt);
    assert.equal(receiptRow.deviceCredentialFingerprint, crypto.createHash('sha256').update(material.spki).digest('hex'));
    assert.equal(receiptRow.referencePhotoChecksum, 'a'.repeat(64));
    const auditJson = JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: 'FaceVerificationSession', entityId: second.session.id } }));
    assert.equal(auditJson.includes(accepted.receipt), false);
    assert.equal(auditJson.includes(providerRef2), false);

    const expected = { employeeId: ids.employee, userId: ids.user, deviceEnrollmentId: ids.device, referencePhotoId: ids.reference, purpose: 'ATTENDANCE_EVENT', contextDigest };
    await assert.rejects(() => service.consumeReceipt({ receipt: accepted.receipt, expected: { ...expected, contextDigest: 'b'.repeat(64) } }), (error) => error.details?.code === 'VERIFICATION_CONTEXT_MISMATCH');
    const consumed = await service.consumeReceipt({ receipt: accepted.receipt, expected });
    assert.equal(consumed.employeeId, ids.employee);
    assert.equal(consumed.referencePhotoId, ids.reference);
    const consumedRow = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: second.session.id } });
    assert.ok(consumedRow.consumedAt);
    const consumedSession = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: second.session.id } });
    assert.equal(consumedSession.status, 'CONSUMED');
    await assert.rejects(() => service.consumeReceipt({ receipt: accepted.receipt, expected }), (error) => error.details?.code === 'VERIFICATION_REPLAYED');

    const third = await startAndProve(service, material);
    const providerRef3 = 'provider-injection-' + crypto.randomUUID();
    await service.bindProviderSession({ sessionId: third.session.id, provider: 'TEST_PROVIDER', providerSessionRef: providerRef3 });
    const injectionFail = await service.recordTrustedProviderResult({ sessionId: third.session.id, providerSessionRef: providerRef3, padPassed: true, faceMatchPassed: true, injectionRiskDetected: true, resultCode: 'INJECTION' });
    assert.equal(injectionFail.receipt, null);
    assert.equal(injectionFail.session.failureCode, 'CAPTURE_INJECTION_RISK');

    const fourth = await startAndProve(service, material);
    const providerRef4 = 'provider-receipt-stale-' + crypto.randomUUID();
    await service.bindProviderSession({ sessionId: fourth.session.id, provider: 'TEST_PROVIDER', providerSessionRef: providerRef4 });
    const staleReceipt = await service.recordTrustedProviderResult({ sessionId: fourth.session.id, providerSessionRef: providerRef4, padPassed: true, faceMatchPassed: true, injectionRiskDetected: false, resultCode: 'PASS' });
    assert.equal(staleReceipt.session.status, 'VERIFIED');
    await prisma.employeeReferencePhoto.update({ where: { id: ids.reference }, data: { status: 'SUPERSEDED', supersededAt: new Date(), storageDeletionRequestedAt: new Date(), storageDeletedAt: new Date() } });
    const newReferenceId = crypto.randomUUID();
    await prisma.employeeReferencePhoto.create({ data: { id: newReferenceId, employeeId: ids.employee, status: 'ACTIVE', storageProvider: 'fake', storageBucket: 'face-uat', storageObjectKey: 'face/' + marker + '/new-reference.png', originalFileName: 'new-reference.png', safeDisplayFileName: 'new-reference.png', mimeType: 'image/png', fileSize: 1024, checksum: 'c'.repeat(64), imageWidth: 512, imageHeight: 512, uploadedByUserId: ids.admin, uploadedByRoleSnapshot: 'ADMIN', reviewedByUserId: ids.admin, reviewedAt: new Date(), activatedAt: new Date() } });
    await assert.rejects(() => service.consumeReceipt({ receipt: staleReceipt.receipt, expected }), (error) => error.details?.code === 'VERIFICATION_STALE');
    const stale = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: fourth.session.id } });
    assert.equal(stale.status, 'FAILED');
    assert.equal(stale.failureCode, 'VERIFICATION_STALE');
    const staleReceiptRow = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: fourth.session.id } });
    assert.equal(staleReceiptRow.consumedAt, null);

    await cleanup();
  });

  test('FACE_MATCH_ONLY requires trusted active challenge and face match while padPassed remains null', async () => {
    const material = keyMaterial();
    await seed(material);
    const service = createFaceVerificationSessionService({ prisma, audit });

    const challengeFailSession = await startAndProve(service, material);
    assert.deepEqual(challengeFailSession.activeChallenge, deriveActiveFaceChallenge(challengeFailSession.session.id));
    const providerRef1 = 'face-only-challenge-fail-' + crypto.randomUUID();
    await service.bindProviderSession({ sessionId: challengeFailSession.session.id, provider: 'SELF_HOSTED_TEST', providerSessionRef: providerRef1, verificationMode: 'FACE_MATCH_ONLY' });
    const challengeFail = await service.recordTrustedFaceMatchOnlyResult({ sessionId: challengeFailSession.session.id, providerSessionRef: providerRef1, activeChallengePassed: false, faceMatchPassed: true, resultCode: 'ACTIVE_CHALLENGE_FAILED' });
    assert.equal(challengeFail.receipt, null);
    assert.equal(challengeFail.session.failureCode, 'ACTIVE_CHALLENGE_FAILED');
    const challengeFailRow = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: challengeFailSession.session.id } });
    assert.equal(challengeFailRow.padPassed, null);
    assert.equal(challengeFailRow.faceMatchPassed, true);
    assert.equal(challengeFailRow.injectionRiskDetected, null);

    const faceFailSession = await startAndProve(service, material);
    const providerRef2 = 'face-only-face-fail-' + crypto.randomUUID();
    await service.bindProviderSession({ sessionId: faceFailSession.session.id, provider: 'SELF_HOSTED_TEST', providerSessionRef: providerRef2, verificationMode: 'FACE_MATCH_ONLY' });
    const faceFail = await service.recordTrustedFaceMatchOnlyResult({ sessionId: faceFailSession.session.id, providerSessionRef: providerRef2, activeChallengePassed: true, faceMatchPassed: false, resultCode: 'FACE_NO_MATCH' });
    assert.equal(faceFail.receipt, null);
    assert.equal(faceFail.session.failureCode, 'FACE_MATCH_FAILED');

    const passedSession = await startAndProve(service, material);
    const providerRef3 = 'face-only-pass-' + crypto.randomUUID();
    await service.bindProviderSession({ sessionId: passedSession.session.id, provider: 'SELF_HOSTED_TEST', providerSessionRef: providerRef3, verificationMode: 'FACE_MATCH_ONLY' });
    const passed = await service.recordTrustedFaceMatchOnlyResult({ sessionId: passedSession.session.id, providerSessionRef: providerRef3, activeChallengePassed: true, faceMatchPassed: true, resultCode: 'FACE_MATCH' });
    assert.ok(passed.receipt.length >= 32);
    assert.equal(passed.session.status, 'VERIFIED');
    const passedRow = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: passedSession.session.id } });
    assert.equal(passedRow.padPassed, null);
    assert.equal(passedRow.faceMatchPassed, true);
    assert.equal(passedRow.injectionRiskDetected, null);
    const receipt = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: passedSession.session.id } });
    assert.equal(receipt.verificationMode, 'FACE_MATCH_ONLY');
    const auditJson = JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: 'FaceVerificationSession', entityId: passedSession.session.id } }));
    assert.ok(auditJson.includes('ACTIVE_FACE_CHALLENGE_V1'));
    assert.ok(auditJson.includes(deriveActiveFaceChallenge(passedSession.session.id).code));
    await cleanup();
  });

  test('expired provider step persists EXPIRED instead of rolling the expiry mutation back', async () => {
    const material = keyMaterial();
    await seed(material);
    let now = new Date('2026-08-24T03:00:00.000Z');
    const service = createFaceVerificationSessionService({ prisma, audit, clock: () => now });
    const created = await service.createSession({ actor, purpose: 'ATTENDANCE_EVENT', contextDigest });
    const sig = crypto.sign('sha256', Buffer.from(created.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });
    await service.verifyDeviceProof({ actor, sessionId: created.session.id, challengeId: created.challengeId, challenge: created.challenge, signatureBase64: sig.toString('base64') });
    now = new Date('2026-08-24T03:06:00.000Z');
    await assert.rejects(() => service.bindProviderSession({ sessionId: created.session.id, provider: 'TEST_PROVIDER', providerSessionRef: 'expired-' + marker }), (error) => error.details?.code === 'VERIFICATION_EXPIRED');
    const expired = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: created.session.id } });
    assert.equal(expired.status, 'EXPIRED');
    assert.equal(expired.failureCode, 'VERIFICATION_EXPIRED');
    assert.ok(expired.failedAt);
    await cleanup();
  });

  test('AWS PoC orchestration uses private Reference Photo bytes and real DB receipt lifecycle with a fake provider', async () => {
    const material = keyMaterial();
    const referenceBytes = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4,5,6,7,8]);
    const referenceChecksum = crypto.createHash('sha256').update(referenceBytes).digest('hex');
    await seed(material);
    await prisma.employeeReferencePhoto.update({ where: { id: ids.reference }, data: { checksum: referenceChecksum, fileSize: referenceBytes.length } });
    const sessionService = createFaceVerificationSessionService({ prisma, audit });
    const created = await startAndProve(sessionService, material);
    const providerSessionRef = crypto.randomUUID();
    let evaluateBytes = null;
    const provider = {
      publicConfig: () => ({ configured: true, provider: 'AWS_REKOGNITION_POC', region: 'ap-southeast-7', challengeType: 'FaceMovementAndLightChallenge' }),
      createLivenessSession: async ({ clientRequestToken }) => { assert.equal(clientRequestToken, created.session.id); return { providerSessionRef, region: 'ap-southeast-7', challengeType: 'FaceMovementAndLightChallenge', policyProfileId: 'aws-poc-test', engineVersion: 'test-engine' }; },
      evaluate: async ({ providerSessionRef: actual, referencePhotoBytes }) => { assert.equal(actual, providerSessionRef); evaluateBytes = Buffer.from(referencePhotoBytes); return { complete: true, providerStatus: 'SUCCEEDED', padPassed: true, faceMatchPassed: true, injectionRiskDetected: false, resultCode: 'AWS_VERIFICATION_PASS', policyProfileId: 'aws-poc-test', engineVersion: 'test-engine' }; }
    };
    let storageReads = 0;
    const storage = { getBytes: async (key) => { storageReads += 1; assert.equal(key, 'face/' + marker + '/reference.png'); return Buffer.from(referenceBytes); } };
    const poc = createFaceVerificationPocService({ prisma, sessionService, provider, storage });
    const bound = await poc.createProviderSession({ actor, sessionId: created.session.id });
    assert.equal(bound.session.status, 'PROVIDER_PENDING');
    assert.equal(bound.providerSessionId, providerSessionRef);
    const completed = await poc.completeProviderSession({ actor, sessionId: created.session.id, providerSessionId: providerSessionRef });
    assert.equal(completed.pending, false);
    assert.equal(completed.session.status, 'VERIFIED');
    assert.ok(completed.receipt.length >= 32);
    assert.equal(storageReads, 1);
    assert.deepEqual(evaluateBytes, referenceBytes);
    const receiptRow = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: created.session.id } });
    assert.equal(receiptRow.receiptHash, receiptHash(completed.receipt));
    const sessionRow = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: created.session.id } });
    assert.equal(sessionRow.provider, 'AWS_REKOGNITION_POC');
    assert.equal(sessionRow.providerResultCode, 'AWS_VERIFICATION_PASS');
    const serialized = JSON.stringify(sessionRow) + JSON.stringify(receiptRow);
    assert.equal(serialized.includes(referenceBytes.toString('base64')), false);
    assert.equal(serialized.includes(providerSessionRef), false);
    await cleanup();
  });

  test('wrong device private key consumes challenge and fails the session', async () => {
    const material = keyMaterial(); const wrong = keyMaterial();
    await seed(material);
    const service = createFaceVerificationSessionService({ prisma, audit });
    const created = await service.createSession({ actor, purpose: 'ATTENDANCE_EVENT', contextDigest });
    const signature = crypto.sign('sha256', Buffer.from(created.challenge, 'base64url'), { key: wrong.privateKey, dsaEncoding: 'ieee-p1363' });
    await assert.rejects(() => service.verifyDeviceProof({ actor, sessionId: created.session.id, challengeId: created.challengeId, challenge: created.challenge, signatureBase64: signature.toString('base64') }), (error) => error.details?.code === 'DEVICE_PROOF_FAILED');
    const challenge = await prisma.attendanceDeviceChallenge.findUniqueOrThrow({ where: { id: created.challengeId } });
    const session = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: created.session.id } });
    assert.ok(challenge.consumedAt);
    assert.equal(session.status, 'FAILED');
    assert.equal(session.failureCode, 'DEVICE_PROOF_FAILED');
    await cleanup();
  });

  test.after(async () => { await cleanup().catch(() => {}); await prisma.$disconnect(); });
}
