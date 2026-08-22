'use strict';

const APPROVAL_TRANSITIONS = Object.freeze({
  SAVE_DRAFT: 'SAVE_DRAFT',
  SUBMIT: 'SUBMIT',
  RETURN_FOR_CORRECTION: 'RETURN_FOR_CORRECTION',
  RESUBMIT: 'RESUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CANCEL: 'CANCEL'
});

const APPROVAL_OUTCOMES = Object.freeze({
  ADVANCE_STAGE: 'ADVANCE_STAGE',
  FINAL_APPROVED: 'FINAL_APPROVED',
  RETURNED: 'RETURNED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
});

const WORKFLOW_AUDIT_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  SAVE_DRAFT: 'SAVE_DRAFT',
  SUBMIT: 'SUBMIT',
  RETURN_FOR_CORRECTION: 'RETURN_FOR_CORRECTION',
  RESUBMIT: 'RESUBMIT',
  STAGE_APPROVE: 'STAGE_APPROVE',
  FINAL_APPROVE: 'FINAL_APPROVE',
  REJECT: 'REJECT',
  CANCEL: 'CANCEL'
});

const transitionValues = new Set(Object.values(APPROVAL_TRANSITIONS));
const auditActionValues = new Set(Object.values(WORKFLOW_AUDIT_ACTIONS));

class ApprovalTransitionError extends Error {
  constructor({ workflow, status, transition }) {
    super(`Transition ${transition} is not allowed from ${status} for ${workflow}.`);
    this.name = 'ApprovalTransitionError';
    this.code = 'APPROVAL_TRANSITION_NOT_ALLOWED';
    this.workflow = workflow;
    this.status = status;
    this.transition = transition;
  }
}

function assertApprovalTransitionAllowed({ workflow, status, transition, allowedTransitions }) {
  if (!transitionValues.has(transition)) throw new TypeError(`Unknown approval transition: ${transition}`);
  const allowed = allowedTransitions?.[status] || [];
  if (!allowed.includes(transition)) throw new ApprovalTransitionError({ workflow, status, transition });
  return transition;
}

function approvalOutcomeFor({ transition, hasNextReviewStage = false }) {
  switch (transition) {
    case APPROVAL_TRANSITIONS.APPROVE:
      return hasNextReviewStage ? APPROVAL_OUTCOMES.ADVANCE_STAGE : APPROVAL_OUTCOMES.FINAL_APPROVED;
    case APPROVAL_TRANSITIONS.RETURN_FOR_CORRECTION:
      return APPROVAL_OUTCOMES.RETURNED;
    case APPROVAL_TRANSITIONS.REJECT:
      return APPROVAL_OUTCOMES.REJECTED;
    case APPROVAL_TRANSITIONS.CANCEL:
      return APPROVAL_OUTCOMES.CANCELLED;
    case APPROVAL_TRANSITIONS.SUBMIT:
    case APPROVAL_TRANSITIONS.RESUBMIT:
      return APPROVAL_OUTCOMES.ADVANCE_STAGE;
    case APPROVAL_TRANSITIONS.SAVE_DRAFT:
      return null;
    default:
      throw new TypeError(`Unknown approval transition: ${transition}`);
  }
}

function workflowAuditActionFor({ transition, hasNextReviewStage = false, isCreate = false }) {
  if (isCreate) return WORKFLOW_AUDIT_ACTIONS.CREATE;
  switch (transition) {
    case APPROVAL_TRANSITIONS.SAVE_DRAFT: return WORKFLOW_AUDIT_ACTIONS.SAVE_DRAFT;
    case APPROVAL_TRANSITIONS.SUBMIT: return WORKFLOW_AUDIT_ACTIONS.SUBMIT;
    case APPROVAL_TRANSITIONS.RETURN_FOR_CORRECTION: return WORKFLOW_AUDIT_ACTIONS.RETURN_FOR_CORRECTION;
    case APPROVAL_TRANSITIONS.RESUBMIT: return WORKFLOW_AUDIT_ACTIONS.RESUBMIT;
    case APPROVAL_TRANSITIONS.APPROVE: return hasNextReviewStage ? WORKFLOW_AUDIT_ACTIONS.STAGE_APPROVE : WORKFLOW_AUDIT_ACTIONS.FINAL_APPROVE;
    case APPROVAL_TRANSITIONS.REJECT: return WORKFLOW_AUDIT_ACTIONS.REJECT;
    case APPROVAL_TRANSITIONS.CANCEL: return WORKFLOW_AUDIT_ACTIONS.CANCEL;
    default: throw new TypeError(`Unknown approval transition: ${transition}`);
  }
}

function buildWorkflowAuditEnvelope({ workflow, requestId, revision = null, actorUserId = null, actorRole = null, fromStatus = null, fromStage = null, toStatus = null, toStage = null, action, reason = null, comment = null, timestamp = new Date() }) {
  if (!workflow || !requestId) throw new TypeError('workflow and requestId are required for workflow audit metadata.');
  if (!auditActionValues.has(action)) throw new TypeError(`Unknown workflow audit action: ${action}`);
  const at = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  return {
    workflow,
    requestId,
    revision,
    actorUserId,
    actorRole,
    fromStatus,
    fromStage,
    toStatus,
    toStage,
    action,
    reason,
    comment,
    timestamp: at
  };
}

module.exports = {
  APPROVAL_TRANSITIONS,
  APPROVAL_OUTCOMES,
  WORKFLOW_AUDIT_ACTIONS,
  ApprovalTransitionError,
  assertApprovalTransitionAllowed,
  approvalOutcomeFor,
  workflowAuditActionFor,
  buildWorkflowAuditEnvelope
};