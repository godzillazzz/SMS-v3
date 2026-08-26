'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceSiteEvidenceService, tokenHash } = require('../src/services/attendance-site-evidence.service');

const expectedId = '11111111-1111-4111-8111-111111111111';
const actualId = '22222222-2222-4222-8222-222222222222';
const qrId = '33333333-3333-4333-8333-333333333333';
const qrToken = 'assist-other-site-qr-token-secret-00001';
const now = new Date('2026-08-25T02:00:00.000Z');

const expectedSite = {
  id: expectedId, code: 'EXPECTED', name: 'Expected Site',
  latitude: 13.8000000, longitude: 100.6000000, geofenceRadiusMeters: 100, isActive: true
};
const actualSite = {
  id: actualId, code: 'ACTUAL', name: 'Actual Site',
  latitude: 13.7241000, longitude: 100.5701000, geofenceRadiusMeters: 120, isActive: true
};
const credential = {
  id: qrId,
  securitySiteId: actualId,
  tokenHash: tokenHash(qrToken),
  version: 1,
  validFrom: new Date('2026-08-25T00:00:00.000Z'),
  validUntil: null,
  revokedAt: null
};

function location(overrides = {}) {
  return {
    latitude: 13.7241100,
    longitude: 100.5701100,
    accuracyMeters: 8,
    capturedAt: now.toISOString(),
    ...overrides
  };
}

function fakeDb() {
  return {
    systemSetting: { findMany: async () => [] },
    securitySite: {
      findUnique: async ({ where }) => where.id === expectedId ? expectedSite : where.id === actualId ? actualSite : null,
      findMany: async () => [expectedSite, actualSite]
    },
    securitySiteQrCredential: {
      findUnique: async ({ where }) => {
        if (where.tokenHash !== undefined) return where.tokenHash === credential.tokenHash ? credential : null;
        if (where.id !== undefined) return where.id === credential.id ? credential : null;
        return null;
      }
    }
  };
}

test('different active Site is accepted as ASSIST_OTHER_SITE with Expected and Actual Site preserved', async () => {
  const service = createAttendanceSiteEvidenceService({ prisma: fakeDb(), clock: () => now });
  const result = await service.validateForAssignment({
    assignment: { securitySiteId: expectedId },
    qrToken,
    location: location()
  });

  assert.equal(result.evidenceRef.siteId, expectedId);
  assert.equal(result.evidenceRef.expectedSiteId, expectedId);
  assert.equal(result.evidenceRef.actualSiteId, actualId);
  assert.deepEqual(result.evidenceRef.riskFlags, ['ASSIST_OTHER_SITE']);
  assert.equal(result.decision.assistOtherSite, true);
  assert.deepEqual(result.decision.riskFlags, ['ASSIST_OTHER_SITE']);
  assert.equal(result.evidenceRef.qrCredentialId, qrId);
});

test('ASSIST_OTHER_SITE evidence revalidates without remapping Expected Site', async () => {
  const service = createAttendanceSiteEvidenceService({ prisma: fakeDb(), clock: () => now });
  const first = await service.validateForAssignment({ assignment: { securitySiteId: expectedId }, qrToken, location: location() });
  const second = await service.revalidateRef({ ref: first.evidenceRef });
  assert.equal(second.siteBindingDigest, first.siteBindingDigest);
  assert.equal(second.locationBindingDigest, first.locationBindingDigest);
  assert.equal(second.evidenceRef.expectedSiteId, expectedId);
  assert.equal(second.evidenceRef.actualSiteId, actualId);
  assert.deepEqual(second.evidenceRef.riskFlags, ['ASSIST_OTHER_SITE']);
});

test('outside every active Site remains fail-closed and is not converted to normal Attendance', async () => {
  const service = createAttendanceSiteEvidenceService({ prisma: fakeDb(), clock: () => now });
  await assert.rejects(
    () => service.validateForAssignment({
      assignment: { securitySiteId: expectedId },
      location: location({ latitude: 14.1000000, longitude: 101.0000000 })
    }),
    (error) => error.details?.code === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE'
  );
});
