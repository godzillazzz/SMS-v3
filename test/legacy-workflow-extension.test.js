process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('leave attachment migration is additive and isolated to its dedicated table', () => {
  const migration = read('prisma/migrations/202607250001_leave_attachments/migration.sql');
  assert.match(migration, /CREATE TABLE "leave_attachments"/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE|^\s*UPDATE\s+|^\s*DELETE\s+FROM/im);
  assert.equal((migration.match(/CREATE TABLE/g) || []).length, 1);
});

test('View As is short-lived, memory-only, audited, and server-enforced read-only', () => {
  const usersRoute = read('src/routes/users.routes.js');
  const middleware = read('src/middlewares/authenticate.js');
  const frontend = read('frontend/src/main.tsx');
  assert.match(usersRoute, /expiresIn: '10m'/);
  assert.match(usersRoute, /entityType: 'ViewAsSession'/);
  assert.match(middleware, /View As mode is read-only/);
  assert.match(middleware, /impersonator\.role !== 'ADMIN'/);
  assert.doesNotMatch(frontend, /localStorage|sessionStorage/);
});

test('leave attachment and Excel routes never expose binary content in JSON', () => {
  const routes = read('src/routes/operations.routes.js');
  assert.match(routes, /multer\.memoryStorage/);
  assert.match(routes, /Attachment must not exceed 4 MB/);
  assert.match(routes, /Content-Disposition.*inline/);
  assert.match(routes, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.doesNotMatch(routes, /content:\s*file\.buffer[^\n]*res\.json/);
});

test('Settings retains the legacy LINE template layout without persisting notification credentials', () => {
  const frontend = read('frontend/src/main.tsx');
  const routes = read('src/routes/operations.routes.js');

  assert.match(frontend, /LINE Notification Settings \(ตั้งค่าแจ้งเตือน LINE\)/);
  assert.match(frontend, /LINE_TEMPLATE_NEW_LEAVE/);
  assert.match(frontend, /LINE_TEMPLATE_LEAVE_STATUS/);
  assert.match(frontend, /Vercel Environment Variables/);
  assert.match(frontend, /Google Sheets ถูกยกเลิก/);
  assert.match(routes, /secret\|token\|password\|credential/);
});

test('legacy schedule and leave controls remain available to Admin and Manager', () => {
  const frontend = read('frontend/src/main.tsx');
  const routes = read('src/routes/operations.routes.js');
  const employees = read('src/services/employee.service.js');

  assert.match(frontend, /เครื่องมือไม้กายสิทธิ์สำหรับ Admin และ Manager/);
  assert.match(frontend, /จัดกะแพทเทิร์นด่วน: 6 วันทำงาน \/ 1 วันหยุด/);
  assert.match(frontend, /Pending Approval Queue/);
  assert.match(frontend, /Submit Leave Request/);
  assert.match(routes, /schedule\/auto-preview', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(routes, /schedule\/auto-commit', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(routes, /schedule\/employee-auto-commit', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(employees, /orderBy: \[\{ employeeCode: 'asc' \}\]/);
});
