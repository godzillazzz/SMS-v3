'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSecuritySiteService } = require('../src/services/security-site.service');

const ids = {
  site: '11111111-1111-4111-8111-111111111111',
  session: '22222222-2222-4222-8222-222222222222',
  actor: '33333333-3333-4333-8333-333333333333'
};

function site(overrides = {}) {
  return {
    id: ids.site,
    code: 'OPEN',
    name: 'Open Attendance Site',
    latitude: '13.7000000',
    longitude: '100.5000000',
    geofenceRadiusMeters: 100,
    isActive: true,
    ...overrides
  };
}

test('deactivation is blocked when an OPEN AttendanceSession still pins the Site', async () => {
  let updateCalls = 0;
  const tx = {
    securitySite: {
      findUnique: async () => site(),
      update: async () => { updateCalls += 1; return site({ isActive: false, reason: 'Governed deactivation test' }); }
    },
    $queryRawUnsafe: async () => [],
    attendanceSession: {
      findFirst: async (args) => {
        assert.deepEqual(args.where, { expectedSiteId: ids.site, state: 'OPEN', closedAt: null });
        return { id: ids.session };
      }
    }
  };
  const service = createSecuritySiteService({
    prisma: { $transaction: async (callback) => callback(tx) },
    audit: { log: async () => {} }
  });

  await assert.rejects(
    () => service.update(ids.site, { isActive: false, reason: 'Governed deactivation test' }, ids.actor),
    (error) => error.details?.code === 'SECURITY_SITE_OPEN_ATTENDANCE_IN_USE'
  );
  assert.equal(updateCalls, 0);
});

test('a non-default Site with no OPEN AttendanceSession can be deactivated', async () => {
  let mappingCleanupCalls = 0;
  let auditCalls = 0;
  const tx = {
    securitySite: {
      findUnique: async () => site(),
      update: async ({ data }) => site({ isActive: data.isActive })
    },
    $queryRawUnsafe: async () => [],
    $executeRawUnsafe: async () => { mappingCleanupCalls += 1; return 0; },
    attendanceSession: { findFirst: async () => null }
  };
  const service = createSecuritySiteService({
    prisma: { $transaction: async (callback) => callback(tx) },
    audit: { log: async () => { auditCalls += 1; } }
  });

  const result = await service.update(ids.site, { isActive: false, reason: 'Governed deactivation test' }, ids.actor);
  assert.equal(result.isActive, false);
  assert.equal(mappingCleanupCalls, 1);
  assert.equal(auditCalls, 1);
});
