'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFINITIONS,
  getSystemSettingDefinition,
  isSensitiveSystemSettingKey,
  normalizeRegisteredSystemSettingValue,
  presentSystemSettings
} = require('../src/services/system-setting-registry.service');
const { ATTENDANCE_POLICY_KEYS } = require('../src/services/attendance-policy.service');
const { G03_1_MULTI_YEAR_WRITES_ENABLED } = require('../src/services/g03-1-multi-year-activation.service');

test('CFG-01 registry has unique governed keys and no secret-bearing setting definitions', () => {
  assert.equal(DEFINITIONS.length, 15);
  assert.equal(new Set(DEFINITIONS.map((definition) => definition.key)).size, DEFINITIONS.length);
  assert.equal(DEFINITIONS.every((definition) => definition.editable === true), true);
  assert.equal(DEFINITIONS.every((definition) => definition.authority === 'ADMIN_GOVERNED'), true);
  for (const definition of DEFINITIONS) {
    assert.equal(isSensitiveSystemSettingKey(definition.key), false, definition.key);
    assert.ok(['ATTENDANCE', 'LEAVE', 'NOTIFICATIONS'].includes(definition.group), definition.key);
  }
});

test('CFG-01 normalizes only registered typed values and rejects arbitrary keys', () => {
  assert.equal(normalizeRegisteredSystemSettingValue(ATTENDANCE_POLICY_KEYS.qrPolicy, 'required'), 'REQUIRED');
  assert.equal(normalizeRegisteredSystemSettingValue(ATTENDANCE_POLICY_KEYS.maxAccuracyMeters, '35'), '35');
  assert.equal(normalizeRegisteredSystemSettingValue(ATTENDANCE_POLICY_KEYS.stepUpOnSiteOverlap, 'TRUE'), 'true');
  assert.equal(normalizeRegisteredSystemSettingValue('LINE_TEMPLATE_NEW_LEAVE', 'Hello {Name}'), 'Hello {Name}');
  assert.throws(() => normalizeRegisteredSystemSettingValue(ATTENDANCE_POLICY_KEYS.maxAccuracyMeters, '500'), /between 5 and 100/);
  assert.throws(
    () => normalizeRegisteredSystemSettingValue('UNREGISTERED_SAFE_LOOKING_KEY', 'x'),
    (error) => error.code === 'SYSTEM_SETTING_NOT_REGISTERED'
  );
  assert.throws(
    () => normalizeRegisteredSystemSettingValue('LINE_TEMPLATE_NEW_LEAVE', 'x'.repeat(2001)),
    (error) => error.code === 'SYSTEM_SETTING_VALUE_INVALID'
  );
});

test('CFG-01 presentation includes absent registered keys and preserves legacy/protected rows as read-only', () => {
  const rows = presentSystemSettings([
    { key: ATTENDANCE_POLICY_KEYS.qrPolicy, value: 'ADAPTIVE', description: 'old description', updatedAt: new Date('2026-08-31T00:00:00Z') },
    { key: 'LEGACY_UI_LABEL', value: 'Legacy', description: 'legacy row', updatedAt: new Date('2026-08-31T00:00:00Z') },
    { key: 'LEGACY_ACCESS_TOKEN', value: 'must-not-leak', description: 'secret-like legacy row', updatedAt: new Date('2026-08-31T00:00:00Z') },
    { key: G03_1_MULTI_YEAR_WRITES_ENABLED, value: 'false', description: 'protected rollout', updatedAt: new Date('2026-08-31T00:00:00Z') }
  ]);

  const registered = rows.find((row) => row.key === ATTENDANCE_POLICY_KEYS.qrPolicy);
  assert.equal(registered.registryStatus, 'REGISTERED');
  assert.equal(registered.editable, true);
  assert.equal(registered.configured, true);
  assert.equal(registered.description, getSystemSettingDefinition(ATTENDANCE_POLICY_KEYS.qrPolicy).description);

  const absentRegistered = rows.find((row) => row.key === ATTENDANCE_POLICY_KEYS.maxAgeSeconds);
  assert.equal(absentRegistered.registryStatus, 'REGISTERED');
  assert.equal(absentRegistered.configured, false);
  assert.equal(absentRegistered.value, undefined);

  const legacy = rows.find((row) => row.key === 'LEGACY_UI_LABEL');
  assert.equal(legacy.registryStatus, 'UNREGISTERED');
  assert.equal(legacy.editable, false);
  assert.equal(legacy.authority, 'LEGACY_READ_ONLY');
  assert.equal(legacy.value, 'Legacy');

  const sensitive = rows.find((row) => row.key === 'LEGACY_ACCESS_TOKEN');
  assert.equal(sensitive.editable, false);
  assert.equal(sensitive.authority, 'ENVIRONMENT_ONLY');
  assert.equal(sensitive.value, undefined);
  assert.equal(sensitive.configured, true);

  const protectedRow = rows.find((row) => row.key === G03_1_MULTI_YEAR_WRITES_ENABLED);
  assert.equal(protectedRow.registryStatus, 'PROTECTED');
  assert.equal(protectedRow.editable, false);
  assert.equal(protectedRow.authority, 'PROTECTED_RELEASE_OPERATION');
});

test('CFG-01 route uses registered governance before SystemSetting upsert and never accepts arbitrary non-secret keys', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'operations.routes.js'), 'utf8');
  const put = source.indexOf("router.put('/system-settings/:key'");
  const reserved = source.indexOf('isReservedOperationalSettingKey(key)', put);
  const sensitive = source.indexOf('isSensitiveSystemSettingKey(key)', put);
  const definition = source.indexOf('getSystemSettingDefinition(key)', put);
  const registeredReject = source.indexOf('SYSTEM_SETTING_NOT_REGISTERED', put);
  const normalize = source.indexOf('normalizeRegisteredSystemSettingValue(key, input.value)', put);
  const upsert = source.indexOf('tx.systemSetting.upsert', put);
  assert.ok(put >= 0 && reserved > put && sensitive > reserved && definition > sensitive && registeredReject > definition && normalize > registeredReject && upsert > normalize);
  assert.match(source, /description: definition\.description/);
  assert.match(source, /group: definition\.group/);
  assert.match(source, /valueType: definition\.valueType/);
  assert.match(source, /res\.set\('Cache-Control', 'no-store'\)/);
  assert.doesNotMatch(source.slice(put, source.indexOf("router.get('/leave-requests/pending-count'", put)), /update:\s*normalizedInput/);
});
