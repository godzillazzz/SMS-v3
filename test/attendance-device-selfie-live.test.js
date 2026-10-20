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
const requestContext = require('../src/middlewares/request-context');

const ids = { user: '11111111-1111-4111-8111-111111111111', employee: '22222222-2222-4222-8222-222222222222', assignment: '33333333-3333-4333-8333-333333333333', shift: '44444444-4444-4444-8444-444444444444', site: '55555555-5555-4555-8555-555555555555', admin: '66666666-6666-4666-8666-666666666666' };
const NOW = new Date('2026-10-02T01:00:00.000Z');
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////2wBDAf//////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Av/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8h/9k=';
const policy = { maxAccuracyMeters: 50, maxAgeMs: 180000, futureSkewMs: 30000, offlineConfirmAfterMs: 300000, offlineBundleTtlMs: 86400000 };

function keyMaterial() { const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); return { pair, publicKeySpkiBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }; }
function selfie(captureMode = 'LIVE_CAMERA', capturedAt = NOW) { return { mimeType: 'image/jpeg', base64: JPEG, captureMode, overlay: { capturedAt: capturedAt.toISOString() } }; }
function inputFor({ pair, publicKeySpkiBase64, captureId = crypto.randomUUID(), selfie: photo, selfieNonce, capturedAt = NOW, action = 'CHECK_IN', clientSelfieRequired } = {}) {
  const input = { captureId, eventIntent: action, shiftAssignmentId: ids.assignment, capturedAt: capturedAt.toISOString(),
    clientSelfieRequired, location: { latitude: 13.7241, longitude: 100.5701, accuracyMeters: 8, capturedAt: capturedAt.toISOString() }, device: { publicKeySpkiBase64, keyAlgorithm: 'ECDSA_P256_SHA256', displayName: 'Test device', signals: { secureContext: true, webCrypto: true, indexedDb: true, privateKeyNonExportable: true }, signatureBase64: '' } };
  if (photo) input.selfie = photo;
  if (selfieNonce !== undefined) input.selfieNonce = selfieNonce;
  input.device.signatureBase64 = crypto.sign('sha256', Buffer.from(canonicalJson(signedEventPayload(input))), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  return input;
}

function harness({ foreign = false, selfieStorage = null, selfiePolicy = false, action = 'CHECK_IN', role = 'VIEWER' } = {}) {
  const state = { now: new Date(NOW), devices: [], challenges: [], selfies: [], events: [], sessions: [], requests: [] };
  const employee = { id: ids.employee, employeeCode: 'LIVE-TEST', displayName: 'Live Test', firstName: 'Live', lastName: 'Test', department: 'SECURITY', isActive: true, deletedAt: null };
  const site = { id: ids.site, code: 'A', name: 'Site A', latitude: 13.7241, longitude: 100.5701, geofenceRadiusMeters: 100, isActive: true };
  const assignment = { id: ids.assignment, employeeId: ids.employee, shiftTypeId: ids.shift, securitySiteId: ids.site, workDate: new Date('2026-10-02T00:00:00.000Z'), startTime: '07:00', endTime: '19:00', shiftType: { id: ids.shift, code: 'D', startTime: '07:00', endTime: '19:00' }, securitySite: site, employee };
  if (foreign) state.devices.push({ id: 'active-primary', employeeId: ids.employee, credentialFingerprint: 'not-the-test-device', status: 'ACTIVE', activatedAt: NOW });
  let transactionTail = Promise.resolve();
  const prisma = {
    user: { findUnique: async () => ({ id: ids.user, employeeId: ids.employee, role, isActive: true, accountStatus: 'ACTIVE', employee }) },
    shiftAssignment: { findMany: async () => [assignment], findUnique: async () => assignment },
    scheduleApproval: { findFirst: async () => ({ id: ids.admin, revision: 1, status: 'APPROVED' }) },
    securitySite: { findUnique: async () => site, findMany: async () => [site] },
    attendanceSession: { findUnique: async ({ where }) => state.sessions.find(x => x.shiftAssignmentId === where.shiftAssignmentId) || null, create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.sessions.push(x); return x; }, update: async ({ data }) => Object.assign(state.sessions[0], data) },
    attendanceEvent: { findUnique: async ({ where }) => where.captureId ? state.events.find(x => x.captureId === where.captureId) || null : state.events.find(x => x.sessionId === where.sessionId_eventType.sessionId && x.eventType === where.sessionId_eventType.eventType) || null, create: async ({ data }) => { if (state.events.some(x => x.captureId === data.captureId)) { const error = new Error('unique captureId'); error.code = 'P2002'; throw error; } const x = { id: crypto.randomUUID(), ...data }; state.events.push(x); return x; } },
    attendancePendingEvent: { findUnique: async () => null, create: async ({ data }) => ({ id: crypto.randomUUID(), ...data }) },
    attendanceDeviceEnrollment: { findUnique: async ({ where }) => state.devices.find(x => x.credentialFingerprint === where.credentialFingerprint) || null, findFirst: async ({ where }) => state.devices.find(x => x.employeeId === where.employeeId && x.status === where.status) || null, create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.devices.push(x); return x; } },
    attendanceDeviceSelfie: { create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.selfies.push(x); return x; } },
    attendanceDeviceChangeRequest: { findFirst: async ({ where }) => state.requests.find(x => x.employeeId === where.employeeId && x.candidateDeviceEnrollmentId === where.candidateDeviceEnrollmentId && x.status === 'PENDING_APPROVAL') || null, create: async ({ data }) => { const x = { id: crypto.randomUUID(), status: 'PENDING_APPROVAL', ...data }; state.requests.push(x); return x; } },
    attendanceDeviceChallenge: { updateMany: async ({ where, data }) => { let count = 0; for (const x of state.challenges) if ((!where.id || x.id === where.id) && x.employeeId === where.employeeId && x.purpose === where.purpose && (!where.challengeHash || x.challengeHash === where.challengeHash) && x.consumedAt == null && (!where.expiresAt || x.expiresAt > where.expiresAt.gt)) { Object.assign(x, data); count++; } return { count }; }, create: async ({ data }) => { const x = { id: crypto.randomUUID(), ...data }; state.challenges.push(x); return x; }, findFirst: async ({ where }) => state.challenges.find(x => x.employeeId === where.employeeId && x.purpose === where.purpose && x.challengeHash === where.challengeHash && x.consumedAt == null && (!where.expiresAt || x.expiresAt > where.expiresAt.gt)) || null },
    attendanceSelfiePolicy: { findUnique: async ({ where }) => selfiePolicy ? { role: where.role, clockInRequired: action === 'CHECK_IN', clockOutRequired: action === 'CHECK_OUT' } : null },
    $transaction: async fn => { const run = transactionTail.then(() => fn(prisma)); transactionTail = run.catch(() => {}); return run; }
  };
  const service = createAttendanceSimpleService({ prisma, clock: () => state.now, audit: { log: async () => {} }, siteAuthorityService: { resolve: async () => ({ site, source: 'ASSIGNMENT' }) }, siteEvidenceService: createAttendanceSiteEvidenceService({ prisma, clock: () => state.now, policyOverride: policy }), policyService: { getPolicy: async () => policy }, selfieStorage: selfieStorage || { put: async ({ captureId, selfie: photo }) => ({ provider: 'test', bucket: 'test', objectKey: captureId, mimeType: photo.mimeType, sizeBytes: photo.buffer.length, checksum: 'a'.repeat(64) }), remove: async () => {} }, bundleSecret: () => 'test-only-offline-signing-secret-at-least-32-bytes' });
  return { state, prisma, service };
}
async function challenge(h) { return h.service.createSelfieChallenge({ actor: { sub: ids.user } }); }
async function errorCode(fn, code) { await assert.rejects(fn, e => e.details?.code === code); }

 test('challenge creates 64-hex nonce, 120-second expiry, and replaces active event challenge', async () => { const h = harness(); const first = await challenge(h); const second = await challenge(h); assert.match(first.nonce, /^[0-9a-f]{64}$/); assert.equal(first.expiresAt.getTime(), NOW.getTime() + 120000); assert.equal(h.state.challenges.filter(x => x.purpose === 'ATTENDANCE_EVENT').length, 2); assert.ok(h.state.challenges[0].consumedAt); assert.equal(h.state.challenges[1].challengeHash, crypto.createHash('sha256').update(`${second.nonce}|${ids.employee}|CHECK_IN|${ids.assignment}`).digest('hex')); });
