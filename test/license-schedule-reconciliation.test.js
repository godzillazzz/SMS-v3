process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { licenseStateForWorkDate, buildLicenseAuthorityByEmployee } = require('../src/services/license-state.service');
const { buildLicenseScheduleReconciliation, applyReconciliationUpdates, touchApproval } = require('../src/services/license-schedule-reconciliation.service');

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

test('reconciliation can restore a historical shift that was incorrectly blocked after license renewal', () => {
  const employeeId = 'employee-restore';
  const licenseId = 'license-restore';
  const authority = buildLicenseAuthorityByEmployee([
    { id: licenseId, employeeId, status: 'Active', issueDate: new Date('2026-09-01T00:00:00Z'), expiryDate: new Date('2027-08-31T00:00:00Z') }
  ], [
    { employeeId, licenseId, status: 'SUPERSEDED', proposedStartDate: new Date('2025-09-01T00:00:00Z'), proposedExpiryDate: new Date('2026-08-31T00:00:00Z') },
    { employeeId, licenseId, status: 'APPROVED', proposedStartDate: new Date('2026-09-01T00:00:00Z'), proposedExpiryDate: new Date('2027-08-31T00:00:00Z') }
  ]).get(employeeId);
  const plan = buildLicenseScheduleReconciliation({ licenses: authority, shiftTypes: shifts, assignments: [
    { id: 'aug-31', workDate: new Date('2026-08-31T00:00:00Z'), shiftTypeId: 'off', shiftType: { code: 'OFF' }, licenseStatus: 'EXPIRED', licenseOverride: false, remark: 'License Block', licenseBlockedFromShiftTypeId: 'd', licenseBlockedFromRemark: 'historical D shift' }
  ] });
  assert.equal(plan.summary.restored, 1);
  assert.equal(plan.updates[0].data.shiftTypeId, 'd');
  assert.equal(plan.updates[0].data.remark, 'historical D shift');
  assert.equal(plan.updates[0].data.licenseStatus, 'VALID');
});
test('reconciliation blocks invalid work days, preserves Admin overrides, and restores after renewal', () => {
  const plan = buildLicenseScheduleReconciliation({
    licenses: [oldLicense, renewedLicense], shiftTypes: shifts,
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
test('license reconciliation creates the next pending schedule revision after an approved month', async () => {
  const month = new Date('2026-09-01T00:00:00Z');
  const calls = [];
  const tx = {
    scheduleApproval: {
      findFirst: async ({ where }) => where.status === 'APPROVED' ? { revision: 4 } : null,
      create: async ({ data }) => { calls.push({ type: 'create', data }); return { id: 'pending-5', ...data }; },
      update: async ({ where, data }) => { calls.push({ type: 'update', where, data }); return { id: where.id, ...data }; }
    }
  };
  const result = await touchApproval(tx, month, 'admin-1');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.revision, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'create');
  assert.equal(calls[0].data.changeType, 'LICENSE_RECONCILIATION');
});

test('license reconciliation reuses an existing pending schedule approval instead of creating a duplicate revision', async () => {
  const month = new Date('2026-09-01T00:00:00Z');
  const calls = [];
  let lookup = 0;
  const tx = {
    scheduleApproval: {
      findFirst: async () => (++lookup === 1 ? { revision: 4 } : { id: 'pending-5' }),
      create: async ({ data }) => { calls.push({ type: 'create', data }); return data; },
      update: async ({ where, data }) => { calls.push({ type: 'update', where, data }); return { id: where.id, status: 'PENDING', revision: 5, ...data }; }
    }
  };
  const result = await touchApproval(tx, month, 'admin-1');
  assert.equal(result.id, 'pending-5');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'update');
});
