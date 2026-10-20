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

test('legacy device status is passive telemetry and never an Attendance gate', () => {
  for (const active of [null, { status: 'ACTIVE' }]) {
    for (const status of ['REVOKED', 'REJECTED', 'CANCELLED', 'PENDING_APPROVAL', 'ACTIVE']) {
      assert.doesNotThrow(() => assertFirstDeviceCanAutoBind(active, { status }), `${status} must not block Attendance`);
    }
  }
  assert.doesNotThrow(() => assertFirstDeviceCanAutoBind(null, null));
});

test('passive device telemetry uses valid AuditAction and cannot block Attendance', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/attendance-simple.service.js'), 'utf8');
  assert.match(service, /recordPassiveDeviceAudit[\s\S]*?catch \(error\)/);
  assert.doesNotMatch(service, /recordPassiveDeviceAudit\(client,/);
  assert.match(service, /recordPassiveDeviceAudit\(\{ actorUserId(?:,|: actor\.sub)/);
  assert.doesNotMatch(service, /action: 'READ'/);
  assert.match(service, /entityType: 'AttendanceEvent', entityId: event\.id,[\s\S]{0,80}metadata:/);
});

test('simple attendance keeps GPS geofence and admin review contracts', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/attendance-simple.service.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/attendance.routes.js'), 'utf8');
  assert.match(service, /validateGpsOnlyForAssignment/);
  assert.match(service, /DEVICE_MISMATCH/);
  assert.match(service, /PENDING_CONFIRMATION/);
  assert.match(service, /AttendanceDeviceChangeRequest/);
  assert.match(service, /OBSERVED_ATTENDANCE_DEVICE|OBSERVED_LEGACY_DEVICE_STATUS/);
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
