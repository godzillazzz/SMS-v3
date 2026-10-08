process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { licenseStateForWorkDate, buildLicenseAuthorityByEmployee } = require('../src/services/license-state.service');
const { buildLicenseScheduleReconciliation, applyReconciliationUpdates, bangkokToday, reconcileEmployeeLicenseSchedules } = require('../src/services/license-schedule-reconciliation.service');

const shifts = [
  { id: 'd', code: 'D', startTime: '08:00', endTime: '20:00', hours: 12 },
  { id: 'n', code: 'N', startTime: '20:00', endTime: '08:00', hours: 12 },
  { id: 'off', code: 'OFF', startTime: null, endTime: null, hours: 0 },
  { id: 'al', code: 'AL', startTime: null, endTime: null, hours: 0 }
];
const oldLicense = { status: 'Active', issueDate: new Date('2026-01-01T00:00:00Z'), expiryDate: new Date('2026-07-23T00:00:00Z') };
const renewedLicense = { status: 'Active', issueDate: new Date('2026-07-26T00:00:00Z'), expiryDate: new Date('2027-07-25T00:00:00Z') };

test('license validity is calculated for the work date across old and renewed licenses', () => {
  assert.equal(licenseStateForWorkDate([oldLicense, renewedLicense], new Date('2026-07-23T00:00:00Z')).valid, true);
  assert.equal(licenseStateForWorkDate([oldLicense, renewedLicense], new Date('2026-07-24T00:00:00Z')).valid, false);
  assert.equal(licenseStateForWorkDate([oldLicense, renewedLicense], new Date('2026-07-25T00:00:00Z')).valid, false);
  assert.equal(licenseStateForWorkDate([oldLicense, renewedLicense], new Date('2026-07-26T00:00:00Z')).valid, true);
});


test('approved license document history preserves work-date validity across a renewal boundary', () => {
  const employeeId = 'employee-1';
  const licenseId = 'license-1';
  const authority = buildLicenseAuthorityByEmployee([
    { id: licenseId, employeeId, status: 'Active', issueDate: new Date('2026-09-01T00:00:00Z'), expiryDate: new Date('2027-08-31T00:00:00Z') }
  ], [
    { employeeId, licenseId, status: 'SUPERSEDED', proposedStartDate: new Date('2025-09-01T00:00:00Z'), proposedExpiryDate: new Date('2026-08-31T00:00:00Z') },
    { employeeId, licenseId, status: 'APPROVED', proposedStartDate: new Date('2026-09-01T00:00:00Z'), proposedExpiryDate: new Date('2027-08-31T00:00:00Z') }
  ]).get(employeeId);
  const august = licenseStateForWorkDate(authority, new Date('2026-08-31T00:00:00Z'));
  const september = licenseStateForWorkDate(authority, new Date('2026-09-01T00:00:00Z'));
  assert.equal(august.valid, true);
  assert.equal(august.expiryDate.toISOString().slice(0, 10), '2026-08-31');
  assert.equal(september.valid, true);
  assert.equal(september.expiryDate.toISOString().slice(0, 10), '2027-08-31');
});

test('approved renewal document remains scheduling authority when a legacy master still says expired', () => {
  const employeeId = 'employee-legacy';
  const licenseId = 'license-legacy';
  const authority = buildLicenseAuthorityByEmployee([
    { id: licenseId, employeeId, status: 'Expired', issueDate: new Date('2025-01-01T00:00:00Z'), expiryDate: new Date('2026-08-31T00:00:00Z') }
  ], [
    { employeeId, licenseId, status: 'APPROVED', proposedStartDate: new Date('2026-09-01T00:00:00Z'), proposedExpiryDate: new Date('2027-08-31T00:00:00Z') }
  ]).get(employeeId);
  assert.equal(licenseStateForWorkDate(authority, new Date('2026-09-02T00:00:00Z')).valid, true);
});

test('historical documents do not bypass an administratively revoked license', () => {
  const employeeId = 'employee-revoked';
  const licenseId = 'license-revoked';
  const authority = buildLicenseAuthorityByEmployee([
    { id: licenseId, employeeId, status: 'Revoked', issueDate: new Date('2026-01-01T00:00:00Z'), expiryDate: new Date('2027-01-01T00:00:00Z') }
  ], [
    { employeeId, licenseId, status: 'APPROVED', proposedStartDate: new Date('2026-01-01T00:00:00Z'), proposedExpiryDate: new Date('2027-01-01T00:00:00Z') }
  ]).get(employeeId);
  assert.equal(licenseStateForWorkDate(authority, new Date('2026-09-02T00:00:00Z')).valid, false);
});

