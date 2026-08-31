const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ALL_SETTING_KEYS,
  REQUEST_TYPE_DEFINITIONS,
  createApprovalPolicyService,
  defaultPolicyFor,
  normalizePolicyInput,
  policyKey,
  policySettingDefinitions,
  positionClass
} = require('../src/services/approval-policy.service');

function rowsFromDefaults(overrides = {}) {
  const rows = [];
  for (const definition of REQUEST_TYPE_DEFINITIONS) {
    const policy = defaultPolicyFor(definition);
    const values = {
      REVIEWER_ROLES: JSON.stringify(overrides[definition.type]?.reviewerRoles || policy.reviewerRoles),
      DUE_SOON_HOURS: String(overrides[definition.type]?.dueSoonHours || policy.dueSoonHours),
      OVERDUE_HOURS: String(overrides[definition.type]?.overdueHours || policy.overdueHours)
    };
    if (definition.supportsPositionAliases) {
      values.ADDITIONAL_SUPERVISOR_ALIASES = JSON.stringify(overrides[definition.type]?.additionalSupervisorAliases || []);
      values.ADDITIONAL_MANAGER_ALIASES = JSON.stringify(overrides[definition.type]?.additionalManagerAliases || []);
    }
    for (const [suffix, value] of Object.entries(values)) rows.push({ key: policyKey(definition.type, suffix), value });
  }
  return rows;
}

test('CFG-06 defines every current Approval Center request type with Admin preserved as mandatory reviewer', () => {
  assert.equal(REQUEST_TYPE_DEFINITIONS.length, 8);
  for (const definition of REQUEST_TYPE_DEFINITIONS) {
    assert.equal(definition.safeReviewerRoles.includes('ADMIN'), true, definition.type);
    const policy = defaultPolicyFor(definition);
    assert.equal(policy.reviewerRoles.includes('ADMIN'), true, definition.type);
    assert.equal(policy.dueSoonHours, 24);
    assert.equal(policy.overdueHours, 48);
  }
  assert.equal(ALL_SETTING_KEYS.length, 26);
});

test('CFG-06 security ceiling cannot grant Manager to an Admin-only workflow or remove Admin', () => {
  assert.throws(
    () => normalizePolicyInput('LICENSE_DOCUMENT', { reviewerRoles: ['ADMIN', 'MANAGER'], dueSoonHours: 12, overdueHours: 36 }),
    (error) => error.details?.code === 'APPROVAL_POLICY_ROLE_EXCEEDS_SECURITY_CEILING'
  );
  assert.throws(
    () => normalizePolicyInput('LEAVE_REQUEST', { reviewerRoles: ['MANAGER'], dueSoonHours: 12, overdueHours: 36 }),
    (error) => error.details?.code === 'APPROVAL_POLICY_ADMIN_REQUIRED'
  );
});

test('CFG-06 validates whole SLA policy atomically and requires overdue after due-soon', () => {
  assert.throws(
    () => normalizePolicyInput('REGISTRATION_REQUEST', { reviewerRoles: ['ADMIN'], dueSoonHours: 48, overdueHours: 48 }),
    (error) => error.details?.code === 'APPROVAL_POLICY_SLA_ORDER_INVALID'
  );
  assert.throws(
    () => normalizePolicyInput('REGISTRATION_REQUEST', { reviewerRoles: ['ADMIN'], dueSoonHours: 0, overdueHours: 48 }),
    (error) => error.details?.code === 'APPROVAL_POLICY_DUE_SOON_INVALID'
  );
});

test('CFG-06 leave position aliases are additive and never remove protected core classifications', () => {
  const policy = normalizePolicyInput('LEAVE_REQUEST', {
    reviewerRoles: ['ADMIN', 'MANAGER'],
    dueSoonHours: 12,
    overdueHours: 36,
    additionalSupervisorAliases: ['หัวหน้าชุด'],
    additionalManagerAliases: ['section lead']
  });
  assert.equal(positionClass('Security Supervisor', policy), 'SUPERVISOR');
  assert.equal(positionClass('หัวหน้าชุด ปฏิบัติการ', policy), 'SUPERVISOR');
  assert.equal(positionClass('Section Lead North', policy), 'MANAGER');
  assert.equal(positionClass('Guard', policy), 'GENERAL');
});

