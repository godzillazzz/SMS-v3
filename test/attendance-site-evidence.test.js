'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SITE_BINDING_VERSION,
  QR_BINDING_VERSION,
  QR_ASSURANCE_BINDING_VERSION,
  LOCATION_BINDING_VERSION,
  MAX_LOCATION_ACCURACY_METERS,
  LOCATION_MAX_AGE_MS,
  LOCATION_FUTURE_SKEW_MS,
  QR_STEP_UP_MAX_ACCURACY_METERS,
  QR_STEP_UP_INNER_MARGIN_METERS,
  GEOFENCE_CLASSIFICATIONS,
  tokenHash,
  haversineMeters,
  chooseActualSite,
  createAttendanceSiteEvidenceService
} = require('../src/services/attendance-site-evidence.service');

const ids = {
  site: '11111111-1111-4111-8111-111111111111',
  otherSite: '22222222-2222-4222-8222-222222222222',
  qr: '33333333-3333-4333-8333-333333333333'
};
const now = new Date('2026-08-24T03:00:00.000Z');
const qrToken = 'attendance-site-qr-token-secret-material-001';

function baseSite(overrides = {}) {
  return {
    id: ids.site,
    code: 'HQ-A',
    name: 'HQ Security A',
    latitude: 13.7241000,
    longitude: 100.5701000,
    geofenceRadiusMeters: 120,
    isActive: true,
    ...overrides
  };
}

function baseCredential(overrides = {}) {
  return {
    id: ids.qr,
    securitySiteId: ids.site,
    tokenHash: tokenHash(qrToken),
    version: 1,
    validFrom: new Date('2026-08-24T00:00:00.000Z'),
    validUntil: new Date('2026-08-25T00:00:00.000Z'),
    revokedAt: null,
    ...overrides
  };
}

function location(overrides = {}) {
  return {
    latitude: 13.7241200,
    longitude: 100.5701200,
    accuracyMeters: 8,
    capturedAt: now.toISOString(),
    ...overrides
  };
}

function fakeDb({ site = baseSite(), credential = baseCredential(), otherSites = [] } = {}) {
  const state = { site, credential, otherSites };
  return {
    state,
    db: {
      systemSetting: {
        findMany: async () => []
      },
      securitySite: {
        findUnique: async ({ where }) => state.site?.id === where.id ? state.site : null,
        findMany: async () => [state.site, ...state.otherSites].filter((row) => row?.isActive === true)
      },
      securitySiteQrCredential: {
        findUnique: async ({ where }) => {
          if (where.tokenHash !== undefined) return state.credential?.tokenHash === where.tokenHash ? state.credential : null;
          if (where.id !== undefined) return state.credential?.id === where.id ? state.credential : null;
          return null;
        }
      }
    }
  };
}

function serviceFor(options = {}, serviceOptions = {}) {
  const { db, state } = fakeDb(options);
  return { service: createAttendanceSiteEvidenceService({ prisma: db, clock: () => now, ...serviceOptions }), db, state };
}

test('site/QR/location authority contracts are versioned and QR tokens are hashed', () => {
  assert.equal(SITE_BINDING_VERSION, 'ATTENDANCE_SITE_AUTHORITY_V1');
  assert.equal(QR_BINDING_VERSION, 'ATTENDANCE_QR_AUTHORITY_V1');
  assert.equal(QR_ASSURANCE_BINDING_VERSION, 'ATTENDANCE_QR_ASSURANCE_V1');
  assert.equal(LOCATION_BINDING_VERSION, 'ATTENDANCE_LOCATION_AUTHORITY_V2');
  assert.deepEqual(GEOFENCE_CLASSIFICATIONS, {
    CONFIDENT_INSIDE: 'CONFIDENT_INSIDE',
    BORDERLINE: 'BORDERLINE',
    CONFIDENT_OUTSIDE: 'CONFIDENT_OUTSIDE'
  });
  assert.equal(MAX_LOCATION_ACCURACY_METERS, 50);
  assert.equal(QR_STEP_UP_MAX_ACCURACY_METERS, 20);
  assert.equal(QR_STEP_UP_INNER_MARGIN_METERS, 20);
  assert.equal(LOCATION_MAX_AGE_MS, 3 * 60 * 1000);
  assert.equal(LOCATION_FUTURE_SKEW_MS, 30 * 1000);
  const hashed = tokenHash(qrToken);
  assert.match(hashed, /^[0-9a-f]{64}$/);
  assert.notEqual(hashed, qrToken);
});

