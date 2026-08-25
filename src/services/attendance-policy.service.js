'use strict';

const prismaDefault = require('../config/prisma');

const ATTENDANCE_POLICY_KEYS = Object.freeze({
  qrPolicy: 'ATTENDANCE_QR_POLICY',
  maxAccuracyMeters: 'ATTENDANCE_GPS_MAX_ACCURACY_METERS',
  maxAgeSeconds: 'ATTENDANCE_GPS_MAX_AGE_SECONDS',
  futureSkewSeconds: 'ATTENDANCE_GPS_FUTURE_SKEW_SECONDS',
  autoPassAccuracyMeters: 'ATTENDANCE_GPS_AUTO_PASS_ACCURACY_METERS',
  innerMarginMeters: 'ATTENDANCE_GEOFENCE_INNER_MARGIN_METERS',
  stepUpOnSiteOverlap: 'ATTENDANCE_QR_STEP_UP_ON_SITE_OVERLAP'
});

const ATTENDANCE_QR_POLICIES = Object.freeze(['ADAPTIVE', 'REQUIRED', 'DISABLED']);
const DEFAULT_ATTENDANCE_POLICY = Object.freeze({
  qrPolicy: 'ADAPTIVE',
  maxAccuracyMeters: 50,
  maxAgeMs: 180000,
  futureSkewMs: 30000,
  autoPassAccuracyMeters: 20,
  innerMarginMeters: 20,
  stepUpOnSiteOverlap: true
});

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function booleanValue(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function normalizeQrPolicy(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ATTENDANCE_QR_POLICIES.includes(normalized) ? normalized : DEFAULT_ATTENDANCE_POLICY.qrPolicy;
}

function policyFromSettings(rows = []) {
  const byKey = new Map(rows.map((row) => [String(row.key || ''), row.value]));
  const maxAccuracyMeters = boundedNumber(byKey.get(ATTENDANCE_POLICY_KEYS.maxAccuracyMeters), DEFAULT_ATTENDANCE_POLICY.maxAccuracyMeters, 5, 100);
  const autoPassAccuracyMeters = Math.min(
    maxAccuracyMeters,
    boundedNumber(byKey.get(ATTENDANCE_POLICY_KEYS.autoPassAccuracyMeters), DEFAULT_ATTENDANCE_POLICY.autoPassAccuracyMeters, 3, 50)
  );
  return Object.freeze({
    qrPolicy: normalizeQrPolicy(byKey.get(ATTENDANCE_POLICY_KEYS.qrPolicy)),
    maxAccuracyMeters,
    maxAgeMs: Math.round(boundedNumber(byKey.get(ATTENDANCE_POLICY_KEYS.maxAgeSeconds), DEFAULT_ATTENDANCE_POLICY.maxAgeMs / 1000, 30, 600) * 1000),
    futureSkewMs: Math.round(boundedNumber(byKey.get(ATTENDANCE_POLICY_KEYS.futureSkewSeconds), DEFAULT_ATTENDANCE_POLICY.futureSkewMs / 1000, 5, 120) * 1000),
    autoPassAccuracyMeters,
    innerMarginMeters: boundedNumber(byKey.get(ATTENDANCE_POLICY_KEYS.innerMarginMeters), DEFAULT_ATTENDANCE_POLICY.innerMarginMeters, 0, 100),
    stepUpOnSiteOverlap: booleanValue(byKey.get(ATTENDANCE_POLICY_KEYS.stepUpOnSiteOverlap), DEFAULT_ATTENDANCE_POLICY.stepUpOnSiteOverlap)
  });
}

function validateAttendancePolicySetting(key, value) {
  const text = String(value ?? '').trim();
  if (key === ATTENDANCE_POLICY_KEYS.qrPolicy) {
    const normalized = text.toUpperCase();
    if (!ATTENDANCE_QR_POLICIES.includes(normalized)) throw new Error('ATTENDANCE_QR_POLICY must be ADAPTIVE, REQUIRED or DISABLED.');
    return normalized;
  }
  if (key === ATTENDANCE_POLICY_KEYS.stepUpOnSiteOverlap) {
    const normalized = text.toLowerCase();
    if (!['true', 'false'].includes(normalized)) throw new Error('ATTENDANCE_QR_STEP_UP_ON_SITE_OVERLAP must be true or false.');
    return normalized;
  }
  const ranges = {
    [ATTENDANCE_POLICY_KEYS.maxAccuracyMeters]: [5, 100],
    [ATTENDANCE_POLICY_KEYS.maxAgeSeconds]: [30, 600],
    [ATTENDANCE_POLICY_KEYS.futureSkewSeconds]: [5, 120],
    [ATTENDANCE_POLICY_KEYS.autoPassAccuracyMeters]: [3, 50],
    [ATTENDANCE_POLICY_KEYS.innerMarginMeters]: [0, 100]
  };
  if (ranges[key]) {
    const number = Number(text);
    const [min, max] = ranges[key];
    if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${key} must be between ${min} and ${max}.`);
    return String(number);
  }
  return null;
}

function createAttendancePolicyService({ prisma = prismaDefault } = {}) {
  async function getPolicy(client = prisma) {
    const keys = Object.values(ATTENDANCE_POLICY_KEYS);
    const rows = await client.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    return policyFromSettings(rows);
  }
  return { getPolicy };
}

module.exports = {
  ATTENDANCE_POLICY_KEYS,
  ATTENDANCE_QR_POLICIES,
  DEFAULT_ATTENDANCE_POLICY,
  policyFromSettings,
  validateAttendancePolicySetting,
  createAttendancePolicyService
};
