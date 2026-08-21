'use strict';

const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const audit = require('./audit.service');
const lifecycle = require('./employee-lifecycle.service');
const mutationModule = require('./employee-master-mutation.service');
const HttpError = require('../utils/http-error');

const REQUEST_LOCK = 615042919;
const TRANSACTION_OPTIONS = { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 };
const ACTIVE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION'];
const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'CANCELLED'];

function businessError(statusCode, code, message, extra = {}) { return new HttpError(statusCode, message, { code, ...extra }); }
function requiredComment(value, code) { const text = String(value || '').trim(); if (text.length < 3) throw businessError(400, code, 'A reviewer or cancellation reason of at least 3 characters is required.'); if (text.length > 1000) throw businessError(400, code, 'Reason is too long.'); return text; }
function uuid(value) { const text = String(value || ''); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw businessError(400, 'EMPLOYEE_CHANGE_INVALID_IDEMPOTENCY_KEY', 'A UUID idempotencyKey is required.'); return text; }

const requestInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true, isActive: true, updatedAt: true } },
  requestOwner: { select: { id: true, displayName: true, role: true } },
  revisions: { include: { submittedBy: { select: { id: true, displayName: true, role: true } } }, orderBy: { revision: 'asc' } },
  events: { include: { actor: { select: { id: true, displayName: true, role: true } } }, orderBy: { createdAt: 'asc' } }
};

function changesFromRevision(revision) {
  const fields = Array.isArray(revision?.changedFields) ? revision.changedFields : [];
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(revision.afterSnapshot || {}, field)).map((field) => [field, revision.afterSnapshot[field]]));
}

function canRead(request, actor) { return actor.role === 'ADMIN' || request.requestOwnerUserId === actor.sub; }
function assertManagerOwner(request, actor) {
  if (actor.role !== 'MANAGER') throw businessError(403, 'EMPLOYEE_CHANGE_MANAGER_REQUIRED', 'Only a Manager request owner may perform this action.');
  if (request.requestOwnerUserId !== actor.sub) throw businessError(403, 'EMPLOYEE_CHANGE_NOT_REQUEST_OWNER', 'Only the request owner may change or cancel this request.');
}
function assertAdmin(actor) { if (actor.role !== 'ADMIN') throw businessError(403, 'EMPLOYEE_CHANGE_ADMIN_REVIEW_REQUIRED', 'Admin review authority is required.'); }

