'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GEOFENCE_ONLY_UAT_MODE,
  GEOFENCE_ONLY_UAT_EMPLOYEE_CODE,
  issueGeofenceOnlyUatReceipt,
  verifyGeofenceOnlyUatReceipt
} = require('../src/services/attendance-geofence-only-uat-receipt.service');

const secret = 'test-only-key-that-is-longer-than-thirty-two-bytes';
const now = 1_790_000_000_000;
const claims = {
  version: 1,
  verificationMode: GEOFENCE_ONLY_UAT_MODE,
  employeeCode: GEOFENCE_ONLY_UAT_EMPLOYEE_CODE,
  sessionId: 'session-1',
  userId: 'user-1',
  employeeId: 'employee-1',
  deviceEnrollmentId: 'device-1',
  referencePhotoId: 'photo-1',
  eventIntent: 'CHECK_IN',
  captureId: 'capture-1',
  shiftAssignmentId: 'shift-1',
  contextDigest: 'a'.repeat(64),
  nonce: 'server-random-nonce',
  issuedAt: now,
  expiresAt: now + 120_000
};

test('controlled UAT receipt is signed, bound to the allowlisted identity, and short-lived', () => {
  const receipt = issueGeofenceOnlyUatReceipt({ claims, secret });
  assert.deepEqual(verifyGeofenceOnlyUatReceipt({ receipt, secret, now }), claims);
  assert.equal(verifyGeofenceOnlyUatReceipt({ receipt: `${receipt}x`, secret, now }), null);
  assert.equal(verifyGeofenceOnlyUatReceipt({ receipt, secret: `${secret}-rotated`, now }), null);
  assert.equal(verifyGeofenceOnlyUatReceipt({ receipt, secret, now: now + 120_000 }), null);
});

test('receipt verification rejects a signed payload with a non-allowlisted account', () => {
  const receipt = issueGeofenceOnlyUatReceipt({ claims: { ...claims, employeeCode: 'EMP001' }, secret });
  assert.equal(verifyGeofenceOnlyUatReceipt({ receipt, secret, now }), null);
});

test('receipt issue fails closed if the existing signing secret is too short', () => {
  assert.throws(() => issueGeofenceOnlyUatReceipt({ claims, secret: 'short' }), /signing key is unavailable/i);
});
