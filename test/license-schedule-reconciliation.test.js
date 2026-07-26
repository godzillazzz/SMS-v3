process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { licenseStateForWorkDate } = require('../src/services/license-state.service');
const { buildLicenseScheduleReconciliation } = require('../src/services/license-schedule-reconciliation.service');

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
