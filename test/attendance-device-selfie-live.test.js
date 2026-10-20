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

const ids = { user: '11111111-1111-4111-8111-111111111111', employee: '22222222-2222-4222-8222-222222222222', assignment: '33333333-3333-4333-8333-333333333333', shift: '44444444-4444-4444-8444-444444444444', site: '55555555-5555-4555-8555-555555555555', admin: '66666666-6666-4666-8666-666666666666' };
const NOW = new Date('2026-10-02T01:00:00.000Z');
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////2wBDAf//////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Av/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8h/9k=';
const policy = { maxAccuracyMeters: 50, maxAgeMs: 180000, futureSkewMs: 30000, offlineConfirmAfterMs: 300000, offlineBundleTtlMs: 86400000 };

function keyMaterial() { const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); return { pair, publicKeySpkiBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }; }
function selfie(captureMode = 'LIVE_CAMERA', capturedAt = NOW) { return { mimeType: 'image/jpeg', base64: JPEG, captureMode, overlay: { capturedAt: capturedAt.toISOString() } }; }
function inputFor({ pair, publicKeySpkiBase64, captureId = crypto.randomUUID(), selfie: photo, selfieNonce, capturedAt = NOW } = {}) {
  const input = { captureId, eventIntent: 'CHECK_IN', shiftAssignmentId: ids.assignment, capturedAt: capturedAt.toISOString(), location: { latitude: 13.7241, longitude: 100.5701, accuracyMeters: 8, capturedAt: capturedAt.toISOString() }, device: { publicKeySpkiBase64, keyAlgorithm: 'ECDSA_P256_SHA256', displayName: 'Test device', signals: { secureContext: true, webCrypto: true, indexedDb: true, privateKeyNonExportable: true }, signatureBase64: '' } };
  if (photo) input.selfie = photo;
  if (selfieNonce !== undefined) input.selfieNonce = selfieNonce;
  input.device.signatureBase64 = crypto.sign('sha256', Buffer.from(canonicalJson(signedEventPayload(input))), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  return input;
}

function harness({ foreign = false, selfieStorage = null } = {}) {
  const state = { now: new Date(NOW), devices: [], challenges: [], selfies: [], events: [], sessions: [], requests: [] };
  const employee = { id: ids.employee, employeeCode: 'LIVE-TEST', displayName: 'Live Test', firstName: 'Live', lastName: 'Test', department: 'SECURITY', isActive: true, deletedAt: null };
  const site = { id: ids.site, code: 'A', name: 'Site A', latitude: 13.7241, longitude: 100.5701, geofenceRadiusMeters: 100, isActive: true };
  const assignment = { id: ids.assignment, employeeId: ids.employee, shiftTypeId: ids.shift, securitySiteId: ids.site, workDate: new Date('2026-10-02T00:00:00.000Z'), startTime: '07:00', endTime: '19:00', shiftType: { id: ids.shift, code: 'D', startTime: '07:00', endTime: '19:00' }, securitySite: site, employee };
  if (foreign) state.devices.push({ id: 'active-primary', employeeId: ids.employee, credentialFingerprint: 'not-the-test-device', status: 'ACTIVE', activatedAt: NOW });
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
    attendanceDeviceChangeRequest: { findFirst: async ({ where }) => state.requests.find(x => x.employeeId === where.employeeId && x.candidateDeviceEnrollmentId === where.candidateDeviceEnrollmentId && x.status === 'PENDING_APPROVAL') || null, create: async ({ data }) => { const x = { id: crypto.randomUUID(), status: 'PENDING_APPROVAL', ...data }; state.requests.push(x); return x; } },
    attendanceDeviceChallenge: { updateMany: async ({ where, data }) => { let count = 0; for (const x of state.challenges) if (x.employeeId === where.employeeId && x.purpose === where.purpose && x.consumedAt == null) { Object.assign(x, data); count++; } return { count }; }, create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.challenges.push(x); return x; }, findFirst: async ({ where }) => state.challenges.find(x => x.employeeId === where.employeeId && x.purpose === where.purpose && x.challengeHash === where.challengeHash && x.consumedAt == null && x.expiresAt > where.expiresAt.gt) || null },
    $transaction: async fn => fn(prisma)
  };
  const service = createAttendanceSimpleService({ prisma, clock: () => state.now, audit: { log: async () => {} }, siteAuthorityService: { resolve: async () => ({ site, source: 'ASSIGNMENT' }) }, siteEvidenceService: createAttendanceSiteEvidenceService({ prisma, clock: () => state.now, policyOverride: policy }), policyService: { getPolicy: async () => policy }, selfieStorage: selfieStorage || { put: async ({ captureId, selfie: photo }) => ({ provider: 'test', bucket: 'test', objectKey: captureId, mimeType: photo.mimeType, sizeBytes: photo.buffer.length, checksum: 'a'.repeat(64) }) }, bundleSecret: () => 'test-only-offline-signing-secret-at-least-32-bytes' });
  return { state, prisma, service };
}
async function challenge(h) { return h.service.createSelfieChallenge({ actor: { sub: ids.user } }); }
async function errorCode(fn, code) { await assert.rejects(fn, e => e.details?.code === code); }

 test('challenge creates 64-hex nonce, 120-second expiry, and replaces active event challenge', async () => { const h = harness(); const first = await challenge(h); const second = await challenge(h); assert.match(first.nonce, /^[0-9a-f]{64}$/); assert.equal(first.expiresAt.getTime(), NOW.getTime() + 120000); assert.equal(h.state.challenges.filter(x => x.purpose === 'ATTENDANCE_EVENT').length, 2); assert.ok(h.state.challenges[0].consumedAt); assert.equal(h.state.challenges[1].challengeHash, crypto.createHash('sha256').update(second.nonce).digest('hex')); });
