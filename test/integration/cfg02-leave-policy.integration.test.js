process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('CFG-02 Leave Policy integration suite requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { LEAVE_POLICY_KEYS } = require('../../src/services/leave-policy.service');
  const { ensureAnnualQuota } = require('../../src/services/annual-leave-quota.service');

  const ids = {
    admin: 'a8020000-0000-4000-8000-000000000001',
    manager: 'a8020000-0000-4000-8000-000000000002',
    viewer: 'a8020000-0000-4000-8000-000000000003',
    managerEmployee: 'b8020000-0000-4000-8000-000000000001',
    viewerEmployee: 'b8020000-0000-4000-8000-000000000002',
    targetEmployee: 'b8020000-0000-4000-8000-000000000003',
    autoPolicyEmployee: 'b8020000-0000-4000-8000-000000000004'
  };
  const userIds = [ids.admin, ids.manager, ids.viewer];
  const employeeIds = [ids.managerEmployee, ids.viewerEmployee, ids.targetEmployee, ids.autoPolicyEmployee];
  const policyKeys = Object.values(LEAVE_POLICY_KEYS);

  function bangkokDateOffset(days) {
    const now = new Date();
    const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const utcDate = new Date(Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth(), bangkok.getUTCDate() + days));
    return utcDate.toISOString().slice(0, 10);
  }

  function yearOf(dateText) {
    return Number(String(dateText).slice(0, 4));
  }

  const pastDate = bangkokDateOffset(-10);
  const futureStart = bangkokDateOffset(10);
  const futureEnd = bangkokDateOffset(11);
  const relevantYears = [...new Set([yearOf(pastDate), yearOf(futureStart), yearOf(futureEnd), 2026])];

  function fp(label) {
    return crypto.createHash('sha256').update('cfg02:' + label + ':' + crypto.randomUUID()).digest('hex');
  }

  async function cleanup() {
    const quotaIds = (await prisma.leaveQuota.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { id: true }
    })).map((row) => row.id);

    await prisma.leaveAttachment.deleteMany({ where: { leaveRequest: { employeeId: { in: employeeIds } } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          ...(quotaIds.length ? [{ entityType: 'LeaveQuota', entityId: { in: quotaIds } }] : [])
        ]
      }
    });
    await prisma.leaveQuota.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: policyKeys } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  }

  async function seed() {
    await cleanup();
    await prisma.employee.createMany({ data: [
      { id: ids.managerEmployee, employeeCode: 'CFG02-M', firstName: 'Manager', lastName: 'Policy', displayName: 'CFG02 Manager', department: 'Security', jobTitle: 'Manager', isActive: true },
      { id: ids.viewerEmployee, employeeCode: 'CFG02-V', firstName: 'Viewer', lastName: 'Policy', displayName: 'CFG02 Viewer', department: 'Security', jobTitle: 'Officer', isActive: true },
      { id: ids.targetEmployee, employeeCode: 'CFG02-T', firstName: 'Target', lastName: 'Policy', displayName: 'CFG02 Target', department: 'Security', jobTitle: 'Officer', isActive: true },
      { id: ids.autoPolicyEmployee, employeeCode: 'CFG02-A', firstName: 'Auto', lastName: 'Policy', displayName: 'CFG02 Auto', department: 'Security', jobTitle: 'Officer', isActive: true }
    ] });

    await prisma.user.createMany({ data: [
      { id: ids.admin, email: 'cfg02-admin@integration.test', passwordHash: 'unused', displayName: 'CFG02 Admin', role: 'ADMIN', isActive: true },
      { id: ids.manager, email: 'cfg02-manager@integration.test', passwordHash: 'unused', displayName: 'CFG02 Manager User', role: 'MANAGER', isActive: true, employeeId: ids.managerEmployee },
      { id: ids.viewer, email: 'cfg02-viewer@integration.test', passwordHash: 'unused', displayName: 'CFG02 Viewer User', role: 'VIEWER', isActive: true, employeeId: ids.viewerEmployee }
    ] });

    const quotaRows = [];
    for (const employeeId of [ids.managerEmployee, ids.viewerEmployee, ids.targetEmployee]) {
      for (const quotaYear of relevantYears) {
        quotaRows.push({
          sourceFingerprint: fp(employeeId + ':' + quotaYear),
          employeeId,
          quotaYear,
          employeeNameSnapshot: 'CFG02 Fixture',
          sickLeave: 30,
          personalLeave: 3,
          vacationLeave: 6,
          matchStatus: 'MATCHED'
        });
      }
    }
    await prisma.leaveQuota.createMany({ data: quotaRows, skipDuplicates: true });
  }

  async function tokens() {
    return {
      admin: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })),
      manager: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.manager } })),
      viewer: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.viewer } }))
    };
  }

  async function setPolicy(key, value) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: String(value), description: 'CFG-02 integration fixture' },
      create: { key, value: String(value), description: 'CFG-02 integration fixture' }
    });
  }

  test('CFG-02 governed setting write changes resolved read-only Leave Policy without weakening invariants', async () => {
    await seed();
    const token = await tokens();

    const update = await request(app)
      .put('/api/v1/system-settings/' + LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays)
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ value: '2' });
    assert.equal(update.status, 200);
    assert.equal(update.body.data.value, '2');
    assert.equal(update.body.data.group, 'LEAVE');

    const response = await request(app)
      .get('/api/v1/leave-policy')
      .set('Authorization', 'Bearer ' + token.manager);
    assert.equal(response.status, 200);
    assert.match(String(response.headers['cache-control']), /no-store/);
    assert.equal(response.body.data.sickAttachmentRequiredAfterDays, 2);
    assert.equal(response.body.data.defaultSickDays, 30);
    assert.deepEqual(response.body.meta.invariants, {
      viewerRetroactiveAllowed: false,
      managerSelfRetroactiveAllowed: false,
      retroactiveReasonRequired: true,
      selfApprovalAllowed: false
    });
    await cleanup();
  });

  test('CFG-02 can disable Manager retroactive on-behalf entry without creating leave evidence', async () => {
    await seed();
    const token = await tokens();
    await setPolicy(LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled, 'false');

    const response = await request(app)
      .post('/api/v1/leave-requests')
      .set('Authorization', 'Bearer ' + token.manager)
      .send({
        employeeId: ids.targetEmployee,
        leaveType: 'ลากิจ',
        startDate: pastDate,
        endDate: pastDate,
        substitute: 'CFG02 Substitute',
        reason: 'retroactive policy test'
      });
    assert.equal(response.status, 403);
    assert.equal(response.body.details?.code, 'LEAVE_MANAGER_RETROACTIVE_DISABLED');
    assert.equal(await prisma.leaveRequest.count({ where: { employeeId: ids.targetEmployee } }), 0);
    await cleanup();
  });

  test('CFG-02 Manager lookback limit is enforced while Viewer and Manager-self hard guards remain non-configurable', async () => {
    await seed();
    const token = await tokens();
    await setPolicy(LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled, 'true');
    await setPolicy(LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack, '3');

    const tooOld = await request(app)
      .post('/api/v1/leave-requests')
      .set('Authorization', 'Bearer ' + token.manager)
      .send({
        employeeId: ids.targetEmployee,
        leaveType: 'ลากิจ',
        startDate: pastDate,
        endDate: pastDate,
        substitute: 'CFG02 Substitute',
        reason: 'lookback limit'
      });
    assert.equal(tooOld.status, 400);
    assert.equal(tooOld.body.details?.code, 'LEAVE_MANAGER_RETROACTIVE_LIMIT_EXCEEDED');

    await setPolicy(LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack, '0');

    const managerSelf = await request(app)
      .post('/api/v1/leave-requests')
      .set('Authorization', 'Bearer ' + token.manager)
      .send({
        employeeId: ids.managerEmployee,
        leaveType: 'ลากิจ',
        startDate: pastDate,
        endDate: pastDate,
        substitute: 'CFG02 Substitute',
        reason: 'self must remain blocked'
      });
    assert.equal(managerSelf.status, 400);
    assert.equal(managerSelf.body.details?.code, 'LEAVE_MANAGER_RETROACTIVE_SELF_NOT_ALLOWED');

    const viewer = await request(app)
      .post('/api/v1/leave-requests')
      .set('Authorization', 'Bearer ' + token.viewer)
      .send({
        leaveType: 'ลากิจ',
        startDate: pastDate,
        endDate: pastDate,
        substitute: 'CFG02 Substitute',
        reason: 'viewer must remain blocked'
      });
    assert.equal(viewer.status, 400);
    assert.equal(viewer.body.details?.code, 'LEAVE_RETROACTIVE_NOT_ALLOWED');
    await cleanup();
  });

  test('CFG-02 configured sick attachment threshold is authoritative for new requests', async () => {
    await seed();
    const token = await tokens();
    await setPolicy(LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays, '1');

    const response = await request(app)
      .post('/api/v1/leave-requests')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({
        employeeId: ids.targetEmployee,
        leaveType: 'ลาป่วย',
        startDate: futureStart,
        endDate: futureEnd,
        substitute: 'CFG02 Substitute',
        reason: 'two day sick leave'
      });
    assert.equal(response.status, 400);
    assert.equal(response.body.details?.code, 'LEAVE_SICK_ATTACHMENT_REQUIRED');
    assert.equal(response.body.details?.thresholdDays, 1);
    assert.equal(await prisma.leaveRequest.count({ where: { employeeId: ids.targetEmployee } }), 0);
    await cleanup();
  });

  test('CFG-02 configured annual defaults affect only newly provisioned quota and never rewrite existing quota', async () => {
    await seed();

    await setPolicy(LEAVE_POLICY_KEYS.defaultSickDays, '31');
    await setPolicy(LEAVE_POLICY_KEYS.defaultPersonalDays, '4');
    await setPolicy(LEAVE_POLICY_KEYS.defaultVacationDays, '7');

    const first = await ensureAnnualQuota({
      employeeId: ids.autoPolicyEmployee,
      quotaYear: 2026,
      prismaClient: prisma
    });
    assert.equal(first.created, true);
    assert.deepEqual(
      [Number(first.quota.sickLeave), Number(first.quota.personalLeave), Number(first.quota.vacationLeave)],
      [31, 4, 7]
    );

    await setPolicy(LEAVE_POLICY_KEYS.defaultSickDays, '40');
    await setPolicy(LEAVE_POLICY_KEYS.defaultPersonalDays, '5');
    await setPolicy(LEAVE_POLICY_KEYS.defaultVacationDays, '8');

    const second = await ensureAnnualQuota({
      employeeId: ids.autoPolicyEmployee,
      quotaYear: 2026,
      prismaClient: prisma
    });
    assert.equal(second.created, false);
    assert.deepEqual(
      [Number(second.quota.sickLeave), Number(second.quota.personalLeave), Number(second.quota.vacationLeave)],
      [31, 4, 7],
      'later policy changes must not rewrite the historical annual quota row'
    );

    const createAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'LeaveQuota', entityId: first.quota.id, action: 'CREATE' },
      orderBy: { createdAt: 'desc' }
    });
    assert.deepEqual(createAudit.metadata.entitlement, { sickLeave: 31, personalLeave: 4, vacationLeave: 7 });
    await cleanup();
  });
}
