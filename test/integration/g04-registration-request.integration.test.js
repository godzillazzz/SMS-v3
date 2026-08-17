process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('G04 registration integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('G04 integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { createRegistrationRequestService } = require('../../src/services/registration-request.service');

  const ids = {
    admin: '74000000-0000-4000-8000-000000000001',
    manager: '74000000-0000-4000-8000-000000000002',
    viewer: '74000000-0000-4000-8000-000000000003',
    existing: '74000000-0000-4000-8000-000000000004',
    employeeA: '74100000-0000-4000-8000-000000000001',
    employeeB: '74100000-0000-4000-8000-000000000002',
    employeeLinked: '74100000-0000-4000-8000-000000000003'
  };

  async function account(id, role, employeeId = null) {
    return prisma.user.create({ data: {
      id,
      email: `${id.slice(-4)}-${role.toLowerCase()}@g04.test`,
      passwordHash: 'integration-test-only',
      displayName: `G04 ${role}`,
      role,
      employeeId,
      accountStatus: 'ACTIVE',
      isActive: true,
      passwordResetRequired: false,
      department: 'Security'
    } });
  }
  async function tokenFor(id) { return accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id } })); }
  async function employee(id, code, name, department = 'Security') {
    const [firstName, ...rest] = name.split(' ');
    return prisma.employee.create({ data: { id, employeeCode: code, firstName, lastName: rest.join(' ') || 'User', displayName: name, department, jobTitle: 'Security Officer', isActive: true } });
  }
  async function registration(overrides = {}) {
    return prisma.registrationRequest.create({ data: {
      submittedName: 'Candidate Person',
      email: `candidate-${crypto.randomUUID()}@g04.test`,
      passwordHash: 'candidate-password-hash',
      departmentHint: 'Applicant Hint',
      status: 'PENDING',
      emailVerifiedAt: new Date(),
      ...overrides
    } });
  }
  async function cleanup() {
    await prisma.authOtpChallenge.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.registrationRequest.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.employeeLifecycleEvent.deleteMany({});
    await prisma.employeeLicenseDocument.deleteMany({});
    await prisma.employeeLicense.deleteMany({});
    await prisma.shiftAssignment.deleteMany({});
    await prisma.leaveRequest.deleteMany({});
    await prisma.leaveQuota.deleteMany({});
    await prisma.employee.deleteMany({});
  }

  test.beforeEach(async () => {
    await cleanup();
    await employee(ids.employeeA, 'G04-001', 'Candidate Person', 'Master Department');
    await employee(ids.employeeB, 'G04-002', 'Candidate Person Two', 'Other Department');
    await employee(ids.employeeLinked, 'G04-003', 'Already Linked', 'Security');
    await account(ids.admin, 'ADMIN');
    await account(ids.manager, 'MANAGER');
    await account(ids.viewer, 'VIEWER');
    await account(ids.existing, 'VIEWER', ids.employeeLinked);
  });
  test.after(async () => { await cleanup(); await prisma.$disconnect(); });

  test('anonymous and VIEWER cannot access private review/search/match/approve/reject endpoints', async () => {
    const row = await registration();
    const viewerToken = await tokenFor(ids.viewer);
    const paths = [
      ['get', '/api/v1/registration-requests'],
      ['get', `/api/v1/registration-requests/${row.id}/candidates?search=Candidate`],
      ['post', `/api/v1/registration-requests/${row.id}/match`, { employeeId: ids.employeeA }],
      ['post', `/api/v1/registration-requests/${row.id}/approve`, {}],
      ['post', `/api/v1/registration-requests/${row.id}/reject`, { reason: 'not eligible' }]
    ];
    for (const [method, path, body] of paths) {
      assert.equal((await request(app)[method](path).send(body || undefined)).status, 401);
      assert.equal((await request(app)[method](path).set('Authorization', `Bearer ${viewerToken}`).send(body || undefined)).status, 403);
    }
  });

  test('ADMIN and MANAGER can bounded-search only eligible Employee Master candidates', async () => {
    const row = await registration();
    for (const id of [ids.admin, ids.manager]) {
      const response = await request(app).get(`/api/v1/registration-requests/${row.id}/candidates?search=Candidate&pageSize=20`).set('Authorization', `Bearer ${await tokenFor(id)}`);
      assert.equal(response.status, 200);
      assert.ok(response.body.data.length >= 1 && response.body.data.length <= 20);
      assert.ok(response.body.data.every((item) => ['id', 'employeeCode', 'firstName', 'lastName', 'displayName', 'department', 'jobTitle', 'isActive'].every((key) => Object.prototype.hasOwnProperty.call(item, key))));
      assert.equal(response.body.data.some((item) => item.id === ids.employeeLinked), false);
      assert.equal(response.body.meta.departmentHint, 'Applicant Hint');
      if (response.body.data.length > 1) {
        assert.equal(response.body.meta.employeeMatchState, 'MULTIPLE_CANDIDATES');
        const stillPending = await prisma.registrationRequest.findUniqueOrThrow({ where: { id: row.id } });
        assert.equal(stillPending.status, 'PENDING');
        assert.equal(stillPending.matchedEmployeeId, null);
      }
    }
    const none = await request(app).get(`/api/v1/registration-requests/${row.id}/candidates?search=ZZZZ-NOT-FOUND`).set('Authorization', `Bearer ${await tokenFor(ids.manager)}`);
    assert.equal(none.status, 200); assert.equal(none.body.meta.employeeMatchState, 'EMPLOYEE_NOT_FOUND');
    assert.equal((await prisma.registrationRequest.findUniqueOrThrow({ where: { id: row.id } })).status, 'PENDING');
  });

  test('explicit Match is required and never modifies Employee Master', async () => {
    const row = await registration();
    const token = await tokenFor(ids.manager);
    const before = await prisma.employee.findUniqueOrThrow({ where: { id: ids.employeeA } });
    const noMatch = await request(app).post(`/api/v1/registration-requests/${row.id}/approve`).set('Authorization', `Bearer ${token}`).send({});
    assert.equal(noMatch.status, 409); assert.equal(noMatch.body.details?.code, 'REGISTRATION_MATCH_REQUIRED');
    const matched = await request(app).post(`/api/v1/registration-requests/${row.id}/match`).set('Authorization', `Bearer ${token}`).send({ employeeId: ids.employeeA });
    assert.equal(matched.status, 200); assert.equal(matched.body.data.status, 'MATCHED');
    const after = await prisma.employee.findUniqueOrThrow({ where: { id: ids.employeeA } });
    for (const field of ['employeeCode', 'firstName', 'lastName', 'displayName', 'department', 'jobTitle', 'isActive']) assert.deepEqual(after[field], before[field], field);
    assert.equal((await prisma.registrationRequest.findUniqueOrThrow({ where: { id: row.id } })).matchedEmployeeId, ids.employeeA);
  });

  test('MANAGER approval creates exactly one active VIEWER linked to selected Employee and cannot elevate role', async () => {
    const row = await registration({ submittedName: 'Different Applicant Name', departmentHint: 'Wrong Hint' });
    const token = await tokenFor(ids.manager);
    const employeeBefore = await prisma.employee.findUniqueOrThrow({ where: { id: ids.employeeA } });
    const employeeCountBefore = await prisma.employee.count();
    assert.equal((await request(app).post(`/api/v1/registration-requests/${row.id}/match`).set('Authorization', `Bearer ${token}`).send({ employeeId: ids.employeeA })).status, 200);
    const tampered = await request(app).post(`/api/v1/registration-requests/${row.id}/approve`).set('Authorization', `Bearer ${token}`).send({ role: 'ADMIN' });
    assert.equal(tampered.status, 400);
    const approved = await request(app).post(`/api/v1/registration-requests/${row.id}/approve`).set('Authorization', `Bearer ${token}`).send({});
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.user.role, 'VIEWER');
    assert.equal(approved.body.data.user.accountStatus, 'ACTIVE');
    assert.equal(approved.body.data.user.isActive, true);
    assert.equal(approved.body.data.user.employeeId, ids.employeeA);
    assert.equal(approved.body.data.user.displayName, employeeBefore.displayName);
    assert.equal(approved.body.data.user.department, employeeBefore.department);
    assert.equal(await prisma.employee.count(), employeeCountBefore);
    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: ids.employeeA } });
    assert.equal(employeeAfter.displayName, employeeBefore.displayName); assert.equal(employeeAfter.department, employeeBefore.department);
    const requestAfter = await prisma.registrationRequest.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(requestAfter.status, 'APPROVED'); assert.ok(requestAfter.approvedAt); assert.equal(requestAfter.passwordHash, null);
    const approvalAudit = await prisma.auditLog.findMany({ where: { entityType: 'RegistrationRequest', entityId: row.id } });
    assert.equal(approvalAudit.some((event) => event.metadata?.event === 'REGISTRATION_REQUEST_MATCHED'), true);
    assert.equal(approvalAudit.some((event) => event.metadata?.event === 'REGISTRATION_REQUEST_APPROVED' && event.metadata?.assignedRole === 'VIEWER'), true);
  });

  test('ADMIN approval also produces VIEWER and existing users/roles remain unchanged', async () => {
    const row = await registration(); const token = await tokenFor(ids.admin);
    const rolesBefore = await prisma.user.findMany({ select: { id: true, role: true, employeeId: true }, orderBy: { id: 'asc' } });
    const existingSession = await prisma.refreshSession.create({ data: { userId: ids.existing, refreshTokenHash: 'g04-existing-session-hash', tokenVersion: 0, expiresAt: new Date(Date.now() + 3600000) } });
    await request(app).post(`/api/v1/registration-requests/${row.id}/match`).set('Authorization', `Bearer ${token}`).send({ employeeId: ids.employeeB });
    const approved = await request(app).post(`/api/v1/registration-requests/${row.id}/approve`).set('Authorization', `Bearer ${token}`).send({});
    assert.equal(approved.status, 200); assert.equal(approved.body.data.user.role, 'VIEWER');
    const existingAfter = await prisma.user.findMany({ where: { id: { in: rolesBefore.map((row) => row.id) } }, select: { id: true, role: true, employeeId: true }, orderBy: { id: 'asc' } });
    assert.deepEqual(existingAfter, rolesBefore);
    const sessionAfter = await prisma.refreshSession.findUnique({ where: { id: existingSession.id } });
    assert.ok(sessionAfter); assert.equal(sessionAfter.revokedAt, null);
  });

  test('stale/ineligible/already-linked Employee match or approval fails closed', async () => {
    const token = await tokenFor(ids.admin);
    const linked = await registration();
    const linkedResponse = await request(app).post(`/api/v1/registration-requests/${linked.id}/match`).set('Authorization', `Bearer ${token}`).send({ employeeId: ids.employeeLinked });
    assert.equal(linkedResponse.status, 409); assert.equal(linkedResponse.body.details?.code, 'REGISTRATION_EMPLOYEE_ALREADY_LINKED');

    const stale = await registration({ email: `stale-${crypto.randomUUID()}@g04.test` });
    await request(app).post(`/api/v1/registration-requests/${stale.id}/match`).set('Authorization', `Bearer ${token}`).send({ employeeId: ids.employeeB });
    await prisma.employee.update({ where: { id: ids.employeeB }, data: { isActive: false } });
    const staleApprove = await request(app).post(`/api/v1/registration-requests/${stale.id}/approve`).set('Authorization', `Bearer ${token}`).send({});
    assert.equal(staleApprove.status, 409); assert.equal(staleApprove.body.details?.code, 'REGISTRATION_MATCH_STALE');
  });

  test('double/concurrent approval creates no duplicate User and no partial approval state', async () => {
    const row = await registration();
    const service = createRegistrationRequestService();
    await service.match({ id: row.id, employeeId: ids.employeeA, actorUserId: ids.admin });
    const [a, b] = await Promise.allSettled([
      service.approve({ id: row.id, actorUserId: ids.admin, actorRole: 'ADMIN' }),
      service.approve({ id: row.id, actorUserId: ids.manager, actorRole: 'MANAGER' })
    ]);
    assert.equal([a, b].filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal([a, b].filter((result) => result.status === 'rejected').length, 1);
    assert.equal(await prisma.user.count({ where: { email: row.email } }), 1);
    assert.equal((await prisma.registrationRequest.findUniqueOrThrow({ where: { id: row.id } })).status, 'APPROVED');
  });

  test('reject is audited and creates neither User nor Employee', async () => {
    const row = await registration(); const employeeCount = await prisma.employee.count();
    const response = await request(app).post(`/api/v1/registration-requests/${row.id}/reject`).set('Authorization', `Bearer ${await tokenFor(ids.manager)}`).send({ reason: 'Employee identity could not be confirmed' });
    assert.equal(response.status, 200); assert.equal(response.body.data.status, 'REJECTED');
    assert.equal((await prisma.registrationRequest.findUniqueOrThrow({ where: { id: row.id } })).passwordHash, null);
    assert.equal(await prisma.user.count({ where: { email: row.email } }), 0);
    assert.equal(await prisma.employee.count(), employeeCount);
    const events = await prisma.auditLog.findMany({ where: { entityType: 'RegistrationRequest', entityId: row.id } });
    assert.equal(events.some((event) => event.metadata?.event === 'REGISTRATION_REQUEST_REJECTED'), true);
  });
}
