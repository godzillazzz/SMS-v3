process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operations = fs.readFileSync(path.join(process.cwd(), 'src/routes/operations.routes.js'), 'utf8');
const frontend = fs.readFileSync(path.join(process.cwd(), 'frontend/src/main.tsx'), 'utf8');
const monthPicker = fs.readFileSync(path.join(process.cwd(), 'frontend/src/components/MonthGridPicker.tsx'), 'utf8');
const batchSchedules = fs.readFileSync(path.join(process.cwd(), 'src/routes/schedules.routes.js'), 'utf8');
const scheduleService = fs.readFileSync(path.join(process.cwd(), 'src/services/schedule.service.js'), 'utf8');
const shiftService = fs.readFileSync(path.join(process.cwd(), 'src/services/shift.service.js'), 'utf8');
const userAccessService = fs.readFileSync(path.join(process.cwd(), 'src/services/user-access.service.js'), 'utf8');

test('legacy protected shift codes remain enforced while monthly approval is Admin-or-Manager only', () => {
  assert.match(shiftService, /\['D', 'N', 'OFF', 'AL'\]\.includes\(existing\.code\.toUpperCase\(\)\)/);
  assert.match(operations, /router\.put\('\/schedule-approvals\/:id', authorize\('ADMIN', 'MANAGER'\)/);
});

test('legacy license permissions and date validation remain enforced', () => {
  assert.match(operations, /router\.post\('\/licenses', authorize\('ADMIN'\)/);
  assert.match(operations, /router\.put\('\/licenses\/:id', authorize\('ADMIN', 'MANAGER', 'SUPERVISOR'\)/);
  assert.match(operations, /router\.delete\('\/licenses\/:id', authorize\('ADMIN'\)/);
  assert.match(operations, /Issue date must not be after expiry date/);
  assert.match(operations, /License number already exists/);
  assert.doesNotMatch(operations, /License number or employee license type already exists/);
  assert.match(batchSchedules, /saveBatchAssignments\(assignments, req\.user\.sub, req\.user\.role, deletes\)/);
  assert.match(scheduleService, /actorRole === 'ADMIN'/);
  assert.match(scheduleService, /License Block/);
  assert.match(operations, /sortByEmployeeCode/);
  assert.match(operations, /localeCompare\(String\(right\.employee\?\.employeeCode \|\| ''\), undefined, \{ numeric: true, sensitivity: 'base' \}\)/);
});

test('Manager account approval is constrained to Viewer and sensitive settings stay environment-managed', () => {
  assert.match(userAccessService, /Managers may assign the Viewer role only/);
  assert.match(userAccessService, /effectiveInput\.role = 'VIEWER'/);
  assert.match(operations, /Sensitive settings must be configured through the approved environment-variable workflow/);
});

test('legacy navigation and four-role model are represented in the frontend', () => {
  const navigationBlock = frontend.match(/const navigation:[\s\S]*?function AuthProvider/)?.[0] || '';
  for (const label of ['ภาพรวม', 'ศูนย์อนุมัติ', 'ข้อมูลพนักงาน', 'ใบอนุญาต รปภ.', 'ลงเวลา', 'ศูนย์ควบคุมการลงเวลา', 'อุปกรณ์ลงเวลา', 'ตารางกะรายเดือน', 'รหัสกะและเวลา', 'ตรวจสอบกฎการทำงาน', 'คำขอลา', 'อนุมัติคำขอลา', 'ประวัติการลาทั้งหมด', 'โควต้าวันลา', 'รายงานและวิเคราะห์', 'ผู้ใช้และสิทธิ์', 'จุดรักษาความปลอดภัยและ QR', 'ตั้งค่าระบบ', 'บันทึกการใช้งานระบบ', 'คุณภาพข้อมูล', 'ประสิทธิภาพและสถานะระบบ']) {
    assert.ok(navigationBlock.includes(`label: '${label}'`), label);
  }
  // OWNER 2026-10-16: schedule-approval sidebar shortcut removed; approval stays available via the Approval Center
  assert.doesNotMatch(navigationBlock, /label: 'อนุมัติตารางกะ'/);
  assert.doesNotMatch(navigationBlock, /label: 'รายงานและ Export'/);
  assert.doesNotMatch(navigationBlock, /label: 'รายงานผู้บริหาร'/);

  assert.match(navigationBlock, /id: 'approvalCenter', icon: 'bell', label: 'ศูนย์อนุมัติ'/);
  assert.match(frontend, /<aside id="app-navigation-drawer"[\s\S]*?<nav className="nav-menu"[\s\S]*?visibleNavigation\.map/);
  assert.match(frontend, /className="mobile-menu-button"[\s\S]*?aria-controls="app-navigation-drawer"[\s\S]*?setMobileMenuOpen\(true\)/);
  assert.match(frontend, /const visibleNavigation = navigation[\s\S]*?section\.items\.filter\(\(item\) => canViewPage\(item\.id\)\)/);
  for (const section of ['บุคลากร', 'ลงเวลา', 'ตารางกะ', 'การลา', 'รายงาน', 'ตั้งค่า', 'ผู้ดูแลระบบ']) {
    assert.ok(navigationBlock.includes(`label: '${section}'`), section);
  }
  assert.match(frontend, /\['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'\]/);
  assert.doesNotMatch(frontend, /\['ADMIN', 'HR', 'USER'\]/);
});

test('schedule month picker and license search match legacy usability expectations', () => {
  assert.match(monthPicker, /export function MonthGridPicker/);
  assert.match(frontend, /<MonthGridPicker value=\{scheduleMonth\} onChange=\{\(value\) => \{ setScheduleMonth\(value\); setOperationPage\(1\); \}\} \/>/);
  assert.match(frontend, /page === 'licenses' && <div className="[^"]*\btoolbar\b[^"]*">/);
  assert.match(frontend, /value=\{tableSearch\} onChange=\{\(event\) => setTableSearch\(event\.target\.value\)\}/);
  assert.match(frontend, /ค้นหารหัสพนักงาน ชื่อ เลขที่ใบอนุญาต หรือสถานะ/);
});
