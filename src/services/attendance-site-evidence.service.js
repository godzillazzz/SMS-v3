'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createAttendancePolicyService, DEFAULT_ATTENDANCE_POLICY } = require('./attendance-policy.service');

const SITE_BINDING_VERSION = 'ATTENDANCE_SITE_AUTHORITY_V1';
const SITE_PAIR_BINDING_VERSION = 'ATTENDANCE_SITE_PAIR_AUTHORITY_V1';
const QR_BINDING_VERSION = 'ATTENDANCE_QR_AUTHORITY_V1';
const QR_ASSURANCE_BINDING_VERSION = 'ATTENDANCE_QR_ASSURANCE_V1';
const LOCATION_BINDING_VERSION = 'ATTENDANCE_LOCATION_AUTHORITY_V2';
const GEOFENCE_CLASSIFICATIONS = Object.freeze({
  CONFIDENT_INSIDE: 'CONFIDENT_INSIDE',
  BORDERLINE: 'BORDERLINE',
  CONFIDENT_OUTSIDE: 'CONFIDENT_OUTSIDE'
});
const MAX_LOCATION_ACCURACY_METERS = 50;
const LOCATION_MAX_AGE_MS = 3 * 60 * 1000;
const LOCATION_FUTURE_SKEW_MS = 30 * 1000;
const QR_STEP_UP_MAX_ACCURACY_METERS = 20;
const QR_STEP_UP_INNER_MARGIN_METERS = 20;
const QR_ASSURANCE_MODES = Object.freeze({
  GPS_ASSURED: 'GPS_ASSURED',
  STEP_UP_QR: 'STEP_UP_QR'
});
const QR_TOKEN_MIN_LENGTH = 24;
const QR_TOKEN_MAX_LENGTH = 512;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_RE = /^[0-9a-f]{64}$/;

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw http(400, 'ATTENDANCE_EVIDENCE_INVALID', 'Attendance evidence contains an invalid number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  throw http(400, 'ATTENDANCE_EVIDENCE_INVALID', 'Attendance evidence contains an unsupported value.');
}

function bindingDigest(payload) {
  return sha256(Buffer.from(JSON.stringify(canonicalize(payload)), 'utf8'));
}

function normalizedUuid(value, code) {
  const text = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(text)) throw http(400, code, 'A valid UUID is required.');
  return text;
}

function finiteNumber(value, code, message) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw http(400, code, message);
  return number;
}

function coordinate(value, min, max, code, message) {
  const number = finiteNumber(value, code, message);
  if (number < min || number > max) throw http(400, code, message);
  return number;
}

function decimal7(value) {
  return Number(value).toFixed(7);
}

function decimal2(value) {
  return Number(value).toFixed(2);
}

function tokenHash(token) {
  const text = String(token || '').trim();
  if (text.length < QR_TOKEN_MIN_LENGTH || text.length > QR_TOKEN_MAX_LENGTH) {
    throw http(400, 'ATTENDANCE_QR_INVALID', 'Attendance QR proof is invalid.');
  }
  return sha256(Buffer.from(text, 'utf8'));
}

