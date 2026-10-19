'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { canonicalJson, signedEventPayload, createAttendanceSimpleService } = require('../src/services/attendance-simple.service');
const { createAttendanceSiteEvidenceService } = require('../src/services/attendance-site-evidence.service');
const { createAttendanceRoutes } = require('../src/routes/attendance.routes');
const { errorHandler } = require('../src/middlewares/error-handler');

const ids = { user: '11111111-1111-4111-8111-111111111111', employee: '22222222-2222-4222-8222-222222222222', assignment: '33333333-3333-4333-8333-333333333333', shift: '44444444-4444-4444-8444-444444444444', site: '55555555-5555-4555-8555-555555555555', admin: '66666666-6666-4666-8666-666666666666' };
const NOW = new Date('2026-10-02T01:00:00.000Z');
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////2wBDAf//////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Av/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8h/9k=';
const policy = { maxAccuracyMeters: 50, maxAgeMs: 180000, futureSkewMs: 30000, offlineConfirmAfterMs: 300000, offlineBundleTtlMs: 86400000 };

// Exactly the checksum the frontend computes for the selfie blob it uploads
// (AttendanceSimplePage.captureSelfie: sha256Hex(new Uint8Array(await blob.arrayBuffer()))).
const SELFIE_CHECKSUM = crypto.createHash('sha256').update(Buffer.from(JPEG, 'base64')).digest('hex');

function keyMaterial() {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { pair, publicKeySpkiBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}

// Payload shape mirrors frontend AttendanceSimplePage.captureSelfie -> signedEvent.
function frontendSelfie(checksum = SELFIE_CHECKSUM) {
  return { mimeType: 'image/jpeg', base64: JPEG, checksum, captureMode: 'LIVE_CAMERA', overlay: { capturedAt: NOW.toISOString() } };
}

function eventInput({ pair, publicKeySpkiBase64, selfie, selfieNonce, captureId = crypto.randomUUID() } = {}) {
  const input = {
    captureId,
    eventIntent: 'CHECK_IN',
    shiftAssignmentId: ids.assignment,
    capturedAt: NOW.toISOString(),
    location: { latitude: 13.7241, longitude: 100.5701, accuracyMeters: 8, capturedAt: NOW.toISOString() },
    device: {
      publicKeySpkiBase64,
      keyAlgorithm: 'ECDSA_P256_SHA256',
      displayName: 'อุปกรณ์ลงเวลา',
      signals: { secureContext: true, webCrypto: true, indexedDb: true, privateKeyNonExportable: true },
      signatureBase64: ''
    }
  };
  if (selfie) input.selfie = selfie;
  if (selfieNonce !== undefined) input.selfieNonce = selfieNonce;
  input.device.signatureBase64 = crypto.sign('sha256', Buffer.from(canonicalJson(signedEventPayload(input))), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  return input;
}

function appWith(simpleService) {
  const routes = createAttendanceRoutes({
    environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' },
    authenticateMiddleware: (req, _res, next) => { req.user = { sub: ids.user, role: 'EMPLOYEE' }; next(); },
    simpleService
  });
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/v1/attendance', routes);
  app.use(errorHandler);
  return app;
}

function spyService() {
  const calls = [];
  return {
    calls,
    createSelfieChallenge: async () => ({ nonce: 'a'.repeat(64), expiresAt: new Date(NOW.getTime() + 120000) }),
    submit: async ({ actor, input, requestUserAgent }) => {
      calls.push({ actor, input, requestUserAgent });
      return { counted: true, status: 'ACCEPTED', event: { id: 'spy-event', captureId: input.captureId } };
    }
  };
}

function harness() {
  const state = { now: new Date(NOW), devices: [], challenges: [], selfies: [], events: [], sessions: [], requests: [] };
  const employee = { id: ids.employee, employeeCode: 'R82-TEST', displayName: 'R82 Test', firstName: 'R82', lastName: 'Test', department: 'SECURITY', isActive: true, deletedAt: null };
  const site = { id: ids.site, code: 'A', name: 'Site A', latitude: 13.7241, longitude: 100.5701, geofenceRadiusMeters: 100, isActive: true };
  const assignment = { id: ids.assignment, employeeId: ids.employee, shiftTypeId: ids.shift, securitySiteId: ids.site, workDate: new Date('2026-10-02T00:00:00.000Z'), startTime: '07:00', endTime: '19:00', shiftType: { id: ids.shift, code: 'D', startTime: '07:00', endTime: '19:00' }, securitySite: site, employee };
  const prisma = {
    user: { findUnique: async () => ({ id: ids.user, employeeId: ids.employee, isActive: true, accountStatus: 'ACTIVE', employee }) },
    shiftAssignment: { findMany: async () => [assignment], findUnique: async () => assignment },
    scheduleApproval: { findFirst: async () => ({ id: ids.admin, revision: 1, status: 'APPROVED' }) },
    securitySite: { findUnique: async () => site, findMany: async () => [site] },
    attendanceSession: { findUnique: async ({ where }) => state.sessions.find(x => x.shiftAssignmentId === where.shiftAssignmentId) || null, create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.sessions.push(x); return x; }, update: async ({ data }) => Object.assign(state.sessions[0], data) },
    attendanceEvent: { findUnique: async ({ where }) => where.captureId ? state.events.find(x => x.captureId === where.captureId) || null : state.events.find(x => x.sessionId === where.sessionId_eventType.sessionId && x.eventType === where.sessionId_eventType.eventType) || null, create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.events.push(x); return x; } },
    attendancePendingEvent: { findUnique: async () => null, create: async ({ data }) => ({ id: crypto.randomUUID(), ...data }) },
    attendanceDeviceEnrollment: { findUnique: async ({ where }) => state.devices.find(x => x.credentialFingerprint === where.credentialFingerprint) || null, findFirst: async ({ where }) => state.devices.find(x => x.employeeId === where.employeeId && x.status === where.status) || null, create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.devices.push(x); return x; } },
    attendanceDeviceSelfie: { create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.selfies.push(x); return x; } },
    attendanceDeviceChangeRequest: { findFirst: async () => null, create: async ({ data }) => { const x = { id: crypto.randomUUID(), status: 'PENDING_APPROVAL', ...data }; state.requests.push(x); return x; } },
    attendanceDeviceChallenge: { updateMany: async ({ where, data }) => { let count = 0; for (const x of state.challenges) if (x.employeeId === where.employeeId && x.purpose === where.purpose && x.consumedAt == null) { Object.assign(x, data); count++; } return { count }; }, create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.challenges.push(x); return x; }, findFirst: async ({ where }) => state.challenges.find(x => x.employeeId === where.employeeId && x.purpose === where.purpose && x.challengeHash === where.challengeHash && x.consumedAt == null && x.expiresAt > where.expiresAt.gt) || null },
    $transaction: async fn => fn(prisma)
  };
  const service = createAttendanceSimpleService({
    prisma,
    clock: () => state.now,
    audit: { log: async () => {} },
    siteAuthorityService: { resolve: async () => ({ site, source: 'ASSIGNMENT' }) },
    siteEvidenceService: createAttendanceSiteEvidenceService({ prisma, clock: () => state.now, policyOverride: policy }),
    policyService: { getPolicy: async () => policy },
    selfieStorage: { put: async ({ captureId, selfie: photo }) => ({ provider: 'test', bucket: 'test', objectKey: captureId, mimeType: photo.mimeType, sizeBytes: photo.buffer.length, checksum: photo.checksum }) },
    bundleSecret: () => 'test-only-offline-signing-secret-at-least-32-bytes'
  });
  return { state, service };
}

