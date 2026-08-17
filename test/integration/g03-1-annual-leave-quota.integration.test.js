process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('G03.1 annual quota integration suite requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require isolated sms_v3_test database.');
  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { ensureAnnualQuota, bangkokQuotaYear } = require('../../src/services/annual-leave-quota.service');
  const { provisionAnnualLeaveQuotas } = require('../../src/services/annual-leave-quota-cron.service');
  const { classifyG031Data } = require('../../src/services/g03-1-preflight.service');

  const ids = {
    admin: 'a3100000-0000-4000-8000-000000000001',
    manager: 'a3100000-0000-4000-8000-000000000002',
    viewer: 'a3100000-0000-4000-8000-000000000003',
    employeeA: 'b3100000-0000-4000-8000-000000000001',
    employeeB: 'b3100000-0000-4000-8000-000000000002',
    employeeC: 'b3100000-0000-4000-8000-000000000003',
    inactive: 'b3100000-0000-4000-8000-000000000004',
    deleted: 'b3100000-0000-4000-8000-000000000005'
  };
  const employeeIds = [ids.employeeA, ids.employeeB, ids.employeeC, ids.inactive, ids.deleted];
  const userIds = [ids.admin, ids.manager, ids.viewer];
  const fp = (label) => crypto.createHash('sha256').update(`g031:${label}:${crypto.randomUUID()}`).digest('hex');

  async function cleanup() {
    await prisma.leaveAttachment.deleteMany({ where: { leaveRequest: { employeeId: { in: employeeIds } } } });
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.leaveQuota.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { employeeNameSnapshot: { startsWith: 'G031 ' } }] } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityType: 'LeaveQuota', metadata: { path: ['employeeId'], string_contains: 'b3100000' } }] } }).catch(() => undefined);
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  }

  async function seed() {
    await cleanup();
    await prisma.employee.createMany({ data: [
      { id: ids.employeeA, employeeCode: 'G031-A', firstName: 'Alpha', lastName: 'Annual', displayName: 'G031 Alpha Annual', department: 'Security', isActive: true },
      { id: ids.employeeB, employeeCode: 'G031-B', firstName: 'Bravo', lastName: 'Annual', displayName: 'G031 Bravo Annual', department: 'Security', isActive: true },
      { id: ids.employeeC, employeeCode: 'G031-C', firstName: 'Charlie', lastName: 'Annual', displayName: 'G031 Charlie Annual', department: 'Security', isActive: true },
      { id: ids.inactive, employeeCode: 'G031-I', firstName: 'Inactive', lastName: 'Annual', displayName: 'G031 Inactive Annual', department: 'Security', isActive: false },
      { id: ids.deleted, employeeCode: 'G031-X', firstName: 'Deleted', lastName: 'Annual', displayName: 'G031 Deleted Annual', department: 'Security', isActive: true, deletedAt: new Date('2026-08-01T00:00:00Z') }
    ] });
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: 'g031-admin@integration.test', passwordHash: 'unused', displayName: 'G031 Admin', role: 'ADMIN', isActive: true },
      { id: ids.manager, email: 'g031-manager@integration.test', passwordHash: 'unused', displayName: 'G031 Manager', role: 'MANAGER', isActive: true },
      { id: ids.viewer, email: 'g031-viewer@integration.test', passwordHash: 'unused', displayName: 'G031 Viewer', role: 'VIEWER', isActive: true, employeeId: ids.employeeA }
    ] });
    await prisma.shiftType.upsert({ where: { code: 'AL' }, update: {}, create: { code: 'AL', name: 'Annual Leave', startTime: null, endTime: null, hours: 0, color: '#64748B' } });
  }

  async function tokens() {
    return {
      admin: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })),
      manager: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.manager } })),
      viewer: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.viewer } }))
    };
  }

  test('year-aware Admin API permits different years, blocks same year, and preserves RBAC', async () => {
    await seed();
    const t = await tokens();
    const payload = { employeeId: ids.employeeA, quotaYear: 2026, sickLeave: 31, personalLeave: 4, vacationLeave: 9 };
    assert.equal((await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${t.manager}`).send(payload)).status, 403);
    assert.equal((await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${t.viewer}`).send(payload)).status, 403);
    const first = await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${t.admin}`).send(payload);
    assert.equal(first.status, 201);
    assert.equal(first.body.data.quotaYear, 2026);
    assert.equal((await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${t.admin}`).send(payload)).status, 409);
    const second = await request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${t.admin}`).send({ ...payload, quotaYear: 2027, vacationLeave: 10 });
    assert.equal(second.status, 201);
    assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeA } }), 2);
    await cleanup();
  });

  test('Admin can classify a uniquely linked null-year legacy quota without relinking the employee', async () => {
    await seed();
    const t = await tokens();
    const legacy = await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('linked-null-year'), employeeId: ids.employeeA, quotaYear: null, employeeNameSnapshot: 'G031 Alpha Annual', sickLeave: 30, personalLeave: 6, vacationLeave: 10, matchStatus: 'MATCHED' } });
    const response = await request(app).put(`/api/v1/leave-quotas/${legacy.id}/link`).set('Authorization', `Bearer ${t.admin}`).send({ employeeId: ids.employeeA, quotaYear: 2026 });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.employeeId, ids.employeeA);
    assert.equal(response.body.data.quotaYear, 2026);
    const stored = await prisma.leaveQuota.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.deepEqual([Number(stored.sickLeave), Number(stored.personalLeave), Number(stored.vacationLeave)], [30, 6, 10], 'classification must preserve legacy entitlement values');
    await cleanup();
  });

  test('on-demand future-year entitlement is 30/3/6 and existing custom annual row is never overwritten', async () => {
    await seed();
    await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('custom'), employeeId: ids.employeeA, quotaYear: 2026, employeeNameSnapshot: 'G031 Alpha Annual', sickLeave: 30, personalLeave: 3, vacationLeave: 10, matchStatus: 'MATCHED' } });
    const custom = await ensureAnnualQuota({ employeeId: ids.employeeA, quotaYear: 2026 });
    assert.equal(custom.created, false);
    assert.equal(Number(custom.quota.vacationLeave), 10);
    const future = await ensureAnnualQuota({ employeeId: ids.employeeA, quotaYear: 2027 });
    assert.equal(future.created, true);
    assert.deepEqual([Number(future.quota.sickLeave), Number(future.quota.personalLeave), Number(future.quota.vacationLeave)], [30, 3, 6]);
    await assert.rejects(() => ensureAnnualQuota({ employeeId: ids.inactive, quotaYear: 2027 }), (e) => e.statusCode === 404);
    await assert.rejects(() => ensureAnnualQuota({ employeeId: ids.deleted, quotaYear: 2027 }), (e) => e.statusCode === 404);
    await cleanup();
  });

  test('cross-year submission provisions missing 2027 and validates 2026=2 / 2027=5 atomically', async () => {
    await seed();
    const t = await tokens();
    await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('2026'), employeeId: ids.employeeA, quotaYear: 2026, employeeNameSnapshot: 'G031 Alpha Annual', sickLeave: 30, personalLeave: 3, vacationLeave: 2, matchStatus: 'MATCHED' } });
    const created = await request(app).post('/api/v1/leave-requests').set('Authorization', `Bearer ${t.viewer}`).send({ leaveType: 'ลาพักร้อน', startDate: '2026-12-30', endDate: '2027-01-05', substitute: 'Substitute' });
    assert.equal(created.status, 201);
    assert.equal(Number(created.body.data.dayCount), 7);
    const q2027 = await prisma.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId: ids.employeeA, quotaYear: 2027 } } });
    assert.ok(q2027);
    assert.equal(Number(q2027.vacationLeave), 6);
    const approve = await request(app).put(`/api/v1/leave-requests/${created.body.data.id}`).set('Authorization', `Bearer ${t.admin}`).send({ status: 'APPROVED' });
    assert.equal(approve.status, 200);
    const summary2026 = await request(app).get('/api/v1/leave-summary?year=2026').set('Authorization', `Bearer ${t.viewer}`);
    const summary2027 = await request(app).get('/api/v1/leave-summary?year=2027').set('Authorization', `Bearer ${t.viewer}`);
    assert.equal(summary2026.body.data.used.vacationLeave, 2);
    assert.equal(summary2027.body.data.used.vacationLeave, 5);
    await cleanup();
  });

  test('insufficient next-year segment rejects the entire request with structured quota year and no request row', async () => {
    await seed();
    const t = await tokens();
    for (const [year, vacation] of [[2026, 2], [2027, 4]]) await prisma.leaveQuota.create({ data: { sourceFingerprint: fp(String(year)), employeeId: ids.employeeA, quotaYear: year, employeeNameSnapshot: 'G031 Alpha Annual', sickLeave: 30, personalLeave: 3, vacationLeave: vacation, matchStatus: 'MATCHED' } });
    const response = await request(app).post('/api/v1/leave-requests').set('Authorization', `Bearer ${t.viewer}`).send({ leaveType: 'ลาพักร้อน', startDate: '2026-12-30', endDate: '2027-01-05', substitute: 'Substitute' });
    assert.equal(response.status, 400);
    assert.equal(response.body.details?.code, 'LEAVE_QUOTA_INSUFFICIENT');
    assert.equal(response.body.details.quotaYear, 2027);
    assert.equal(await prisma.leaveRequest.count({ where: { employeeId: ids.employeeA } }), 0);
    await cleanup();
  });

  test('retroactive leave uses prior-year entitlement and explicit summary year', async () => {
    await seed();
    const t = await tokens();
    await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('retro'), employeeId: ids.employeeB, quotaYear: 2025, employeeNameSnapshot: 'G031 Bravo Annual', sickLeave: 30, personalLeave: 3, vacationLeave: 6, matchStatus: 'MATCHED' } });
    const created = await request(app).post('/api/v1/leave-requests').set('Authorization', `Bearer ${t.manager}`).send({ employeeId: ids.employeeB, leaveType: 'ลากิจ', startDate: '2025-12-15', endDate: '2025-12-15', substitute: 'Substitute', reason: 'retroactive integration' });
    assert.equal(created.status, 201);
    const approved = await request(app).put(`/api/v1/leave-requests/${created.body.data.id}`).set('Authorization', `Bearer ${t.admin}`).send({ status: 'APPROVED' });
    assert.equal(approved.status, 200);
    const usage = await prisma.leaveRequest.findUnique({ where: { id: created.body.data.id } });
    assert.equal(Number(usage.dayCount), 1);
    const q = await prisma.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId: ids.employeeB, quotaYear: 2025 } } });
    assert.equal(Number(q.personalLeave), 3);
    await cleanup();
  });

  test('simultaneous ensure creates exactly one annual authority and preserves winner', async () => {
    await seed();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => ensureAnnualQuota({ employeeId: ids.employeeC, quotaYear: 2028 })));
    assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeC, quotaYear: 2028 } }), 1);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    const q = await prisma.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId: ids.employeeC, quotaYear: 2028 } } });
    assert.deepEqual([Number(q.sickLeave), Number(q.personalLeave), Number(q.vacationLeave)], [30, 3, 6]);
    await cleanup();
  });

  test('simultaneous approvals cannot overdraw the same annual balance', async () => {
    await seed();
    const t = await tokens();
    await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('race'), employeeId: ids.employeeB, quotaYear: 2026, employeeNameSnapshot: 'G031 Bravo Annual', sickLeave: 30, personalLeave: 3, vacationLeave: 1, matchStatus: 'MATCHED' } });
    const a = await request(app).post('/api/v1/leave-requests').set('Authorization', `Bearer ${t.manager}`).send({ employeeId: ids.employeeB, leaveType: 'ลาพักร้อน', startDate: '2026-10-01', endDate: '2026-10-01', substitute: 'Sub A' });
    const b = await request(app).post('/api/v1/leave-requests').set('Authorization', `Bearer ${t.manager}`).send({ employeeId: ids.employeeB, leaveType: 'ลาพักร้อน', startDate: '2026-10-03', endDate: '2026-10-03', substitute: 'Sub B' });
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    const approvals = await Promise.all([
      request(app).put(`/api/v1/leave-requests/${a.body.data.id}`).set('Authorization', `Bearer ${t.admin}`).send({ status: 'APPROVED' }),
      request(app).put(`/api/v1/leave-requests/${b.body.data.id}`).set('Authorization', `Bearer ${t.admin}`).send({ status: 'APPROVED' })
    ]);
    assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 400]);
    assert.equal(await prisma.leaveRequest.count({ where: { employeeId: ids.employeeB, status: 'APPROVED' } }), 1);
    await cleanup();
  });

  test('cron endpoint is secret-protected, idempotent, skips inactive/deleted, and preserves custom quota', async () => {
    await seed();
    process.env.CRON_SECRET = 'g031-local-cron-secret';
    await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('custom-cron'), employeeId: ids.employeeA, quotaYear: 2026, employeeNameSnapshot: 'G031 Alpha Annual', sickLeave: 30, personalLeave: 3, vacationLeave: 10, matchStatus: 'MATCHED' } });
    assert.equal((await request(app).get('/api/v1/internal/annual-leave-quota-provisioning')).status, 401);
    assert.equal((await request(app).get('/api/v1/internal/annual-leave-quota-provisioning').set('Authorization', 'Bearer wrong')).status, 401);
    const first = await request(app).get('/api/v1/internal/annual-leave-quota-provisioning').set('Authorization', 'Bearer g031-local-cron-secret');
    assert.equal(first.status, 200);
    assert.equal(first.body.data.quotaYear, 2026);
    assert.equal(Object.keys(first.body.data).some((k) => /name|email|department|code/i.test(k)), false);
    const second = await request(app).get('/api/v1/internal/annual-leave-quota-provisioning').set('Authorization', 'Bearer g031-local-cron-secret');
    assert.equal(second.status, 200);
    const custom = await prisma.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId: ids.employeeA, quotaYear: 2026 } } });
    assert.equal(Number(custom.vacationLeave), 10);
    assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.inactive, quotaYear: 2026 } }), 0);
    assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.deleted, quotaYear: 2026 } }), 0);
    await cleanup();
  });

  test('Admin create vs ensure, Cron vs ensure, and different-year races keep one authority per employee/year', async () => {
    await seed();
    const t = await tokens();
    const [adminRace, ensureRace] = await Promise.allSettled([
      request(app).post('/api/v1/leave-quotas').set('Authorization', `Bearer ${t.admin}`).send({ employeeId: ids.employeeC, quotaYear: 2029, sickLeave: 30, personalLeave: 3, vacationLeave: 8 }),
      ensureAnnualQuota({ employeeId: ids.employeeC, quotaYear: 2029 })
    ]);
    assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeC, quotaYear: 2029 } }), 1);
    assert.ok(adminRace.status === 'fulfilled' && ensureRace.status === 'fulfilled');
    const authority = await prisma.leaveQuota.findUnique({ where: { employeeId_quotaYear: { employeeId: ids.employeeC, quotaYear: 2029 } } });
    assert.ok([6, 8].includes(Number(authority.vacationLeave)));

    await Promise.all([
      provisionAnnualLeaveQuotas({ prismaClient: prisma, now: new Date('2030-01-01T00:00:00+07:00'), batchSize: 2 }),
      ensureAnnualQuota({ employeeId: ids.employeeC, quotaYear: 2030 })
    ]);
    assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeC, quotaYear: 2030 } }), 1);

    await Promise.all([
      ensureAnnualQuota({ employeeId: ids.employeeC, quotaYear: 2031 }),
      ensureAnnualQuota({ employeeId: ids.employeeC, quotaYear: 2032 })
    ]);
    assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employeeC, quotaYear: { in: [2031, 2032] } } }), 2);
    await cleanup();
  });

  test('cross-year approval row locks use deterministic year ordering and prevent multi-year overdraw without deadlock', async () => {
    await seed();
    const t = await tokens();
    for (const year of [2026, 2027]) await prisma.leaveQuota.create({ data: { sourceFingerprint: fp(`lock-${year}`), employeeId: ids.employeeB, quotaYear: year, employeeNameSnapshot: 'G031 Bravo Annual', sickLeave: 30, personalLeave: 3, vacationLeave: 1, matchStatus: 'MATCHED' } });
    const pending = [];
    for (const [label, startDate, endDate] of [['a','2026-12-31','2027-01-01'], ['b','2026-12-30','2027-01-01']]) {
      pending.push(await prisma.leaveRequest.create({ data: { sourceFingerprint: fp(`cross-lock-${label}`), employeeId: ids.employeeB, requestedAt: new Date(), employeeNameSnapshot: 'G031 Bravo Annual', departmentSnapshot: 'Security', leaveType: 'VACATION', startDate: new Date(`${startDate}T00:00:00Z`), endDate: new Date(`${endDate}T00:00:00Z`), dayCount: label === 'a' ? 2 : 3, status: 'PENDING', createdByUserId: ids.manager } }));
    }
    const approvals = await Promise.all([
      request(app).put(`/api/v1/leave-requests/${pending[0].id}`).set('Authorization', `Bearer ${t.admin}`).send({ status: 'APPROVED' }),
      request(app).put(`/api/v1/leave-requests/${pending[1].id}`).set('Authorization', `Bearer ${t.admin}`).send({ status: 'APPROVED' })
    ]);
    assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 400]);
    assert.equal(await prisma.leaveRequest.count({ where: { id: { in: pending.map((row) => row.id) }, status: 'APPROVED' } }), 1);
    await cleanup();
  });

  test('Report Center leave quota KPI is scoped to the current Bangkok annual year', async () => {
    await seed();
    const t = await tokens();
    const currentYear = bangkokQuotaYear(new Date());
    await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('report-current'), employeeId: ids.employeeA, quotaYear: currentYear, employeeNameSnapshot: 'G031 Alpha Annual', sickLeave: 30, personalLeave: 3, vacationLeave: 6, matchStatus: 'MATCHED' } });
    await prisma.leaveQuota.create({ data: { sourceFingerprint: fp('report-history'), employeeId: ids.employeeA, quotaYear: currentYear - 1, employeeNameSnapshot: 'G031 Alpha Annual', sickLeave: 30, personalLeave: 9, vacationLeave: 12, matchStatus: 'MATCHED' } });
    const expected = await prisma.leaveQuota.count({ where: { quotaYear: currentYear } });
    const response = await request(app).get('/api/v1/reports/summary').set('Authorization', `Bearer ${t.admin}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.leaveQuotas, expected);
    assert.notEqual(response.body.data.leaveQuotas, await prisma.leaveQuota.count(), 'historical annual rows must not inflate current-year quota KPI');
    await cleanup();
  });

  test('read-only preflight classifier reports safe and remediation fixtures without mutation', async () => {
    await seed();
    const before = { quotas: await prisma.leaveQuota.count(), leaves: await prisma.leaveRequest.count(), audits: await prisma.auditLog.count() };
    const safe = await classifyG031Data(prisma);
    assert.equal(safe.classification, 'SAFE_FOR_G03_1_CUTOVER');
    const afterSafe = { quotas: await prisma.leaveQuota.count(), leaves: await prisma.leaveRequest.count(), audits: await prisma.auditLog.count() };
    assert.deepEqual(afterSafe, before);
    await prisma.leaveRequest.create({ data: { sourceFingerprint: fp('ambiguous'), employeeId: ids.employeeA, requestedAt: new Date(), employeeNameSnapshot: 'G031 Alpha Annual', departmentSnapshot: 'Security', leaveType: 'VACATION', startDate: new Date('2026-12-30T00:00:00Z'), endDate: new Date('2027-01-05T00:00:00Z'), dayCount: 5, status: 'APPROVED' } });
    const beforeRemediation = { quotas: await prisma.leaveQuota.count(), leaves: await prisma.leaveRequest.count(), audits: await prisma.auditLog.count() };
    const remediation = await classifyG031Data(prisma);
    assert.equal(remediation.classification, 'G03_1_DATA_INVARIANT_REQUIRES_REMEDIATION');
    assert.equal(remediation.metrics.ambiguousLegacyCrossYearRequests, 1);
    const afterRemediation = { quotas: await prisma.leaveQuota.count(), leaves: await prisma.leaveRequest.count(), audits: await prisma.auditLog.count() };
    assert.deepEqual(afterRemediation, beforeRemediation);
    await cleanup();
  });

  test.after(async () => { await cleanup(); await prisma.$disconnect(); });
}
