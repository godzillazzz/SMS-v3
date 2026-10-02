'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalJson,
  integrityRiskFlags,
  signedEventPayload
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

test('rollback-safe schema does not add new values to existing attendance enums', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  const provenance = schema.match(/enum AttendanceEventProvenance \{([\s\S]*?)\}/)?.[1] || '';
  const timeBasis = schema.match(/enum AttendanceTimeBasis \{([\s\S]*?)\}/)?.[1] || '';
  assert.doesNotMatch(provenance, /OFFLINE/);
  assert.doesNotMatch(timeBasis, /DEVICE_CAPTURED/);
  assert.match(schema, /sourceMode\s+String\s+@default\("ONLINE"\)/);
  assert.match(schema, /observationOnly\s+Boolean/);
});

