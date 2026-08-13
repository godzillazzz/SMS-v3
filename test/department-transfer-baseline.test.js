const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('department baseline: Employee stores current department and lifecycle events preserve transfer history', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /model Employee\s*\{[\s\S]*?department\s+String\?/);
  assert.doesNotMatch(schema, /model EmployeeDepartmentHistory\s*\{/);
  assert.match(schema, /model EmployeeLifecycleEvent\s*\{[\s\S]*?effectiveDate\s+DateTime[\s\S]*?oldValue\s+Json[\s\S]*?newValue\s+Json/);
});

test('department baseline: controlled Employee changes require ADMIN lifecycle actions', () => {
  const route = read('src/routes/employees.routes.js');
  const lifecycle = read('src/services/employee-lifecycle.service.js');
  const page = read('frontend/src/pages/personnel/PersonnelDirectoryPage.tsx');
  assert.match(route, /router\.put\('\/:id', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(route, /LIFECYCLE_ACTION_REQUIRED/);
  assert.match(route, /router\.get\('\/:id\/lifecycle', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(route, /router\.post\('\/:id\/lifecycle', authorize\('ADMIN'\)/);
  assert.match(lifecycle, /EVENT_TYPES = \[[\s\S]*'DEPARTMENT_TRANSFER'/);
  assert.match(lifecycle, /entityType:\s*'EmployeeLifecycleEvent'/);
  assert.match(page, /employee\.department/);
});

test('department baseline: lifecycle actions keep employeeId and synchronize linked User safely', () => {
  const schema = read('prisma/schema.prisma');
  const lifecycle = read('src/services/employee-lifecycle.service.js');
  assert.match(schema, /employeeId\s+String\?[^\n]*@unique/);
  assert.match(schema, /department\s+String\?[^\n]*@db\.VarChar\(100\)/);
  assert.match(lifecycle, /where:\s*\{ id: employee\.id \}/);
  assert.match(lifecycle, /type === 'NAME_CHANGE'[\s\S]*displayName: state\.displayName/);
  assert.match(lifecycle, /\['DEPARTMENT_TRANSFER', 'REHIRE'\][\s\S]*department: state\.department/);
  assert.match(lifecycle, /type === 'EMPLOYMENT_TERMINATION'[\s\S]*accountStatus: 'SUSPENDED'/);
  assert.match(lifecycle, /type === 'REHIRE'[\s\S]*accountStatus: 'ACTIVE'/);
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

test('department baseline: Executive Report snapshots workforce, schedule, and leave while license remains current-linked', () => {
  const service = read('src/services/executive-report.service.js');
  assert.match(service, /async function workforceSnapshot\(/);
  assert.match(service, /employee_lifecycle_events/);
  assert.match(service, /effective_date <= \$\{asOfDate\}::date/);
  assert.match(service, /assignmentCount = await prismaClient\.shiftAssignment\.count\(\{ where: \{[\s\S]*departmentSnapshot: scope\.department/);
  assert.match(service, /const leaveWhere = historicalLeaveScopeWhere\(scope, period\)/);
  assert.match(service, /departmentSnapshot: scope\.department/);
  assert.match(service, /function employeeRelation\(scope\)/);
  assert.match(service, /const documentScope = \{ employee: employeeRelation\(scope\) \}/);
});
