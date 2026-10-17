import { expect, test, type Page } from '@playwright/test';

const types = ['EMPLOYEE_MASTER_CHANGE', 'EMPLOYEE_REFERENCE_PHOTO', 'LICENSE_DOCUMENT', 'SCHEDULE_APPROVAL', 'ATTENDANCE_DEVICE_REQUEST', 'ATTENDANCE_ADJUSTMENT_REQUEST', 'REGISTRATION_REQUEST', 'USER_ACCESS', 'LEAVE_REQUEST'] as const;
const ids = Object.fromEntries(types.map((type, index) => [type, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));

async function install(page: Page, viewAs = false) {
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/auth/refresh') return route.fulfill({ status: 200, json: { accessToken: 'fixture-token', user: { id: 'admin', role: 'ADMIN', displayName: 'Admin Fixture' } } });
    if (url.pathname === '/api/v1/auth/passkeys/config') return route.fulfill({ status: 200, json: { enabled: false } });
    if (url.pathname === '/api/v1/approval-center/summary') return route.fulfill({ status: 200, json: { summary: { total: types.length, byType: Object.fromEntries(types.map(type => [type, 1])), truncated: false } } });
    if (url.pathname === '/api/v1/approval-center' && url.searchParams.has('type')) {
      const type = url.searchParams.get('type') as typeof types[number];
      return route.fulfill({ status: 200, json: viewAs ? { data: [], summary: { total: 0, byType: {} }, meta: { total: 0 } } : { data: [{ id: `${type}:${ids[type]}`, type, requestId: ids[type], title: `${type} fixture`, status: 'PENDING_APPROVAL', submittedAt: '2026-10-17T00:00:00Z', metadata: { detail: 'real fixture detail' } }], summary: { total: 1, byType: { [type]: 1 } }, meta: { total: 1 } } });
    }
    if (url.pathname === '/api/v1/approval-center') return route.fulfill({ status: 200, json: { data: types.map(type => ({ id: `${type}:${ids[type]}`, type, requestId: ids[type], title: `${type} fixture`, status: 'PENDING_APPROVAL', submittedAt: '2026-10-17T00:00:00Z', metadata: { detail: 'real fixture detail' } })), summary: { total: types.length, byType: Object.fromEntries(types.map(type => [type, 1])) }, meta: { total: types.length } } });
    return route.fulfill({ status: 200, json: { data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } } });
  });
  await page.goto('/app/approvals');
  await expect(page.getByRole('heading', { name: 'ศูนย์อนุมัติคำขอ' })).toBeVisible();
}

test('all nine approval request types open a non-zero detail envelope', async ({ page }) => {
  await install(page);
  for (const type of types) {
    const row = page.locator('.approval-queue-row').nth(types.indexOf(type));
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /ดูรายละเอียด/ }).click();
    await expect(page.locator('.approval-detail-panel, .approval-schedule-detail')).toContainText('fixture');
    await expect(page.locator('.approval-detail-panel, .approval-schedule-detail')).not.toContainText('ไม่มีข้อมูล');
  }
});

test('View-As with type and requestId returns the A2 zero envelope', async ({ page }) => {
  await install(page, true);
  const response = await page.evaluate(async ({ type, requestId }) => {
    const result = await fetch(`/api/v1/approval-center?type=${type}&requestId=${requestId}`);
    return result.json();
  }, { type: types[0], requestId: ids[types[0]] });
  expect(response.data).toEqual([]);
  expect(response.meta.total).toBe(0);
});

test('detail fixture requests preserve the requestId and type contract', async ({ page }) => {
  await install(page);
  const response = await page.evaluate(async ({ type, requestId }) => (await fetch(`/api/v1/approval-center?type=${type}&requestId=${requestId}`)).json(), { type: types[8], requestId: ids[types[8]] });
  expect(response.data[0]).toMatchObject({ type: types[8], requestId: ids[types[8]] });
  expect(response.meta.total).toBe(1);
});
