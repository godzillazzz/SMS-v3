'use strict';

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const personnelMaster = require('./personnel-master.service');

const CORE_SUPERVISOR_ALIASES = Object.freeze(['supervisor', 'หัวหน้า', 'ซุปเปอร์ไวเซอร์']);
const CORE_MANAGER_ALIASES = Object.freeze(['manager', 'ผู้จัดการ']);

const REQUEST_TYPE_DEFINITIONS = Object.freeze([
  Object.freeze({ type: 'EMPLOYEE_MASTER_CHANGE', label: 'แก้ไขข้อมูลพนักงาน', safeReviewerRoles: Object.freeze(['ADMIN']) }),
  Object.freeze({ type: 'EMPLOYEE_REFERENCE_PHOTO', label: 'รูปอ้างอิงพนักงาน', safeReviewerRoles: Object.freeze(['ADMIN']) }),
  Object.freeze({ type: 'LICENSE_DOCUMENT', label: 'เอกสารใบอนุญาต', safeReviewerRoles: Object.freeze(['ADMIN']) }),
  Object.freeze({ type: 'ATTENDANCE_DEVICE_REQUEST', label: 'อุปกรณ์ลงเวลา', safeReviewerRoles: Object.freeze(['ADMIN']) }),
  Object.freeze({ type: 'ATTENDANCE_ADJUSTMENT_REQUEST', label: 'ปรับปรุงเวลา Attendance', safeReviewerRoles: Object.freeze(['ADMIN']) }),
  Object.freeze({ type: 'REGISTRATION_REQUEST', label: 'ลงทะเบียนบัญชี', safeReviewerRoles: Object.freeze(['ADMIN', 'MANAGER']) }),
  Object.freeze({ type: 'USER_ACCESS', label: 'เปิดสิทธิ์ผู้ใช้', safeReviewerRoles: Object.freeze(['ADMIN', 'MANAGER']) }),
  Object.freeze({ type: 'LEAVE_REQUEST', label: 'คำขอลา', safeReviewerRoles: Object.freeze(['ADMIN', 'MANAGER']), supportsPositionAliases: true })
]);

const BY_TYPE = new Map(REQUEST_TYPE_DEFINITIONS.map((row) => [row.type, row]));
const DEFAULT_DUE_SOON_HOURS = 24;
const DEFAULT_OVERDUE_HOURS = 48;

function policyKey(requestType, suffix) {
  return `APPROVAL_POLICY.${requestType}.${suffix}`;
}

function settingKeysFor(definition) {
  const keys = [
    policyKey(definition.type, 'REVIEWER_ROLES'),
    policyKey(definition.type, 'DUE_SOON_HOURS'),
    policyKey(definition.type, 'OVERDUE_HOURS')
  ];
  if (definition.supportsPositionAliases) {
    keys.push(
      policyKey(definition.type, 'ADDITIONAL_SUPERVISOR_ALIASES'),
      policyKey(definition.type, 'ADDITIONAL_MANAGER_ALIASES')
    );
  }
  return keys;
}

const ALL_SETTING_KEYS = Object.freeze(REQUEST_TYPE_DEFINITIONS.flatMap(settingKeysFor));

function policyError(statusCode, code, message, details = {}) {
  return new HttpError(statusCode, message, { code, ...details });
}

function definitionFor(requestType) {
  const definition = BY_TYPE.get(String(requestType || '').trim().toUpperCase());
  if (!definition) throw policyError(400, 'APPROVAL_POLICY_REQUEST_TYPE_INVALID', 'Unsupported approval request type.');
  return definition;
}

function normalizeReviewerRoles(input, definition) {
  if (!Array.isArray(input) || input.length === 0) {
    throw policyError(400, 'APPROVAL_POLICY_REVIEWER_ROLES_INVALID', 'At least one reviewer role is required.');
  }
  const roles = [...new Set(input.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))];
  if (!roles.includes('ADMIN')) {
    throw policyError(400, 'APPROVAL_POLICY_ADMIN_REQUIRED', 'Admin reviewer authority cannot be removed.');
  }
  const invalid = roles.filter((role) => !definition.safeReviewerRoles.includes(role));
  if (invalid.length) {
    throw policyError(400, 'APPROVAL_POLICY_ROLE_EXCEEDS_SECURITY_CEILING', 'Reviewer role exceeds the protected security ceiling.', { invalidRoles: invalid });
  }
  return definition.safeReviewerRoles.filter((role) => roles.includes(role));
}

