'use strict';

const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const audit = require('./audit.service');
const lifecycle = require('./employee-lifecycle.service');
const HttpError = require('../utils/http-error');
const personnelMaster = require('./personnel-master.service');

const ADMIN_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'department', 'jobTitle', 'skill', 'isActive'];
const MANAGER_FIELDS = ['firstName', 'lastName', 'department', 'jobTitle', 'isActive'];
const IMMEDIATE_ONLY_FIELDS = ['email', 'phone', 'skill'];
const GOVERNED_REASON_FIELDS = ['firstName', 'lastName', 'department', 'jobTitle', 'isActive'];
const EFFECTIVE_MODES = ['IMMEDIATE', 'FUTURE_EFFECTIVE'];
const MASTER_TRANSACTION_OPTIONS = lifecycle.LIFECYCLE_TRANSACTION_OPTIONS;

function businessError(statusCode, code, message, extra = {}) {
  return new HttpError(statusCode, message, { code, ...extra });
}

function cleanString(value, field, max, nullable = false) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_FIELD', `${field} is required.`, { field });
  }
  const text = String(value).trim();
  if (!text && !nullable) throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_FIELD', `${field} is required.`, { field });
  if (text.length > max) throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_FIELD', `${field} is too long.`, { field });
  return text || null;
}

function normalizeDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_FIELD', `${field} must be a valid date.`, { field });
  }
  return text;
}

function normalizeChanges(input, scope = 'ADMIN') {
  const changes = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowed = scope === 'MANAGER' ? MANAGER_FIELDS : ADMIN_FIELDS;
  const unknown = Object.keys(changes).filter((field) => !allowed.includes(field));
  if (unknown.length) throw businessError(403, 'EMPLOYEE_CHANGE_FIELD_NOT_ALLOWED', 'One or more Employee fields are not permitted for this actor.', { fields: unknown });
  const normalized = {};
  for (const field of Object.keys(changes)) {
    const value = changes[field];
    if (field === 'employeeCode') normalized[field] = cleanString(value, field, 50);
    else if (field === 'firstName' || field === 'lastName') normalized[field] = cleanString(value, field, 100);
    else if (field === 'email') {
      const email = cleanString(value, field, 255, true);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_FIELD', 'email must be valid.', { field });
      normalized[field] = email;
    } else if (field === 'phone') normalized[field] = cleanString(value, field, 50, true);
    else if (field === 'department' || field === 'jobTitle') normalized[field] = cleanString(value, field, 100, true);
    else if (field === 'hiredAt') normalized[field] = normalizeDate(value, field);
    else if (field === 'skill') normalized[field] = cleanString(value, field, 255, true);
    else if (field === 'isActive') {
      if (typeof value !== 'boolean') throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_FIELD', 'isActive must be boolean.', { field });
      normalized[field] = value;
    }
  }
  if (!Object.keys(normalized).length) throw businessError(400, 'EMPLOYEE_CHANGE_NO_CHANGES', 'At least one Employee field must be changed.');
  return normalized;
}

function sameValue(left, right) {
  return (left ?? null) === (right ?? null);
}

function effectiveChanges(changes, currentState) {
  return Object.fromEntries(Object.entries(changes).filter(([field, value]) => !sameValue(value, currentState?.[field])));
}

function validateEffectiveTiming(changes, effectiveMode = 'IMMEDIATE', effectiveDate, now = new Date()) {
  if (!EFFECTIVE_MODES.includes(effectiveMode)) throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_EFFECTIVE_MODE', 'Unsupported effective mode.');
  const today = lifecycle.bangkokToday(now);
  const todayText = today.toISOString().slice(0, 10);
  if (effectiveMode === 'IMMEDIATE') {
    if (effectiveDate && normalizeDate(effectiveDate, 'effectiveDate') !== todayText) {
      throw businessError(409, 'EMPLOYEE_CHANGE_MIXED_EFFECTIVE_TIMING', 'Immediate and future-effective changes must be separated.');
    }
    return { effectiveMode, effectiveDate: todayText };
  }
  const dateText = normalizeDate(effectiveDate, 'effectiveDate');
  if (!dateText || lifecycle.dateOnly(dateText) <= today) throw businessError(400, 'EMPLOYEE_CHANGE_FUTURE_DATE_REQUIRED', 'Future-effective changes require a future effectiveDate.');
  const mixed = Object.keys(changes).filter((field) => IMMEDIATE_ONLY_FIELDS.includes(field));
  if (mixed.length) {
    throw businessError(409, 'EMPLOYEE_CHANGE_MIXED_EFFECTIVE_TIMING', 'Immediate-only Employee fields must be edited separately from a future-effective change.', { fields: mixed });
  }
  return { effectiveMode, effectiveDate: dateText };
}

