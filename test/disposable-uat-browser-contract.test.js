'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const specPath = path.join(__dirname, '../e2e/smoke/disposable-employee.spec.js');
const fixturePath = path.join(__dirname, '../scripts/admin/disposable-uat-employee.js');
const employeeRoutesPath = path.join(__dirname, '../src/routes/employees.routes.js');

const spec = fs.readFileSync(specPath, 'utf8');
const fixture = fs.readFileSync(fixturePath, 'utf8');
const employeeRoutes = fs.readFileSync(employeeRoutesPath, 'utf8');

test('destructive browser lifecycle is disabled by default and requires explicit authenticated enablement', () => {
  assert.match(spec, /process\.env\.UAT_MODE === 'authenticated'/);
  assert.match(spec, /process\.env\.UAT_DISPOSABLE_EMPLOYEE_ENABLED === 'true'/);
  assert.match(spec, /test\.skip\(!destructiveFixtureEnabled\(\)/);
  assert.doesNotMatch(spec, /firstEmployee\s*\(/);
  assert.match(spec, new RegExp(`search=\\$\\{encodeURIComponent\\(FIXTURE_EMPLOYEE_CODE\\)\\}`));
});

test('browser scenario always resets in finally and verifies all five existing lifecycle actions', () => {
  assert.match(spec, /try\s*\{[\s\S]*prepareDisposableUatEmployee/);
  assert.match(spec, /finally\s*\{[\s\S]*resetDisposableUatEmployee[\s\S]*assertDisposableUatEmployeeBaseline/);
  for (const type of ['NAME_CHANGE', 'DEPARTMENT_TRANSFER', 'POSITION_CHANGE', 'EMPLOYMENT_TERMINATION', 'REHIRE']) {
    assert.match(spec, new RegExp(`'${type}'`));
  }
  assert.match(spec, /EmployeeLifecycleEvent/);
  assert.match(spec, /FIXTURE_USER_EMAIL/);
});

test('fixture tooling has no generic employee deletion or arbitrary employee reset API', () => {
  assert.doesNotMatch(fixture, /function\s+resetEmployee\s*\(/);
  assert.doesNotMatch(fixture, /function\s+deleteEmployee\s*\(/);
  assert.doesNotMatch(fixture, /DELETE\s+\/employees/i);
  assert.match(employeeRoutes, /router\.delete\('\/:id', authorize\('ADMIN'\)/);
  assert.match(employeeRoutes, /LIFECYCLE_TERMINATION_REQUIRED/);
});

test('fixture CLI output is bounded to safe fixture metadata instead of full Employee/User rows', () => {
  assert.match(fixture, /fixtureClass:\s*FIXTURE_CLASS/);
  assert.match(fixture, /employeeCode:\s*FIXTURE_EMPLOYEE_CODE/);
  assert.match(fixture, /state:\s*'ACTIVE_BASELINE'/);
  assert.match(fixture, /linkedUser:\s*true/);
  assert.doesNotMatch(fixture, /console\.log\([^\n]*(passwordHash|DATABASE_URL|email:|phone:)/);
});
