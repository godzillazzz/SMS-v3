'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  ATTENDANCE_POLICY_KEYS,
  DEFAULT_ATTENDANCE_POLICY,
  policyFromSettings,
  validateAttendancePolicySetting,
  createAttendancePolicyService
} = require('../src/services/attendance-policy.service');

test('Attendance policy uses safe defaults when SystemSetting rows are absent', () => {
  assert.deepEqual(policyFromSettings([]), DEFAULT_ATTENDANCE_POLICY);
});

test('Attendance policy parses Admin-controlled QR/GPS settings with bounded values', () => {
  const policy = policyFromSettings([
    { key: ATTENDANCE_POLICY_KEYS.qrPolicy, value: 'required' },
    { key: ATTENDANCE_POLICY_KEYS.maxAccuracyMeters, value: '40' },
    { key: ATTENDANCE_POLICY_KEYS.maxAgeSeconds, value: '120' },
    { key: ATTENDANCE_POLICY_KEYS.futureSkewSeconds, value: '20' },
    { key: ATTENDANCE_POLICY_KEYS.autoPassAccuracyMeters, value: '12' },
    { key: ATTENDANCE_POLICY_KEYS.innerMarginMeters, value: '15' },
    { key: ATTENDANCE_POLICY_KEYS.stepUpOnSiteOverlap, value: 'false' }
  ]);
  assert.deepEqual(policy, {
    qrPolicy: 'REQUIRED',
    maxAccuracyMeters: 40,
    maxAgeMs: 120000,
    futureSkewMs: 20000,
    autoPassAccuracyMeters: 12,
    innerMarginMeters: 15,
    stepUpOnSiteOverlap: false
  });
});

test('invalid persisted policy values fail safe to defaults and auto-pass accuracy never exceeds hard GPS accuracy', () => {
  const policy = policyFromSettings([
    { key: ATTENDANCE_POLICY_KEYS.qrPolicy, value: 'BYPASS_SECURITY' },
    { key: ATTENDANCE_POLICY_KEYS.maxAccuracyMeters, value: '10' },
    { key: ATTENDANCE_POLICY_KEYS.autoPassAccuracyMeters, value: '50' },
    { key: ATTENDANCE_POLICY_KEYS.maxAgeSeconds, value: '99999' },
    { key: ATTENDANCE_POLICY_KEYS.stepUpOnSiteOverlap, value: 'maybe' }
  ]);
  assert.equal(policy.qrPolicy, 'ADAPTIVE');
  assert.equal(policy.maxAccuracyMeters, 10);
  assert.equal(policy.autoPassAccuracyMeters, 10);
  assert.equal(policy.maxAgeMs, DEFAULT_ATTENDANCE_POLICY.maxAgeMs);
  assert.equal(policy.stepUpOnSiteOverlap, true);
});

test('Admin setting validator accepts only supported policy values and safety ranges', () => {
  assert.equal(validateAttendancePolicySetting(ATTENDANCE_POLICY_KEYS.qrPolicy, 'adaptive'), 'ADAPTIVE');
  assert.equal(validateAttendancePolicySetting(ATTENDANCE_POLICY_KEYS.stepUpOnSiteOverlap, 'TRUE'), 'true');
  assert.equal(validateAttendancePolicySetting(ATTENDANCE_POLICY_KEYS.maxAccuracyMeters, '35'), '35');
  assert.throws(() => validateAttendancePolicySetting(ATTENDANCE_POLICY_KEYS.qrPolicy, 'ALWAYS_PASS'));
  assert.throws(() => validateAttendancePolicySetting(ATTENDANCE_POLICY_KEYS.maxAccuracyMeters, '500'));
  assert.throws(() => validateAttendancePolicySetting(ATTENDANCE_POLICY_KEYS.innerMarginMeters, '-1'));
  assert.equal(validateAttendancePolicySetting('UNRELATED_SETTING', 'x'), null);
});

test('policy service reads only known Attendance policy keys from SystemSetting', async () => {
  const calls = [];
  const prisma = { systemSetting: { findMany: async (input) => { calls.push(input); return [{ key: ATTENDANCE_POLICY_KEYS.qrPolicy, value: 'DISABLED' }]; } } };
  const policy = await createAttendancePolicyService({ prisma }).getPolicy();
  assert.equal(policy.qrPolicy, 'DISABLED');
  assert.deepEqual(new Set(calls[0].where.key.in), new Set(Object.values(ATTENDANCE_POLICY_KEYS)));
  assert.deepEqual(calls[0].select, { key: true, value: true });
});
test('SystemSetting write route keeps Attendance policy Admin-only under registered typed governance and audit', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'routes', 'operations.routes.js'), 'utf8');
  const registry = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'services', 'system-setting-registry.service.js'), 'utf8');
  assert.ok(source.includes("router.put('/system-settings/:key', authorize('ADMIN')"));
  assert.ok(source.includes('getSystemSettingDefinition(key)'));
  assert.ok(source.includes('normalizeRegisteredSystemSettingValue(key, input.value)'));
  assert.ok(source.includes('SYSTEM_SETTING_NOT_REGISTERED'));
  assert.ok(source.includes('audit.log('));
  assert.ok(registry.includes('validateAttendancePolicySetting(definition.key, value)'));
  assert.ok(registry.includes('ATTENDANCE_POLICY_KEYS.qrPolicy'));
});