test('effective policy OFF ignores device identity, client boolean, nonce, camera and storage', async () => { const h = harness({ foreign: true }); const k = keyMaterial(); const result = await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, clientSelfieRequired: true }) }); assert.equal(result.counted, true); assert.equal(h.state.selfies.length, 0); });
test('policy ON CHECK_IN rejects missing, non-JPEG and oversize selfie before rows', async () => { for (const photo of [undefined, selfie('GALLERY')]) { const h = harness({ foreign: true, selfiePolicy: true }); const k = keyMaterial(); await assert.rejects(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: photo }) }), error => ['ATTENDANCE_SELFIE_REQUIRED', 'ATTENDANCE_SELFIE_CAMERA_REQUIRED'].includes(error.details?.code)); assert.equal(h.state.events.length, 0); assert.equal(h.state.sessions.length, 0); assert.equal(h.state.selfies.length, 0); } const k = keyMaterial(); assert.throws(() => inputFor({ ...k, selfie: { ...selfie(), base64: Buffer.alloc(1048577).toString('base64') } }), error => error.details?.code === 'ATTENDANCE_SELFIE_TOO_LARGE'); });
test('policy ON CHECK_OUT is enforced independently', async () => { const h = harness({ action: 'CHECK_OUT', selfiePolicy: true }); const k = keyMaterial(); await errorCode(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, action: 'CHECK_OUT' }) }), 'ATTENDANCE_SELFIE_REQUIRED'); });
test('server role policy wins over client boolean and device identity', async () => { const h = harness({ foreign: true, selfiePolicy: true }); const k = keyMaterial(); const result = await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), clientSelfieRequired: false, selfieNonce: 'not-a-live-challenge' }) }); assert.equal(result.counted, true); assert.ok(result.reviewReasons.includes('ROLE_SELFIE_REQUIRED')); assert.equal(result.reviewReasons.includes('SELFIE_LIVE_VERIFIED'), false); assert.equal(h.state.selfies.length, 1); });
test('valid role-policy selfie stores private evidence and expected audit flags', async () => { const h = harness({ foreign: true, selfiePolicy: true }); const challengeResult = await challenge(h); const k = keyMaterial(); const result = await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie(), selfieNonce: challengeResult.nonce }) }); assert.equal(result.counted, true); assert.ok(result.reviewReasons.includes('SELFIE_LIVE_VERIFIED')); assert.equal(h.state.selfies.length, 1); assert.equal(h.state.requests.length, 0); });

