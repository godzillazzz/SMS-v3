'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LEAVE_POLICY_KEYS,
  DEFAULT_LEAVE_POLICY,
  policyFromSettings,
  validateLeavePolicySetting,
  isRetroactiveLeaveStart,
  retroactiveDaysBack,
  defaultEntitlementFromPolicy,
  createLeavePolicyService
} = require('../src/services/leave-policy.service');
const { DEFINITIONS, getSystemSettingDefinition } = require('../src/services/system-setting-registry.service');

test('CFG-02 defaults preserve current leave behavior', () => {
  assert.deepEqual(DEFAULT_LEAVE_POLICY, {
    defaultSickDays: 30,
    defaultPersonalDays: 3,
    defaultVacationDays: 6,
    sickAttachmentRequiredAfterDays: 3,
    managerRetroactiveOnBehalfEnabled: true,
    managerRetroactiveMaxDaysBack: 0
  });
  assert.deepEqual(defaultEntitlementFromPolicy(DEFAULT_LEAVE_POLICY), {
    sickLeave: 30,
    personalLeave: 3,
    vacationLeave: 6
  });
});

test('CFG-02 parses governed leave policy and fails safe for invalid persisted values', () => {
  const policy = policyFromSettings([
    { key: LEAVE_POLICY_KEYS.defaultSickDays, value: '31' },
    { key: LEAVE_POLICY_KEYS.defaultPersonalDays, value: '4' },
    { key: LEAVE_POLICY_KEYS.defaultVacationDays, value: '7' },
    { key: LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays, value: '2' },
    { key: LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled, value: 'false' },
    { key: LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack, value: '14' }
  ]);
  assert.deepEqual(policy, {
    defaultSickDays: 31,
    defaultPersonalDays: 4,
    defaultVacationDays: 7,
    sickAttachmentRequiredAfterDays: 2,
    managerRetroactiveOnBehalfEnabled: false,
    managerRetroactiveMaxDaysBack: 14
  });

  assert.deepEqual(policyFromSettings([
    { key: LEAVE_POLICY_KEYS.defaultSickDays, value: '-1' },
    { key: LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays, value: '500' },
    { key: LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled, value: 'maybe' },
    { key: LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack, value: '-3' }
  ]), DEFAULT_LEAVE_POLICY);
});

test('CFG-02 validators enforce numeric bounds and strict booleans', () => {
  assert.equal(validateLeavePolicySetting(LEAVE_POLICY_KEYS.defaultSickDays, '45'), '45');
  assert.equal(validateLeavePolicySetting(LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays, '0'), '0');
  assert.equal(validateLeavePolicySetting(LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack, '3650'), '3650');
  assert.equal(validateLeavePolicySetting(LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled, 'TRUE'), 'true');

  assert.throws(() => validateLeavePolicySetting(LEAVE_POLICY_KEYS.defaultVacationDays, '1000'), /between 0 and 999/);
  assert.throws(() => validateLeavePolicySetting(LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays, '31'), /between 0 and 30/);
  assert.throws(() => validateLeavePolicySetting(LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack, '3651'), /between 0 and 3650/);
  assert.throws(() => validateLeavePolicySetting(LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled, 'yes'), /true or false/);
  assert.equal(validateLeavePolicySetting('UNRELATED_SETTING', 'x'), null);
});

test('CFG-02 Bangkok retroactive calculation uses date-only authority and stable lookback days', () => {
  const now = new Date('2026-08-31T05:31:00+07:00');
  assert.equal(isRetroactiveLeaveStart('2026-08-30', now), true);
  assert.equal(isRetroactiveLeaveStart('2026-08-31', now), false);
  assert.equal(isRetroactiveLeaveStart('2026-09-01', now), false);
  assert.equal(retroactiveDaysBack('2026-08-30', now), 1);
  assert.equal(retroactiveDaysBack('2026-08-01', now), 30);
  assert.equal(retroactiveDaysBack('2026-09-01', now), 0);
});

test('CFG-02 service reads only registered leave policy keys', async () => {
  const calls = [];
  const prisma = {
    systemSetting: {
      findMany: async (input) => {
        calls.push(input);
        return [{ key: LEAVE_POLICY_KEYS.defaultVacationDays, value: '8' }];
      }
    }
  };
  const policy = await createLeavePolicyService({ prisma }).getPolicy();
  assert.equal(policy.defaultVacationDays, 8);
  assert.deepEqual(new Set(calls[0].where.key.in), new Set(Object.values(LEAVE_POLICY_KEYS)));
  assert.deepEqual(calls[0].select, { key: true, value: true });
});

test('CFG-02 registry exposes exactly six Leave Policy keys with typed governance', () => {
  const leaveDefinitions = DEFINITIONS.filter((definition) => definition.group === 'LEAVE');
  assert.equal(leaveDefinitions.length, 6);
  assert.deepEqual(new Set(leaveDefinitions.map((definition) => definition.key)), new Set(Object.values(LEAVE_POLICY_KEYS)));
  for (const key of Object.values(LEAVE_POLICY_KEYS)) {
    const definition = getSystemSettingDefinition(key);
    assert.equal(definition.editable, true);
    assert.equal(definition.authority, 'ADMIN_GOVERNED');
    assert.ok(['NUMBER', 'BOOLEAN'].includes(definition.valueType));
  }
});

test('CFG-02 route applies one policy snapshot to retroactive, quota and attachment decisions while retaining hard invariants', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'operations.routes.js'), 'utf8');
  assert.match(source, /leave_policy_lookup/);
  assert.match(source, /assertRetroactiveLeaveEntryAllowed/);
  assert.match(source, /managerRetroactiveOnBehalfEnabled/);
  assert.match(source, /managerRetroactiveMaxDaysBack/);
  assert.match(source, /sickAttachmentRequiredAfterDays/);
  assert.match(source, /leavePolicySnapshot/);
  assert.match(source, /พนักงานทั่วไปไม่สามารถบันทึกการลาย้อนหลังได้/);
  assert.match(source, /ผู้จัดการไม่สามารถบันทึกการลาย้อนหลังให้ตนเองได้/);
  assert.match(source, /ต้องระบุเหตุผลในการบันทึกการลาย้อนหลัง/);
  assert.match(source, /LEAVE_OWNER_SELF_APPROVAL_NOT_ALLOWED/);
  assert.doesNotMatch(source, /leaveType === 'SICK' && dayCount > 3/);
  assert.match(source, /router\.get\('\/leave-policy'/);
  assert.match(source, /viewerRetroactiveAllowed: false/);
  assert.match(source, /managerSelfRetroactiveAllowed: false/);
  assert.match(source, /selfApprovalAllowed: false/);
});