function parseCapturedAt(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw http(400, 'ATTENDANCE_LOCATION_CAPTURED_AT_INVALID', 'A valid location capture time is required.');
  return date;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const radius = 6371008.8;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function assertSite(site) {
  if (!site) throw http(409, 'ATTENDANCE_SITE_REQUIRED', 'An authoritative Security Site is required for Attendance.');
  if (site.isActive !== true) throw http(409, 'ATTENDANCE_SITE_INACTIVE', 'The assigned Security Site is inactive.');
  const latitude = coordinate(site.latitude, -90, 90, 'ATTENDANCE_SITE_INVALID', 'Security Site latitude is invalid.');
  const longitude = coordinate(site.longitude, -180, 180, 'ATTENDANCE_SITE_INVALID', 'Security Site longitude is invalid.');
  const geofenceRadiusMeters = finiteNumber(site.geofenceRadiusMeters, 'ATTENDANCE_SITE_INVALID', 'Security Site geofence is invalid.');
  if (!Number.isInteger(geofenceRadiusMeters) || geofenceRadiusMeters <= 0) throw http(409, 'ATTENDANCE_SITE_INVALID', 'Security Site geofence is invalid.');
  return { ...site, latitude, longitude, geofenceRadiusMeters };
}

function sitePayload(site) {
  return {
    version: SITE_BINDING_VERSION,
    siteId: site.id,
    code: String(site.code || ''),
    latitude: decimal7(site.latitude),
    longitude: decimal7(site.longitude),
    geofenceRadiusMeters: site.geofenceRadiusMeters,
    isActive: true
  };
}

function siteBindingPayload(expectedSite, actualSite) {
  if (expectedSite.id === actualSite.id) return sitePayload(expectedSite);
  return {
    version: SITE_PAIR_BINDING_VERSION,
    expectedSite: sitePayload(expectedSite),
    actualSite: sitePayload(actualSite),
    result: 'ASSIST_OTHER_SITE'
  };
}

function assertQrCredential(credential, siteId, now) {
  if (!credential || credential.securitySiteId !== siteId) throw http(400, 'ATTENDANCE_QR_INVALID', 'Attendance QR proof is invalid for the current Security Site.');
  if (!DIGEST_RE.test(String(credential.tokenHash || ''))) throw http(409, 'ATTENDANCE_QR_AUTHORITY_INVALID', 'Attendance QR authority is inconsistent.');
  if (credential.revokedAt) throw http(409, 'ATTENDANCE_QR_REVOKED', 'Attendance QR authority has been revoked.');
  if (credential.validFrom && new Date(credential.validFrom) > now) throw http(409, 'ATTENDANCE_QR_NOT_ACTIVE', 'Attendance QR authority is not active yet.');
  if (credential.validUntil && new Date(credential.validUntil) <= now) throw http(410, 'ATTENDANCE_QR_EXPIRED', 'Attendance QR authority has expired.');
  if (!Number.isInteger(credential.version) || credential.version <= 0) throw http(409, 'ATTENDANCE_QR_AUTHORITY_INVALID', 'Attendance QR authority is inconsistent.');
  return credential;
}

function qrPayload(credential) {
  return {
    version: QR_BINDING_VERSION,
    siteId: credential.securitySiteId,
    credentialId: credential.id,
    credentialVersion: credential.version,
    tokenHash: credential.tokenHash,
    validFrom: credential.validFrom ? new Date(credential.validFrom).toISOString() : null,
    validUntil: credential.validUntil ? new Date(credential.validUntil).toISOString() : null
  };
}

function gpsAssuredQrPayload(site, policy) {
  return {
    version: QR_ASSURANCE_BINDING_VERSION,
    mode: QR_ASSURANCE_MODES.GPS_ASSURED,
    siteId: site.id,
    policy: {
      qrPolicy: policy.qrPolicy,
      maxAccuracyMeters: policy.autoPassAccuracyMeters,
      innerMarginMeters: policy.innerMarginMeters,
      stepUpOnSiteOverlap: policy.stepUpOnSiteOverlap,
      ambiguityRule: policy.stepUpOnSiteOverlap ? 'NO_OTHER_ACTIVE_SITE_CONTAINS_SAMPLE' : 'DISABLED_BY_ADMIN_POLICY'
    }
  };
}

function normalizeLocation(location, now, {
  maxAccuracyMeters = MAX_LOCATION_ACCURACY_METERS,
  maxAgeMs = LOCATION_MAX_AGE_MS,
  futureSkewMs = LOCATION_FUTURE_SKEW_MS
} = {}) {
  const latitude = coordinate(location?.latitude, -90, 90, 'ATTENDANCE_LOCATION_INVALID', 'Attendance location latitude is invalid.');
  const longitude = coordinate(location?.longitude, -180, 180, 'ATTENDANCE_LOCATION_INVALID', 'Attendance location longitude is invalid.');
  const accuracyMeters = finiteNumber(location?.accuracyMeters, 'ATTENDANCE_LOCATION_ACCURACY_INVALID', 'Attendance location accuracy is invalid.');
  if (accuracyMeters <= 0 || accuracyMeters > maxAccuracyMeters) {
    throw http(409, 'ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT', 'Attendance location accuracy is not sufficient for verification.');
  }
  const capturedAt = parseCapturedAt(location?.capturedAt);
  const ageMs = now.getTime() - capturedAt.getTime();
  if (ageMs > maxAgeMs) throw http(410, 'ATTENDANCE_LOCATION_STALE', 'Attendance location sample is too old.');
  if (ageMs < -futureSkewMs) throw http(400, 'ATTENDANCE_LOCATION_FROM_FUTURE', 'Attendance location sample time is invalid.');
  return { latitude, longitude, accuracyMeters, capturedAt };
}

function locationCheck(site, sample, policy) {
  const distanceMeters = haversineMeters(site.latitude, site.longitude, sample.latitude, sample.longitude);
  const lowerBoundMeters = Math.max(0, distanceMeters - sample.accuracyMeters);
  const upperBoundMeters = distanceMeters + sample.accuracyMeters;
  const classification = upperBoundMeters <= site.geofenceRadiusMeters
    ? GEOFENCE_CLASSIFICATIONS.CONFIDENT_INSIDE
    : lowerBoundMeters <= site.geofenceRadiusMeters
      ? GEOFENCE_CLASSIFICATIONS.BORDERLINE
      : GEOFENCE_CLASSIFICATIONS.CONFIDENT_OUTSIDE;
  return {
    inside: classification === GEOFENCE_CLASSIFICATIONS.CONFIDENT_INSIDE,
    possibleInside: classification !== GEOFENCE_CLASSIFICATIONS.CONFIDENT_OUTSIDE,
    classification,
    distanceMeters,
    lowerBoundMeters,
    upperBoundMeters,
    payload: {
      version: LOCATION_BINDING_VERSION,
      siteId: site.id,
      latitude: decimal7(sample.latitude),
      longitude: decimal7(sample.longitude),
      accuracyMeters: decimal2(sample.accuracyMeters),
      capturedAt: sample.capturedAt.toISOString(),
      classification,
      distanceMeters: decimal2(distanceMeters),
      lowerBoundMeters: decimal2(lowerBoundMeters),
      upperBoundMeters: decimal2(upperBoundMeters),
      policy: {
        maxAccuracyMeters: policy.maxAccuracyMeters,
        maxAgeMs: policy.maxAgeMs,
        futureSkewMs: policy.futureSkewMs,
        containment: 'UNCERTAINTY_BAND_V1'
      }
    }
  };
}

function validateLocationAgainstSite(site, sample, policy) {
  const checked = locationCheck(site, sample, policy);
  if (checked.classification === GEOFENCE_CLASSIFICATIONS.CONFIDENT_OUTSIDE) {
    throw http(409, 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE', 'Attendance location is confidently outside the assigned Security Site geofence.');
  }
  return checked;
}

function createAttendanceSiteEvidenceService({
  prisma = prismaDefault,
  clock = () => new Date(),
  policyService = null,
  policyOverride = null
} = {}) {
  const policies = policyService || createAttendancePolicyService({ prisma });

  async function currentPolicy(client) {
    if (policyOverride) return Object.freeze({ ...DEFAULT_ATTENDANCE_POLICY, ...policyOverride });
    return policies.getPolicy(client);
  }

  async function loadSite(client, siteId) {
    const id = normalizedUuid(siteId, 'ATTENDANCE_SITE_INVALID');
    return assertSite(await client.securitySite.findUnique({ where: { id } }));
  }

  async function activeSites(client) {
    const rows = await client.securitySite.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, latitude: true, longitude: true, geofenceRadiusMeters: true, isActive: true }
    });
    return rows.map((candidate) => { try { return assertSite(candidate); } catch { return null; } }).filter(Boolean);
  }

  async function validateQrToken(client, site, qrToken, now) {
    const hash = tokenHash(qrToken);
    const credential = assertQrCredential(await client.securitySiteQrCredential.findUnique({ where: { tokenHash: hash } }), site.id, now);
    return { credential, digest: bindingDigest(qrPayload(credential)) };
  }

  async function revalidateQrCredential(client, site, credentialId, now) {
    const id = normalizedUuid(credentialId, 'ATTENDANCE_QR_CREDENTIAL_INVALID');
    const credential = assertQrCredential(await client.securitySiteQrCredential.findUnique({ where: { id } }), site.id, now);
    return { credential, digest: bindingDigest(qrPayload(credential)) };
  }

  function normalizeSample(location, now, policy) {
    return normalizeLocation(location, now, {
      maxAccuracyMeters: policy.maxAccuracyMeters,
      maxAgeMs: policy.maxAgeMs,
      futureSkewMs: policy.futureSkewMs
    });
  }

  function validateSample(site, sample, policy) {
    const checked = validateLocationAgainstSite(site, sample, {
      maxAccuracyMeters: policy.maxAccuracyMeters,
      maxAgeMs: policy.maxAgeMs,
      futureSkewMs: policy.futureSkewMs
    });
    return {
      sample,
      classification: checked.classification,
      distanceMeters: checked.distanceMeters,
      lowerBoundMeters: checked.lowerBoundMeters,
      upperBoundMeters: checked.upperBoundMeters,
      digest: bindingDigest(checked.payload)
    };
  }

  async function actualSiteForSample(client, expectedSite, sample, policy) {
    const expectedCheck = locationCheck(expectedSite, sample, policy);
    if (expectedCheck.classification === GEOFENCE_CLASSIFICATIONS.CONFIDENT_INSIDE) return expectedSite;

    const otherChecks = (await activeSites(client))
      .filter((candidate) => candidate.id !== expectedSite.id)
      .map((candidate) => ({ candidate, check: locationCheck(candidate, sample, policy) }));

    const confidentInside = otherChecks
      .filter((row) => row.check.classification === GEOFENCE_CLASSIFICATIONS.CONFIDENT_INSIDE)
      .sort((left, right) => left.check.distanceMeters - right.check.distanceMeters || String(left.candidate.code).localeCompare(String(right.candidate.code)));
    if (confidentInside.length) return confidentInside[0].candidate;

    if (expectedCheck.classification === GEOFENCE_CLASSIFICATIONS.BORDERLINE) return expectedSite;

    const borderline = otherChecks
      .filter((row) => row.check.classification === GEOFENCE_CLASSIFICATIONS.BORDERLINE)
      .sort((left, right) => left.check.distanceMeters - right.check.distanceMeters || String(left.candidate.code).localeCompare(String(right.candidate.code)));
    if (borderline.length) return borderline[0].candidate;

    throw http(409, 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE', 'Attendance location is confidently outside all active Security Site geofences.');
  }

  async function assessQrStepUp(client, site, gps, policy) {
    const sites = policy.stepUpOnSiteOverlap ? await activeSites(client) : [site];
    const possibleSiteIds = sites
      .filter((candidate) => locationCheck(candidate, gps.sample, policy).classification !== GEOFENCE_CLASSIFICATIONS.CONFIDENT_OUTSIDE)
      .map((candidate) => candidate.id);
    const innerMarginMeters = site.geofenceRadiusMeters - gps.upperBoundMeters;
    const reasons = [];
    if (gps.classification === GEOFENCE_CLASSIFICATIONS.BORDERLINE) reasons.push('GEOFENCE_UNCERTAINTY');
    if (gps.sample.accuracyMeters > policy.autoPassAccuracyMeters) reasons.push('GPS_ACCURACY');
    if (gps.classification === GEOFENCE_CLASSIFICATIONS.CONFIDENT_INSIDE && innerMarginMeters < policy.innerMarginMeters) reasons.push('GEOFENCE_BOUNDARY');
    if (policy.stepUpOnSiteOverlap && possibleSiteIds.some((siteId) => siteId !== site.id)) reasons.push('SITE_AMBIGUITY');
    if (policy.qrPolicy === 'REQUIRED') reasons.unshift('ADMIN_POLICY_REQUIRED');
    return { required: reasons.length > 0, reasons, innerMarginMeters };
  }

  function assertQrPolicyCanProceedWithoutQr(stepUp, policy) {
    if (!stepUp.required) return;
    if (policy.qrPolicy === 'DISABLED') {
      throw http(409, 'ATTENDANCE_LOCATION_ASSURANCE_INSUFFICIENT', 'Location assurance is not strong enough under the current Attendance policy.');
    }
    throw http(409, 'ATTENDANCE_QR_STEP_UP_REQUIRED', 'Scan the current Site QR to strengthen location assurance.');
  }

  function riskFlagsFor(expectedSite, actualSite, gps) {
    const flags = [];
    if (expectedSite.id !== actualSite.id) flags.push('ASSIST_OTHER_SITE');
    if (gps.classification === GEOFENCE_CLASSIFICATIONS.BORDERLINE) flags.push('LOCATION_RISK');
    return flags;
  }

  function evidenceReference({ expectedSite, actualSite, gps, qrMode, qrCredential }) {
    return {
      siteId: expectedSite.id,
      expectedSiteId: expectedSite.id,
      actualSiteId: actualSite.id,
      qrMode,
      qrCredentialId: qrCredential?.id || null,
      geofenceClassification: gps.classification,
      riskFlags: riskFlagsFor(expectedSite, actualSite, gps),
      location: {
        latitude: decimal7(gps.sample.latitude),
        longitude: decimal7(gps.sample.longitude),
        accuracyMeters: decimal2(gps.sample.accuracyMeters),
        capturedAt: gps.sample.capturedAt.toISOString()
      }
    };
  }

  function decisionFor({ expectedSite, actualSite, gps, stepUp, qrMode, policy }) {
    const assist = expectedSite.id !== actualSite.id;
    return {
      siteId: expectedSite.id,
      expectedSiteId: expectedSite.id,
      actualSiteId: actualSite.id,
      assistOtherSite: assist,
      riskFlags: riskFlagsFor(expectedSite, actualSite, gps),
      insideGeofence: true,
      geofenceClassification: gps.classification,
      distanceMeters: Number(gps.distanceMeters.toFixed(2)),
      distanceLowerBoundMeters: Number(gps.lowerBoundMeters.toFixed(2)),
      distanceUpperBoundMeters: Number(gps.upperBoundMeters.toFixed(2)),
      qrRequired: stepUp.required,
      qrMode,
      qrStepUpReasons: stepUp.reasons,
      qrPolicy: policy.qrPolicy
    };
  }

  async function validateForAssignment({ assignment, qrToken, location }, client = prisma) {
    if (!assignment?.securitySiteId) throw http(409, 'ATTENDANCE_SITE_REQUIRED', 'The Shift Assignment does not have an authoritative Security Site.');
    const now = clock();
    const policy = await currentPolicy(client);
    const expectedSite = await loadSite(client, assignment.securitySiteId);
    const sample = normalizeSample(location, now, policy);
    const actualSite = await actualSiteForSample(client, expectedSite, sample, policy);
    const gps = validateSample(actualSite, sample, policy);
    const stepUp = await assessQrStepUp(client, actualSite, gps, policy);
    const suppliedQr = String(qrToken || '').trim();
    let qrCredential = null;
    let qrMode = QR_ASSURANCE_MODES.GPS_ASSURED;
    let qrBindingDigest;
    if (suppliedQr) {
      const qr = await validateQrToken(client, actualSite, suppliedQr, now);
      qrCredential = qr.credential;
      qrMode = QR_ASSURANCE_MODES.STEP_UP_QR;
      qrBindingDigest = qr.digest;
    } else {
      assertQrPolicyCanProceedWithoutQr(stepUp, policy);
      qrBindingDigest = bindingDigest(gpsAssuredQrPayload(actualSite, policy));
    }
    return {
      siteBindingDigest: bindingDigest(siteBindingPayload(expectedSite, actualSite)),
      qrBindingDigest,
      locationBindingDigest: gps.digest,
      evidenceRef: evidenceReference({ expectedSite, actualSite, gps, qrMode, qrCredential }),
      decision: decisionFor({ expectedSite, actualSite, gps, stepUp, qrMode, policy })
    };
  }

  async function revalidateRef({ ref }, client = prisma) {
    const now = clock();
    const policy = await currentPolicy(client);
    const expectedSite = await loadSite(client, ref?.expectedSiteId || ref?.siteId);
    const actualSiteId = normalizedUuid(ref?.actualSiteId || ref?.siteId, 'ATTENDANCE_SITE_INVALID');
    const actualSite = actualSiteId === expectedSite.id
      ? expectedSite
      : (await activeSites(client)).find((candidate) => candidate.id === actualSiteId);
    if (!actualSite) throw http(409, 'ATTENDANCE_SITE_INACTIVE', 'The actual Attendance Security Site is no longer active.');
    const sample = normalizeSample(ref?.location, now, policy);
    const gps = validateSample(actualSite, sample, policy);
    const stepUp = await assessQrStepUp(client, actualSite, gps, policy);
    const qrMode = String(ref?.qrMode || '');
    let qrCredential = null;
    let qrBindingDigest;
    if (qrMode === QR_ASSURANCE_MODES.STEP_UP_QR) {
      const qr = await revalidateQrCredential(client, actualSite, ref?.qrCredentialId, now);
      qrCredential = qr.credential;
      qrBindingDigest = qr.digest;
    } else if (qrMode === QR_ASSURANCE_MODES.GPS_ASSURED) {
      if (ref?.qrCredentialId != null) throw http(409, 'ATTENDANCE_QR_AUTHORITY_INVALID', 'GPS-assured Attendance context must not contain a QR credential.');
      assertQrPolicyCanProceedWithoutQr(stepUp, policy);
      qrBindingDigest = bindingDigest(gpsAssuredQrPayload(actualSite, policy));
    } else {
      throw http(409, 'ATTENDANCE_QR_AUTHORITY_INVALID', 'Attendance QR assurance mode is invalid.');
    }
    return {
      siteBindingDigest: bindingDigest(siteBindingPayload(expectedSite, actualSite)),
      qrBindingDigest,
      locationBindingDigest: gps.digest,
      evidenceRef: evidenceReference({ expectedSite, actualSite, gps, qrMode, qrCredential }),
      decision: decisionFor({ expectedSite, actualSite, gps, stepUp, qrMode, policy })
    };
  }

  return { validateForAssignment, revalidateRef };
}

module.exports = {
  SITE_BINDING_VERSION,
  SITE_PAIR_BINDING_VERSION,
  QR_BINDING_VERSION,
  QR_ASSURANCE_BINDING_VERSION,
  LOCATION_BINDING_VERSION,
  MAX_LOCATION_ACCURACY_METERS,
  LOCATION_MAX_AGE_MS,
  LOCATION_FUTURE_SKEW_MS,
  QR_STEP_UP_MAX_ACCURACY_METERS,
  QR_STEP_UP_INNER_MARGIN_METERS,
  QR_ASSURANCE_MODES,
  GEOFENCE_CLASSIFICATIONS,
  tokenHash,
  haversineMeters,
  bindingDigest,
  createAttendanceSiteEvidenceService
};
