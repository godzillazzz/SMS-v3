process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('leave quota provisioning integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { provisionLeaveQuota } = require('../../src/services/leave-quota-provisioning.service');
  const { linkLeaveQuota } = require('../../src/services/leave-quota-link.service');

  const ids = {
    admin: '93000000-0000-4000-8000-000000000001',
    manager: '93000000-0000-4000-8000-000000000002',
    viewer: '93000000-0000-4000-8000-000000000003',
    employeeA: '94000000-0000-4000-8000-000000000001',
    employeeB: '94000000-0000-4000-8000-000000000002',
    employeeC: '94000000-0000-4000-8000-000000000003',
    employeeD: '94000000-0000-4000-8000-000000000004',
    employeeE: '94000000-0000-4000-8000-000000000005',
    employeeF: '94000000-0000-4000-8000-000000000006',
    employeeG: '94000000-0000-4000-8000-000000000007',
    employeeH: '94000000-0000-4000-8000-000000000008',
    inactive: '94000000-0000-4000-8000-000000000009',
    deleted: '94000000-0000-4000-8000-000000000010',
    zero: '94000000-0000-4000-8000-000000000011'
  };
  const employeeIds = Object.entries(ids).filter(([key]) => key.startsWith('employee') || ['inactive', 'deleted', 'zero'].includes(key)).map(([, value]) => value);
  const userIds = [ids.admin, ids.manager, ids.viewer];
  const fp = (label) => crypto.createHash('sha256').update(`g03-integration:${label}`).digest('hex');

  async function cleanup() {
    await prisma.leaveAttachment.deleteMany({ where: { leaveRequest: { employeeId: { in: employeeIds } } } });
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.leaveQuota.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { employeeNameSnapshot: { startsWith: 'G03 ' } }] } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  }

  async function seed() {
    await cleanup();
    const employeeData = [
      [ids.employeeA, 'G03-A', 'Alpha', 'Guard', true, null],
      [ids.employeeB, 'G03-B', 'Bravo', 'Guard', true, null],
      [ids.employeeC, 'G03-C', 'Charlie', 'Guard', true, null],
      [ids.employeeD, 'G03-D', 'Delta', 'Guard', true, null],
      [ids.employeeE, 'G03-E', 'Echo', 'Guard', true, null],
      [ids.employeeF, 'G03-F', 'Foxtrot', 'Guard', true, null],
      [ids.employeeG, 'G03-G', 'Golf', 'Guard', true, null],
      [ids.employeeH, 'G03-H', 'Hotel', 'Guard', true, null],
      [ids.inactive, 'G03-I', 'Inactive', 'Guard', false, null],
      [ids.deleted, 'G03-X', 'Deleted', 'Guard', true, new Date('2026-08-01T00:00:00.000Z')],
      [ids.zero, 'G03-Z', 'Zero', 'Guard', true, null]
    ].map(([id, employeeCode, firstName, lastName, isActive, deletedAt]) => ({ id, employeeCode, firstName, lastName, displayName: `G03 ${firstName} ${lastName}`, department: 'Security', isActive, deletedAt }));
    await prisma.employee.createMany({ data: employeeData });
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: 'g03-admin@integration.test', passwordHash: 'unused', displayName: 'G03 Admin', role: 'ADMIN', isActive: true },
      { id: ids.manager, email: 'g03-manager@integration.test', passwordHash: 'unused', displayName: 'G03 Manager', role: 'MANAGER', isActive: true },
      { id: ids.viewer, email: 'g03-viewer@integration.test', passwordHash: 'unused', displayName: 'G03 Viewer', role: 'VIEWER', isActive: true, employeeId: ids.employeeA }
    ] });
  }

  async function tokenFor(id) {
    return accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id } }));
  }

  test('mounted Admin provisioning closes the fallback gap while RBAC and validation fail closed', async () => {
    await seed();
    const admin = await tokenFor(ids.admin);
    const manager = await tokenFor(ids.manager);
    const viewer = await tokenFor(ids.viewer);
    try {
      const fallback = await request(app).get('/api/v1/leave-summary').set('Authorization', `Bearer ${viewer}`);
      assert.equal(fallback.status, 200);
      assert.deepEqual(fallback.body.data.entitlement, { sickLeave: 30, personalLeave: 6, vacationLeave: 10 });
      assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeA } }), 0, 'fallback must stay virtual');

      const payload = { employeeId: ids.employeeA, sickLeave: 12, personalLeave: 4, vacationLeave: 8 };
      assert.equal((await request(app).post('/api/v1/leave-quotas').send(payload)).status, 401);
      assert.equal((await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${manager}`).send(payload)).status, 403);
      assert.equal((await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${viewer}`).send(payload)).status, 403);

      const protectedOverride = await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${admin}`).send({ ...payload, matchStatus: 'UNMATCHED', employeeNameSnapshot: 'Client Override', sourceFingerprint: 'x'.repeat(64) });
      assert.equal(protectedOverride.status, 400);
      assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeA } }), 0);

      for (const bad of [
        { employeeId: ids.employeeA, sickLeave: -1, personalLeave: 4, vacationLeave: 8 },
        { employeeId: ids.employeeA, sickLeave: 1000, personalLeave: 4, vacationLeave: 8 },
        { employeeId: ids.employeeA, sickLeave: null, personalLeave: 4, vacationLeave: 8 },
        { employeeId: ids.employeeA, sickLeave: true, personalLeave: 4, vacationLeave: 8 },
        { employeeId: ids.employeeA, sickLeave: 12, personalLeave: 4 }
      ]) assert.equal((await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${admin}`).send(bad)).status, 400);

      const unknown = await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${admin}`).send({ ...payload, employeeId: '94000000-0000-4000-8000-000000000099' });
      assert.equal(unknown.status, 404);
      assert.equal((await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${admin}`).send({ ...payload, employeeId: ids.inactive })).status, 404);
      assert.equal((await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${admin}`).send({ ...payload, employeeId: ids.deleted })).status, 404);

      const zero = await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${admin}`).send({ employeeId: ids.zero, sickLeave: 0, personalLeave: 0, vacationLeave: 0 });
      assert.equal(zero.status, 201);

      const created = await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${admin}`).send(payload);
      assert.equal(created.status, 201);
      assert.deepEqual({ sickLeave: created.body.data.sickLeave, personalLeave: created.body.data.personalLeave, vacationLeave: created.body.data.vacationLeave, matchStatus: created.body.data.matchStatus }, { sickLeave: 12, personalLeave: 4, vacationLeave: 8, matchStatus: 'MATCHED' });
      assert.equal(created.body.data.employeeNameSnapshot, 'G03 Alpha Guard');
      assert.equal(created.body.data.sourceFingerprint, undefined);
      const stored = await prisma.leaveQuota.findUniqueOrThrow({ where: { id: created.body.data.id } });
      assert.match(stored.sourceFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(stored.employeeNameSnapshot, 'G03 Alpha Guard');
      const auditRow = await prisma.auditLog.findFirst({ where: { actorUserId: ids.admin, entityType: 'LeaveQuota', entityId: stored.id, action: 'CREATE' } });
      assert.ok(auditRow);
      assert.equal(auditRow.metadata.matchStatus, 'MATCHED');

      const duplicate = await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${admin}`).send(payload);
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.details.code, 'LEAVE_QUOTA_ALREADY_EXISTS');

      const explicit = await request(app).get('/api/v1/leave-summary').set('Authorization', `Bearer ${viewer}`);
      assert.equal(explicit.status, 200);
      assert.deepEqual(explicit.body.data.entitlement, { sickLeave: 12, personalLeave: 4, vacationLeave: 8 });

      const overQuota = await request(app).post('/api/v1/leave-requests').set('Authorization', `Bearer ${viewer}`).send({ leaveType: 'ลาพักร้อน', startDate: '2027-02-01', endDate: '2027-02-09', substitute: 'Integration Substitute' });
      assert.equal(overQuota.status, 400);
      assert.match(overQuota.body.error, /Insufficient leave quota/);

      const pending = await request(app).post('/api/v1/leave-requests').set('Authorization', `Bearer ${viewer}`).send({ leaveType: 'ลาพักร้อน', startDate: '2027-03-01', endDate: '2027-03-01', substitute: 'Integration Substitute' });
      assert.equal(pending.status, 201);
      await prisma.leaveRequest.create({ data: { sourceFingerprint: fp('approved-usage'), employeeId: ids.employeeA, requestedAt: new Date('2027-01-01T00:00:00Z'), employeeNameSnapshot: 'G03 Alpha Guard', departmentSnapshot: 'Security', leaveType: 'VACATION', startDate: new Date('2027-01-01T00:00:00Z'), endDate: new Date('2027-01-08T00:00:00Z'), dayCount: 8, status: 'APPROVED' } });
      const approval = await request(app).put(`/api/v1/leave-requests/${pending.body.data.id}`).set('Authorization', `Bearer ${admin}`).send({ status: 'APPROVED' });
      assert.equal(approval.status, 400);
      assert.match(approval.body.error, /Insufficient leave quota/);
    } finally { await cleanup(); }
  });

  test('Serializable create/create allows exactly one authoritative quota', async () => {
    await seed();
    try {
      const actor = { sub: ids.admin, role: 'ADMIN' };
      const attempts = await Promise.allSettled([
        provisionLeaveQuota({ actor, employeeId: ids.employeeB, sickLeave: 30, personalLeave: 6, vacationLeave: 10 }),
        provisionLeaveQuota({ actor, employeeId: ids.employeeB, sickLeave: 20, personalLeave: 5, vacationLeave: 9 })
      ]);
      assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
      const rejected = attempts.find((item) => item.status === 'rejected');
      assert.equal(rejected.reason.statusCode, 409);
      assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeB } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { actorUserId: ids.admin, entityType: 'LeaveQuota', action: 'CREATE' } }), 1);
    } finally { await cleanup(); }
  });

  test('Serializable create/link allows exactly one linked quota and preserves the legacy row contract', async () => {
    await seed();
    try {
      const legacy = await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('create-link-legacy'), employeeId: null, employeeNameSnapshot: 'G03 Legacy Create Link', sickLeave: 7, personalLeave: 3, vacationLeave: 5, matchStatus: 'UNMATCHED' } });
      const actor = { sub: ids.admin, role: 'ADMIN' };
      const attempts = await Promise.allSettled([
        provisionLeaveQuota({ actor, employeeId: ids.employeeC, sickLeave: 30, personalLeave: 6, vacationLeave: 10 }),
        linkLeaveQuota({ quotaId: legacy.id, employeeId: ids.employeeC, actorUserId: ids.admin })
      ]);
      assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
      const rejected = attempts.find((item) => item.status === 'rejected');
      assert.equal(rejected.reason.statusCode, 409);
      assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeC } }), 1);
      assert.equal(await prisma.leaveQuota.count({ where: { id: legacy.id } }), 1, 'legacy row must not be deleted or merged');
    } finally { await cleanup(); }
  });

  test('audit failure rolls back the real PostgreSQL quota transaction', async () => {
    await seed();
    try {
      const auditService = { log: async () => { throw new Error('INJECTED_AUDIT_FAILURE'); } };
      await assert.rejects(() => provisionLeaveQuota({ actor: { sub: ids.admin, role: 'ADMIN' }, employeeId: ids.employeeD, sickLeave: 12, personalLeave: 4, vacationLeave: 8, auditService }), /INJECTED_AUDIT_FAILURE/);
      assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeD } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { actorUserId: ids.admin, entityType: 'LeaveQuota' } }), 0);
    } finally { await cleanup(); }
  });

  test('legacy unmatched states are never auto-linked, DUPLICATE_MATCHED blocks create, and manual link still works', async () => {
    await seed();
    try {
      const unmatched = await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('unmatched'), employeeId: null, employeeNameSnapshot: 'G03 Legacy Unmatched', sickLeave: 1, personalLeave: 1, vacationLeave: 1, matchStatus: 'UNMATCHED' } });
      const duplicateUnmatched = await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('duplicate-unmatched'), employeeId: null, employeeNameSnapshot: 'G03 Legacy Duplicate', sickLeave: 2, personalLeave: 2, vacationLeave: 2, matchStatus: 'DUPLICATE_UNMATCHED' } });
      await provisionLeaveQuota({ actor: { sub: ids.admin, role: 'ADMIN' }, employeeId: ids.employeeE, sickLeave: 12, personalLeave: 4, vacationLeave: 8 });
      assert.equal((await prisma.leaveQuota.findUniqueOrThrow({ where: { id: unmatched.id } })).employeeId, null);
      assert.equal((await prisma.leaveQuota.findUniqueOrThrow({ where: { id: duplicateUnmatched.id } })).employeeId, null);

      const linked = await linkLeaveQuota({ quotaId: unmatched.id, employeeId: ids.employeeF, actorUserId: ids.admin });
      assert.equal(linked.employeeId, ids.employeeF);
      assert.equal(linked.matchStatus, 'MATCHED');

      const duplicateMatched = await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('duplicate-matched'), employeeId: ids.employeeG, employeeNameSnapshot: 'G03 Duplicate Matched', sickLeave: 3, personalLeave: 3, vacationLeave: 3, matchStatus: 'DUPLICATE_MATCHED' } });
      await assert.rejects(() => provisionLeaveQuota({ actor: { sub: ids.admin, role: 'ADMIN' }, employeeId: ids.employeeG, sickLeave: 30, personalLeave: 6, vacationLeave: 10 }), (error) => error.statusCode === 409 && error.details?.code === 'LEAVE_QUOTA_ALREADY_EXISTS');
      assert.deepEqual(await prisma.leaveQuota.findUnique({ where: { id: duplicateMatched.id }, select: { sickLeave: true, personalLeave: true, vacationLeave: true, matchStatus: true } }), { sickLeave: duplicateMatched.sickLeave, personalLeave: duplicateMatched.personalLeave, vacationLeave: duplicateMatched.vacationLeave, matchStatus: 'DUPLICATE_MATCHED' });
    } finally { await cleanup(); }
  });

  test.after(async () => { await cleanup(); await prisma.$disconnect(); });
}
