'use strict';

const prismaDefault = require('../config/prisma');

const LEAVE_POLICY_KEYS = Object.freeze({
  defaultSickDays: 'LEAVE_DEFAULT_SICK_DAYS',
  defaultPersonalDays: 'LEAVE_DEFAULT_PERSONAL_DAYS',
  defaultVacationDays: 'LEAVE_DEFAULT_VACATION_DAYS',
  sickAttachmentRequiredAfterDays: 'LEAVE_SICK_ATTACHMENT_REQUIRED_AFTER_DAYS',
  managerRetroactiveOnBehalfEnabled: 'LEAVE_MANAGER_RETROACTIVE_ON_BEHALF_ENABLED',
  managerRetroactiveMaxDaysBack: 'LEAVE_MANAGER_RETROACTIVE_MAX_DAYS_BACK'
});

const DEFAULT_LEAVE_POLICY = Object.freeze({
  defaultSickDays: 30,
  defaultPersonalDays: 3,
  defaultVacationDays: 6,
  sickAttachmentRequiredAfterDays: 3,
  managerRetroactiveOnBehalfEnabled: true,
  managerRetroactiveMaxDaysBack: 0
});

const NUMBER_RANGES = Object.freeze({
  [LEAVE_POLICY_KEYS.defaultSickDays]: Object.freeze([0, 999]),
  [LEAVE_POLICY_KEYS.defaultPersonalDays]: Object.freeze([0, 999]),
  [LEAVE_POLICY_KEYS.defaultVacationDays]: Object.freeze([0, 999]),
  [LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays]: Object.freeze([0, 30]),
  [LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack]: Object.freeze([0, 3650])
});

function numberValue(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function booleanValue(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function policyFromSettings(rows = []) {
  const byKey = new Map(rows.map((row) => [String(row.key || ''), row.value]));
  return Object.freeze({
    defaultSickDays: numberValue(
      byKey.get(LEAVE_POLICY_KEYS.defaultSickDays),
      DEFAULT_LEAVE_POLICY.defaultSickDays,
      0,
      999
    ),
    defaultPersonalDays: numberValue(
      byKey.get(LEAVE_POLICY_KEYS.defaultPersonalDays),
      DEFAULT_LEAVE_POLICY.defaultPersonalDays,
      0,
      999
    ),
    defaultVacationDays: numberValue(
      byKey.get(LEAVE_POLICY_KEYS.defaultVacationDays),
      DEFAULT_LEAVE_POLICY.defaultVacationDays,
      0,
      999
    ),
    sickAttachmentRequiredAfterDays: numberValue(
      byKey.get(LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays),
      DEFAULT_LEAVE_POLICY.sickAttachmentRequiredAfterDays,
      0,
      30
    ),
    managerRetroactiveOnBehalfEnabled: booleanValue(
      byKey.get(LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled),
      DEFAULT_LEAVE_POLICY.managerRetroactiveOnBehalfEnabled
    ),
    managerRetroactiveMaxDaysBack: numberValue(
      byKey.get(LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack),
      DEFAULT_LEAVE_POLICY.managerRetroactiveMaxDaysBack,
      0,
      3650
    )
  });
}

function validateLeavePolicySetting(key, value) {
  const text = String(value ?? '').trim();

  if (key === LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled) {
    const normalized = text.toLowerCase();
    if (!['true', 'false'].includes(normalized)) {
      throw new Error(`${key} must be true or false.`);
    }
    return normalized;
  }

  const range = NUMBER_RANGES[key];
  if (range) {
    const parsed = Number(text);
    const [min, max] = range;
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new Error(`${key} must be between ${min} and ${max}.`);
    }
    return String(parsed);
  }

  return null;
}

function bangkokDateOnlyUtc(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const bangkok = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  return new Date(Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth(), bangkok.getUTCDate()));
}

function isRetroactiveLeaveStart(value, now = new Date()) {
  const start = bangkokDateOnlyUtc(value);
  const today = bangkokDateOnlyUtc(now);
  if (!start || !today) return false;
  return start < today;
}

function retroactiveDaysBack(value, now = new Date()) {
  const start = bangkokDateOnlyUtc(value);
  const today = bangkokDateOnlyUtc(now);
  if (!start || !today || start >= today) return 0;
  return Math.floor((today.getTime() - start.getTime()) / 86400000);
}

function defaultEntitlementFromPolicy(policy = DEFAULT_LEAVE_POLICY) {
  return Object.freeze({
    sickLeave: Number(policy.defaultSickDays),
    personalLeave: Number(policy.defaultPersonalDays),
    vacationLeave: Number(policy.defaultVacationDays)
  });
}

function createLeavePolicyService({ prisma = prismaDefault } = {}) {
  async function getPolicy(client = prisma) {
    const keys = Object.values(LEAVE_POLICY_KEYS);
    const rows = await client.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true }
    });
    return policyFromSettings(rows);
  }

  return { getPolicy };
}

module.exports = {
  LEAVE_POLICY_KEYS,
  DEFAULT_LEAVE_POLICY,
  NUMBER_RANGES,
  policyFromSettings,
  validateLeavePolicySetting,
  bangkokDateOnlyUtc,
  isRetroactiveLeaveStart,
  retroactiveDaysBack,
  defaultEntitlementFromPolicy,
  createLeavePolicyService
};
