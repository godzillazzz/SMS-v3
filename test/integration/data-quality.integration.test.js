process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('data quality integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Data Quality integration tests require an isolated sms_v3_test database.');
  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const ids = {
    admin: '73000000-0000-4000-8000-000000000001',
    manager: '73000000-0000-4000-8000-000000000002',
    viewer: '73000000-0000-4000-8000-000000000003',
    employee: '73000000-0000-4000-8000-000000000010',
    license: '73000000-0000-4000-8000-000000000011',
    document: '73000000-0000-4000-8000-000000000012',
    quota: '73000000-0000-4000-8000-000000000013'
  };
  const prefix = 'data-quality-fixture-';

  async function cleanup() {
    await prisma.employeeLicenseDocument.deleteMany({ where: { id: ids.document } });
    await prisma.employeeLicense.deleteMany({ where: { id: ids.license } });
    await prisma.leaveQuota.deleteMany({ where: { id: ids.quota } });
    await prisma.employee.deleteMany({ where: { id: ids.employee } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.manager, ids.viewer] } } });
  }

  async function tokenFor(id) {
    return accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id } }));
  }

  async function seed() {
    await cleanup();
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: `${prefix}admin@test.local`, passwordHash: 'hash', displayName: 'DQ Admin', role: 'ADMIN', accountStatus: 'ACTIVE', isActive: true, passwordResetRequired: false },
      { id: ids.manager, email: `${prefix}manager@test.local`, passwordHash: 'hash', displayName: 'DQ Manager', role: 'MANAGER', accountStatus: 'ACTIVE', isActive: true, passwordResetRequired: false },
      { id: ids.viewer, email: `${prefix}viewer@test.local`, passwordHash: 'hash', displayName: 'DQ Viewer', role: 'VIEWER', accountStatus: 'ACTIVE', isActive: true, passwordResetRequired: false }
    ] });
    await prisma.employee.create({ data: { id: ids.employee, employeeCode: `${prefix}employee`, firstName: 'Data', lastName: 'Quality', displayName: 'Data Quality', department: 'North', isActive: true } });
    await prisma.leaveQuota.create({ data: { id: ids.quota, sourceFingerprint: `${prefix}quota`, employeeId: null, employeeNameSnapshot: 'Unmatched Quota', sickLeave: 0, personalLeave: 0, vacationLeave: 0, matchStatus: 'UNMATCHED' } });
    await prisma.employeeLicense.create({ data: { id: ids.license, legacyLicenseId: `${prefix}license`, employeeId: ids.employee, licenseType: 'Security', licenseNumber: 'DQ-001', status: 'Active' } });
    await prisma.employeeLicenseDocument.create({ data: { id: ids.document, employeeId: ids.employee, licenseId: ids.license, storageProvider: 'test', storageBucket: 'test', storageObjectKey: `${prefix}document`, originalFileName: 'test.pdf', safeDisplayFileName: 'test.pdf', mimeType: 'application/pdf', fileSize: 1, proposedStartDate: new Date('2026-01-01'), proposedExpiryDate: new Date('2026-08-01'), status: 'APPROVED', isCurrent: true, uploadedById: ids.admin, version: 1 } });
  }

  test.beforeEach(seed);
  test.after(async () => { await cleanup(); await prisma.$disconnect(); });

  test('ADMIN receives deterministic issues and server-side filters', async () => {
    const token = await tokenFor(ids.admin);
    const response = await request(app).get('/api/v1/data-quality/issues?pageSize=25').set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.critical, 3);
    assert.equal(response.body.data.some((row) => row.rule === 'LEAVE_QUOTA_UNMATCHED'), true);
    assert.equal(response.body.data.some((row) => row.rule === 'LEAVE_QUOTA_YEAR_UNCLASSIFIED'), true);
    assert.equal(response.body.data.some((row) => row.rule === 'LICENSE_EXPIRED'), true);
    const filtered = await request(app).get('/api/v1/data-quality/issues?module=LICENSE&department=North').set('Authorization', `Bearer ${token}`);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.summary.total, 1);
    assert.equal(filtered.body.data[0].department, 'North');
    const invalid = await request(app).get('/api/v1/data-quality/issues?pageSize=101').set('Authorization', `Bearer ${token}`);
    assert.equal(invalid.status, 400);
  });

  test('ADMIN-only route rejects unauthenticated and restricted roles without write routes', async () => {
    assert.equal((await request(app).get('/api/v1/data-quality/issues')).status, 401);
    assert.equal((await request(app).get('/api/v1/data-quality/issues').set('Authorization', `Bearer ${await tokenFor(ids.manager)}`)).status, 403);
    assert.equal((await request(app).get('/api/v1/data-quality/issues').set('Authorization', `Bearer ${await tokenFor(ids.viewer)}`)).status, 403);
    assert.equal((await request(app).post('/api/v1/data-quality/issues').set('Authorization', `Bearer ${await tokenFor(ids.admin)}`)).status, 404);
    assert.equal((await request(app).delete('/api/v1/data-quality/issues').set('Authorization', `Bearer ${await tokenFor(ids.admin)}`)).status, 404);
  });
}
