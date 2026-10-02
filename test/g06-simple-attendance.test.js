'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalJson,
  integrityRiskFlags,
  signedEventPayload,
  assertFirstDeviceCanAutoBind
} = require('../src/services/attendance-simple.service');

test('simple attendance canonical signing payload is deterministic', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  const payload = signedEventPayload({
    captureId: '11111111-1111-4111-8111-111111111111',
    eventIntent: 'CHECK_IN',
    shiftAssignmentId: '22222222-2222-4222-8222-222222222222',
    capturedAt: '2026-10-02T01:00:00.000Z',
    location: { latitude: 13.7, longitude: 100.5, accuracyMeters: 8, capturedAt: '2026-10-02T01:00:00.000Z' },
    device: { publicKeySpkiBase64: 'abc', keyAlgorithm: 'ECDSA_P256_SHA256', signals: { secureContext: true } },
    offlineBundle: null
  });
  assert.equal(payload.version, 'SMS_ATTENDANCE_SIMPLE_EVENT_V1');
  assert.equal(payload.offlineBundleHash, null);
});

test('device integrity risks are review flags, not a device bypass', () => {
  assert.deepEqual(integrityRiskFlags({
    secureContext: false,
    webCrypto: false,
    indexedDb: false,
    privateKeyNonExportable: false,
    automation: true
  }), [
    'DEVICE_SECURE_CONTEXT_RISK',
    'DEVICE_WEBCRYPTO_RISK',
    'DEVICE_STORAGE_RISK',
    'DEVICE_KEY_EXPORTABILITY_RISK',
    'DEVICE_AUTOMATION_RISK'
  ]);
});

test('only a genuinely new device can use first-device auto-binding', () => {
  assert.doesNotThrow(() => assertFirstDeviceCanAutoBind(null, null));
  for (const status of ['REVOKED', 'REJECTED', 'CANCELLED', 'PENDING_APPROVAL']) {
    assert.throws(() => assertFirstDeviceCanAutoBind(null, { status }), (error) =>
      error.statusCode === 409 && error.details?.code === 'ATTENDANCE_DEVICE_NOT_ALLOWED',
      `${status} enrollment must not be reactivated by self-service Attendance`);
  }
  assert.doesNotThrow(() => assertFirstDeviceCanAutoBind({ status: 'ACTIVE' }, { status: 'ACTIVE' }));
});

test('simple attendance keeps GPS geofence and admin review contracts', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/attendance-simple.service.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/attendance.routes.js'), 'utf8');
  assert.match(service, /validateGpsOnlyForAssignment/);
  assert.match(service, /DEVICE_MISMATCH/);
  assert.match(service, /PENDING_CONFIRMATION/);
  assert.match(service, /AttendanceDeviceChangeRequest/);
  assert.match(service, /AUTO_BIND_FIRST_DEVICE/);
  assert.match(routes, /simple\/pending\/:id\/confirm/);
  assert.match(routes, /authorize\('ADMIN'\)/);
});

test('owner-requested simplified Attendance contract excludes Face and QR gates', () => {
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/attendance-simple/AttendanceSimplePage.tsx'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/attendance-simple/attendance-simple-client.ts'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../src/services/attendance-simple.service.js'), 'utf8');
  assert.match(client, /\/attendance\/simple\//);
  assert.doesNotMatch(client, /\b(?:face|qr|challenge)\b/i);
  assert.doesNotMatch(page, /\b(?:face|qr)\b/i);
  assert.match(service, /faceVerificationSessionId:\s*null/);
});

test('delayed offline events remain pending and uncounted until ADMIN confirmation', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/attendance-simple.service.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../prisma/migrations/202610020001_g06_simple_device_offline/migration.sql'), 'utf8');
  assert.match(service, /status:\s*'PENDING_CONFIRMATION'/);
  assert.match(service, /counted:\s*false,\s*status:\s*'PENDING_CONFIRMATION'/);
  assert.match(service, /if \(actor\?\.role !== 'ADMIN'\) throw http\(403, 'FORBIDDEN'/);
  assert.match(migration, /ALTER TABLE public\."attendance_pending_events" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\."attendance_pending_events" FROM anon/);
  assert.match(migration, /REVOKE ALL ON TABLE public\."attendance_pending_events" FROM authenticated/);
});

test('rollback-safe schema does not add new values to existing attendance enums', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const provenance = schema.match(/enum AttendanceEventProvenance \{([\s\S]*?)\}/)?.[1] || '';
  const timeBasis = schema.match(/enum AttendanceTimeBasis \{([\s\S]*?)\}/)?.[1] || '';
  assert.doesNotMatch(provenance, /OFFLINE/);
  assert.doesNotMatch(timeBasis, /DEVICE_CAPTURED/);
  assert.match(schema, /sourceMode\s+String\s+@default\("ONLINE"\)/);
  assert.match(schema, /observationOnly\s+Boolean/);
});