test('haversine distance is stable enough for geofence policy', () => {
  assert.equal(Math.round(haversineMeters(13.7241, 100.5701, 13.7241, 100.5701)), 0);
  const meters = haversineMeters(13.7241, 100.5701, 13.7242, 100.5701);
  assert.ok(meters > 10 && meters < 12.5);
});

test('valid server-side Site + QR + GPS produces three digests and a secret-free evidence reference', async () => {
  const { service } = serviceFor();
  const result = await service.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() });
  assert.match(result.siteBindingDigest, /^[0-9a-f]{64}$/);
  assert.match(result.qrBindingDigest, /^[0-9a-f]{64}$/);
  assert.match(result.locationBindingDigest, /^[0-9a-f]{64}$/);
  assert.equal(result.evidenceRef.siteId, ids.site);
  assert.equal(result.evidenceRef.qrMode, 'STEP_UP_QR');
  assert.equal(result.evidenceRef.qrCredentialId, ids.qr);
  assert.equal(result.decision.insideGeofence, true);
  const serialized = JSON.stringify(result.evidenceRef);
  assert.equal(serialized.includes(qrToken), false);
  assert.equal(serialized.includes(tokenHash(qrToken)), false);
});

test('strong unambiguous GPS may proceed without QR while weak, boundary, or ambiguous GPS requires QR step-up', async () => {
  const strong = serviceFor().service;
  const gpsOnly = await strong.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: location() });
  assert.equal(gpsOnly.evidenceRef.qrMode, 'GPS_ASSURED');
  assert.equal(gpsOnly.evidenceRef.qrCredentialId, null);
  assert.equal(gpsOnly.decision.qrRequired, false);
  assert.match(gpsOnly.qrBindingDigest, /^[0-9a-f]{64}$/);

  await assert.rejects(
    () => strong.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: location({ accuracyMeters: 25 }) }),
    (error) => error.details?.code === 'ATTENDANCE_QR_STEP_UP_REQUIRED'
  );

  const nearBoundary = serviceFor({ site: baseSite({ geofenceRadiusMeters: 25 }) }).service;
  await assert.rejects(
    () => nearBoundary.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_QR_STEP_UP_REQUIRED'
  );

  const overlapping = serviceFor({
    otherSites: [{ ...baseSite({ id: ids.otherSite, code: 'HQ-B' }), latitude: 13.72411, longitude: 100.57011 }]
  }).service;
  await assert.rejects(
    () => overlapping.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_QR_STEP_UP_REQUIRED'
  );

  const steppedUp = await overlapping.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() });
  assert.equal(steppedUp.evidenceRef.qrMode, 'STEP_UP_QR');
  assert.equal(steppedUp.evidenceRef.qrCredentialId, ids.qr);
});


test('uncertainty-aware geofence requires QR for BORDERLINE and records LOCATION_RISK without allowing confident outside', async () => {
  const { service } = serviceFor();
  const borderlineInsidePoint = location({ latitude: 13.72513, longitude: 100.5701, accuracyMeters: 10 });

  await assert.rejects(
    () => service.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: borderlineInsidePoint }),
    (error) => error.details?.code === 'ATTENDANCE_QR_STEP_UP_REQUIRED'
  );

  const steppedUp = await service.validateForAssignment({
    assignment: { securitySiteId: ids.site },
    qrToken,
    location: borderlineInsidePoint
  });
  assert.equal(steppedUp.decision.geofenceClassification, 'BORDERLINE');
  assert.equal(steppedUp.decision.insideGeofence, true);
  assert.equal(steppedUp.decision.qrRequired, true);
  assert.ok(steppedUp.decision.qrStepUpReasons.includes('GEOFENCE_UNCERTAINTY'));
  assert.deepEqual(steppedUp.evidenceRef.riskFlags, ['LOCATION_RISK']);
  assert.equal(steppedUp.evidenceRef.geofenceClassification, 'BORDERLINE');
  assert.ok(steppedUp.decision.distanceLowerBoundMeters < 120);
  assert.ok(steppedUp.decision.distanceUpperBoundMeters > 120);

  const revalidated = await service.revalidateRef({ ref: steppedUp.evidenceRef });
  assert.equal(revalidated.decision.geofenceClassification, 'BORDERLINE');
  assert.deepEqual(revalidated.evidenceRef.riskFlags, ['LOCATION_RISK']);

  const borderlineOutsidePoint = location({ latitude: 13.72522, longitude: 100.5701, accuracyMeters: 10 });
  const outsidePointSteppedUp = await service.validateForAssignment({
    assignment: { securitySiteId: ids.site },
    qrToken,
    location: borderlineOutsidePoint
  });
  assert.equal(outsidePointSteppedUp.decision.geofenceClassification, 'BORDERLINE');
  assert.deepEqual(outsidePointSteppedUp.evidenceRef.riskFlags, ['LOCATION_RISK']);

  await assert.rejects(
    () => service.validateForAssignment({
      assignment: { securitySiteId: ids.site },
      qrToken,
      location: location({ latitude: 13.7254, longitude: 100.5701, accuracyMeters: 10 })
    }),
    (error) => error.details?.code === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE'
  );
});

