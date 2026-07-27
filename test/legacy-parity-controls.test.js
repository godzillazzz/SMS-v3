process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operations = fs.readFileSync(path.join(process.cwd(), 'src/routes/operations.routes.js'), 'utf8');
const frontend = fs.readFileSync(path.join(process.cwd(), 'frontend/src/main.tsx'), 'utf8');
const batchSchedules = fs.readFileSync(path.join(process.cwd(), 'src/routes/schedules.routes.js'), 'utf8');
const scheduleService = fs.readFileSync(path.join(process.cwd(), 'src/services/schedule.service.js'), 'utf8');

test('legacy protected shift codes and Admin-only schedule approval remain enforced', () => {
  assert.match(operations, /\['D', 'N', 'OFF', 'AL'\]\.includes\(before\.code\.toUpperCase\(\)\)/);
  assert.match(operations, /router\.put\('\/schedule-approvals\/:id', authorize\('ADMIN'\)/);
});

test('legacy license permissions and date validation remain enforced', () => {
  assert.match(operations, /router\.post\('\/licenses', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(operations, /router\.put\('\/licenses\/:id', authorize\('ADMIN'\)/);
  assert.match(operations, /router\.delete\('\/licenses\/:id', authorize\('ADMIN'\)/);
  assert.match(operations, /Issue date must not be after expiry date/);
  assert.match(operations, /License number already exists/);
  assert.doesNotMatch(operations, /License number or employee license type already exists/);
  assert.match(batchSchedules, /saveBatchAssignments\(assignments, req\.user\.sub, req\.user\.role\)/);
  assert.match(scheduleService, /actorRole === 'ADMIN'/);
  assert.match(scheduleService, /License Block/);
});

test('Manager account approval is constrained to Viewer and sensitive settings stay environment-managed', () => {
  assert.match(operations, /Managers may assign the Viewer role only/);
  assert.match(operations, /input\.role = 'VIEWER'/);
  assert.match(operations, /Sensitive settings must be configured through the approved environment-variable workflow/);
});

test('legacy navigation and three-role model are represented in the frontend', () => {
  for (const label of ['Dashboard', 'ข้อมูลพนักงาน', 'ใบอนุญาต รปภ.', 'ตารางกะรายเดือน', 'อนุมัติตารางกะ', 'รหัสกะและเวลา', 'คำขอลา', 'โควต้าวันลา', 'กฎการทำงาน', 'Audit Log', 'ผู้ใช้และสิทธิ์', 'รายงานและ Export', 'ตั้งค่าระบบ']) {
    assert.ok(frontend.includes(`label: '${label}'`), label);
  }
  for (const section of ['ภาพรวม', 'พนักงาน', 'ตารางกะ', 'การลา', 'ตรวจสอบ', 'ผู้ใช้และสิทธิ์', 'รายงาน', 'ตั้งค่า']) {
    assert.ok(frontend.includes(`label: '${section}'`), section);
  }
  assert.match(frontend, /\['ADMIN', 'MANAGER', 'VIEWER'\]/);
  assert.doesNotMatch(frontend, /\['ADMIN', 'HR', 'USER'\]/);
});
