'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'docker-container-network'
  && target.hostname === '127.0.0.1'
  && target.port === '5432'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('G06 Department Security Site authority integration requires the isolated CI PostgreSQL target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createSecuritySiteService } = require('../../src/services/security-site.service');
  const {
    SITE_AUTHORITY_SOURCES,
    createSecuritySiteAuthorityService
  } = require('../../src/services/security-site-authority.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    siteA: crypto.randomUUID(),
    siteB: crypto.randomUUID(),
    assignment: crypto.randomUUID()
  };
  const department = `G06-SITE-${marker.toUpperCase()}`;
  const siteIds = [ids.siteA, ids.siteB];
  const service = createSecuritySiteService({ prisma });
  const authority = createSecuritySiteAuthorityService({ prisma });

  async function cleanup() {
    await prisma.$executeRawUnsafe(
      'DELETE FROM security_site_departments WHERE department_name = $1 OR security_site_id = ANY($2::uuid[])',
      department,
      siteIds
    ).catch(() => {});
    await prisma.securitySiteQrCredential.deleteMany({ where: { securitySiteId: { in: siteIds } } }).catch(() => {});
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: ids.admin },
          { entityId: department },
          { entityId: { in: siteIds } }
        ]
      }
    }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: { in: siteIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  test.before(async () => {
    await cleanup();
    await prisma.employee.create({
      data: {
        id: ids.employee,
        employeeCode: `G06SITE-${marker.toUpperCase()}`,
        firstName: 'Department',
        lastName: 'Authority',
        department
      }
    });
    await prisma.user.create({
      data: {
        id: ids.admin,
        email: `g06-site-admin-${marker}@example.test`,
        passwordHash: 'test-only',
        displayName: 'G06 Security Site Admin',
        role: 'ADMIN'
      }
    });
    await prisma.securitySite.createMany({
      data: [
        {
          id: ids.siteA,
          code: `G06A-${marker.toUpperCase()}`,
          name: 'G06 Authority Site A',
          latitude: 13.7241000,
          longitude: 100.5701000,
          geofenceRadiusMeters: 120,
          isActive: true
        },
        {
          id: ids.siteB,
          code: `G06B-${marker.toUpperCase()}`,
          name: 'G06 Authority Site B',
          latitude: 13.7251000,
          longitude: 100.5711000,
          geofenceRadiusMeters: 100,
          isActive: true
        }
      ]
    });
  });

  test.after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test('Department Default, schedule override, historical pin, DB invariant and QR lifecycle hold together', async () => {
    const firstMapping = await service.replaceDepartmentMapping({
      departmentName: department,
      siteIds,
      defaultSiteId: ids.siteA
    }, ids.admin);
    assert.equal(firstMapping.defaultSiteId, ids.siteA);
    assert.deepEqual(new Set(firstMapping.siteIds), new Set(siteIds));

    const assignment = {
      id: ids.assignment,
      employeeId: ids.employee,
      securitySiteId: null,
      departmentSnapshot: null
    };
    const defaultA = await authority.resolve({ assignment });
    assert.equal(defaultA.siteId, ids.siteA);
    assert.equal(defaultA.source, SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT);
    assert.equal(defaultA.departmentName, department);
    assert.equal(defaultA.pinnedBySession, false);

    await assert.rejects(
      () => prisma.$executeRawUnsafe(
        'UPDATE security_site_departments SET is_default = TRUE, updated_at = NOW() WHERE department_name = $1 AND security_site_id = $2',
        department,
        ids.siteB
      ),
      () => true,
      'PostgreSQL must reject a second Default Site for the same Department'
    );

    const secondMapping = await service.replaceDepartmentMapping({
      departmentName: department,
      siteIds,
      defaultSiteId: ids.siteB
    }, ids.admin);
    assert.equal(secondMapping.defaultSiteId, ids.siteB);

    const currentDefault = await authority.resolve({ assignment });
    assert.equal(currentDefault.siteId, ids.siteB);
    assert.equal(currentDefault.source, SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT);

    const historical = await authority.resolve({
      assignment,
      existingSession: {
        expectedSiteId: ids.siteA,
        expectationSnapshot: {
          site: {
            authoritySource: SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT,
            departmentName: department
          }
        }
      }
    });
    assert.equal(historical.siteId, ids.siteA);
    assert.equal(historical.source, SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT);
    assert.equal(historical.pinnedBySession, true);

    const scheduled = await authority.resolve({
      assignment: {
        ...assignment,
        securitySiteId: ids.siteB,
        departmentSnapshot: department
      }
    });
    assert.equal(scheduled.siteId, ids.siteB);
    assert.equal(scheduled.source, SITE_AUTHORITY_SOURCES.SCHEDULE);
    assert.equal(scheduled.pinnedBySession, false);

    const firstQr = await service.rotateQr(ids.siteB, ids.admin, 'integration rotation');
    assert.ok(firstQr.qrToken.length >= 24);
    const firstCredential = await prisma.securitySiteQrCredential.findUnique({
      where: { id: firstQr.credential.id }
    });
    const expectedHash = crypto.createHash('sha256').update(Buffer.from(firstQr.qrToken, 'utf8')).digest('hex');
    assert.equal(firstCredential.tokenHash, expectedHash);
    assert.notEqual(firstCredential.tokenHash, firstQr.qrToken);

    const secondQr = await service.rotateQr(ids.siteB, ids.admin);
    assert.equal(secondQr.credential.version, firstQr.credential.version + 1);
    const revokedFirst = await prisma.securitySiteQrCredential.findUnique({
      where: { id: firstQr.credential.id }
    });
    assert.ok(revokedFirst.revokedAt instanceof Date);

    const qrAudits = await prisma.auditLog.findMany({
      where: {
        actorUserId: ids.admin,
        entityType: 'SecuritySiteQrCredential'
      }
    });
    const serializedAudits = JSON.stringify(qrAudits);
    assert.equal(serializedAudits.includes(firstQr.qrToken), false);
    assert.equal(serializedAudits.includes(expectedHash), false);

    await assert.rejects(
      () => service.update(ids.siteB, { isActive: false }, ids.admin),
      (error) => error.details?.code === 'SECURITY_SITE_DEFAULT_IN_USE'
    );
    const stillActive = await prisma.securitySite.findUnique({ where: { id: ids.siteB } });
    assert.equal(stillActive.isActive, true);
  });
}