test('forged and replayed selfie nonces never earn SELFIE_LIVE_VERIFIED', async () => { const forgedHarness = harness({ selfiePolicy: true }); const forgedKey = keyMaterial(); const forged = await forgedHarness.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...forgedKey, selfie: selfie(), selfieNonce: 'f'.repeat(64) }) }); assert.equal(forged.reviewReasons.includes('SELFIE_LIVE_VERIFIED'), false); const validHarness = harness({ selfiePolicy: true }); const issued = await challenge(validHarness); const validKey = keyMaterial(); const valid = await validHarness.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...validKey, selfie: selfie(), selfieNonce: issued.nonce }) }); assert.equal(valid.reviewReasons.includes('SELFIE_LIVE_VERIFIED'), true); const replayHarness = harness({ selfiePolicy: true }); const replayIssued = await challenge(replayHarness); const replayKey = keyMaterial(); const replayed = await replayHarness.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...replayKey, selfie: selfie(), selfieNonce: replayIssued.nonce }) }); assert.equal(replayed.reviewReasons.includes('SELFIE_LIVE_VERIFIED'), true); const replayAgainKey = keyMaterial(); const replayAgain = await replayHarness.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...replayAgainKey, selfie: selfie(), selfieNonce: replayIssued.nonce, action: 'CHECK_OUT' }) }); assert.equal(replayAgain.reviewReasons.includes('SELFIE_LIVE_VERIFIED'), false); });

