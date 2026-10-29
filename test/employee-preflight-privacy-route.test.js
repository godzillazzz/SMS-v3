'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const requestId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const employee = { id: employeeId, employeeCode: 'E1', firstName: 'Before', lastName: 'Name', displayName: 'Before Name', email: 'private@example.test', phone: 'PHONE-PRIVATE', address: 'HOME-PRIVATE', emergencyContact: 'CONTACT-PRIVATE', emergencyPhone: 'EMERGENCY-PRIVATE', isActive: true, updatedAt: new Date('2026-01-01'), user: null };
const count = { count: async () => 0 };
const prisma = {
  employee: { findFirst: async () => employee },
  employeeLifecycleEvent: { findFirst: async () => ({ sequence: 1, effectiveDate: new Date('2099-01-01') }) },
  employeeChangeRequestEvent: { findUnique: async () => null },
  employeeChangeRequest: { findUnique: async () => ({ employeeId, requestOwnerUserId: actorId, status: 'DRAFT', draftProposal: { firstName: 'After' }, draftEffectiveMode: 'IMMEDIATE', draftReason: 'Reason' }) },
  shiftAssignment: count, leaveRequest: count, leaveQuota: count, employeeLicense: count, employeeLicenseDocument: count, attendanceDeviceEnrollment: count
};
require.cache[require.resolve('../src/config/prisma')] = { exports: prisma };
require.cache[require.resolve('../src/middlewares/authenticate')] = { exports: {
  authenticate: (req, _res, next) => { req.user = { sub: actorId, role: req.headers['x-test-role'] }; next(); },
  authorize: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403)
} };
const changeRoutes = require('../src/routes/employee-change-requests.routes');
const employeeRoutes = require('../src/routes/employees.routes');
const { errorHandler } = require('../src/middlewares/error-handler');

test('blocked master preflight protects management roles and retains admin state', async () => {
  const app = express(); app.use(express.json());
  app.use('/changes', changeRoutes); app.use('/employees', employeeRoutes); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const role of ['MANAGER', 'SUPERVISOR']) {
      const response = await fetch(`${base}/changes/${requestId}/submit`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': role }, body: JSON.stringify({ idempotencyKey: key }) });
      const body = await response.json();
      assert.equal(response.status, 409); assert.equal(body.code, 'EMPLOYEE_CHANGE_PREFLIGHT_BLOCKED');
      assert.equal(body.details.preflight.blockingIssues[0].code, 'LIFECYCLE_EVENT_ORDER_CONFLICT');
      assert.equal(body.details.preflight.currentState.firstName, 'Before');
      assert.equal(body.details.preflight.proposedState.firstName, 'After');
      for (const secret of ['private@example.test', 'PHONE-PRIVATE', 'HOME-PRIVATE', 'CONTACT-PRIVATE', 'EMERGENCY-PRIVATE']) assert.equal(JSON.stringify(body).includes(secret), false, `${role} leaked ${secret}`);
    }
    const response = await fetch(`${base}/employees/${employeeId}/master-edit/preflight`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': 'ADMIN' }, body: JSON.stringify({ changes: { firstName: 'After' }, reason: 'Reason' }) });
    const body = await response.json();
    assert.equal(response.status, 409); assert.equal(body.code, 'EMPLOYEE_CHANGE_PREFLIGHT_BLOCKED');
    assert.equal(body.details.preflight.currentState.address, 'HOME-PRIVATE');
    assert.equal(body.details.preflight.proposedState.emergencyPhone, 'EMERGENCY-PRIVATE');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
