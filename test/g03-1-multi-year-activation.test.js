process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  G03_1_MULTI_YEAR_WRITES_ENABLED,
  G03_1_ROLLOUT_BASE_YEAR,
  G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED,
  settingValueIsActivated,
  isMultiYearWriteActivated,
  assertAnnualQuotaCreationAllowed,
  isReservedOperationalSettingKey
} = require('../src/services/g03-1-multi-year-activation.service');

const clientFor = (value, exists = true) => ({
  systemSetting: {
    findUnique: async ({ where }) => {
      assert.equal(where.key, G03_1_MULTI_YEAR_WRITES_ENABLED);
      return exists ? { value } : null;
    }
  }
});

test('activation setting is strict, persistent-read based, and missing/malformed values fail closed', async () => {
  assert.equal(G03_1_ROLLOUT_BASE_YEAR, 2026);
  assert.equal(settingValueIsActivated('true'), true);
  for (const value of ['false', 'TRUE', '1', 'yes', '', ' true ', undefined, null]) assert.equal(settingValueIsActivated(value), false);
  assert.equal(await isMultiYearWriteActivated(clientFor(undefined, false)), false);
  assert.equal(await isMultiYearWriteActivated(clientFor('false')), false);
  assert.equal(await isMultiYearWriteActivated(clientFor('garbage')), false);
  assert.equal(await isMultiYearWriteActivated(clientFor('true')), true);
});

test('base-year creation is allowed without consulting activation state', async () => {
  let reads = 0;
  const client = { systemSetting: { findUnique: async () => { reads += 1; throw new Error('must-not-read'); } } };
  const result = await assertAnnualQuotaCreationAllowed(client, 2026);
  assert.equal(result.baseYearBypass, true);
  assert.equal(reads, 0);
});

test('missing non-base authority is blocked while inactive with safe structured conflict', async () => {
  await assert.rejects(
    () => assertAnnualQuotaCreationAllowed(clientFor(undefined, false), 2027),
    (error) => error.statusCode === 409
      && error.details?.code === G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED
      && error.details?.quotaYear === 2027
      && error.details?.baseYear === 2026
  );
  await assert.rejects(
    () => assertAnnualQuotaCreationAllowed(clientFor('false'), 2025),
    (error) => error.details?.code === G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED && error.details?.quotaYear === 2025
  );
});

test('activation true restores non-base annual creation eligibility and key is reserved operationally', async () => {
  const result = await assertAnnualQuotaCreationAllowed(clientFor('true'), 2027);
  assert.equal(result.activated, true);
  assert.equal(isReservedOperationalSettingKey(G03_1_MULTI_YEAR_WRITES_ENABLED), true);
  assert.equal(isReservedOperationalSettingKey('LINE_TEMPLATE_NEW_LEAVE'), false);
});