function projectState(state, scope) {
  if (scope !== 'MANAGER') return { ...state };
  return Object.fromEntries([...MANAGER_FIELDS, 'displayName', 'employmentStatus'].filter((field) => Object.prototype.hasOwnProperty.call(state || {}, field)).map((field) => [field, state[field]]));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function proposalHash({ changes, effectiveMode, effectiveDate, reason }) {
  return crypto.createHash('sha256').update(JSON.stringify(stableObject({ changes, effectiveMode, effectiveDate: effectiveDate || null, reason: reason || null }))).digest('hex');
}

function safeReason(value, { required = false } = {}) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (required && text.length < 3) throw businessError(400, 'EMPLOYEE_CHANGE_REASON_REQUIRED', 'A reason is required.');
  if (text.length > 1000) throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_FIELD', 'Reason is too long.', { field: 'reason' });
  return text || null;
}

function governedReasonRequired(changes, effectiveMode) {
  return effectiveMode === 'FUTURE_EFFECTIVE'
    || Object.keys(changes || {}).some((field) => GOVERNED_REASON_FIELDS.includes(field));
}

function createEmployeeMasterMutationService({ prismaClient = prisma, auditService = audit, clock = () => new Date() } = {}) {
  const lifecycleService = lifecycle.createEmployeeLifecycleService({ prismaClient, auditService, clock });

  async function preflight({ employeeId, actorRole, fieldScope, changes, effectiveMode = 'IMMEDIATE', effectiveDate, reason }) {
    const scope = fieldScope || actorRole || 'ADMIN';
    let normalized = normalizeChanges(changes, scope === 'MANAGER' ? 'MANAGER' : 'ADMIN');
    if (Object.prototype.hasOwnProperty.call(normalized, 'department')) normalized = { ...normalized, department: await personnelMaster.assertActiveValue(prismaClient, 'department', normalized.department) };
    if (Object.prototype.hasOwnProperty.call(normalized, 'jobTitle')) normalized = { ...normalized, jobTitle: await personnelMaster.assertActiveValue(prismaClient, 'position', normalized.jobTitle) };
    const timing = validateEffectiveTiming(normalized, effectiveMode, effectiveDate, clock());
    let analysis = await lifecycleService.preflight({ employeeId, type: 'MASTER_EDIT', effectiveDate: timing.effectiveDate, changes: normalized });
    const actual = effectiveChanges(normalized, analysis.currentState);
    if (!Object.keys(actual).length) throw businessError(409, 'EMPLOYEE_CHANGE_NO_CHANGES', 'The proposed Employee data is already authoritative.');
    if (Object.keys(actual).length !== Object.keys(normalized).length) {
      analysis = await lifecycleService.preflight({ employeeId, type: 'MASTER_EDIT', effectiveDate: timing.effectiveDate, changes: actual });
    }
    const hardBlocks = (analysis.blockingIssues || []).filter((issue) => issue.code !== 'NO_STATE_CHANGE');
    if (hardBlocks.length) throw businessError(409, 'EMPLOYEE_CHANGE_PREFLIGHT_BLOCKED', 'The Employee change cannot be applied.', { preflight: { ...analysis, blockingIssues: hardBlocks } });
    return {
      employee: analysis.employee,
      currentState: projectState(analysis.currentState, scope === 'MANAGER' ? 'MANAGER' : 'ADMIN'),
      proposedState: projectState(analysis.proposedState, scope === 'MANAGER' ? 'MANAGER' : 'ADMIN'),
      changedFields: Object.keys(actual),
      changes: actual,
      effectiveMode: timing.effectiveMode,
      effectiveDate: timing.effectiveDate,
      reason: safeReason(reason, { required: governedReasonRequired(actual, timing.effectiveMode) }),
      warnings: analysis.warnings || [],
      impacts: analysis.impacts,
      expectedEmployeeUpdatedAt: analysis.expectedEmployeeUpdatedAt,
      latestLifecycleSequence: analysis.latestLifecycleSequence
    };
  }

  async function applyInTransaction(tx, { employeeId, actorUserId, actorRole = 'ADMIN', fieldScope = 'ADMIN', changes, effectiveMode = 'IMMEDIATE', effectiveDate, reason, expectedEmployeeUpdatedAt, expectedLifecycleSequence, idempotencyKey, sourceChangeRequestId = null, sourceChangeRequestRevision = null, staleCode = 'EMPLOYEE_STATE_CONFLICT' }) {
    let normalized = normalizeChanges(changes, fieldScope === 'MANAGER' ? 'MANAGER' : 'ADMIN');
    if (Object.prototype.hasOwnProperty.call(normalized, 'department')) normalized = { ...normalized, department: await personnelMaster.assertActiveValue(tx, 'department', normalized.department) };
    if (Object.prototype.hasOwnProperty.call(normalized, 'jobTitle')) normalized = { ...normalized, jobTitle: await personnelMaster.assertActiveValue(tx, 'position', normalized.jobTitle) };
    const timing = validateEffectiveTiming(normalized, effectiveMode, effectiveDate, clock());
    const txLifecycle = lifecycle.createEmployeeLifecycleService({ prismaClient: tx, auditService, clock });
    const duplicate = await tx.employeeLifecycleEvent.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      if (duplicate.employeeId !== employeeId || duplicate.type !== 'MASTER_EDIT') throw businessError(409, 'EMPLOYEE_CHANGE_IDEMPOTENCY_CONFLICT', 'The idempotency key belongs to another Employee mutation.');
      return { lifecycleEvent: duplicate, employee: await tx.employee.findUnique({ where: { id: employeeId } }), applied: duplicate.status === 'APPLIED', idempotent: true };
    }
    const authoritative = await txLifecycle.authoritativeMutationState({ employeeId, type: 'MASTER_EDIT', effectiveDate: timing.effectiveDate, changes: normalized }, tx);
    const actual = effectiveChanges(normalized, authoritative.prior.employee);
    if (!Object.keys(actual).length) throw businessError(409, 'EMPLOYEE_CHANGE_NO_CHANGES', 'The proposed Employee data is already authoritative.');
    if (new Date(expectedEmployeeUpdatedAt).getTime() !== new Date(authoritative.employee.updatedAt).getTime()) {
      throw businessError(409, staleCode, 'Employee Master changed after the proposal base was captured.', { conflict: 'employeeUpdatedAt' });
    }
    if (Number(expectedLifecycleSequence) !== Number(authoritative.latestLifecycleSequence)) {
      throw businessError(409, staleCode, 'Employee lifecycle changed after the proposal base was captured.', { conflict: 'lifecycleSequence' });
    }
    const hardBlocks = authoritative.blockingIssues.filter((issue) => issue.code !== 'NO_STATE_CHANGE');
    if (hardBlocks.length) throw businessError(409, 'EMPLOYEE_CHANGE_PREFLIGHT_BLOCKED', 'The Employee change cannot be applied.', { blockingIssues: hardBlocks });
    const effective = lifecycle.dateOnly(timing.effectiveDate);
    const appliesNow = effective <= lifecycle.bangkokToday(clock());
    const event = await tx.employeeLifecycleEvent.create({ data: {
      employeeId,
      sequence: authoritative.latestLifecycleSequence + 1,
      type: 'MASTER_EDIT',
      status: appliesNow ? 'APPLIED' : 'PENDING',
      effectiveDate: effective,
      oldValue: { employee: authoritative.prior.employee, user: authoritative.prior.user },
      newValue: authoritative.next,
      reason: safeReason(reason, { required: governedReasonRequired(actual, timing.effectiveMode) }) || 'Employee Master edit',
      changedByUserId: actorUserId,
      idempotencyKey,
      expectedEmployeeUpdatedAt: new Date(expectedEmployeeUpdatedAt),
      sourceChangeRequestId,
      sourceChangeRequestRevision,
      appliedAt: appliesNow ? clock() : null
    } });
    let employee = authoritative.employee;
    if (appliesNow) {
      const synchronized = await lifecycle.applyEmployeeSnapshot(tx, authoritative.employee, 'MASTER_EDIT', authoritative.next, effective, clock);
      employee = synchronized.employee;
      await auditService.log({ actorUserId, action: 'UPDATE', entityType: 'Employee', entityId: employeeId, metadata: { event: 'EMPLOYEE_MASTER_EDIT', lifecycleEventId: event.id, sourceChangeRequestId, sourceChangeRequestRevision, before: authoritative.prior.employee, after: lifecycle.employeeMasterState(employee) } }, tx);
    }
    await auditService.log({ actorUserId, action: 'CREATE', entityType: 'EmployeeLifecycleEvent', entityId: event.id, metadata: { employeeId, type: 'MASTER_EDIT', status: event.status, effectiveMode: timing.effectiveMode, effectiveDate: timing.effectiveDate, sourceChangeRequestId, sourceChangeRequestRevision, changedFields: Object.keys(actual) } }, tx);
    return { lifecycleEvent: event, employee, applied: appliesNow, idempotent: false };
  }

  async function mutate(input) {
    const analysis = await preflight(input);
    if (new Date(input.expectedEmployeeUpdatedAt).getTime() !== new Date(analysis.expectedEmployeeUpdatedAt).getTime()) throw businessError(409, 'EMPLOYEE_STATE_CONFLICT', 'Employee Master changed. Refresh and try again.');
    if (Number(input.expectedLifecycleSequence) !== Number(analysis.latestLifecycleSequence)) throw businessError(409, 'LIFECYCLE_STATE_CONFLICT', 'Employee lifecycle changed. Refresh and try again.');
    if (analysis.warnings.length && input.acknowledgeWarnings !== true) throw businessError(409, 'EMPLOYEE_CHANGE_WARNINGS_REQUIRE_CONFIRMATION', 'Review and acknowledge Employee change impacts before saving.', { preflight: analysis });
    try {
      return await prismaClient.$transaction(async (tx) => {
        if (typeof tx.$executeRaw === 'function') await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lifecycle.LIFECYCLE_LOCK})`;
        if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employees WHERE id = ${input.employeeId}::uuid FOR UPDATE`;
        return applyInTransaction(tx, { ...input, changes: analysis.changes, effectiveMode: analysis.effectiveMode, effectiveDate: analysis.effectiveDate, reason: analysis.reason });
      }, MASTER_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error?.code === 'P2002') throw businessError(409, 'EMPLOYEE_MASTER_UNIQUE_CONFLICT', 'Employee code or contact email already exists.');
      if (error?.code === 'P2034') throw businessError(409, 'EMPLOYEE_STATE_CONFLICT', 'Employee Master changed concurrently. Refresh and try again.');
      throw error;
    }
  }

  return { preflight, applyInTransaction, mutate };
}

module.exports = {
  ADMIN_FIELDS,
  MANAGER_FIELDS,
  IMMEDIATE_ONLY_FIELDS,
  GOVERNED_REASON_FIELDS,
  EFFECTIVE_MODES,
  MASTER_TRANSACTION_OPTIONS,
  normalizeChanges,
  validateEffectiveTiming,
  proposalHash,
  governedReasonRequired,
  createEmployeeMasterMutationService,
  preflightEmployeeMasterMutation: createEmployeeMasterMutationService().preflight,
  mutateEmployeeMaster: createEmployeeMasterMutationService().mutate
};