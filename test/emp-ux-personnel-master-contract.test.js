'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('EMP-UX personnel masters are additive history-preserving schema with bootstrap migration', () => {
  const schema = read('prisma/schema.prisma');
  const sql = read('prisma/migrations/202609010001_emp_ux_department_position_master/migration.sql');
  assert.match(schema, /model DepartmentMaster/);
  assert.match(schema, /model PositionMaster/);
  assert.match(sql, /CREATE TABLE "department_master"/);
  assert.match(sql, /CREATE TABLE "position_master"/);
  assert.match(sql, /FROM "employees"/);
  assert.equal(sql.includes('BTRIM("department")'), true);
  assert.equal(sql.includes('BTRIM("job_title")'), true);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM "employees"|UPDATE "employees"/i);
});

test('Personnel Master API is read for Admin Manager and mutation is Admin-only with no delete route', () => {
  const route = read('src/routes/personnel-masters.routes.js');
  const index = read('src/routes/index.js');
  assert.match(index, /personnel-masters/);
  assert.equal(route.includes("router.get('/', authorize('ADMIN', 'MANAGER')"), true);
  assert.equal(route.includes("router.post('/:kind', authorize('ADMIN')"), true);
  assert.equal(route.includes("router.put('/:kind/:id', authorize('ADMIN')"), true);
  assert.doesNotMatch(route, /router.delete/);
});

test('Employee create and governed lifecycle enforce active Department Position Master server-side', () => {
  const employee = read('src/services/employee.service.js');
  const mutation = read('src/services/employee-master-mutation.service.js');
  const lifecycle = read('src/services/employee-lifecycle.service.js');
  assert.equal(employee.includes("assertActiveValue(tx, 'department'"), true);
  assert.equal(employee.includes("assertActiveValue(tx, 'position'"), true);
  assert.equal(mutation.includes("assertActiveValue(prismaClient, 'department'"), true);
  assert.equal(mutation.includes("assertActiveValue(tx, 'position'"), true);
  assert.equal(lifecycle.includes("assertActiveValue(client, 'department'"), true);
  assert.equal(lifecycle.includes("assertActiveValue(client, 'position'"), true);
});

test('Approval aliases may only add active Position Master values while legacy aliases remain readable', () => {
  const policy = read('src/services/approval-policy.service.js');
  assert.match(policy, /previousAliases/);
  assert.match(policy, /newAliases/);
  assert.equal(policy.includes("assertActiveValue(tx, 'position', alias)"), true);
});