function createEmployeeChangeRequestService({ prismaClient = prisma, auditService = audit, clock = () => new Date(), mutationService = null } = {}) {
  const masterMutation = mutationService || mutationModule.createEmployeeMasterMutationService({ prismaClient, auditService, clock });

  async function findWithHistory(id, client = prismaClient) { return client.employeeChangeRequest.findUnique({ where: { id }, include: requestInclude }); }
  async function getById({ id, actor }) { const request = await findWithHistory(id); if (!request) throw businessError(404, 'EMPLOYEE_CHANGE_REQUEST_NOT_FOUND', 'Employee change request not found.'); if (!canRead(request, actor)) throw businessError(403, 'EMPLOYEE_CHANGE_REQUEST_FORBIDDEN', 'You cannot view this Employee change request.'); return request; }

  async function list({ actor, status, employeeId, page = 1, pageSize = 25 }) {
    if (!['ADMIN', 'MANAGER'].includes(actor.role)) throw businessError(403, 'EMPLOYEE_CHANGE_REQUEST_FORBIDDEN', 'You cannot view Employee change requests.');
    const where = { ...(actor.role === 'ADMIN' ? { status: status || 'PENDING_APPROVAL' } : { requestOwnerUserId: actor.sub, ...(status && { status }) }), ...(employeeId && { employeeId }) };
    const [total, rows] = await prismaClient.$transaction([
      prismaClient.employeeChangeRequest.count({ where }),
      prismaClient.employeeChangeRequest.findMany({ where, include: requestInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })
    ]);
    return { data: rows, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async function listForEmployee({ employeeId, actor }) {
    if (!['ADMIN', 'MANAGER'].includes(actor.role)) throw businessError(403, 'EMPLOYEE_CHANGE_REQUEST_FORBIDDEN', 'You cannot view Employee change requests.');
    const where = { employeeId, ...(actor.role === 'MANAGER' && { requestOwnerUserId: actor.sub }) };
    const rows = await prismaClient.employeeChangeRequest.findMany({ where, include: requestInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 50 });
    return { data: rows, meta: { page: 1, pageSize: 50, total: rows.length, totalPages: rows.length ? 1 : 0 } };
  }

  async function createEvent(tx, { requestId, employeeId, revision = null, action, fromStatus = null, toStatus, actor, reason = null, metadata = null, idempotencyKey }) {
    return tx.employeeChangeRequestEvent.create({ data: { requestId, employeeId, revision, action, fromStatus, toStatus, actorUserId: actor?.sub || null, actorRoleSnapshot: actor?.role || 'SYSTEM', reason, metadata, idempotencyKey } });
  }

  async function auditTransition(tx, { actor, requestId, action, fromStatus, toStatus, revision, reasonProvided = false, metadata = {} }) {
    await auditService.log({ actorUserId: actor?.sub || null, action: 'UPDATE', entityType: 'EmployeeChangeRequest', entityId: requestId, metadata: { event: action, fromStatus, toStatus, revision: revision ?? null, reasonProvided, ...metadata } }, tx);
  }

  async function createDraft({ employeeId, actor, proposal = null, effectiveMode = 'IMMEDIATE', effectiveDate = null, reason = null, idempotencyKey = crypto.randomUUID() }) {
    if (actor.role !== 'MANAGER') throw businessError(403, 'EMPLOYEE_CHANGE_REQUEST_REQUIRED', 'Only Manager-originated Employee edits use governed change requests.');
    let normalized = null;
    if (proposal && Object.keys(proposal).length) {
      normalized = mutationModule.normalizeChanges(proposal, 'MANAGER');
      mutationModule.validateEffectiveTiming(normalized, effectiveMode, effectiveDate, clock());
    }
    try {
      return await prismaClient.$transaction(async (tx) => {
        if (typeof tx.$executeRaw === 'function') await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REQUEST_LOCK})`;
        const employee = await tx.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true } });
        if (!employee) throw businessError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
        const request = await tx.employeeChangeRequest.create({ data: { employeeId, status: 'DRAFT', requestOwnerUserId: actor.sub, requestOwnerRoleSnapshot: actor.role, activeEmployeeId: employeeId, draftProposal: normalized, draftEffectiveMode: effectiveMode, draftEffectiveDate: effectiveDate ? lifecycle.dateOnly(effectiveDate) : null, draftReason: reason ? String(reason).trim().slice(0, 1000) : null } });
        await createEvent(tx, { requestId: request.id, employeeId, action: 'DRAFT_SAVED', toStatus: 'DRAFT', actor, metadata: { created: true, hasProposal: Boolean(normalized) }, idempotencyKey: uuid(idempotencyKey) });
        await auditService.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'EmployeeChangeRequest', entityId: request.id, metadata: { employeeId, status: 'DRAFT' } }, tx);
        return findWithHistory(request.id, tx);
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error?.code === 'P2002') throw businessError(409, 'EMPLOYEE_CHANGE_ACTIVE_REQUEST_EXISTS', 'This Employee already has an active governed change request.');
      if (error?.code === 'P2034') throw businessError(409, 'EMPLOYEE_CHANGE_ACTIVE_REQUEST_EXISTS', 'A concurrent active Employee change request already won the race.');
      throw error;
    }
  }

  async function saveDraft({ id, actor, proposal, effectiveMode = 'IMMEDIATE', effectiveDate = null, reason = null, idempotencyKey = crypto.randomUUID() }) {
    const normalized = mutationModule.normalizeChanges(proposal, 'MANAGER');
    const timing = mutationModule.validateEffectiveTiming(normalized, effectiveMode, effectiveDate, clock());
    return prismaClient.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employee_change_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const request = await tx.employeeChangeRequest.findUnique({ where: { id } });
      if (!request) throw businessError(404, 'EMPLOYEE_CHANGE_REQUEST_NOT_FOUND', 'Employee change request not found.');
      assertManagerOwner(request, actor);
      if (!['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(request.status)) throw businessError(409, 'EMPLOYEE_CHANGE_REQUEST_NOT_EDITABLE', 'Only draft or returned requests can be edited.');
      await tx.employeeChangeRequest.update({ where: { id }, data: { draftProposal: normalized, draftEffectiveMode: timing.effectiveMode, draftEffectiveDate: timing.effectiveMode === 'FUTURE_EFFECTIVE' ? lifecycle.dateOnly(timing.effectiveDate) : null, draftReason: reason ? String(reason).trim().slice(0, 1000) : null } });
      await createEvent(tx, { requestId: id, employeeId: request.employeeId, revision: request.currentRevision || null, action: 'DRAFT_SAVED', fromStatus: request.status, toStatus: request.status, actor, metadata: { editedReturned: request.status === 'RETURNED_FOR_CORRECTION' }, idempotencyKey: uuid(idempotencyKey) });
      await auditTransition(tx, { actor, requestId: id, action: 'DRAFT_SAVED', fromStatus: request.status, toStatus: request.status, revision: request.currentRevision || null });
      return findWithHistory(id, tx);
    }, TRANSACTION_OPTIONS);
  }

  async function createRevisionTransition({ id, actor, expectedStatus, action, idempotencyKey }) {
    const existingEvent = await prismaClient.employeeChangeRequestEvent.findUnique({ where: { idempotencyKey: uuid(idempotencyKey) } });
    if (existingEvent) {
      if (existingEvent.requestId !== id || existingEvent.action !== action) throw businessError(409, 'EMPLOYEE_CHANGE_IDEMPOTENCY_CONFLICT', 'Idempotency key belongs to another request transition.');
      return { request: await getById({ id, actor }), idempotent: true };
    }
    const base = await prismaClient.employeeChangeRequest.findUnique({ where: { id } });
    if (!base) throw businessError(404, 'EMPLOYEE_CHANGE_REQUEST_NOT_FOUND', 'Employee change request not found.');
    assertManagerOwner(base, actor);
    if (base.status !== expectedStatus) throw businessError(409, 'EMPLOYEE_CHANGE_INVALID_TRANSITION', `Request must be ${expectedStatus} before ${action}.`);
    if (!base.draftProposal || !Object.keys(base.draftProposal).length) throw businessError(400, 'EMPLOYEE_CHANGE_NO_CHANGES', 'Save Employee changes before submitting.');
    const analysis = await masterMutation.preflight({ employeeId: base.employeeId, actorRole: 'MANAGER', fieldScope: 'MANAGER', changes: base.draftProposal, effectiveMode: base.draftEffectiveMode, effectiveDate: base.draftEffectiveDate, reason: base.draftReason });
    try {
      return await prismaClient.$transaction(async (tx) => {
        if (typeof tx.$executeRaw === 'function') await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REQUEST_LOCK})`;
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT id FROM employee_change_requests WHERE id = ${id}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM employees WHERE id = ${base.employeeId}::uuid FOR UPDATE`;
        }
        const request = await tx.employeeChangeRequest.findUnique({ where: { id } });
        assertManagerOwner(request, actor);
        if (request.status !== expectedStatus) {
          const duplicate = await tx.employeeChangeRequestEvent.findUnique({ where: { idempotencyKey } });
          if (duplicate?.requestId === id && duplicate.action === action) return { request: await findWithHistory(id, tx), idempotent: true };
          throw businessError(409, 'EMPLOYEE_CHANGE_INVALID_TRANSITION', 'Request state changed before submission.');
        }
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: request.employeeId }, select: { updatedAt: true } });
        const latest = await tx.employeeLifecycleEvent.findFirst({ where: { employeeId: request.employeeId }, orderBy: [{ effectiveDate: 'desc' }, { sequence: 'desc' }], select: { sequence: true } });
        if (new Date(employee.updatedAt).getTime() !== new Date(analysis.expectedEmployeeUpdatedAt).getTime() || Number(latest?.sequence || 0) !== Number(analysis.latestLifecycleSequence)) throw businessError(409, 'EMPLOYEE_CHANGE_SUBMIT_BASE_CHANGED', 'Employee Master changed while the revision was being submitted. Refresh and resubmit.');
        const revision = request.currentRevision + 1;
        await tx.employeeChangeRequestRevision.create({ data: { requestId: id, revision, baseEmployeeUpdatedAt: new Date(analysis.expectedEmployeeUpdatedAt), baseLifecycleSequence: analysis.latestLifecycleSequence, beforeSnapshot: analysis.currentState, afterSnapshot: analysis.proposedState, changedFields: analysis.changedFields, effectiveMode: analysis.effectiveMode, effectiveDate: analysis.effectiveMode === 'FUTURE_EFFECTIVE' ? lifecycle.dateOnly(analysis.effectiveDate) : null, reason: analysis.reason, submittedByUserId: actor.sub, submittedByRoleSnapshot: actor.role, proposalHash: mutationModule.proposalHash({ changes: analysis.changes, effectiveMode: analysis.effectiveMode, effectiveDate: analysis.effectiveDate, reason: analysis.reason }) } });
        await tx.employeeChangeRequest.update({ where: { id }, data: { status: 'PENDING_APPROVAL', currentRevision: revision, draftProposal: analysis.changes, draftEffectiveMode: analysis.effectiveMode, draftEffectiveDate: analysis.effectiveMode === 'FUTURE_EFFECTIVE' ? lifecycle.dateOnly(analysis.effectiveDate) : null, draftReason: analysis.reason, lastReviewerComment: null } });
        await createEvent(tx, { requestId: id, employeeId: request.employeeId, revision, action, fromStatus: expectedStatus, toStatus: 'PENDING_APPROVAL', actor, metadata: { impacts: analysis.impacts, warningCodes: analysis.warnings.map((warning) => warning.code) }, idempotencyKey });
        await auditTransition(tx, { actor, requestId: id, action, fromStatus: expectedStatus, toStatus: 'PENDING_APPROVAL', revision, metadata: { changedFields: analysis.changedFields } });
        await auditService.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'EmployeeChangeRequestRevision', entityId: id, metadata: { requestId: id, revision, employeeId: request.employeeId, changedFields: analysis.changedFields } }, tx);
        return { request: await findWithHistory(id, tx), idempotent: false };
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error?.code === 'P2002' || error?.code === 'P2034') throw businessError(409, 'EMPLOYEE_CHANGE_SUBMIT_CONFLICT', 'Employee change submission conflicted with another operation.');
      throw error;
    }
  }

  const submit = (input) => createRevisionTransition({ ...input, expectedStatus: 'DRAFT', action: 'SUBMIT' });
  const resubmit = (input) => createRevisionTransition({ ...input, expectedStatus: 'RETURNED_FOR_CORRECTION', action: 'RESUBMIT' });

  async function returnForCorrection({ id, actor, comment, idempotencyKey }) {
    assertAdmin(actor); const reason = requiredComment(comment, 'EMPLOYEE_CHANGE_RETURN_COMMENT_REQUIRED');
    return prismaClient.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employee_change_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const request = await tx.employeeChangeRequest.findUnique({ where: { id }, include: { revisions: { where: { revision: { gt: 0 } }, orderBy: { revision: 'desc' }, take: 1 } } });
      if (!request) throw businessError(404, 'EMPLOYEE_CHANGE_REQUEST_NOT_FOUND', 'Employee change request not found.');
      if (request.status !== 'PENDING_APPROVAL') throw businessError(409, 'EMPLOYEE_CHANGE_INVALID_TRANSITION', 'Only pending requests can be returned.');
      const revision = request.revisions[0]; if (!revision || revision.revision !== request.currentRevision) throw businessError(409, 'EMPLOYEE_CHANGE_REVISION_MISSING', 'Current submitted revision is unavailable.');
      const intent = changesFromRevision(revision);
      await tx.employeeChangeRequest.update({ where: { id }, data: { status: 'RETURNED_FOR_CORRECTION', draftProposal: intent, draftEffectiveMode: revision.effectiveMode, draftEffectiveDate: revision.effectiveDate, draftReason: revision.reason, lastReviewerComment: reason } });
      await createEvent(tx, { requestId: id, employeeId: request.employeeId, revision: revision.revision, action: 'RETURN_FOR_CORRECTION', fromStatus: 'PENDING_APPROVAL', toStatus: 'RETURNED_FOR_CORRECTION', actor, reason, idempotencyKey: uuid(idempotencyKey) });
      await auditTransition(tx, { actor, requestId: id, action: 'RETURN_FOR_CORRECTION', fromStatus: 'PENDING_APPROVAL', toStatus: 'RETURNED_FOR_CORRECTION', revision: revision.revision, reasonProvided: true });
      return findWithHistory(id, tx);
    }, TRANSACTION_OPTIONS);
  }

  async function reject({ id, actor, reason, idempotencyKey }) {
    assertAdmin(actor); const safe = requiredComment(reason, 'EMPLOYEE_CHANGE_REJECTION_REASON_REQUIRED');
    return prismaClient.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employee_change_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const request = await tx.employeeChangeRequest.findUnique({ where: { id } });
      if (!request) throw businessError(404, 'EMPLOYEE_CHANGE_REQUEST_NOT_FOUND', 'Employee change request not found.');
      if (request.status === 'REJECTED') return findWithHistory(id, tx);
      if (request.status !== 'PENDING_APPROVAL') throw businessError(409, 'EMPLOYEE_CHANGE_INVALID_TRANSITION', 'Only pending requests can be rejected.');
      await tx.employeeChangeRequest.update({ where: { id }, data: { status: 'REJECTED', activeEmployeeId: null, rejectedAt: clock(), lastReviewerComment: safe } });
      await createEvent(tx, { requestId: id, employeeId: request.employeeId, revision: request.currentRevision, action: 'REJECT', fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED', actor, reason: safe, idempotencyKey: uuid(idempotencyKey) });
      await auditTransition(tx, { actor, requestId: id, action: 'REJECT', fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED', revision: request.currentRevision, reasonProvided: true });
      return findWithHistory(id, tx);
    }, TRANSACTION_OPTIONS);
  }

  async function cancel({ id, actor, reason = null, idempotencyKey }) {
    const safe = reason ? requiredComment(reason, 'EMPLOYEE_CHANGE_CANCEL_REASON_INVALID') : null;
    return prismaClient.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employee_change_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const request = await tx.employeeChangeRequest.findUnique({ where: { id } });
      if (!request) throw businessError(404, 'EMPLOYEE_CHANGE_REQUEST_NOT_FOUND', 'Employee change request not found.');
      assertManagerOwner(request, actor);
      if (request.status === 'CANCELLED') return findWithHistory(id, tx);
      if (!ACTIVE_STATUSES.includes(request.status)) throw businessError(409, 'EMPLOYEE_CHANGE_INVALID_TRANSITION', 'Only an active request can be cancelled by its owner.');
      const fromStatus = request.status;
      await tx.employeeChangeRequest.update({ where: { id }, data: { status: 'CANCELLED', activeEmployeeId: null, cancelledAt: clock() } });
      await createEvent(tx, { requestId: id, employeeId: request.employeeId, revision: request.currentRevision || null, action: 'CANCEL', fromStatus, toStatus: 'CANCELLED', actor, reason: safe, idempotencyKey: uuid(idempotencyKey) });
      await auditTransition(tx, { actor, requestId: id, action: 'CANCEL', fromStatus, toStatus: 'CANCELLED', revision: request.currentRevision || null, reasonProvided: Boolean(safe) });
      return findWithHistory(id, tx);
    }, TRANSACTION_OPTIONS);
  }

  async function recordStaleConflict({ id, actor, revision, conflict }) {
    try {
      await prismaClient.$transaction(async (tx) => {
        const request = await tx.employeeChangeRequest.findUnique({ where: { id } });
        if (!request || request.status !== 'PENDING_APPROVAL') return;
        await createEvent(tx, { requestId: id, employeeId: request.employeeId, revision, action: 'STALE_CONFLICT', fromStatus: 'PENDING_APPROVAL', toStatus: 'PENDING_APPROVAL', actor, metadata: { conflict }, idempotencyKey: crypto.randomUUID() });
        await auditTransition(tx, { actor, requestId: id, action: 'STALE_CONFLICT', fromStatus: 'PENDING_APPROVAL', toStatus: 'PENDING_APPROVAL', revision, metadata: { conflict } });
      }, TRANSACTION_OPTIONS);
    } catch { /* stale conflict telemetry must not change approval failure semantics */ }
  }

  async function approve({ id, actor, idempotencyKey, acknowledgeWarnings = false }) {
    assertAdmin(actor); uuid(idempotencyKey);
    const base = await prismaClient.employeeChangeRequest.findUnique({ where: { id }, include: { revisions: { where: { revision: { gt: 0 } }, orderBy: { revision: 'desc' }, take: 1 } } });
    if (!base) throw businessError(404, 'EMPLOYEE_CHANGE_REQUEST_NOT_FOUND', 'Employee change request not found.');
    if (base.status === 'APPROVED') return { request: await findWithHistory(id), idempotent: true };
    if (base.status !== 'PENDING_APPROVAL') throw businessError(409, 'EMPLOYEE_CHANGE_INVALID_TRANSITION', 'Only pending requests can be approved.');
    const revision = base.revisions[0]; if (!revision || revision.revision !== base.currentRevision) throw businessError(409, 'EMPLOYEE_CHANGE_REVISION_MISSING', 'Current submitted revision is unavailable.');
    const changes = changesFromRevision(revision);
    const impact = await masterMutation.preflight({ employeeId: base.employeeId, actorRole: 'ADMIN', fieldScope: 'MANAGER', changes, effectiveMode: revision.effectiveMode, effectiveDate: revision.effectiveDate, reason: revision.reason });
    if (impact.warnings.length && acknowledgeWarnings !== true) throw businessError(409, 'EMPLOYEE_CHANGE_WARNINGS_REQUIRE_CONFIRMATION', 'Review and acknowledge Employee change impacts before approval.', { preflight: impact });
    try {
      return await prismaClient.$transaction(async (tx) => {
        if (typeof tx.$executeRaw === 'function') await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lifecycle.LIFECYCLE_LOCK})`;
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT id FROM employee_change_requests WHERE id = ${id}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM employees WHERE id = ${base.employeeId}::uuid FOR UPDATE`;
        }
        const request = await tx.employeeChangeRequest.findUnique({ where: { id } });
        if (request.status === 'APPROVED') return { request: await findWithHistory(id, tx), idempotent: true };
        if (request.status !== 'PENDING_APPROVAL' || request.currentRevision !== revision.revision) throw businessError(409, 'EMPLOYEE_CHANGE_INVALID_TRANSITION', 'Request changed before approval.');
        const result = await masterMutation.applyInTransaction(tx, { employeeId: request.employeeId, actorUserId: actor.sub, actorRole: actor.role, fieldScope: 'MANAGER', changes, effectiveMode: revision.effectiveMode, effectiveDate: revision.effectiveDate, reason: revision.reason, expectedEmployeeUpdatedAt: revision.baseEmployeeUpdatedAt, expectedLifecycleSequence: revision.baseLifecycleSequence, idempotencyKey: crypto.randomUUID(), sourceChangeRequestId: id, sourceChangeRequestRevision: revision.revision, staleCode: 'EMPLOYEE_CHANGE_STALE_MASTER' });
        const now = clock();
        await tx.employeeChangeRequest.update({ where: { id }, data: { status: 'APPROVED', activeEmployeeId: null, approvedRevision: revision.revision, approvedAt: now, appliedAt: result.applied ? now : null, lastReviewerComment: null } });
        await createEvent(tx, { requestId: id, employeeId: request.employeeId, revision: revision.revision, action: 'APPROVE', fromStatus: 'PENDING_APPROVAL', toStatus: 'APPROVED', actor, metadata: { lifecycleEventId: result.lifecycleEvent.id, applied: result.applied, effectiveMode: revision.effectiveMode }, idempotencyKey });
        await auditTransition(tx, { actor, requestId: id, action: 'APPROVE', fromStatus: 'PENDING_APPROVAL', toStatus: 'APPROVED', revision: revision.revision, metadata: { lifecycleEventId: result.lifecycleEvent.id, applied: result.applied } });
        return { request: await findWithHistory(id, tx), mutation: result, preflight: impact, idempotent: false };
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error?.details?.code === 'EMPLOYEE_CHANGE_STALE_MASTER') await recordStaleConflict({ id, actor, revision: revision.revision, conflict: error.details.conflict });
      if (error?.code === 'P2002') throw businessError(409, 'EMPLOYEE_MASTER_UNIQUE_CONFLICT', 'Employee code or contact email already exists.');
      if (error?.code === 'P2034') throw businessError(409, 'EMPLOYEE_CHANGE_STALE_MASTER', 'Employee Master changed concurrently.');
      throw error;
    }
  }

  return { list, listForEmployee, getById, createDraft, saveDraft, submit, resubmit, returnForCorrection, reject, cancel, approve };
}

module.exports = { REQUEST_LOCK, TRANSACTION_OPTIONS, ACTIVE_STATUSES, TERMINAL_STATUSES, changesFromRevision, createEmployeeChangeRequestService };