test('reconciliation preserves a past License Block even when document history now proves validity', () => {
  const employeeId = 'employee-restore';
  const licenseId = 'license-restore';
  const authority = buildLicenseAuthorityByEmployee([
    { id: licenseId, employeeId, status: 'Active', issueDate: new Date('2026-09-01T00:00:00Z'), expiryDate: new Date('2027-08-31T00:00:00Z') }
  ], [
    { employeeId, licenseId, status: 'SUPERSEDED', proposedStartDate: new Date('2025-09-01T00:00:00Z'), proposedExpiryDate: new Date('2026-08-31T00:00:00Z') },
    { employeeId, licenseId, status: 'APPROVED', proposedStartDate: new Date('2026-09-01T00:00:00Z'), proposedExpiryDate: new Date('2027-08-31T00:00:00Z') }
  ]).get(employeeId);
  const plan = buildLicenseScheduleReconciliation({ licenses: authority, shiftTypes: shifts, now: new Date('2026-09-01T00:00:00Z'), assignments: [
    { id: 'aug-31', workDate: new Date('2026-08-31T00:00:00Z'), shiftTypeId: 'off', shiftType: { code: 'OFF' }, licenseStatus: 'EXPIRED', licenseOverride: false, remark: 'License Block', licenseBlockedFromShiftTypeId: 'd', licenseBlockedFromRemark: 'historical D shift' }
  ] });
  assert.equal(plan.summary.restored, 0);
  assert.equal(plan.summary.skippedPast, 1);
  assert.deepEqual(plan.updates, []);
});
test('reconciliation blocks invalid work days, preserves Admin overrides, and restores after renewal', () => {
  const plan = buildLicenseScheduleReconciliation({
    licenses: [oldLicense, renewedLicense], shiftTypes: shifts, now: new Date('2026-07-23T00:00:00Z'),
    assignments: [
      { id: 'valid-before-expiry', workDate: new Date('2026-07-23T00:00:00Z'), shiftTypeId: 'd', shiftType: { code: 'D' }, licenseStatus: 'EXPIRED', licenseOverride: false, remark: null },
      { id: 'admin-override', workDate: new Date('2026-07-24T00:00:00Z'), shiftTypeId: 'n', shiftType: { code: 'N' }, licenseStatus: 'OVERRIDDEN', licenseOverride: true, remark: 'Admin approved coverage' },
      { id: 'block-invalid', workDate: new Date('2026-07-25T00:00:00Z'), shiftTypeId: 'd', shiftType: { code: 'D' }, licenseStatus: 'VALID', licenseOverride: false, remark: 'manual schedule' },
      { id: 'restore-renewed', workDate: new Date('2026-07-26T00:00:00Z'), shiftTypeId: 'off', shiftType: { code: 'OFF' }, licenseStatus: 'EXPIRED', licenseOverride: false, remark: 'License Block', licenseBlockedFromShiftTypeId: 'n', licenseBlockedFromRemark: 'Auto rotating pattern' }
    ]
  });
  assert.equal(plan.summary.validated, 1);
  assert.equal(plan.summary.preservedOverrides, 1);
  assert.equal(plan.summary.blocked, 1);
  assert.equal(plan.summary.restored, 1);
  const blocked = plan.updates.find((update) => update.id === 'block-invalid');
  assert.equal(blocked.data.shiftTypeId, 'off');
  assert.equal(blocked.data.remark, 'License Block');
  assert.equal(blocked.data.licenseBlockedFromShiftTypeId, 'd');
  assert.equal(plan.updates.find((update) => update.id === 'restore-renewed').data.shiftTypeId, 'n');
  assert.equal(plan.updates.some((update) => update.id === 'admin-override'), false);
});

test('reconciliation batches identical assignment writes instead of issuing one database update per day', async () => {
  const calls = [];
  const tx = { shiftAssignment: { updateMany: async (input) => { calls.push(input); return { count: input.where.id.in.length }; } } };
  const expiry = new Date('2027-07-25T00:00:00Z');
  await applyReconciliationUpdates(tx, [
    { id: 'day-1', data: { licenseStatus: 'VALID', licenseExpiryDate: expiry, licenseBlockedAt: null } },
    { id: 'day-2', data: { licenseStatus: 'VALID', licenseExpiryDate: new Date(expiry), licenseBlockedAt: null } },
    { id: 'day-3', data: { licenseStatus: 'EXPIRED', licenseExpiryDate: null, licenseBlockedAt: null } }
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].where.id.in, ['day-1', 'day-2']);
  assert.deepEqual(calls[1].where.id.in, ['day-3']);
});

