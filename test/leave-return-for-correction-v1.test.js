const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'src/routes/operations.routes.js'), 'utf8');
const notification = fs.readFileSync(path.join(root, 'src/services/notification-email.service.js'), 'utf8');

test('Leave Return for Correction exposes the Owner-locked transitions', () => {
  assert.match(routes, /router\.post\('\/leave-requests\/:id\/return-for-correction'/);
  assert.match(routes, /status: 'RETURNED_FOR_CORRECTION'/);
  assert.match(routes, /workflowAction: 'RETURN_FOR_CORRECTION'/);
  assert.match(routes, /router\.put\('\/leave-requests\/:id\/correction'/);
  assert.match(routes, /workflowAction: 'EDIT_RETURNED_REQUEST'/);
  assert.match(routes, /router\.post\('\/leave-requests\/:id\/resubmit'/);
  assert.match(routes, /workflowAction: 'RESUBMIT'/);
  assert.match(routes, /data: \{ status: 'PENDING'/);
});

test('return and cancel reasons are mandatory', () => {
  assert.match(routes, /leaveWorkflowReasonInput = z\.object\(\{ reason: z\.string\(\)\.trim\(\)\.min\(3\)\.max\(2000\) \}\)/);
  assert.match(routes, /return-for-correction[\s\S]*leaveWorkflowReasonInput\.parse/);
  assert.match(routes, /leave-requests\/:id\/cancel'[\s\S]*leaveWorkflowReasonInput\.parse/);
});

test('returned request edits and cancellation retain the same LeaveRequest identity', () => {
  const correction = routes.slice(routes.indexOf("router.put('/leave-requests/:id/correction'"), routes.indexOf("router.post('/leave-requests/:id/resubmit'"));
  const resubmit = routes.slice(routes.indexOf("router.post('/leave-requests/:id/resubmit'"), routes.indexOf("router.put('/leave-requests/:id'"));
  assert.match(correction, /tx\.leaveRequest\.update\(\{\s*where: \{ id \}/);
  assert.doesNotMatch(correction, /leaveRequest\.create/);
  assert.match(resubmit, /tx\.leaveRequest\.update\(\{ where: \{ id \}/);
  assert.doesNotMatch(resubmit, /leaveRequest\.create/);
});

test('returned requests remain active overlap blockers while cancelled requests do not', () => {
  assert.match(routes, /LEAVE_OVERLAP_ACTIVE_STATUSES = \['PENDING', 'APPROVED', 'RETURNED_FOR_CORRECTION'\]/);
  assert.match(routes, /status: \{ in: LEAVE_OVERLAP_ACTIVE_STATUSES \}/);
  assert.doesNotMatch(routes, /LEAVE_OVERLAP_ACTIVE_STATUSES[^\n]*CANCELLED/);
});

test('returned cancellation is requester/original-creator scoped and approved cancellation is Admin only', () => {
  const cancel = routes.slice(routes.indexOf("router.post('/leave-requests/:id/cancel'"), routes.indexOf("router.post('/leave-quotas'"));
  assert.match(cancel, /before\.status === 'RETURNED_FOR_CORRECTION'/);
  assert.match(cancel, /assertReturnedLeaveOwner\(before, actor\)/);
  assert.match(cancel, /RETURNED_REQUEST_OWNER_CANCEL/);
  assert.match(cancel, /before\.status === 'APPROVED'/);
  assert.match(cancel, /actor\.role !== 'ADMIN'/);
  assert.match(cancel, /APPROVED_ADMIN_REVERSAL/);
  assert.match(cancel, /LEAVE_CANCEL_INVALID_STATE/);
});

test('approved cancellation restores derived quota exactly once through locked state transition', () => {
  const cancel = routes.slice(routes.indexOf("router.post('/leave-requests/:id/cancel'"), routes.indexOf("router.post('/leave-quotas'"));
  assert.match(cancel, /SELECT id FROM leave_requests WHERE id = \$\{id\}::uuid FOR UPDATE/);
  assert.match(cancel, /persistedUsageByQuotaYear\(before\)/);
  assert.match(cancel, /affectedQuotaYears/);
  assert.match(cancel, /status: 'CANCELLED'/);
  assert.match(cancel, /quotaRecalculatedByApprovedStatus: before\.status === 'APPROVED'/);
  assert.doesNotMatch(cancel, /quota[^\n]*increment/i);
  assert.doesNotMatch(cancel, /quota[^\n]*decrement/i);
});

test('workflow audit and notifications cover return, resubmit and cancellation', () => {
  for (const event of ['RETURN_FOR_CORRECTION', 'EDIT_RETURNED_REQUEST', 'RESUBMIT', 'CANCEL']) {
    assert.match(routes, new RegExp(`workflowAction: '${event}'`));
  }
  assert.match(notification, /LEAVE_RETURNED_FOR_CORRECTION/);
  assert.match(notification, /LEAVE_RESUBMITTED/);
  assert.match(notification, /eventType = 'LEAVE_CREATED'/);
  assert.match(notification, /'leave:' \+ leaveRequest\.id \+ ':' \+ eventType/);
});

test('P2028 Leave Create semantics remain unchanged in the feature source', () => {
  const tx = fs.readFileSync(path.join(root, 'src/services/leave-transaction.service.js'), 'utf8');
  assert.match(tx, /isolationLevel: 'ReadCommitted'/);
  assert.match(tx, /maxWait: 5000/);
  assert.match(tx, /timeout: 15000/);
  assert.match(tx, /LEAVE_TRANSACTION_TIMEOUT/);
  assert.match(tx, /LEAVE_QUOTA_STATE_CONFLICT/);
});