function normalizeHours(value, { min, max, code, label }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw policyError(400, code, `${label} must be an integer between ${min} and ${max} hours.`);
  }
  return number;
}

function normalizeAliases(input, coreAliases, code) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw policyError(400, code, 'Position aliases must be an array.');
  if (input.length > 20) throw policyError(400, code, 'Position aliases may contain at most 20 values.');
  const core = new Set(coreAliases.map((value) => value.toLocaleLowerCase('th-TH')));
  const values = [];
  for (const raw of input) {
    const value = String(raw || '').trim().toLocaleLowerCase('th-TH');
    if (!value || value.length > 80) throw policyError(400, code, 'Each position alias must contain 1-80 characters.');
    if (!core.has(value) && !values.includes(value)) values.push(value);
  }
  return values;
}

function normalizePolicyInput(requestType, input = {}) {
  const definition = definitionFor(requestType);
  const reviewerRoles = normalizeReviewerRoles(input.reviewerRoles, definition);
  const dueSoonHours = normalizeHours(input.dueSoonHours, {
    min: 1, max: 168, code: 'APPROVAL_POLICY_DUE_SOON_INVALID', label: 'Due-soon threshold'
  });
  const overdueHours = normalizeHours(input.overdueHours, {
    min: 2, max: 720, code: 'APPROVAL_POLICY_OVERDUE_INVALID', label: 'Overdue threshold'
  });
  if (overdueHours <= dueSoonHours) {
    throw policyError(400, 'APPROVAL_POLICY_SLA_ORDER_INVALID', 'Overdue threshold must be greater than the due-soon threshold.');
  }
  const additionalSupervisorAliases = definition.supportsPositionAliases
    ? normalizeAliases(input.additionalSupervisorAliases, CORE_SUPERVISOR_ALIASES, 'APPROVAL_POLICY_SUPERVISOR_ALIASES_INVALID')
    : [];
  const additionalManagerAliases = definition.supportsPositionAliases
    ? normalizeAliases(input.additionalManagerAliases, CORE_MANAGER_ALIASES, 'APPROVAL_POLICY_MANAGER_ALIASES_INVALID')
    : [];
  return {
    requestType: definition.type,
    label: definition.label,
    reviewerRoles,
    safeReviewerRoles: [...definition.safeReviewerRoles],
    reviewerRolesLocked: definition.safeReviewerRoles.length === 1,
    dueSoonHours,
    overdueHours,
    additionalSupervisorAliases,
    additionalManagerAliases,
    protectedInvariants: protectedInvariantsFor(definition)
  };
}

function protectedInvariantsFor(definition) {
  const values = ['ADMIN authority cannot be removed'];
  if (definition.safeReviewerRoles.length === 1) values.push('Reviewer role is protected as ADMIN only');
  if (definition.type === 'LEAVE_REQUEST') {
    values.push('Self-approval is always forbidden');
    values.push('Non-retroactive Supervisor leave requires ADMIN approval');
    values.push('Non-retroactive Manager leave requires Supervisor-level reviewer position or ADMIN');
    values.push('Core Supervisor/Manager position aliases cannot be removed');
  }
  return values;
}

function parseJsonArray(value, code) {
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) throw new Error('not-array');
    return parsed;
  } catch {
    throw policyError(503, 'APPROVAL_POLICY_INVALID', 'Approval policy configuration is invalid.', { key: code });
  }
}

function parseStoredPolicy(definition, rowsByKey) {
  const required = settingKeysFor(definition);
  const missing = required.filter((key) => !rowsByKey.has(key));
  if (missing.length) {
    throw policyError(503, 'APPROVAL_POLICY_INCOMPLETE', 'Approval policy configuration is incomplete.', { requestType: definition.type, missingKeys: missing });
  }
  try {
    return normalizePolicyInput(definition.type, {
      reviewerRoles: parseJsonArray(rowsByKey.get(policyKey(definition.type, 'REVIEWER_ROLES')).value, 'REVIEWER_ROLES'),
      dueSoonHours: rowsByKey.get(policyKey(definition.type, 'DUE_SOON_HOURS')).value,
      overdueHours: rowsByKey.get(policyKey(definition.type, 'OVERDUE_HOURS')).value,
      additionalSupervisorAliases: definition.supportsPositionAliases
        ? parseJsonArray(rowsByKey.get(policyKey(definition.type, 'ADDITIONAL_SUPERVISOR_ALIASES')).value, 'ADDITIONAL_SUPERVISOR_ALIASES')
        : [],
      additionalManagerAliases: definition.supportsPositionAliases
        ? parseJsonArray(rowsByKey.get(policyKey(definition.type, 'ADDITIONAL_MANAGER_ALIASES')).value, 'ADDITIONAL_MANAGER_ALIASES')
        : []
    });
  } catch (error) {
    if (error?.statusCode === 503 || error?.status === 503) throw error;
    throw policyError(503, 'APPROVAL_POLICY_INVALID', 'Approval policy configuration is invalid.', {
      requestType: definition.type,
      causeCode: error?.details?.code || error?.code || 'INVALID_VALUE'
    });
  }
}

