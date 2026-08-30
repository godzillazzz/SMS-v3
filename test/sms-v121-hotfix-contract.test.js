process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const operations = read('src/routes/operations.routes.js');
const licenseDocument = read('src/services/license-document.service.js');
const dashboard = read('src/services/dashboard.service.js');
const dataQuality = read('src/services/data-quality.service.js');
const executiveReport = read('src/services/executive-report.service.js');

test('License operational status contract defaults to active and preserves explicit history views', () => {
  assert.match(operations, /employeeStatus: z\.enum\(\['ACTIVE', 'INACTIVE', 'ALL'\]\)\.default\('ACTIVE'\)/);
  assert.match(operations, /if \(employeeStatus === 'ALL'\) return \{\};/);
  assert.match(operations, /if \(employeeStatus === 'INACTIVE'\) return \{ employee: \{ is: \{ OR:/);
  assert.match(operations, /employee: \{ is: \{ isActive: true, deletedAt: null \} \}/);
  assert.match(operations, /const where = licenseEmployeeWhere\(employeeStatus\);/);
});

test('inactive License mutations fail with a domain code while reads and G05 remain separate', () => {
  assert.match(operations, /INACTIVE_EMPLOYEE_OPERATION/);
  for (const method of ['upload', 'approve', 'returnForCorrection', 'resubmit', 'reject']) assert.match(licenseDocument, new RegExp(`async function ${method}`));
  const permanentDelete = licenseDocument.slice(licenseDocument.indexOf('async function permanentlyDelete'));
  assert.doesNotMatch(permanentDelete, /ensureOperationalEmployee/);
});

test('Dashboard and data quality active scopes preserve unlinked operational work', () => {
  assert.match(dashboard, /isActive: true, deletedAt: null/);
  assert.match(dashboard, /\{ employeeId: null \}/);
  assert.match(dashboard, /DASHBOARD_QUERY_CONCURRENCY = 2/);
  assert.match(dataQuality, /const where = \{ isActive: true, deletedAt: null \};/);
  assert.match(dataQuality, /\{ employeeId: null \},/);
});

test('Executive Report separates historical leave scope from active operational attention', () => {
  assert.match(executiveReport, /function operationalEmployeeRelation/);
  assert.match(executiveReport, /function operationalLeaveScopeWhere/);
  assert.match(executiveReport, /const leaveWhere = historicalLeaveScopeWhere/);
  assert.match(executiveReport, /const operationalLeaveWhere = operationalLeaveScopeWhere/);
  assert.match(executiveReport, /actionablePendingCount/);
});
