import { expect, test } from '@playwright/test';
import { readinessTimeout } from '../support/readiness';

// Owner 2026-10-28: each request in the desktop approval queue sits on a single row.
const items = [
  { id: 'LEAVE_REQUEST:l1', type: 'LEAVE_REQUEST', requestId: 'l1', title: 'ยุทธนา เอี่ยมชู', status: 'PENDING', sourcePage: 'leavePending', submittedAt: '2026-10-22T11:45:00Z', ageHours: 141, urgency: 'OVERDUE', employee: { id: 'e1', displayName: 'ยุทธนา เอี่ยมชู', department: 'WCS' }, requestedBy: { id: 'u1', displayName: 'ยุทธนา เอี่ยมชู', role: 'EMPLOYEE' }, metadata: { leaveType: 'ลาพักร้อน', startDate: '2026-11-03', endDate: '2026-11-03', dayCount: 1 } },
  { id: 'ATTENDANCE_CORRECTION:c1', type: 'ATTENDANCE_CORRECTION', requestId: 'c1', title: 'Sermpong UAT', status: 'PENDING', sourcePage: 'attendanceSupervisor', submittedAt: '2026-10-27T11:28:00Z', ageHours: 22, urgency: 'NORMAL', employee: { id: 'e2', displayName: 'Sermpong UAT', department: 'WCS' }, requestedBy: { id: 'u2', displayName: 'Sermpong UAT', role: 'EMPLOYEE' }, metadata: { reason: 'ทดสอบการแก้ไขเวลาเข้างานที่มีข้อความยาวมากพอที่จะต้องตัดบรรทัด', workDate: '2026-10-26' } },
  { id: 'LEAVE_REQUEST:l2', type: 'LEAVE_REQUEST', requestId: 'l2', title: 'ยุทธนา เอี่ยมชู', status: 'PENDING', sourcePage: 'leavePending', submittedAt: '2026-10-28T03:24:00Z', ageHours: 6, urgency: 'NEW', employee: { id: 'e1', displayName: 'ยุทธนา เอี่ยมชู', department: 'WCS' }, requestedBy: { id: 'u1', displayName: 'ยุทธนา เอี่ยมชู', role: 'EMPLOYEE' }, metadata: { leaveType: 'ลาป่วย', startDate: '2026-11-01', endDate: '2026-11-01', dayCount: 1 } }
];

for (const width of [1366, 1920]) test(`approval queue rows are single-line at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 768 });
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], summary: { total: 0, byType: {} }, meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } }) }));
  await page.route('**/api/v1/approval-center/summary', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: { total: 3, byType: { LEAVE_REQUEST: 2, ATTENDANCE_CORRECTION: 1 } } }) }));
  await page.route('**/api/v1/approval-center?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: items }) }));
  let authenticated = false;
  const session = { accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: 'admin@example.test', displayName: 'ADMIN Fixture', role: 'ADMIN' } };
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill(authenticated ? { status: 200, contentType: 'application/json', body: JSON.stringify(session) } : { status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) }));
  await page.route('**/api/v1/auth/passkeys/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.route('**/api/v1/auth/login', (route) => { authenticated = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }); });
  await page.goto('/app');
  await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
  await page.locator('#email').fill('admin@example.test');
  await page.locator('#password').fill('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await page.locator('[data-navigation-id="approvalCenter"]').click();
  const rows = page.locator('.approval-queue-desktop .approval-queue-row');
  await expect(rows).toHaveCount(3, { timeout: readinessTimeout() });
  const heights = await rows.evaluateAll((list) => list.map((row) => Math.round(row.getBoundingClientRect().height)));
  console.log('ROW_HEIGHTS', width, heights.join(','));
  // One line = avatar (36px) + cell padding; before the fix rows were ~121px (three stacked lines).
  for (const height of heights) expect(height).toBeLessThanOrEqual(64);
  const actions = rows.first().locator('.approval-queue-row-actions button');
  const [a, b] = await actions.evaluateAll((list) => list.map((button) => button.getBoundingClientRect().top));
  expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
});
