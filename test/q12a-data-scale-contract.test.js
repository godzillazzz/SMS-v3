'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const route = read('src/routes/employees.routes.js');
const service = read('src/services/employee.service.js');

test('Q12-A Employee list accepts directory metadata without changing the default list boundary', () => {
  assert.match(route, /directoryMeta: z\.enum\(\['true', 'false'\]\)/);
  assert.match(route, /pageSize: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/);
  assert.match(service, /directoryMeta = false/);
});

test('Q12-A Employee directory metadata is server-authoritative and read-only', () => {
  assert.match(service, /meta\.summary = \{ total: overallTotal, active: activeTotal, incomplete: incompleteTotal \}/);
  assert.match(service, /meta\.departments = \(departmentRows \|\| \[\]\)/);
  assert.match(service, /prisma\.employee\.count\(\{ where: baseWhere \}\)/);
  assert.match(service, /prisma\.employee\.count\(\{ where: \{ \.\.\.baseWhere, isActive: true \} \}\)/);
  assert.doesNotMatch(service, /prisma\.employee\.(create|update|delete)/);
});

test('Q12-A Employee search includes directory fields needed by the UI', () => {
  for (const field of ['employeeCode', 'firstName', 'lastName', 'displayName', 'department', 'jobTitle']) {
    assert.match(service, new RegExp(field + ': \\{ contains: search'));
  }
});
