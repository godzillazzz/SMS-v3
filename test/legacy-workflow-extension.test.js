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

  assert.match(frontend, /เครื่องมือไม้กายสิทธิ์สำหรับ Admin/);
  assert.match(frontend, /จัดกะแพทเทิร์นด่วน: 6 วันทำงาน \/ 1 วันหยุด/);
  assert.match(frontend, /Pending Approval Queue/);
  assert.match(frontend, /Submit Leave Request/);
  assert.match(routes, /schedule\/auto-preview', authorize\('ADMIN'\)/);
  assert.match(routes, /schedule\/auto-commit', authorize\('ADMIN'\)/);
  assert.match(routes, /schedule\/employee-auto-commit', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(employees, /orderBy: \[\{ employeeCode: 'asc' \}\]/);
});

test('leave workflow uses the consolidated leave-requests route and policy validations', () => {
  const index = read('src/routes/index.js');
  const routes = read('src/routes/operations.routes.js');
  const frontend = read('frontend/src/main.tsx');
  const api = read('frontend/src/api.ts');

  assert.doesNotMatch(index, /leavesRoutes/);
  assert.doesNotMatch(index, /router\.use\('\/leave-requests',\s*leavesRoutes\)/);
  assert.doesNotMatch(api, /\/leaves/);
  assert.match(routes, /substitute: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(255\)/);
  assert.match(routes, /employeeId: req\.body\.employeeId \|\| undefined/);
  assert.match(routes, /Sick leave longer than 3 days requires an attachment/);
  assert.match(routes, /Supervisor leave requests require Admin approval/);
  assert.match(routes, /Manager leave requests require Supervisor-level approval or higher/);
  assert.match(routes, /const after = await tx\.leaveRequest\.update\(\{ where: \{ id \}, data: \{ status: input\.status, approvedAt:/);
  assert.match(frontend, /const formReady = Boolean/);
  assert.match(frontend, /เหตุผลการลา/);
  assert.match(frontend, /เหตุผลการลา \{isRetroactive && <b>\*<\/b>\}/);
  assert.match(frontend, /<textarea required=\{isRetroactive\} rows=\{3\}/);
  assert.doesNotMatch(frontend, /reason: `\[แทน:/);
  assert.match(frontend, /if \(!canManage\) delete payload\.employeeId/);
});

test('leave quota management exposes entitlement, approved usage, and remaining balances', () => {
  const routes = read('src/routes/operations.routes.js');
  const frontend = read('frontend/src/main.tsx');
  assert.match(routes, /router\.get\('\/leave-quotas', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(routes, /where: \{ employeeId: \{ in: employeeIds \}, status: 'APPROVED' \}/);
  assert.match(routes, /personalLeaveRemaining: Math\.max\(0, entitlement\.personalLeave - used\.personalLeave\)/);
  assert.match(frontend, /quotaBalanceText\(row\.personalLeave, row\.personalLeaveUsed\)/);
  assert.match(frontend, /DUPLICATE_MATCHED/);
});

test('approved test leave can be cancelled to restore quota and remove leave-generated AL shifts', () => {
  const routes = read('src/routes/operations.routes.js');
  const frontend = read('frontend/src/main.tsx');
  const api = read('frontend/src/api.ts');
  assert.match(routes, /router\.post\('\/leave-requests\/:id\/cancel', authorize\('ADMIN'\)/);
  assert.match(routes, /before\.status !== 'APPROVED'/);
  assert.match(routes, /status: 'CANCELLED'/);
  assert.match(routes, /source: 'LEAVE_APPROVAL'/);
  assert.match(routes, /removedLeaveShifts/);
  assert.match(api, /cancelLeaveRequest/);
  assert.match(frontend, /ยกเลิกใบลาที่อนุมัติแล้ว/);
  assert.match(frontend, /row\.status === 'APPROVED' \? <button className="btn-info leave-print-button"/);
});

test('approved leave prints a dedicated A4 leave form rather than the application screen', () => {
  const frontend = read('frontend/src/main.tsx');
  const styles = read('frontend/src/styles.css');

  assert.match(frontend, /function LeavePrintDocument/);
  assert.match(frontend, /ใบขออนุมัติลางาน/);
  assert.match(frontend, /ผู้ปฏิบัติงานแทน \/ รายละเอียด/);
  assert.match(frontend, /onPrint=\{setLeavePrintTarget\}/);
  assert.match(frontend, /window\.setTimeout\(\(\) => window\.print\(\), 80\)/);
  assert.match(frontend, /size: A4 portrait/);
  assert.match(styles, /body\.printing-leave \.leave-print-document/);
});

test('approved schedule PDF keeps the shift legend directly below the roster and spaces signatures for review', () => {
  const frontend = read('frontend/src/main.tsx');
  const styles = read('frontend/src/styles.css');
  assert.match(frontend, /<\/table>\s*<div className="print-legend">/);
  assert.match(frontend, /<div className="print-footer-container">\s*<div className="print-signatures">/);
  assert.match(styles, /\.print-footer-container\s*\{[\s\S]*?justify-content: space-between/);
  assert.match(styles, /\.print-footer-container\s*\{[\s\S]*?margin-top: auto/);
  assert.match(styles, /\.print-signatures\s*\{[\s\S]*?margin-left: auto/);
  assert.match(styles, /\.print-signatures\s*\{[\s\S]*?gap: 16mm/);
});

test('interface keeps operational feedback, mobile tables, and schedule draft actions usable', () => {
  const frontend = read('frontend/src/main.tsx');
  const styles = read('frontend/src/styles.css');

  assert.match(frontend, /function ErrorAlert/);
  assert.match(frontend, /ระบบไม่สามารถดำเนินการได้ชั่วคราว/);
  assert.match(frontend, /className="empty-state"/);
  assert.match(frontend, /className="calendar-toolbar-box schedule-workbench"/);
  assert.match(frontend, /className="schedule-draft-actions"/);
  assert.match(styles, /\.data-table:not\(\.schedule-grid\) th:first-child/);
  assert.match(styles, /\.schedule-draft-actions\s*\{[\s\S]*?position: sticky/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('individual magic wand creates a schedule draft instead of saving immediately', () => {
  const frontend = read('frontend/src/main.tsx');
  assert.match(frontend, /ใส่ลงในฉบับร่าง/);
  assert.match(frontend, /ต้องกดบันทึกการเปลี่ยนแปลงทั้งหมดเพื่อบันทึกจริง/);
  assert.match(frontend, /api\.previewEmployeeAutoSchedule\(auth\.token, scheduleMonth, employeeId, phase, patternType\)/);
  assert.match(frontend, /applyPreviewToDrafts\(rows, employeeId\)/);
  assert.doesNotMatch(frontend, /api\.commitEmployeeAutoSchedule\(auth\.token, scheduleMonth, employeeId, phase, patternType\)/);
});
