'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SITE_BINDING_VERSION,
  QR_BINDING_VERSION,
  LOCATION_BINDING_VERSION,
  MAX_LOCATION_ACCURACY_METERS,
  LOCATION_MAX_AGE_MS,
  LOCATION_FUTURE_SKEW_MS,
  tokenHash,
  haversineMeters,
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

function fakeDb({ site = baseSite(), credential = baseCredential() } = {}) {
  const state = { site, credential };
  return {
    state,
    db: {
      securitySite: {
        findUnique: async ({ where }) => state.site?.id === where.id ? state.site : null
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

function serviceFor(options = {}) {
  const { db, state } = fakeDb(options);
  return { service: createAttendanceSiteEvidenceService({ prisma: db, clock: () => now }), db, state };
}

test('site/QR/location authority contracts are versioned and QR tokens are hashed', () => {
  assert.equal(SITE_BINDING_VERSION, 'ATTENDANCE_SITE_AUTHORITY_V1');
  assert.equal(QR_BINDING_VERSION, 'ATTENDANCE_QR_AUTHORITY_V1');
  assert.equal(LOCATION_BINDING_VERSION, 'ATTENDANCE_LOCATION_AUTHORITY_V1');
  assert.equal(MAX_LOCATION_ACCURACY_METERS, 50);
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
  assert.equal(result.evidenceRef.qrCredentialId, ids.qr);
  assert.equal(result.decision.insideGeofence, true);
  const serialized = JSON.stringify(result.evidenceRef);
  assert.equal(serialized.includes(qrToken), false);
  assert.equal(serialized.includes(tokenHash(qrToken)), false);
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

test('GPS requires useful accuracy, fresh time and conservative full-containment inside geofence', async () => {
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