test('assigned Site wins overlapping geofences whenever its uncertainty band still matches', async () => {
  const other = { ...baseSite({ id: ids.otherSite, code: 'HQ-B' }), latitude: 13.72513, longitude: 100.5701, geofenceRadiusMeters: 80 };
  const { service } = serviceFor({ otherSites: [other] });
  const sample = location({ latitude: 13.72514, longitude: 100.5701, accuracyMeters: 8 });
  const result = await service.validateForAssignment({
    assignment: { securitySiteId: ids.site },
    qrToken,
    location: sample
  });
  assert.equal(result.evidenceRef.actualSiteId, ids.site);
  assert.equal(result.evidenceRef.workSiteContext, 'ASSIGNED_SITE');
  assert.equal(result.decision.geofenceClassification, 'BORDERLINE');
  assert.deepEqual(result.evidenceRef.riskFlags, ['LOCATION_RISK']);
});

test('support-site overlap selection uses normalized distance then stable Site code and ID', () => {
  const assigned = baseSite({ latitude: 13.72, longitude: 100.57, geofenceRadiusMeters: 30 });
  const widerButNearer = baseSite({ id: ids.otherSite, code: 'Z-SITE', latitude: 13.7242, longitude: 100.57012, geofenceRadiusMeters: 200 });
  const lexicalWinner = baseSite({ id: '33333333-3333-4333-8333-333333333333', code: 'A-SITE', latitude: 13.7242, longitude: 100.57012, geofenceRadiusMeters: 200 });
  const sample = location({ capturedAt: now });
  const selected = chooseActualSite(assigned, [lexicalWinner, widerButNearer], sample, {});
  assert.equal(selected.candidate.id, lexicalWinner.id);
  assert.equal(selected.check.classification, 'CONFIDENT_INSIDE');

  const normalizedAssigned = baseSite({ latitude: 13.72, longitude: 100.57, geofenceRadiusMeters: 25 });
  const narrowCloser = baseSite({ id: '55555555-5555-4555-8555-555555555555', code: 'A-CLOSER', latitude: 13.7244, longitude: 100.5701, geofenceRadiusMeters: 60 });
  const broadNormalizedWinner = baseSite({ id: '66666666-6666-4666-8666-666666666666', code: 'Z-NORMALIZED', latitude: 13.7246, longitude: 100.5701, geofenceRadiusMeters: 120 });
  const normalized = chooseActualSite(normalizedAssigned, [narrowCloser, broadNormalizedWinner], location({ capturedAt: now }), {});
  assert.ok(haversineMeters(normalizedAssigned.latitude, normalizedAssigned.longitude, narrowCloser.latitude, narrowCloser.longitude)
    < haversineMeters(normalizedAssigned.latitude, normalizedAssigned.longitude, broadNormalizedWinner.latitude, broadNormalizedWinner.longitude));
  assert.equal(normalized.candidate.id, broadNormalizedWinner.id);
});

test('support Site requires a confident inside GPS classification when assigned Site is outside', () => {
  const assigned = baseSite({ latitude: 13.7241, longitude: 100.5701, geofenceRadiusMeters: 60 });
  const support = baseSite({ id: ids.otherSite, code: 'HQ-B', latitude: 13.72513, longitude: 100.5701, geofenceRadiusMeters: 80 });
  const sample = location({ latitude: 13.7259, longitude: 100.5701, accuracyMeters: 8, capturedAt: now });
  const supportDistance = haversineMeters(support.latitude, support.longitude, sample.latitude, sample.longitude);
  const assignedDistance = haversineMeters(assigned.latitude, assigned.longitude, sample.latitude, sample.longitude);
  assert.ok(supportDistance - sample.accuracyMeters <= support.geofenceRadiusMeters);
  assert.ok(supportDistance + sample.accuracyMeters > support.geofenceRadiusMeters);
  assert.ok(assignedDistance - sample.accuracyMeters > assigned.geofenceRadiusMeters);
  assert.equal(chooseActualSite(assigned, [support], sample, {}), null);
});

