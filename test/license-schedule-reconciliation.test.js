process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLicenseScheduleReconciliation } = require('../src/services/license-schedule-reconciliation.service');

const shifts = [
  { id: 'd', code: 'D', startTime: '08:00', endTime: '20:00', hours: 12 },
  { id: 'n', code: 'N', startTime: '20:00', endTime: '08:00', hours: 12 },
  { id: 'off', code: 'OFF', startTime: null, endTime: null, hours: 0 },
  { id: 'al', code: 'AL', startTime: null, endTime: null, hours: 0 }
];

test('license reconciliation blocks only current or future unprotected working shifts', () => {
  const plan = buildLicenseScheduleReconciliation({
    licenses: [], shiftTypes: shifts, asOf: new Date('2026-07-10T00:00:00Z'),
    assignments: [
      { id: 'future', workDate: new Date('2026-07-11T00:00:00Z'), shiftType: { code: 'D' }, locked: false, licenseOverride: false, licenseStatus: 'VALID' },
      { id: 'past', workDate: new Date('2026-07-09T00:00:00Z'), shiftType: { code: 'N' }, locked: false, licenseOverride: false, licenseStatus: 'VALID' },
      { id: 'locked', workDate: new Date('2026-07-11T00:00:00Z'), shiftType: { code: 'D' }, locked: true, licenseOverride: false, licenseStatus: 'VALID' }
    ]
  });
  assert.equal(plan.summary.blocked, 1);
  assert.equal(plan.summary.skippedHistorical, 1);
  assert.equal(plan.summary.skippedProtected, 1);
  assert.deepEqual(plan.updates[0].data, { shiftTypeId: 'off', startTime: null, endTime: null, hours: 0, remark: 'License Block: [D]', licenseStatus: 'MISSING', licenseExpiryDate: null, licenseOverride: false, overrideReason: null, overrideAt: null });
});

test('license reconciliation restores only OFF shifts previously blocked by license automation', () => {
  const plan = buildLicenseScheduleReconciliation({
    licenses: [{ status: 'Active', issueDate: new Date('2026-07-01T00:00:00Z'), expiryDate: new Date('2026-12-31T00:00:00Z') }], shiftTypes: shifts, asOf: new Date('2026-07-10T00:00:00Z'),
    assignments: [
      { id: 'restore', workDate: new Date('2026-07-11T00:00:00Z'), shiftType: { code: 'OFF' }, remark: 'License Block: [N]', locked: false, licenseOverride: false, licenseStatus: 'EXPIRED' },
      { id: 'normal-off', workDate: new Date('2026-07-11T00:00:00Z'), shiftType: { code: 'OFF' }, remark: 'Weekly off', locked: false, licenseOverride: false, licenseStatus: 'NOT_REQUIRED' }
    ]
  });
  assert.equal(plan.summary.restored, 1);
  assert.equal(plan.updates[0].data.shiftTypeId, 'n');
  assert.equal(plan.updates[0].data.remark, null);
});