test('CFG-06 policy master fails closed when its governed seed is incomplete', async () => {
  const service = createApprovalPolicyService({
    prismaClient: { systemSetting: { findMany: async () => rowsFromDefaults().slice(1) } },
    auditService: { log: async () => {} }
  });
  await assert.rejects(
    () => service.list(),
    (error) => error.statusCode === 503 && error.details?.code === 'APPROVAL_POLICY_INCOMPLETE'
  );
});

test('CFG-06 persisted invalid policy values fail closed as service unavailable', async () => {
  const rows = rowsFromDefaults();
  const bad = rows.map((row) => row.key === policyKey('REGISTRATION_REQUEST', 'OVERDUE_HOURS') ? { ...row, value: '1' } : row);
  const service = createApprovalPolicyService({
    prismaClient: { systemSetting: { findMany: async () => bad } },
    auditService: { log: async () => {} }
  });
  await assert.rejects(
    () => service.getPolicy('REGISTRATION_REQUEST'),
    (error) => error.statusCode === 503 && error.details?.code === 'APPROVAL_POLICY_INVALID'
  );
});

test('CFG-06 update is atomic, audited, and preserves protected role ceiling', async () => {
  const rows = rowsFromDefaults();
  const store = new Map(rows.map((row) => [row.key, { ...row }]));
  let auditEvent;
  const tx = {
    systemSetting: {
      findMany: async ({ where }) => where.key.in.map((key) => store.get(key)).filter(Boolean),
      upsert: async ({ where, update, create }) => {
        const previous = store.get(where.key);
        const row = previous ? { ...previous, ...update } : create;
        store.set(where.key, row);
        return row;
      }
    }
  };
  const prismaClient = {
    systemSetting: tx.systemSetting,
    $transaction: async (fn) => fn(tx)
  };
  const service = createApprovalPolicyService({
    prismaClient,
    auditService: { log: async (event) => { auditEvent = event; } }
  });

  const updated = await service.update({
    requestType: 'LEAVE_REQUEST',
    input: {
      reviewerRoles: ['ADMIN'],
      dueSoonHours: 8,
      overdueHours: 20,
      additionalSupervisorAliases: ['หัวหน้าชุด'],
      additionalManagerAliases: []
    },
    actor: { role: 'ADMIN', sub: 'admin-1' }
  });

  assert.deepEqual(updated.reviewerRoles, ['ADMIN']);
  assert.equal(updated.dueSoonHours, 8);
  assert.equal(updated.overdueHours, 20);
  assert.deepEqual(updated.additionalSupervisorAliases, ['หัวหน้าชุด']);
  assert.equal(auditEvent.entityType, 'ApprovalAuthorityPolicy');
  assert.equal(auditEvent.entityId, 'LEAVE_REQUEST');
  assert.deepEqual(auditEvent.metadata.before.reviewerRoles, ['ADMIN', 'MANAGER']);
  assert.deepEqual(auditEvent.metadata.after.reviewerRoles, ['ADMIN']);
});

test('CFG-06 migration seeds only governed approval policy defaults and is non-destructive', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '202608310004_cfg06_approval_authority_policy', 'migration.sql'), 'utf8');
  assert.equal((sql.match(/^INSERT INTO /gmi) || []).length, 1);
  assert.match(sql, /ON CONFLICT \("key"\) DO NOTHING/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|ALTER|DROP|DELETE|TRUNCATE)\b/i);
  assert.equal((sql.match(/APPROVAL_POLICY\.[A-Z_]+\.(?:REVIEWER_ROLES|DUE_SOON_HOURS|OVERDUE_HOURS|ADDITIONAL_SUPERVISOR_ALIASES|ADDITIONAL_MANAGER_ALIASES)/g) || []).length, 26);
});

test('CFG-06 registry exposes policy keys as registered but not editable one key at a time', () => {
  const definitions = policySettingDefinitions();
  assert.equal(definitions.length, 26);
  assert.equal(definitions.every((row) => row.group === 'APPROVAL'), true);
  assert.equal(definitions.every((row) => row.editable === false), true);
  assert.equal(definitions.every((row) => row.authority === 'ADMIN_GOVERNED_VIA_APPROVAL_POLICY_API'), true);
});