test('offline eligible Site snapshot contains active authoritative Sites only and deterministic order', async () => {
  const disabled = baseSite({ id: '44444444-4444-4444-8444-444444444444', code: 'DISABLED', isActive: false });
  const { service } = serviceFor({ otherSites: [baseSite({ id: ids.otherSite, code: 'HQ-B' }), disabled] });
  const sites = await service.eligibleSitesForAssignment({ assignment: { securitySiteId: ids.site } });
  assert.deepEqual(sites.map((site) => site.code), ['HQ-A', 'HQ-B']);
  assert.equal(sites.some((site) => site.id === disabled.id), false);
  assert.equal(sites.every((site) => site.isActive === true), true);
});

test('support-site evidence persists assigned/actual Site and explicit work context', async () => {
  const other = { ...baseSite({ id: ids.otherSite, code: 'HQ-B' }), latitude: 13.72513, longitude: 100.5701, geofenceRadiusMeters: 80 };
  const { service } = serviceFor({ otherSites: [other] });
  const result = await service.validateGpsOnlyForAssignment({
    assignment: { securitySiteId: ids.site },
    location: location({ latitude: 13.7253, longitude: 100.5701 }),
    referenceTime: now
  });
  assert.equal(result.evidenceRef.expectedSiteId, ids.site);
  assert.equal(result.evidenceRef.actualSiteId, ids.otherSite);
  assert.equal(result.evidenceRef.assignedSite.code, 'HQ-A');
  assert.equal(result.evidenceRef.actualSite.code, 'HQ-B');
  assert.equal(result.evidenceRef.workSiteContext, 'SUPPORT_SITE');
  assert.deepEqual(result.evidenceRef.riskFlags, ['ASSIST_OTHER_SITE']);
});

test('Admin QR policy changes Server behavior without source changes and never overrides geofence', async () => {
  const required = serviceFor({}, { policyOverride: { qrPolicy: 'REQUIRED' } }).service;
  await assert.rejects(
    () => required.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_QR_STEP_UP_REQUIRED'
  );
  const requiredWithQr = await required.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() });
  assert.equal(requiredWithQr.decision.qrPolicy, 'REQUIRED');
  assert.equal(requiredWithQr.evidenceRef.qrMode, 'STEP_UP_QR');

  const disabled = serviceFor({}, { policyOverride: { qrPolicy: 'DISABLED', autoPassAccuracyMeters: 10 } }).service;
  await assert.rejects(
    () => disabled.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: location({ accuracyMeters: 15 }) }),
    (error) => error.details?.code === 'ATTENDANCE_LOCATION_ASSURANCE_INSUFFICIENT'
  );
  const disabledStrong = await disabled.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: location({ accuracyMeters: 8 }) });
  assert.equal(disabledStrong.decision.qrPolicy, 'DISABLED');
  assert.equal(disabledStrong.evidenceRef.qrMode, 'GPS_ASSURED');

  const anyPolicy = serviceFor({}, { policyOverride: { qrPolicy: 'REQUIRED' } }).service;
  await assert.rejects(
    () => anyPolicy.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location({ latitude: 13.7253, accuracyMeters: 10 }) }),
    (error) => error.details?.code === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE'
  );
});

test('GPS-assured context revalidation fails closed if current location policy later requires QR step-up', async () => {
  const { service, state } = serviceFor();
  const first = await service.validateForAssignment({ assignment: { securitySiteId: ids.site }, location: location() });
  assert.equal(first.evidenceRef.qrMode, 'GPS_ASSURED');
  state.otherSites = [{ ...baseSite({ id: ids.otherSite, code: 'HQ-B' }), latitude: 13.72411, longitude: 100.57011 }];
  await assert.rejects(
    () => service.revalidateRef({ ref: first.evidenceRef }),
    (error) => error.details?.code === 'ATTENDANCE_QR_STEP_UP_REQUIRED'
  );
});

