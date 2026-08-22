const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APPROVAL_TRANSITIONS,
  APPROVAL_OUTCOMES,
  WORKFLOW_AUDIT_ACTIONS,
  assertApprovalTransitionAllowed,
  approvalOutcomeFor,
  workflowAuditActionFor,
  buildWorkflowAuditEnvelope
} = require('../src/services/approval-workflow-semantics');

test('shared approval semantics distinguish stage approval from final approval', () => {
  assert.equal(approvalOutcomeFor({ transition: APPROVAL_TRANSITIONS.APPROVE, hasNextReviewStage: true }), APPROVAL_OUTCOMES.ADVANCE_STAGE);
  assert.equal(approvalOutcomeFor({ transition: APPROVAL_TRANSITIONS.APPROVE, hasNextReviewStage: false }), APPROVAL_OUTCOMES.FINAL_APPROVED);
  assert.equal(workflowAuditActionFor({ transition: APPROVAL_TRANSITIONS.APPROVE, hasNextReviewStage: true }), WORKFLOW_AUDIT_ACTIONS.STAGE_APPROVE);
  assert.equal(workflowAuditActionFor({ transition: APPROVAL_TRANSITIONS.APPROVE, hasNextReviewStage: false }), WORKFLOW_AUDIT_ACTIONS.FINAL_APPROVE);
});

test('shared approval semantics keep Return, Reject and Cancel distinct', () => {
  assert.equal(approvalOutcomeFor({ transition: APPROVAL_TRANSITIONS.RETURN_FOR_CORRECTION }), APPROVAL_OUTCOMES.RETURNED);
  assert.equal(approvalOutcomeFor({ transition: APPROVAL_TRANSITIONS.REJECT }), APPROVAL_OUTCOMES.REJECTED);
  assert.equal(approvalOutcomeFor({ transition: APPROVAL_TRANSITIONS.CANCEL }), APPROVAL_OUTCOMES.CANCELLED);
  assert.equal(workflowAuditActionFor({ transition: APPROVAL_TRANSITIONS.RETURN_FOR_CORRECTION }), WORKFLOW_AUDIT_ACTIONS.RETURN_FOR_CORRECTION);
  assert.equal(workflowAuditActionFor({ transition: APPROVAL_TRANSITIONS.REJECT }), WORKFLOW_AUDIT_ACTIONS.REJECT);
  assert.equal(workflowAuditActionFor({ transition: APPROVAL_TRANSITIONS.CANCEL }), WORKFLOW_AUDIT_ACTIONS.CANCEL);
});

test('allowed-transition guard remains module-policy driven', () => {
  const policy = {
    PENDING_APPROVAL: [APPROVAL_TRANSITIONS.APPROVE, APPROVAL_TRANSITIONS.RETURN_FOR_CORRECTION, APPROVAL_TRANSITIONS.REJECT],
    RETURNED_FOR_CORRECTION: [APPROVAL_TRANSITIONS.RESUBMIT, APPROVAL_TRANSITIONS.CANCEL]
  };
  assert.equal(assertApprovalTransitionAllowed({ workflow: 'EMPLOYEE_MASTER', status: 'PENDING_APPROVAL', transition: APPROVAL_TRANSITIONS.APPROVE, allowedTransitions: policy }), APPROVAL_TRANSITIONS.APPROVE);
  assert.throws(
    () => assertApprovalTransitionAllowed({ workflow: 'EMPLOYEE_MASTER', status: 'PENDING_APPROVAL', transition: APPROVAL_TRANSITIONS.CANCEL, allowedTransitions: policy }),
    (error) => error.code === 'APPROVAL_TRANSITION_NOT_ALLOWED'
  );
});

test('workflow audit envelope records normalized transition context without business payload', () => {
  const metadata = buildWorkflowAuditEnvelope({
    workflow: 'EMPLOYEE_MASTER',
    requestId: 'request-1',
    revision: 2,
    actorUserId: 'actor-1',
    actorRole: 'ADMIN',
    fromStatus: 'PENDING_APPROVAL',
    fromStage: 'ADMIN_REVIEW',
    toStatus: 'APPROVED',
    toStage: 'COMPLETED',
    action: WORKFLOW_AUDIT_ACTIONS.FINAL_APPROVE,
    comment: null,
    timestamp: new Date('2026-08-22T00:00:00.000Z')
  });
  assert.deepEqual(metadata, {
    workflow: 'EMPLOYEE_MASTER', requestId: 'request-1', revision: 2, actorUserId: 'actor-1', actorRole: 'ADMIN',
    fromStatus: 'PENDING_APPROVAL', fromStage: 'ADMIN_REVIEW', toStatus: 'APPROVED', toStage: 'COMPLETED',
    action: 'FINAL_APPROVE', reason: null, comment: null, timestamp: '2026-08-22T00:00:00.000Z'
  });
});