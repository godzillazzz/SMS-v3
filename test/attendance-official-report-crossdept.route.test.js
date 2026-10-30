'use strict';

// OWNER policy 2026-10-30 ("แบบ ค", SENTINEL SNT-XD-L2): a department is only a place of work and every
// MANAGER/SUPERVISOR supervises all VIEWERs. The official Attendance report (Certified Snapshot) is therefore
// readable by ADMIN, MANAGER and SUPERVISOR across every department. VIEWER stays denied and every other
// governance route (preview, certifications, report.xlsx, certify, unlock) stays ADMIN-only.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:***@localhost:5432/smsv3_test';
process.env.JWT_SECRET = 'official-report-crossdept-test-secret-minimum-length';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const env = require('../src/config/env');
const { snapshotDigest } = require('../src/services/attendance-month-governance.service');

const ids = {
  admin: 'd0000000-0000-4000-8000-000000000001',
  manager: 'd0000000-0000-4000-8000-000000000002',
  supervisor: 'd0000000-0000-4000-8000-000000000003',
  viewer: 'd0000000-0000-4000-8000-000000000004'
};
const roleById = new Map(Object.entries({
  [ids.admin]: 'ADMIN',
  [ids.manager]: 'MANAGER',
  [ids.supervisor]: 'SUPERVISOR',
  [ids.viewer]: 'VIEWER'
}));
const snapshot = {
  version: 'ATTENDANCE_MONTH_OFFICIAL_V1',
  month: '2026-08',
  generatedAt: '2026-09-01T02:00:00.000Z',
  summary: { assignments: 3, complete: 2, absent: 1 },
  rows: [
    { assignmentId: 'a1', employeeId: 'employee-a', employeeName: 'A One', department: 'SECURITY-A', workDate: '2026-08-01', status: 'COMPLETE', flags: ['LATE'] },
    { assignmentId: 'a2', employeeId: 'employee-b', employeeName: 'A Two', department: 'SECURITY-A', workDate: '2026-08-02', status: 'COMPLETE', flags: ['ON_TIME'] },
    { assignmentId: 'b1', employeeId: 'employee-c', employeeName: 'B One', department: 'SECURITY-B', workDate: '2026-08-03', status: 'ABSENT', flags: ['ABSENT'] }
  ]
};
// Supervisor deliberately has no department: it must still receive the all-department report.
const departmentById = { [ids.admin]: null, [ids.manager]: 'SECURITY-A', [ids.supervisor]: null, [ids.viewer]: 'SECURITY-A' };
const prisma = new Proxy({
  user: {
    findUnique: async ({ where }) => {
      const role = roleById.get(where.id);
      if (!role) return null;
      const department = departmentById[where.id];
      return {
        id: where.id,
        email: `${role.toLowerCase()}@example.test`,
        displayName: role,
        role,
        department,
        employeeId: null,
        employee: null,
        isActive: true,
        accountStatus: 'ACTIVE',
        passwordResetRequired: false,
        tokenVersion: 0
      };
    }
  },
  employeeLifecycleEvent: { findMany: async () => [] },
  $queryRaw: async () => [{
    id: '11111111-2222-4333-8444-555555555555', month: new Date('2026-08-01T00:00:00.000Z'), revision: 1,
    status: 'CERTIFIED', summarySnapshot: snapshot, summaryDigest: snapshotDigest(snapshot), certifiedByUserId: ids.admin, certifiedAt: new Date('2026-09-01T02:00:00.000Z')
  }]
}, {
  get(target, property) {
    if (property in target) return target[property];
    if (property === 'then') return undefined;
    throw new Error(`Unexpected Prisma access: ${String(property)}`);
  }
});
const prismaPath = Module._resolveFilename('../src/config/prisma', module);
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: prisma,
  children: [],
  paths: Module._nodeModulePaths(path.dirname(prismaPath))
};

const { router } = require('../src/routes/attendance-governance.routes');
const { errorHandler } = require('../src/middlewares/error-handler');
// attendanceApiEnabled() is evaluated per request; enable the route family only after env validation loaded.
process.env.VERCEL_ENV = 'preview';
process.env.ATTENDANCE_API_PREVIEW_ENABLED = 'true';
const app = express();
app.use(express.json());
app.use('/api/v1/attendance/governance', router);
app.use(errorHandler);

function auth(userId, claims = {}) {
  return `Bearer ${jwt.sign({ sub: userId, tokenVersion: 0, ...claims }, env.jwtSecret, {
    algorithm: env.jwtAlgorithm,
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    expiresIn: '5m'
  })}`;
}
const reportPath = '/api/v1/attendance/governance/months/2026-08/report';

test('official report: ADMIN, MANAGER and SUPERVISOR (even without a department) get 200 with every department', async () => {
  for (const [role, userId] of [['ADMIN', ids.admin], ['MANAGER', ids.manager], ['SUPERVISOR', ids.supervisor]]) {
    const response = await request(app).get(reportPath).set('Authorization', auth(userId));
    assert.equal(response.status, 200, `${role}: ${JSON.stringify(response.body)}`);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body.data.scope, { department: null }, `${role} scope`);
    assert.deepEqual(response.body.data.rows.map((row) => row.department), ['SECURITY-A', 'SECURITY-A', 'SECURITY-B'], `${role} rows`);
    assert.equal(response.body.data.summary.assignments, 3);
  }
});

test('official report: VIEWER 403, no token 401, forged role claim cannot lift a VIEWER account', async () => {
  assert.equal((await request(app).get(reportPath).set('Authorization', auth(ids.viewer))).status, 403);
  assert.equal((await request(app).get(reportPath)).status, 401);
  // authenticate takes the role from the account, never from the token claim.
  assert.equal((await request(app).get(reportPath).set('Authorization', auth(ids.viewer, { role: 'MANAGER' }))).status, 403);
  assert.equal((await request(app).get(reportPath).set('Authorization', auth('d0000000-0000-4000-8000-000000000099', { role: 'ADMIN' }))).status, 401);
});

test('other governance routes stay ADMIN-only: MANAGER and SUPERVISOR receive 403', async () => {
  const routes = [
    ['get', '/api/v1/attendance/governance/months/2026-08/preview'],
    ['get', '/api/v1/attendance/governance/months/2026-08/certifications'],
    ['get', '/api/v1/attendance/governance/months/2026-08/report.xlsx'],
    ['post', '/api/v1/attendance/governance/months/2026-08/certify', {}],
    ['post', '/api/v1/attendance/governance/months/2026-08/unlock', { reason: 'not allowed reason' }]
  ];
  for (const userId of [ids.manager, ids.supervisor, ids.viewer]) {
    for (const [method, url, body] of routes) {
      let call = request(app)[method](url).set('Authorization', auth(userId));
      if (body) call = call.send(body);
      const response = await call;
      assert.equal(response.status, 403, `${roleById.get(userId)} ${method.toUpperCase()} ${url}`);
    }
  }
});
