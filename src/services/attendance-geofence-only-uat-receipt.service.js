'use strict';

const crypto = require('node:crypto');

const GEOFENCE_ONLY_UAT_RECEIPT_PREFIX = 'g06-geofence-only-uat-v1';
const GEOFENCE_ONLY_UAT_MODE = 'GEOFENCE_ONLY_UAT';
const GEOFENCE_ONLY_UAT_EMPLOYEE_CODE = 'UAT-ST-20260902';
const GEOFENCE_ONLY_UAT_RECEIPT_TTL_MS = 2 * 60 * 1000;

function signingKey(secret) {
  const value = String(secret || '');
  if (value.length < 32) throw new Error('Attendance receipt signing key is unavailable.');
  return value;
}

function signature(encodedPayload, secret) {
  return crypto.createHmac('sha256', signingKey(secret))
    .update(`${GEOFENCE_ONLY_UAT_RECEIPT_PREFIX}.${encodedPayload}`)
    .digest('base64url');
}

function issueGeofenceOnlyUatReceipt({ claims, secret }) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${GEOFENCE_ONLY_UAT_RECEIPT_PREFIX}.${payload}.${signature(payload, secret)}`;
}

function isGeofenceOnlyUatReceipt(receipt) {
  return typeof receipt === 'string'
    && receipt.length <= 2048
    && receipt.startsWith(`${GEOFENCE_ONLY_UAT_RECEIPT_PREFIX}.`);
}

function verifyGeofenceOnlyUatReceipt({ receipt, secret, now = Date.now() }) {
  if (!isGeofenceOnlyUatReceipt(receipt)) return null;
  const [prefix, encodedPayload, receivedSignature, extra] = receipt.split('.');
  if (prefix !== GEOFENCE_ONLY_UAT_RECEIPT_PREFIX || !encodedPayload || !receivedSignature || extra !== undefined) return null;
  let expected;
  try {
    expected = signature(encodedPayload, secret);
  } catch {
    return null;
  }
  const expectedBytes = Buffer.from(expected, 'base64url');
  const receivedBytes = Buffer.from(receivedSignature, 'base64url');
  if (expectedBytes.length !== receivedBytes.length || !crypto.timingSafeEqual(expectedBytes, receivedBytes)) return null;

  try {
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
    if (claims.version !== 1 || claims.verificationMode !== GEOFENCE_ONLY_UAT_MODE) return null;
    if (claims.employeeCode !== GEOFENCE_ONLY_UAT_EMPLOYEE_CODE) return null;
    for (const field of ['sessionId', 'userId', 'employeeId', 'deviceEnrollmentId', 'referencePhotoId', 'shiftAssignmentId', 'captureId', 'contextDigest', 'eventIntent', 'nonce']) {
      if (typeof claims[field] !== 'string' || !claims[field]) return null;
    }
    if (!/^[0-9a-f]{64}$/i.test(claims.contextDigest)) return null;
    if (!['CHECK_IN', 'CHECK_OUT'].includes(claims.eventIntent)) return null;
    if (!Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)) return null;
    if (claims.issuedAt > now + 30_000
      || claims.expiresAt <= now
      || claims.expiresAt <= claims.issuedAt
      || claims.expiresAt - claims.issuedAt > GEOFENCE_ONLY_UAT_RECEIPT_TTL_MS) return null;
    return claims;
  } catch {
    return null;
  }
}

module.exports = {
  GEOFENCE_ONLY_UAT_RECEIPT_PREFIX,
  GEOFENCE_ONLY_UAT_MODE,
  GEOFENCE_ONLY_UAT_EMPLOYEE_CODE,
  GEOFENCE_ONLY_UAT_RECEIPT_TTL_MS,
  issueGeofenceOnlyUatReceipt,
  isGeofenceOnlyUatReceipt,
  verifyGeofenceOnlyUatReceipt
};
