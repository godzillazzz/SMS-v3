process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operations = fs.readFileSync(path.join(process.cwd(), 'src/routes/operations.routes.js'), 'utf8');
const frontend = fs.readFileSync(path.join(process.cwd(), 'frontend/src/main.tsx'), 'utf8');

test('legacy protected shift codes and Admin-only schedule approval remain enforced', () => {
  assert.match(operations, /\['D', 'N', 'OFF', 'AL'\]\.includes\(before\.code\.toUpperCase\(\)\)/);
  assert.match(operations, /router\.put\('\/schedule-approvals\/:id', authorize\('ADMIN'\)/);
});

test('legacy license permissions and date validation remain enforced', () => {
  assert.match(operations, /router\.post\('\/licenses', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(operations, /router\.put\('\/licenses\/:id', authorize\('ADMIN'\)/);
  assert.match(operations, /router\.delete\('\/licenses\/:id', authorize\('ADMIN'\)/);
  assert.match(operations, /Issue date must not be after expiry date/);
});

test('Manager account approval is constrained to Viewer and sensitive settings stay environment-managed', () => {
  assert.match(operations, /Managers may assign the Viewer role only/);
  assert.match(operations, /input\.role = 'VIEWER'/);
  assert.match(operations, /Sensitive settings must be configured through the approved environment-variable workflow/);
});

test('legacy navigation and three-role model are represented in the frontend', () => {
  for (const label of ['Dashboard', 'Master Data', 'Shift Setup', 'Schedule Calendar', 'จัดการการลา', 'Rule Checking', 'Reports', 'Users & Roles', 'Settings']) {
    assert.ok(frontend.includes(`label: '${label}'`), label);
  }
  assert.match(frontend, /\['ADMIN', 'MANAGER', 'VIEWER'\]/);
  assert.doesNotMatch(frontend, /\['ADMIN', 'HR', 'USER'\]/);
});