test('batched reconciliation fails closed when the database updates fewer assignments than planned', async () => {
  const tx = { shiftAssignment: { updateMany: async () => ({ count: 1 }) } };
  await assert.rejects(
    () => applyReconciliationUpdates(tx, [
      { id: 'day-1', data: { licenseStatus: 'VALID' } },
      { id: 'day-2', data: { licenseStatus: 'VALID' } }
    ]),
    /License reconciliation update count mismatch/
  );
});

test('Bangkok midnight advances the immutable historical boundary', () => {
  assert.equal(bangkokToday('2026-10-08T16:59:59.999Z').toISOString(), '2026-10-08T00:00:00.000Z');
  assert.equal(bangkokToday('2026-10-08T17:00:00.000Z').toISOString(), '2026-10-09T00:00:00.000Z');
  assert.throws(() => bangkokToday('invalid'), /Valid reconciliation time/);
  const assignments = [8, 9, 10].map((day) => ({ id: String(day), workDate: new Date('2026-10-' + String(day).padStart(2, '0') + 'T00:00:00Z'), shiftTypeId: 'd', shiftType: { code: 'D' } }));
  const before = buildLicenseScheduleReconciliation({ licenses: [], assignments, shiftTypes: shifts, now: new Date('2026-10-08T16:59:59.999Z') });
  const after = buildLicenseScheduleReconciliation({ licenses: [], assignments, shiftTypes: shifts, now: new Date('2026-10-08T17:00:00.000Z') });
  assert.deepEqual(before.updates.map((row) => row.id), ['8', '9', '10']);
  assert.deepEqual(after.updates.map((row) => row.id), ['9', '10']);
});

test('AL, ordinary OFF and Admin overrides remain outside automatic blocking', () => {
  const assignments = ['AL', 'OFF', 'N'].map((code) => ({ id: code, workDate: new Date('2026-10-09T00:00:00Z'), shiftTypeId: code.toLowerCase(), shiftType: { code }, licenseOverride: code === 'N' }));
  const plan = buildLicenseScheduleReconciliation({ licenses: [], assignments, shiftTypes: shifts, now: new Date('2026-10-09T00:00:00Z') });
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.summary.skippedLeave, 1);
  assert.equal(plan.summary.preservedOverrides, 1);
});

test('reconciliation never accesses approval or Attendance models and audits each change', async () => {
  const now = new Date('2026-10-08T17:00:00.000Z');
  const assignment = { id: 'today', workDate: new Date('2026-10-09T00:00:00Z'), shiftTypeId: 'd', shiftType: { code: 'D' }, remark: 'original schedule' };
  const writes = [];
  const audits = [];
  const tx = {
    employeeLicense: { findMany: async () => [] },
    employeeLicenseDocument: { findMany: async () => [] },
    shiftType: { findMany: async () => shifts },
    shiftAssignment: {
      findMany: async ({ where }) => { assert.deepEqual(where, { employeeId: 'employee-1', workDate: { gte: bangkokToday(now) } }); return [assignment]; },
      updateMany: async (input) => { writes.push(input); return { count: input.where.id.in.length }; }
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    get scheduleApproval() { throw new Error('ScheduleApproval must remain isolated'); },
    get scheduleApprovalEvent() { throw new Error('ScheduleApprovalEvent must remain isolated'); },
    get attendanceEvent() { throw new Error('Attendance must remain isolated'); }
  };
  const result = await reconcileEmployeeLicenseSchedules(tx, 'employee-1', null, { now });
  assert.equal(result.blocked, 1);
  assert.equal(result.affectedAssignments, 1);
  assert.deepEqual(writes[0].where.workDate, { gte: bangkokToday(now) });
  assert.equal(audits[0].entityType, 'LicenseScheduleReconciliation');
  assert.equal(audits[0].metadata.scheduleApprovalChanged, false);
  assert.equal(audits[0].metadata.cutoffDate, '2026-10-09');
  assert.equal(audits[0].metadata.changes[0].before.shiftTypeId, 'd');
  assert.equal(audits[0].metadata.changes[0].after.shiftTypeId, 'off');
  Object.assign(assignment, writes[0].data, { shiftType: { code: 'OFF' } });
  const repeated = await reconcileEmployeeLicenseSchedules(tx, 'employee-1', null, { now });
  assert.equal(repeated.affectedAssignments, 0);
  assert.equal(writes.length, 1);
  assert.equal(audits.length, 1);
});