test('missing site assignment and inactive site fail closed', async () => {
  const { service } = serviceFor();
  await assert.rejects(
    () => service.validateForAssignment({ assignment: {}, qrToken, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_SITE_REQUIRED'
  );
  const inactive = serviceFor({ site: baseSite({ isActive: false }) }).service;
  await assert.rejects(
    () => inactive.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_SITE_INACTIVE'
  );
});

test('wrong, cross-site, revoked, future and expired QR authority fail closed', async () => {
  const { service } = serviceFor();
  await assert.rejects(
    () => service.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken: 'wrong-token-that-is-long-enough-000000', location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_QR_INVALID'
  );

  const crossSite = serviceFor({ credential: baseCredential({ securitySiteId: ids.otherSite }) }).service;
  await assert.rejects(
    () => crossSite.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_QR_INVALID'
  );

  const revoked = serviceFor({ credential: baseCredential({ revokedAt: new Date('2026-08-24T02:00:00.000Z') }) }).service;
  await assert.rejects(
    () => revoked.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_QR_REVOKED'
  );

  const future = serviceFor({ credential: baseCredential({ validFrom: new Date('2026-08-24T04:00:00.000Z') }) }).service;
  await assert.rejects(
    () => future.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_QR_NOT_ACTIVE'
  );

  const expired = serviceFor({ credential: baseCredential({ validUntil: new Date('2026-08-24T02:59:00.000Z') }) }).service;
  await assert.rejects(
    () => expired.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() }),
    (error) => error.details?.code === 'ATTENDANCE_QR_EXPIRED'
  );
});

test('GPS requires useful accuracy, fresh time and blocks CONFIDENT_OUTSIDE geofence samples', async () => {
  const { service } = serviceFor();
  await assert.rejects(
    () => service.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location({ accuracyMeters: 55 }) }),
    (error) => error.details?.code === 'ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT'
  );
  await assert.rejects(
    () => service.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location({ capturedAt: '2026-08-24T02:56:00.000Z' }) }),
    (error) => error.details?.code === 'ATTENDANCE_LOCATION_STALE'
  );
  await assert.rejects(
    () => service.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location({ capturedAt: '2026-08-24T03:01:00.000Z' }) }),
    (error) => error.details?.code === 'ATTENDANCE_LOCATION_FROM_FUTURE'
  );
  await assert.rejects(
    () => service.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location({ latitude: 13.7253, accuracyMeters: 10 }) }),
    (error) => error.details?.code === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE'
  );
});

test('revalidation uses current Site/QR authority and reproduces the original decision while unchanged', async () => {
  const { service, state } = serviceFor();
  const first = await service.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() });
  const second = await service.revalidateRef({ ref: first.evidenceRef });
  assert.equal(second.siteBindingDigest, first.siteBindingDigest);
  assert.equal(second.qrBindingDigest, first.qrBindingDigest);
  assert.equal(second.locationBindingDigest, first.locationBindingDigest);

  state.site = { ...state.site, code: 'HQ-A-RENAMED' };
  const changed = await service.revalidateRef({ ref: first.evidenceRef });
  assert.notEqual(changed.siteBindingDigest, first.siteBindingDigest);
});

test('revoking the exact QR credential after preparation blocks receipt-context revalidation', async () => {
  const { service, state } = serviceFor();
  const first = await service.validateForAssignment({ assignment: { securitySiteId: ids.site }, qrToken, location: location() });
  state.credential = { ...state.credential, revokedAt: new Date('2026-08-24T03:00:30.000Z') };
  await assert.rejects(
    () => service.revalidateRef({ ref: first.evidenceRef }),
    (error) => error.details?.code === 'ATTENDANCE_QR_REVOKED'
  );
});

test('schema/migration persist only QR token hashes and add Site authority additively', () => {
  const root = path.resolve(__dirname, '..');
  const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'prisma', 'migrations', '202608240003_g06_security_site_qr_gps_v1', 'migration.sql'), 'utf8');
  assert.match(schema, /model SecuritySite \{/);
  assert.match(schema, /model SecuritySiteQrCredential \{/);
  assert.match(schema, /tokenHash\s+String\s+@unique/);
  assert.match(schema, /securitySiteId\s+String\?/);
  assert.doesNotMatch(schema.slice(schema.indexOf('model SecuritySiteQrCredential'), schema.indexOf('model ShiftType')), /\btoken\s+String|qrToken/i);
  assert.match(migration, /security_site_qr_credentials_token_hash_format/);
  assert.match(migration, /ADD COLUMN "security_site_id" UUID/);
  assert.doesNotMatch(migration, /"qr_token"|"token" VARCHAR|"token" TEXT/i);
});

test('validator source never logs or returns raw QR token material', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'attendance-site-evidence.service.js'), 'utf8');
  assert.match(source, /tokenHash\(qrToken\)/);
  assert.doesNotMatch(source, /console\.|audit\.log|logger\./);
  assert.doesNotMatch(source, /evidenceRef:[\s\S]{0,500}qrToken/);
});
