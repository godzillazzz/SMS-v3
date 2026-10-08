process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const routes = source('src/routes/operations.routes.js');
const documents = source('src/services/license-document.service.js');
const reconciliation = source('src/services/license-schedule-reconciliation.service.js');
const schedules = source('src/services/schedule.service.js');

test('license lifecycle retains reconciliation and manual schedule license controls', () => {
  assert.match(routes, /reconcileAllEmployeeLicenseSchedules\(prisma\)/);
  for (const record of ['license', 'after', 'before']) assert.ok(routes.includes('await reconcileEmployeeLicenseSchedules(tx, ' + record + '.employeeId, req.user.sub)'));
  assert.match(documents, /await reconcileSchedules\(tx, license.employeeId, requestUser.sub\)/);
  assert.match(schedules, /licenseStateForWorkDate/);
  assert.match(schedules, /License Block:/);
  assert.match(schedules, /licenseOverride/);
});

test('automatic reconciliation has a Bangkok cutoff and no approval or Attendance writes', () => {
  assert.match(reconciliation, /Asia\/Bangkok/);
  assert.match(reconciliation, /workDate: \{ gte: cutoff \}/);
  assert.doesNotMatch(reconciliation, /tx\.scheduleApproval|touchApproval|tx\.attendance/);
  assert.match(reconciliation, /entityType: 'LicenseScheduleReconciliation'/);
  assert.match(reconciliation, /scheduleApprovalChanged: false/);
  assert.match(documents, /tx\.employeeLicense\.update\(/);
  assert.match(documents, /audit\.log\(/);
});
