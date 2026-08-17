'use strict';

const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');

const G03_1_MULTI_YEAR_WRITES_ENABLED = 'G03_1_MULTI_YEAR_WRITES_ENABLED';
const G03_1_ROLLOUT_BASE_YEAR = 2026;
const G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED = 'G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED';

function settingValueIsActivated(value) {
  return value === 'true';
}

async function isMultiYearWriteActivated(client = prisma) {
  const setting = await client.systemSetting.findUnique({
    where: { key: G03_1_MULTI_YEAR_WRITES_ENABLED },
    select: { value: true }
  });
  return settingValueIsActivated(setting?.value);
}

async function assertAnnualQuotaCreationAllowed(client, quotaYear) {
  const year = Number(quotaYear);
  if (year === G03_1_ROLLOUT_BASE_YEAR) return { activated: false, baseYearBypass: true };
  const activated = await isMultiYearWriteActivated(client);
  if (activated) return { activated: true, baseYearBypass: false };
  throw new HttpError(409, 'Annual quota creation for this year is not activated.', {
    code: G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED,
    quotaYear: year,
    baseYear: G03_1_ROLLOUT_BASE_YEAR
  });
}

function isReservedOperationalSettingKey(key) {
  return key === G03_1_MULTI_YEAR_WRITES_ENABLED;
}

module.exports = {
  G03_1_MULTI_YEAR_WRITES_ENABLED,
  G03_1_ROLLOUT_BASE_YEAR,
  G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED,
  settingValueIsActivated,
  isMultiYearWriteActivated,
  assertAnnualQuotaCreationAllowed,
  isReservedOperationalSettingKey
};
