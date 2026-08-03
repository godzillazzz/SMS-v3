process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { actionRequired, employeeScope, licenseStatusSummary } = require('../src/services/dashboard.service');

test('dashboard scope keeps ADMIN global, MANAGER department-scoped, and VIEWER employee-scoped', () => {
  assert.deepEqual(employeeScope({ role: 'ADMIN', employeeId: null, department: null }), {});
  assert.deepEqual(employeeScope({ role: 'MANAGER', employeeId: 'employee-1', department: 'Security' }), { department: 'Security' });
  assert.deepEqual(employeeScope({ role: 'VIEWER', employeeId: 'employee-1', department: 'Security' }), { id: 'employee-1' });
  assert.deepEqual(employeeScope({ role: 'VIEWER', employeeId: null, department: null }), { id: '00000000-0000-0000-0000-000000000000' });
});

test('dashboard license status mapping preserves every supported status', () => {
  const summary = licenseStatusSummary([
    { status: 'APPROVED', _count: { _all: 4 } },
    { status: 'RETURNED_FOR_CORRECTION', _count: { _all: 2 } },
    { status: 'EXPIRED', _count: { _all: 1 } }
  ]);
  assert.deepEqual(summary, { PENDING: 0, APPROVED: 4, RETURNED_FOR_CORRECTION: 2, REJECTED: 0, EXPIRED: 1, SUPERSEDED: 0 });
});

test('dashboard action required contains only positive counts and preserves role visibility', () => {
  const input = { licenseSummary: { PENDING: 2, RETURNED_FOR_CORRECTION: 1, EXPIRED: 0 }, expiringLicenses: 3, pendingLeaves: 4, notScheduledToday: 1, unmatchedQuotas: 5 };
  const adminRows = actionRequired(input, true, true);
  assert.deepEqual(adminRows.map((row) => row.key), ['licensePending', 'licenseReturned', 'licenseExpiring', 'pendingLeaves', 'missingSchedule', 'unmatchedQuota']);
  const viewerRows = actionRequired(input, false, false);
  assert.deepEqual(viewerRows.map((row) => row.key), ['licensePending', 'licenseReturned', 'licenseExpiring', 'missingSchedule']);
});
