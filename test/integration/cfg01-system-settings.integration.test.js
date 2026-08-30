process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('CFG-01 SystemSetting integration suite requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { ATTENDANCE_POLICY_KEYS } = require('../../src/services/attendance-policy.service');
  const { G03_1_MULTI_YEAR_WRITES_ENABLED } = require('../../src/services/g03-1-multi-year-activation.service');

  const ids = {
    admin: 'a8010000-0000-4000-8000-000000000001',
    manager: 'a8010000-0000-4000-8000-000000000002'
  };
  const settingKeys = [
    ATTENDANCE_POLICY_KEYS.qrPolicy,
    'CFG01_LEGACY_READ_ONLY',
    'CFG01_UNREGISTERED_SAFE_KEY',
    'CFG01_ACCESS_TOKEN',
    G03_1_MULTI_YEAR_WRITES_ENABLED
  ];

  async function cleanup() {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: Object.values(ids) } },
          { entityType: 'SystemSetting', entityId: { in: settingKeys } }
        ]
      }
    });
    await prisma.systemSetting.deleteMany({ where: { key: { in: settingKeys } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  }

  async function seed() {
    await cleanup();
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: 'cfg01-admin@integration.test', passwordHash: 'unused', displayName: 'CFG01 Admin', role: 'ADMIN', isActive: true },
      { id: ids.manager, email: 'cfg01-manager@integration.test', passwordHash: 'unused', displayName: 'CFG01 Manager', role: 'MANAGER', isActive: true }
    ] });
    await prisma.systemSetting.createMany({ data: [
      { key: 'CFG01_LEGACY_READ_ONLY', value: 'legacy-value', description: 'legacy fixture' },
      { key: G03_1_MULTI_YEAR_WRITES_ENABLED, value: 'false', description: 'protected fixture' }
    ] });
  }

  async function tokens() {
    return {
      admin: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })),
      manager: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.manager } }))
    };
  }

  test('CFG-01 Admin reads governed registry while Manager is denied and legacy/protected rows stay read-only', async () => {
    await seed();
    const token = await tokens();

    const denied = await request(app)
      .get('/api/v1/system-settings')
      .set('Authorization', 'Bearer ' + token.manager);
    assert.equal(denied.status, 403);

    const response = await request(app)
      .get('/api/v1/system-settings')
      .set('Authorization', 'Bearer ' + token.admin);
    assert.equal(response.status, 200);
    assert.match(String(response.headers['cache-control']), /no-store/);

    const qr = response.body.data.find((row) => row.key === ATTENDANCE_POLICY_KEYS.qrPolicy);
    assert.equal(qr.registryStatus, 'REGISTERED');
    assert.equal(qr.editable, true);
    assert.equal(qr.configured, false);
    assert.equal(qr.valueType, 'ENUM');

    const legacy = response.body.data.find((row) => row.key === 'CFG01_LEGACY_READ_ONLY');
    assert.equal(legacy.registryStatus, 'UNREGISTERED');
    assert.equal(legacy.editable, false);
    assert.equal(legacy.authority, 'LEGACY_READ_ONLY');

    const protectedRow = response.body.data.find((row) => row.key === G03_1_MULTI_YEAR_WRITES_ENABLED);
    assert.equal(protectedRow.registryStatus, 'PROTECTED');
    assert.equal(protectedRow.editable, false);
    assert.equal(protectedRow.authority, 'PROTECTED_RELEASE_OPERATION');
    await cleanup();
  });

  test('CFG-01 rejects arbitrary and sensitive-looking keys without creating rows', async () => {
    await seed();
    const token = await tokens();

    const arbitrary = await request(app)
      .put('/api/v1/system-settings/CFG01_UNREGISTERED_SAFE_KEY')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ value: 'x', description: 'must not create' });
    assert.equal(arbitrary.status, 403);
    assert.equal(arbitrary.body.details?.code, 'SYSTEM_SETTING_NOT_REGISTERED');

    const sensitive = await request(app)
      .put('/api/v1/system-settings/CFG01_ACCESS_TOKEN')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ value: 'secret', description: 'must not create' });
    assert.equal(sensitive.status, 400);
    assert.equal(sensitive.body.details?.code, 'SENSITIVE_SETTING_ENVIRONMENT_ONLY');

    assert.equal(
      await prisma.systemSetting.count({
        where: { key: { in: ['CFG01_UNREGISTERED_SAFE_KEY', 'CFG01_ACCESS_TOKEN'] } }
      }),
      0
    );
    await cleanup();
  });

  test('CFG-01 registered update normalizes value, uses canonical description and emits governed audit metadata', async () => {
    await seed();
    const token = await tokens();

    const response = await request(app)
      .put('/api/v1/system-settings/' + ATTENDANCE_POLICY_KEYS.qrPolicy)
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ value: 'required', description: 'client must not control canonical description' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.value, 'REQUIRED');
    assert.equal(response.body.data.registryStatus, 'REGISTERED');
    assert.equal(response.body.data.group, 'ATTENDANCE');

    const stored = await prisma.systemSetting.findUniqueOrThrow({ where: { key: ATTENDANCE_POLICY_KEYS.qrPolicy } });
    assert.equal(stored.value, 'REQUIRED');
    assert.equal(stored.description, 'Attendance QR policy: ADAPTIVE / REQUIRED / DISABLED');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: ids.admin, entityType: 'SystemSetting', entityId: ATTENDANCE_POLICY_KEYS.qrPolicy },
      orderBy: { createdAt: 'desc' }
    });
    assert.equal(audit.metadata.key, ATTENDANCE_POLICY_KEYS.qrPolicy);
    assert.equal(audit.metadata.group, 'ATTENDANCE');
    assert.equal(audit.metadata.valueType, 'ENUM');
    assert.equal(audit.metadata.beforeConfigured, false);
    assert.equal(audit.metadata.afterConfigured, true);
    assert.equal(audit.metadata.valueChanged, true);
    assert.equal(JSON.stringify(audit.metadata).includes('required'), false);
    await cleanup();
  });
}