test('foreign device without nonce is rejected', async () => { const h = harness({ foreign: true }); const k = keyMaterial(); await errorCode(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie() }) }), 'ATTENDANCE_FOREIGN_DEVICE_SELFIE_LIVE_REQUIRED'); });
test('foreign GALLERY capture is rejected', async () => { const h = harness({ foreign: true }); const k = keyMaterial(); const c = await challenge(h); await errorCode(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie('GALLERY'), selfieNonce: c.nonce }) }), 'ATTENDANCE_FOREIGN_DEVICE_SELFIE_LIVE_REQUIRED'); });
test('foreign selfie with stale overlay is rejected', async () => { const h = harness({ foreign: true }); const k = keyMaterial(); const c = await challenge(h); await errorCode(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie('LIVE_CAMERA', new Date(NOW - 600000)), selfieNonce: c.nonce }) }), 'ATTENDANCE_SELFIE_OVERLAY_STALE'); });
test('foreign wrong, consumed, and expired nonces are rejected', async () => { const h = harness({ foreign: true }); const k = keyMaterial(); const c = await challenge(h); await errorCode(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: 'a'.repeat(64) }) }), 'ATTENDANCE_SELFIE_NONCE_INVALID'); h.state.challenges[0].expiresAt = new Date(NOW.getTime() - 1); await errorCode(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: c.nonce }) }), 'ATTENDANCE_SELFIE_NONCE_INVALID'); });
test('foreign valid live selfie succeeds, records flags/selfie, and creates PENDING request', async () => { const h = harness({ foreign: true }); const k = keyMaterial(); const c = await challenge(h); const result = await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: c.nonce }) }); assert.equal(result.counted, true); assert.ok(result.event.reviewReasons.includes('FOREIGN_DEVICE_SELFIE')); assert.ok(result.event.reviewReasons.includes('SELFIE_LIVE_VERIFIED')); assert.equal(h.state.selfies.length, 1); assert.equal(h.state.requests[0].status, 'PENDING_APPROVAL'); });
test('a nonce is atomically single-use', async () => { const h = harness({ foreign: true }); const k = keyMaterial(); const c = await challenge(h); const first = await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: c.nonce }) }); assert.equal(first.counted, true); const k2 = keyMaterial(); await errorCode(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k2, selfie: selfie(), selfieNonce: c.nonce }) }), 'ATTENDANCE_SELFIE_NONCE_INVALID'); });
test('FOREIGN device fails closed when challenge model is unavailable', async () => { const h = harness({ foreign: true }); delete h.prisma.attendanceDeviceChallenge; const k = keyMaterial(); await errorCode(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: 'a'.repeat(64) }) }), 'ATTENDANCE_SELFIE_GUARD_UNAVAILABLE'); });
test('foreign storage failure returns safe code, consumes nonce, and commits no attendance rows', async () => {
  const storage = { put: async () => { throw new Error('provider secret must not escape'); } };
  const h = harness({ foreign: true, selfieStorage: storage });
  const k = keyMaterial(); const c = await challenge(h);
  await assert.rejects(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: c.nonce }) }), e => e.details?.code === 'ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE' && e.statusCode === 503);
  assert.equal(h.state.events.length, 0); assert.equal(h.state.sessions.length, 0); assert.equal(h.state.selfies.length, 0); assert.ok(h.state.challenges[0].consumedAt);
});

test('primary device remains accepted without selfie or nonce', async () => { const h = harness(); const k = keyMaterial(); const result = await h.service.submit({ actor: { sub: ids.user }, input: inputFor(k) }); assert.equal(result.counted, true); });


test('fresh challenge retries successfully after storage recovers', async () => {
  let fail = true;
  const storage = { put: async ({ captureId, selfie: photo }) => { if (fail) { fail = false; throw new Error('temporary'); } return { provider: 'test', bucket: 'test', objectKey: captureId, mimeType: photo.mimeType, sizeBytes: photo.buffer.length, checksum: 'a'.repeat(64) }; } };
  const h = harness({ foreign: true, selfieStorage: storage }); const k = keyMaterial(); const first = await challenge(h);
  await assert.rejects(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: first.nonce }) }), e => e.details?.code === 'ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE');
  const second = await challenge(h); const retry = await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: second.nonce }) });
  assert.equal(retry.counted, true); assert.equal(h.state.events.length, 1); assert.equal(h.state.selfies.length, 1);
});

test('multipart simple event input is rejected with 422', async () => { const routes = createAttendanceRoutes({ environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }, authenticateMiddleware: (req, _res, next) => { req.user = { sub: ids.user }; next(); }, simpleService: { createSelfieChallenge: async () => ({}), submit: async () => { throw new Error('must not call'); } } }); const app = express(); app.use(express.json()); app.use('/api/v1/attendance', routes); app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.details || {} })); const response = await request(app).post('/api/v1/attendance/simple/events').set('Content-Type', 'multipart/form-data; boundary=x').send('--x--'); assert.equal(response.status, 422); assert.equal(response.body.error.code, 'ATTENDANCE_FOREIGN_SELFIE_MULTIPART_FORBIDDEN'); });
