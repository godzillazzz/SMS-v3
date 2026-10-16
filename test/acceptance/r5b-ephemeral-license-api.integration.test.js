'use strict';

// Ephemeral API-integration evidence only; NOT Authenticated Browser Preview UAT.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('R5-B local API acceptance requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  const target = new URL(process.env.DATABASE_URL || 'http://invalid');
  const direct = new URL(process.env.DIRECT_URL || 'http://invalid');
  const expected = (url) => (
    url.protocol === 'postgresql:' &&
    url.hostname === '127.0.0.1' &&
    url.port === '5432' &&
    url.pathname === '/sms_v3_test' &&
    url.username === 'ci_user'
  );
  if (!expected(target) || !expected(direct) ||
      process.env.TEST_DATABASE_RUNNER !== 'docker-container-network' ||
      process.env.NODE_ENV !== 'test' ||
      process.env.VERCEL_ENV ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_URL ||
      process.env.VERCEL_TOKEN ||
      process.env.CRON_SECRET) {
    throw new Error('R5B_LOCAL_DISPOSABLE_DB_GUARD_FAILED');
  }

  const request = require('supertest');
  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  test('R5B LOCAL API: employee license create/read/RBAC/document-review/duplicate/delete with fixture cleanup', async () => {
    const marker = randomUUID();
    const users = [];
    let employeeId;
    let licenseId;
    const number = 'Q13C-LIC-' + marker;
    try {
      const employee = await prisma.employee.create({
        data: { employeeCode: 'Q13C-' + marker.slice(0, 18),
          firstName: 'Synthetic', lastName: 'License',
          department: 'ISOLATED-TEST-ONLY', jobTitle: 'Security Guard', isActive: true }
      });
      employeeId = employee.id;
      const userTokens = {};
      for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
        const user = await prisma.user.create({
          data: { email: role.toLowerCase() + '-' + marker + '@example.invalid',
            passwordHash: 'no-login-in-ephemeral-test',
            displayName: 'Q13C Synthetic ' + role,
            role, accountStatus: 'ACTIVE', isActive: true }
        });
        users.push(user.id);
        userTokens[role] = accessTokenFor(user);
      }
      const send = (role, method, path, data) => {
        let r = request(app)[method.toLowerCase()](path)
          .set('Authorization', 'Bearer ' + userTokens[role]);
        if (data !== undefined) r = r.send(data);
        return r;
      };
      const newLicense = {
        employeeId, licenseType: 'Q13C synthetic license',
        licenseNumber: number, issueDate: '2026-10-01T00:00:00.000Z',
        expiryDate: '2028-10-01T00:00:00.000Z',
        status: 'Active', remark: 'synthetic fixture only'
      };

      assert.equal((await send('MANAGER', 'POST', '/api/v1/licenses', newLicense)).status, 403);
      const created = await send('ADMIN', 'POST', '/api/v1/licenses', newLicense);
      assert.equal(created.status, 201, 'ADMIN create');
      licenseId = created.body?.data?.id;
      assert.ok(licenseId, 'created license id');
      assert.equal(created.body.data.licenseNumber, number);

      const list = '/api/v1/licenses?employeeStatus=ALL&employeeId=' + employeeId + '&pageSize=1000';
      const managerList = await send('MANAGER', 'GET', list);
      assert.equal(managerList.status, 200);
      assert.equal(managerList.body.data.filter(row => row.id === licenseId).length, 1);
      assert.equal((await send('VIEWER', 'GET', list)).status, 403);

      const updated = await send('MANAGER', 'PUT', '/api/v1/licenses/' + licenseId, { remark: 'safe synthetic note' });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.remark, 'safe synthetic note');

      const forbiddenExpiry = await send('MANAGER', 'PUT', '/api/v1/licenses/' + licenseId, {
        expiryDate: '2029-10-01T00:00:00.000Z'
      });
      assert.equal(forbiddenExpiry.status, 409, 'expiry requires document review');
      assert.equal((await send('ADMIN', 'POST', '/api/v1/licenses', newLicense)).status, 409);
      assert.equal((await send('MANAGER', 'DELETE', '/api/v1/licenses/' + licenseId)).status, 403);

      const reloaded = await send('ADMIN', 'GET', list);
      assert.equal(reloaded.status, 200);
      const persisted = reloaded.body.data.find(row => row.id === licenseId);
      assert.equal(persisted.licenseNumber, number);
      assert.equal(persisted.remark, 'safe synthetic note');
      assert.equal(String(persisted.expiryDate).slice(0, 10), '2028-10-01');

      const deleted = await send('ADMIN', 'DELETE', '/api/v1/licenses/' + licenseId);
      assert.equal(deleted.status, 204);
      assert.equal(await prisma.employeeLicense.count({ where: { id: licenseId } }), 0);
      licenseId = undefined;
    } finally {
      // These cleanup operations are strictly confined to the disposable local DB.
      if (licenseId) await prisma.employeeLicense.deleteMany({ where: { id: licenseId } });
      if (users.length) {
        await prisma.auditLog.deleteMany({
          where: { OR: [
            { actorUserId: { in: users } },
            ...(employeeId ? [{ entityType: 'EmployeeLicense', entityId: licenseId || '00000000-0000-4000-8000-000000000000' }] : [])
          ] }
        });
        await prisma.refreshSession.deleteMany({ where: { userId: { in: users } } });
        await prisma.user.deleteMany({ where: { id: { in: users } } });
      }
      if (employeeId) await prisma.employee.deleteMany({ where: { id: employeeId } });
      if (employeeId) assert.equal(await prisma.employee.count({ where: { id: employeeId } }), 0);
      for (const id of users) assert.equal(await prisma.user.count({ where: { id } }), 0);
    }
  });

  test.after(async () => { await prisma.$disconnect(); });
}
