const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('department baseline: Employee stores current department and no transfer history model exists', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /model Employee\s*\{[\s\S]*?department\s+String\?/);
  assert.doesNotMatch(schema, /model EmployeeDepartmentHistory\s*\{/);
});

test('department baseline: Employee updates accept department and audit before/after values', () => {
  const route = read('src/routes/employees.routes.js');
  const service = read('src/services/employee.service.js');
  const page = read('frontend/src/pages/personnel/PersonnelDirectoryPage.tsx');
  assert.match(route, /router\.put\('\/:id', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(service, /department/);
  assert.match(service, /metadata:\s*\{\s*before:\s*auditSnapshot\(existing\),\s*after:\s*auditSnapshot\(employee\)/);
  assert.match(page, /employee\.department/);
});

test('department baseline: user linkage keeps employeeId separate from user department', () => {
  const schema = read('prisma/schema.prisma');
  const accessService = read('src/services/user-access.service.js');
  assert.match(schema, /employeeId\s+String\?[^\n]*@unique/);
  assert.match(schema, /department\s+String\?[^\n]*@db\.VarChar\(100\)/);
  assert.match(accessService, /before\.department/);
  assert.match(accessService, /after\.department/);
});

test('department baseline: leave and schedule store event-time department snapshots', () => {
  const operations = read('src/routes/operations.routes.js');
  const leaveService = read('src/services/leave.service.js');
  const scheduleService = read('src/services/schedule.service.js');
  assert.match(operations, /departmentSnapshot:\s*employee\.department/);
  assert.match(leaveService, /departmentSnapshot:\s*emp\.department/);
  assert.match(scheduleService, /departmentSnapshot:\s*emp\.department/);
  assert.match(operations, /departmentSnapshot:\s*true/);
});

test('department baseline: Executive Report uses current Employee relation for scope-sensitive metrics', () => {
  const service = read('src/services/executive-report.service.js');
  assert.match(service, /function employeeRelation\(scope\)/);
  assert.match(service, /employee:\s*employeeRelation\(scope\)/);
  assert.match(service, /assignmentCount = await prismaClient\.shiftAssignment\.count\(\{ where: \{[\s\S]*employee: employeeRelation\(scope\)/);
  assert.match(service, /leaveScopeWhere\(scope, period\)/);
});
