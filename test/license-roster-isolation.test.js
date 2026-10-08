process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'src/routes/operations.routes.js'), 'utf8');
const documentService = fs.readFileSync(path.join(root, 'src/services/license-document.service.js'), 'utf8');
const scheduleService = fs.readFileSync(path.join(root, 'src/services/schedule.service.js'), 'utf8');

test('license writes and document approval do not invoke schedule reconciliation or mutate approval revisions', () => {
  assert.doesNotMatch(routes, /reconcile(?:Employee|AllEmployee)LicenseSchedules/);
  assert.doesNotMatch(documentService, /reconcileSchedules/);
  const cron = routes.slice(routes.indexOf("router.post('/internal/license-reconciliation'"), routes.indexOf("router.get('/licenses'"));
  assert.match(cron, /expireDueLicenseDocuments/);
  assert.match(cron, /cleanupDueLicenseDocuments/);
  assert.match(cron, /LICENSE_ROSTER_ISOLATED/);
  assert.doesNotMatch(cron, /shiftAssignment|scheduleApproval|touchApproval/);

  // License expiry/renewal remains authoritative when writing NEW work shifts.
  assert.match(scheduleService, /licenseStateForWorkDate/);
  assert.match(scheduleService, /License Block:/);
  assert.match(scheduleService, /licenseOverride/);
});

test('license document approval preserves license master update and audit', () => {
  assert.match(documentService, /tx\.employeeLicense\.update\(/);
  assert.match(documentService, /employeeLicenseDocument\.update\(/);
  assert.match(documentService, /audit\.log\(/);
});