function serializedValues(policy) {
  const values = new Map([
    [policyKey(policy.requestType, 'REVIEWER_ROLES'), JSON.stringify(policy.reviewerRoles)],
    [policyKey(policy.requestType, 'DUE_SOON_HOURS'), String(policy.dueSoonHours)],
    [policyKey(policy.requestType, 'OVERDUE_HOURS'), String(policy.overdueHours)]
  ]);
  if (policy.requestType === 'LEAVE_REQUEST') {
    values.set(policyKey(policy.requestType, 'ADDITIONAL_SUPERVISOR_ALIASES'), JSON.stringify(policy.additionalSupervisorAliases || []));
    values.set(policyKey(policy.requestType, 'ADDITIONAL_MANAGER_ALIASES'), JSON.stringify(policy.additionalManagerAliases || []));
  }
  return values;
}

function defaultPolicyFor(definition) {
  return normalizePolicyInput(definition.type, {
    reviewerRoles: [...definition.safeReviewerRoles],
    dueSoonHours: DEFAULT_DUE_SOON_HOURS,
    overdueHours: DEFAULT_OVERDUE_HOURS,
    additionalSupervisorAliases: [],
    additionalManagerAliases: []
  });
}

function policySettingDefinitions() {
  return REQUEST_TYPE_DEFINITIONS.flatMap((definition) => {
    const base = {
      group: 'APPROVAL',
      groupLabel: 'Approval Authority & SLA',
      groupOrder: 25,
      editable: false,
      authority: 'ADMIN_GOVERNED_VIA_APPROVAL_POLICY_API',
      source: 'SYSTEM_SETTING'
    };
    const rows = [
      { ...base, key: policyKey(definition.type, 'REVIEWER_ROLES'), label: `${definition.label} · Reviewer roles`, valueType: 'JSON', description: `CFG-06 reviewer roles for ${definition.type}; protected by a code-enforced security ceiling.` },
      { ...base, key: policyKey(definition.type, 'DUE_SOON_HOURS'), label: `${definition.label} · Due-soon SLA`, valueType: 'NUMBER', description: `CFG-06 due-soon threshold in hours for ${definition.type}.`, constraints: { min: 1, max: 168, unit: 'hours' } },
      { ...base, key: policyKey(definition.type, 'OVERDUE_HOURS'), label: `${definition.label} · Overdue SLA`, valueType: 'NUMBER', description: `CFG-06 overdue threshold in hours for ${definition.type}.`, constraints: { min: 2, max: 720, unit: 'hours' } }
    ];
    if (definition.supportsPositionAliases) {
      rows.push(
        { ...base, key: policyKey(definition.type, 'ADDITIONAL_SUPERVISOR_ALIASES'), label: `${definition.label} · Additional Supervisor aliases`, valueType: 'JSON', description: 'CFG-06 additive Supervisor position aliases. Core protected aliases remain active.' },
        { ...base, key: policyKey(definition.type, 'ADDITIONAL_MANAGER_ALIASES'), label: `${definition.label} · Additional Manager aliases`, valueType: 'JSON', description: 'CFG-06 additive Manager position aliases. Core protected aliases remain active.' }
      );
    }
    return rows;
  });
}

function positionClass(jobTitle, policy) {
  const text = String(jobTitle || '').trim().toLocaleLowerCase('th-TH');
  const supervisorAliases = [...CORE_SUPERVISOR_ALIASES, ...(policy?.additionalSupervisorAliases || [])];
  const managerAliases = [...CORE_MANAGER_ALIASES, ...(policy?.additionalManagerAliases || [])];
  if (supervisorAliases.some((alias) => text.includes(String(alias).toLocaleLowerCase('th-TH')))) return 'SUPERVISOR';
  if (managerAliases.some((alias) => text.includes(String(alias).toLocaleLowerCase('th-TH')))) return 'MANAGER';
  return 'GENERAL';
}