test('foreign enrollment is audit-only and never becomes actor event or selfie FK', async () => { const h = harness({ selfiePolicy: true }); const key = keyMaterial(); const fingerprint = crypto.createHash('sha256').update(Buffer.from(key.publicKeySpkiBase64, 'base64')).digest('hex'); const foreign = { id: 'foreign-enrollment', employeeId: 'other-employee', credentialFingerprint: fingerprint, status: 'ACTIVE', activatedAt: NOW }; h.state.devices.push(foreign); const issued = await challenge(h); const result = await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...key, selfie: selfie(), selfieNonce: issued.nonce }) }); assert.equal(result.event.deviceEnrollmentId, null); assert.equal(h.state.selfies.length, 0); assert.deepEqual(h.state.devices.find(row => row.id === foreign.id), foreign); });
test('DB failure after upload removes object and preserves error for captureId retry', async () => { let fail = true; const removed = []; const storage = { put: async ({ captureId, selfie: photo }) => ({ provider: 'test', bucket: 'private', objectKey: captureId, mimeType: photo.mimeType, sizeBytes: photo.buffer.length, checksum: 'a'.repeat(64) }), remove: async ({ objectKey }) => removed.push(objectKey) }; const h = harness({ selfiePolicy: true, selfieStorage: storage }); const original = h.prisma.$transaction; h.prisma.$transaction = async fn => { if (fail) { fail = false; throw new Error('transaction failure'); } return original(fn); }; const k = keyMaterial(); await assert.rejects(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie() }) }), /transaction failure/); assert.deepEqual(removed.length, 1); const retry = await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie() }) }); assert.equal(retry.counted, true); });
test('storage provider errors expose allowlisted safe contract only', async () => { const h = harness({ selfiePolicy: true, selfieStorage: { put: async () => { throw new Error('provider secret must not escape'); } } }); const k = keyMaterial(); await assert.rejects(() => h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie() }) }), error => error.details?.code === 'ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE' && !/provider secret/.test(error.message)); });
test('same captureId retry is idempotent and final JPEG stamp remains bounded/decodable', async () => { const h = harness({ selfiePolicy: true }); const k = keyMaterial(); const captureId = crypto.randomUUID(); const input = inputFor({ ...k, captureId, selfie: selfie() }); const first = await h.service.submit({ actor: { sub: ids.user }, input }); const second = await h.service.submit({ actor: { sub: ids.user }, input }); assert.equal(first.counted, true); assert.equal(second.idempotent, true); assert.equal(h.state.events.length, 1); assert.equal(h.state.selfies.length, 1); assert.ok(h.state.selfies[0].sizeBytes <= 1048576); });
test('concurrent same captureId produces one event/evidence and compensates loser upload', async () => { let entered = 0; let release; const barrier = new Promise(resolve => { release = resolve; }); const storage = { put: async ({ captureId, selfie: photo }) => { entered++; if (entered === 2) release(); await barrier; return { provider: 'test', bucket: 'private', objectKey: `${captureId}-${entered}`, mimeType: photo.mimeType, sizeBytes: photo.buffer.length, checksum: 'a'.repeat(64) }; }, remove: async ({ objectKey }) => storage.removed.push(objectKey), removed: [] }; const h = harness({ selfiePolicy: true, selfieStorage: storage }); const k1 = keyMaterial(); const k2 = keyMaterial(); const captureId = crypto.randomUUID(); const first = h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k1, captureId, selfie: selfie() }) }); const second = h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k2, captureId, selfie: selfie() }) }); await new Promise(resolve => setImmediate(resolve)); release(); const results = await Promise.allSettled([first, second]); assert.equal(results.filter(result => result.status === 'fulfilled').length, 2); assert.equal(h.state.events.length, 1); assert.equal(h.state.selfies.length, 1); assert.equal(storage.removed.length, 1); });
test('successful role selfie never creates an Attendance Device change request', async () => { const h = harness({ foreign: true, selfiePolicy: true }); const k = keyMaterial(); await h.service.submit({ actor: { sub: ids.user }, input: inputFor({ ...k, selfie: selfie() }) }); assert.equal(h.state.requests.length, 0); });

test('primary device remains accepted without selfie or nonce', async () => { const h = harness(); const k = keyMaterial(); const result = await h.service.submit({ actor: { sub: ids.user }, input: inputFor(k) }); assert.equal(result.counted, true); });



test('route and middleware expose only the allowlisted storage failure contract', async () => {
  const routes = createAttendanceRoutes({
    environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' },
    authenticateMiddleware: (req, _res, next) => { req.user = { sub: ids.user }; next(); },
    simpleService: { createSelfieChallenge: async () => ({}), submit: async () => {
      const error = new Error('provider secret must not escape');
      error.statusCode = 503;
      error.publicCode = 'ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE';
      error.publicMessage = 'Attendance selfie storage is temporarily unavailable.';
      throw error;
    } }
  });
  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.use('/api/v1/attendance', routes);
  app.use(errorHandler);
  const response = await request(app).post('/api/v1/attendance/simple/events').send({
    captureId: crypto.randomUUID(), eventIntent: 'CHECK_IN', shiftAssignmentId: ids.assignment,
    capturedAt: NOW.toISOString(), location: { latitude: 13.7241, longitude: 100.5701, accuracyMeters: 8, capturedAt: NOW.toISOString() },
    device: { publicKeySpkiBase64: 'not-used-by-stub', keyAlgorithm: 'ECDSA_P256_SHA256', signatureBase64: 'not-used-by-stub', signals: { secureContext: true, webCrypto: true, indexedDb: true, privateKeyNonExportable: true } }
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE');
  assert.equal(response.body.error, 'Attendance selfie storage is temporarily unavailable.');
  assert.ok(response.body.requestId);
  assert.doesNotMatch(JSON.stringify(response.body), /provider secret/i);
});


test('multipart simple event input is rejected with 422', async () => { const routes = createAttendanceRoutes({ environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }, authenticateMiddleware: (req, _res, next) => { req.user = { sub: ids.user }; next(); }, simpleService: { createSelfieChallenge: async () => ({}), submit: async () => { throw new Error('must not call'); } } }); const app = express(); app.use(express.json()); app.use('/api/v1/attendance', routes); app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.details || {} })); const response = await request(app).post('/api/v1/attendance/simple/events').set('Content-Type', 'multipart/form-data; boundary=x').send('--x--'); assert.equal(response.status, 422); assert.equal(response.body.error.code, 'ATTENDANCE_SELFIE_MULTIPART_FORBIDDEN'); });