// F-01 regression: the frontend-shaped selfie payload carries a SHA-256 `checksum`.
// A strict schema that did not know the field answered HTTP 400 before the service ran.
test('simple/events accepts the frontend selfie payload including a 64-hex checksum', async () => {
  const spy = spyService();
  const app = appWith(spy);
  const k = keyMaterial();
  const payload = eventInput({ ...k, selfie: frontendSelfie() });
  const response = await request(app).post('/api/v1/attendance/simple/events').send(payload);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(spy.calls.length, 1, 'service handler must be reached exactly once');
  assert.equal(spy.calls[0].input.selfie.checksum, SELFIE_CHECKSUM);
  assert.deepEqual(spy.calls[0].input.selfie, frontendSelfie());
  assert.equal(response.body.data.status, 'ACCEPTED');
});

test('simple/events keeps the checksum intact for the signed payload and reaches the real service', async () => {
  // Uppercase hex proves both the /i format rule and that the route never rewrites
  // or drops the field: the service re-derives the signed payload from the parsed input,
  // so a stripped checksum would break the device signature.
  const declared = SELFIE_CHECKSUM.toUpperCase();
  const h = harness();
  const app = appWith(h.service);
  const k = keyMaterial();
  const payload = eventInput({ ...k, selfie: frontendSelfie(declared) });
  const response = await request(app).post('/api/v1/attendance/simple/events').send(payload);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.data.counted, true);
  assert.equal(h.state.events.length, 1);
  assert.equal(signedEventPayload(payload).selfieChecksum, declared);
});

test('simple/events rejects a malformed checksum with 400 and never calls the service', async () => {
  for (const malformed of ['not-a-checksum', 'a'.repeat(63), 'g'.repeat(64), `${'a'.repeat(64)}0`, '']) {
    const spy = spyService();
    const app = appWith(spy);
    const k = keyMaterial();
    const response = await request(app).post('/api/v1/attendance/simple/events').send(eventInput({ ...k, selfie: frontendSelfie(malformed) }));
    assert.equal(response.status, 400, `checksum ${JSON.stringify(malformed)} must be rejected: ${JSON.stringify(response.body)}`);
    assert.equal(spy.calls.length, 0, 'service handler must not run for a schema-rejected payload');
    assert.match(String(response.body.error), /checksum/i, 'the rejection must name the offending field');
  }
});

test('simple/events still accepts a selfie without a checksum', async () => {
  const spy = spyService();
  const app = appWith(spy);
  const k = keyMaterial();
  const selfie = frontendSelfie();
  delete selfie.checksum;
  const response = await request(app).post('/api/v1/attendance/simple/events').send(eventInput({ ...k, selfie }));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].input.selfie.checksum, undefined);
});