function canReview(policy, actorRole) {
  return Boolean(policy?.reviewerRoles?.includes(String(actorRole || '').trim().toUpperCase()));
}

function createApprovalPolicyService({ prismaClient = prismaDefault, auditService = auditDefault } = {}) {
  async function loadPolicies(client = prismaClient) {
    if (!client?.systemSetting?.findMany) {
      throw policyError(503, 'APPROVAL_POLICY_MASTER_UNAVAILABLE', 'Approval policy master is unavailable.');
    }
    const rows = await client.systemSetting.findMany({
      where: { key: { in: [...ALL_SETTING_KEYS] } },
      select: { key: true, value: true, description: true, updatedAt: true }
    });
    const rowsByKey = new Map(rows.map((row) => [row.key, row]));
    const policies = REQUEST_TYPE_DEFINITIONS.map((definition) => parseStoredPolicy(definition, rowsByKey));
    return new Map(policies.map((policy) => [policy.requestType, policy]));
  }

  async function list(client = prismaClient) {
    const map = await loadPolicies(client);
    return REQUEST_TYPE_DEFINITIONS.map((definition) => map.get(definition.type));
  }

  async function getPolicy(requestType, client = prismaClient) {
    const definition = definitionFor(requestType);
    const map = await loadPolicies(client);
    return map.get(definition.type);
  }

  async function assertReviewer(requestType, actor, client = prismaClient) {
    const policy = await getPolicy(requestType, client);
    if (!canReview(policy, actor?.role)) {
      throw policyError(403, 'APPROVAL_POLICY_REVIEWER_NOT_AUTHORIZED', 'Current approval policy does not authorize this reviewer.', { requestType: policy.requestType });
    }
    return policy;
  }

  async function update({ requestType, input, actor }) {
    if (String(actor?.role || '').toUpperCase() !== 'ADMIN') {
      throw policyError(403, 'APPROVAL_POLICY_ADMIN_REQUIRED', 'Only Admin may change approval policy.');
    }
    const desired = normalizePolicyInput(requestType, input);
    return prismaClient.$transaction(async (tx) => {
      const before = await getPolicy(desired.requestType, tx);
      if (desired.requestType === 'LEAVE_REQUEST') {
        const previousAliases = new Set([...before.additionalSupervisorAliases, ...before.additionalManagerAliases]);
        const newAliases = [...desired.additionalSupervisorAliases, ...desired.additionalManagerAliases].filter((value) => !previousAliases.has(value));
        for (const alias of newAliases) await personnelMaster.assertActiveValue(tx, 'position', alias);
      }
      const values = serializedValues(desired);
      for (const [key, value] of values) {
        await tx.systemSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value, description: policySettingDefinitions().find((row) => row.key === key)?.description || 'CFG-06 approval policy' }
        });
      }
      await auditService.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'ApprovalAuthorityPolicy',
        entityId: desired.requestType,
        metadata: {
          before: {
            reviewerRoles: before.reviewerRoles,
            dueSoonHours: before.dueSoonHours,
            overdueHours: before.overdueHours,
            additionalSupervisorAliases: before.additionalSupervisorAliases,
            additionalManagerAliases: before.additionalManagerAliases
          },
          after: {
            reviewerRoles: desired.reviewerRoles,
            dueSoonHours: desired.dueSoonHours,
            overdueHours: desired.overdueHours,
            additionalSupervisorAliases: desired.additionalSupervisorAliases,
            additionalManagerAliases: desired.additionalManagerAliases
          },
          protectedInvariants: desired.protectedInvariants
        }
      }, tx);
      return desired;
    });
  }

  return { loadPolicies, list, getPolicy, assertReviewer, update };
}

module.exports = {
  ALL_SETTING_KEYS,
  CORE_MANAGER_ALIASES,
  CORE_SUPERVISOR_ALIASES,
  DEFAULT_DUE_SOON_HOURS,
  DEFAULT_OVERDUE_HOURS,
  REQUEST_TYPE_DEFINITIONS,
  canReview,
  createApprovalPolicyService,
  defaultPolicyFor,
  definitionFor,
  normalizePolicyInput,
  policyKey,
  policySettingDefinitions,
  positionClass,
  protectedInvariantsFor,
  settingKeysFor
};
