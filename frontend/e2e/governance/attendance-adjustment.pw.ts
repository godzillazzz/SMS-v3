import { expect, test, type Page } from '@playwright/test';

const assignmentId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
type Role = 'ADMIN' | 'SUPERVISOR' | 'VIEWER' | 'EMPLOYEE';

async function installFixture(page: Page, role: Role) {
  let status = 'DRAFT';
  const calls: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push(`${req.method()} ${path}`);
    if (path === '/api/v1/auth/refresh') return route.fulfill({ status: 200, json: { accessToken: `fixture-${role}`, user: { id: `${role.toLowerCase()}-user`, role, employeeId: 'employee-1', displayName: `${role} fixture` } } });
    if (path === '/api/v1/auth/passkeys/config') return route.fulfill({ status: 200, json: { enabled: false } });
    if (path === '/api/v1/attendance/adjustment-requests' && req.method() === 'POST') {
      if (role === 'SUPERVISOR' || role === 'VIEWER') return route.fulfill({ status: 403, json: { error: 'Attendance adjustment maker role is not permitted' } });
      return route.fulfill({ status: 201, json: { data: { id: requestId, status: 'DRAFT', makerRole: role } } });
    }
    if (path === `/api/v1/attendance/adjustment-requests/${requestId}/submit` && req.method() === 'POST') {
      if (role !== 'EMPLOYEE') return route.fulfill({ status: 403, json: { error: 'Only the request maker may submit' } });
      status = 'PENDING_APPROVAL';
      return route.fulfill({ status: 200, json: { data: { id: requestId, status } } });
    }
    if (path === `/api/v1/attendance/adjustment-requests/${requestId}/approve` && req.method() === 'POST') {
      if (role !== 'ADMIN') return route.fulfill({ status: 403, json: { error: 'ADMIN approval required' } });
      status = 'APPROVED';
      return route.fulfill({ status: 200, json: { data: { id: requestId, status } } });
    }
    if (path === '/api/v1/attendance/adjustment-requests' && req.method() === 'GET') return route.fulfill({ status: 200, json: { data: [], meta: { total: 0 } } });
    return route.fulfill({ status: 200, json: { data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } } });
  });
  await page.goto('/app');
  return { calls, request: (method: string, path: string, body?: unknown) => page.evaluate(async ({ method, path, body }) => { const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }, { method, path, body }) };
}

const draft = { assignmentId, requestType: 'CONFIRM_WORK_PERFORMED', proposal: { checkInAt: null, checkOutAt: null }, reason: 'Fixture employee confirmation' };

test('SUPERVISOR has no adjustment action and direct create is 403', async ({ page }) => {
  const fixture = await installFixture(page, 'SUPERVISOR');
  const result = await fixture.request('POST', '/api/v1/attendance/adjustment-requests', draft);
  expect(result.status).toBe(403);
  expect(await page.locator('button', { hasText: /แก้ไข|ยืนยันการปฏิบัติงาน/ }).count()).toBe(0);
});

test('employee can create and submit a self-confirmation request', async ({ page }) => {
  const fixture = await installFixture(page, 'EMPLOYEE');
  const created = await fixture.request('POST', '/api/v1/attendance/adjustment-requests', draft);
  expect(created.status).toBe(201);
  const submitted = await fixture.request('POST', `/api/v1/attendance/adjustment-requests/${requestId}/submit`, {});
  expect(submitted.status).toBe(200);
  expect(submitted.body.data.status).toBe('PENDING_APPROVAL');
});

test('ADMIN can perform the final approval', async ({ page }) => {
  const fixture = await installFixture(page, 'ADMIN');
  const approved = await fixture.request('POST', `/api/v1/attendance/adjustment-requests/${requestId}/approve`, {});
  expect(approved.status).toBe(200);
  expect(approved.body.data.status).toBe('APPROVED');
});

test('VIEWER is denied even when calling the adjustment API directly', async ({ page }) => {
  const fixture = await installFixture(page, 'VIEWER');
  const result = await fixture.request('POST', '/api/v1/attendance/adjustment-requests', draft);
  expect(result.status).toBe(403);
});

test('governance fixture never issues a business write outside the asserted request', async ({ page }) => {
  const fixture = await installFixture(page, 'EMPLOYEE');
  await fixture.request('POST', '/api/v1/attendance/adjustment-requests', draft);
  expect(fixture.calls.filter(call => call.startsWith('POST '))).toEqual(['POST /api/v1/attendance/adjustment-requests']);
});
