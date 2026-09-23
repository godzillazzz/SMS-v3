'use strict';

const { randomUUID } = require('node:crypto');
const { test, expect } = require('../helpers/uat-test');
const { roleAccessToken } = require('../helpers/uat-auth');
const { authenticatedRequest } = require('../helpers/uat-authenticated-request');

const Q13C_CONFIRMATION = 'MUTATE_Q13C_PREVIEW_BUSINESS_V1';
const FIXTURE_EMPLOYEE_CODE = 'ZZZ-UAT-DISPOSABLE-V1';
const FIXTURE_USER_EMAIL = 'uat-disposable-employee-v1@example.invalid';
const DEPARTMENT_CODE = 'ZZZ_Q13C_DEPT_V1';
const DEPARTMENT_NAME = 'Q13C Preview Department Updated';
const SITE_CODE = 'ZZZ_Q13C_SITE_V1';
const SITE_NAME = 'Q13C Preview Site V1';
const SETTING_KEY = 'LINE_TEMPLATE_NEW_LEAVE';
const MARKER = 'Q13C-UAT';

test.describe.configure({ mode: 'serial' });

function assertMutationGuard() {
  expect(process.env.UAT_TARGET_MODE).toBe('preview');
  expect(process.env.Q13C_WRITE_CONFIRMATION).toBe(Q13C_CONFIRMATION);
  expect(process.env.UAT_BASE_URL).toMatch(/^https:\/\/sms-v3-staging-[a-z0-9]+-godzillazz\.vercel\.app$/i);
  expect(process.env.UAT_BASE_URL).not.toBe('https://sms-v3-staging-ten.vercel.app');
}

async function fixtureEmployee(accessToken) {
  const response = await authenticatedRequest(`/api/v1/employees?page=1&pageSize=20&search=${encodeURIComponent(FIXTURE_EMPLOYEE_CODE)}`, { accessToken });
  expect(response.status).toBe(200);
  const rows = (response.payload?.data || []).filter((row) => row.employeeCode === FIXTURE_EMPLOYEE_CODE);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function fixtureUser(accessToken) {
  const response = await authenticatedRequest('/api/v1/users', { accessToken });
  expect(response.status).toBe(200);
  const row = (response.payload?.data || []).find((item) => String(item.email || '').toLowerCase() === FIXTURE_USER_EMAIL);
  expect(row).toBeTruthy();
  return row;
}

test('Q13C ADMIN: Preview mutation safety guard', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const ready = await authenticatedRequest('/api/v1/ready', { accessToken });
  expect(ready.status).toBe(200);
  expect(ready.payload?.status).toBe('ready');
  expect(ready.payload?.database).toBe('ok');
});

test('Q13C ADMIN: Personnel Master reversible lifecycle', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const before = await authenticatedRequest('/api/v1/personnel-masters', { accessToken });
  expect(before.status).toBe(200);
  expect((before.payload?.data?.departments || []).some((row) => row.code === DEPARTMENT_CODE)).toBe(false);
  const created = await authenticatedRequest('/api/v1/personnel-masters/department', { accessToken, method: 'POST', data: { code: DEPARTMENT_CODE, name: 'Q13C Preview Department V1', isActive: true, sortOrder: 9900 } });
  expect(created.status).toBe(201);
  const id = created.payload?.data?.id;
  expect(id).toBeTruthy();
  const updated = await authenticatedRequest(`/api/v1/personnel-masters/department/${id}`, { accessToken, method: 'PUT', data: { name: DEPARTMENT_NAME, sortOrder: 9901 } });
  expect(updated.status).toBe(200);
  expect(updated.payload?.data?.name).toBe(DEPARTMENT_NAME);
  const impact = await authenticatedRequest(`/api/v1/personnel-masters/department/${id}/impact`, { accessToken });
  expect(impact.status).toBe(200);
  expect(impact.payload?.data?.totalReferences).toBe(0);
});

test('Q13C ADMIN: Employee Change governed approval workflow', async () => {
  assertMutationGuard();
  test.setTimeout(120_000);
  const adminToken = roleAccessToken('ADMIN');
  const managerToken = roleAccessToken('MANAGER');
  const employee = await fixtureEmployee(adminToken);
  const draft = await authenticatedRequest(`/api/v1/employees/${employee.id}/change-requests`, { accessToken: managerToken, method: 'POST', data: { proposal: { firstName: 'UAT', lastName: 'LifecycleV1' }, effectiveMode: 'IMMEDIATE', reason: `${MARKER} governed employee change`, idempotencyKey: randomUUID() } });
  expect(draft.status).toBe(201);
  const requestId = draft.payload?.data?.id;
  expect(requestId).toBeTruthy();
  expect(draft.payload?.data?.status).toBe('DRAFT');
  const submitted = await authenticatedRequest(`/api/v1/employee-change-requests/${requestId}/submit`, { accessToken: managerToken, method: 'POST', data: { idempotencyKey: randomUUID() } });
  expect(submitted.status).toBe(200);
  expect(submitted.payload?.data?.request?.status || submitted.payload?.data?.status).toBe('PENDING_APPROVAL');
  const approved = await authenticatedRequest(`/api/v1/employee-change-requests/${requestId}/approve`, { accessToken: adminToken, method: 'POST', data: { idempotencyKey: randomUUID(), acknowledgeWarnings: true } });
  expect(approved.status).toBe(200);
  expect(approved.payload?.data?.request?.status || approved.payload?.data?.status).toBe('APPROVED');
  const readBack = await authenticatedRequest(`/api/v1/employees/${employee.id}`, { accessToken: adminToken });
  expect(readBack.status).toBe(200);
  expect(readBack.payload?.data?.firstName).toBe('UAT');
  expect(readBack.payload?.data?.lastName).toBe('LifecycleV1');
  expect(readBack.payload?.data?.displayName).toBe('UAT LifecycleV1');
});

test('Q13C ADMIN: Disposable user access lifecycle', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const before = await fixtureUser(accessToken);
  expect(before.role).toBe('VIEWER');
  try {
    const suspended = await authenticatedRequest(`/api/v1/users/${before.id}`, { accessToken, method: 'PUT', data: { accountStatus: 'SUSPENDED', isActive: false } });
    expect(suspended.status).toBe(200);
    expect(suspended.payload?.data?.accountStatus).toBe('SUSPENDED');
    expect(suspended.payload?.data?.isActive).toBe(false);
    const restored = await authenticatedRequest(`/api/v1/users/${before.id}`, { accessToken, method: 'PUT', data: { role: 'VIEWER', department: 'UAT Fixture Alpha', accountStatus: 'ACTIVE', isActive: true } });
    expect(restored.status).toBe(200);
    expect(restored.payload?.data?.accountStatus).toBe('ACTIVE');
    expect(restored.payload?.data?.isActive).toBe(true);
    expect(restored.payload?.data?.role).toBe('VIEWER');
  } finally {
    await authenticatedRequest(`/api/v1/users/${before.id}`, { accessToken, method: 'PUT', data: { role: 'VIEWER', department: 'UAT Fixture Alpha', accountStatus: 'ACTIVE', isActive: true } }).catch(() => undefined);
  }
});

test('Q13C ADMIN: Security Site reversible configuration workflow', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const masters = await authenticatedRequest('/api/v1/personnel-masters', { accessToken });
  expect(masters.status).toBe(200);
  const department = (masters.payload?.data?.departments || []).find((row) => row.code === DEPARTMENT_CODE);
  expect(department).toBeTruthy();
  const created = await authenticatedRequest('/api/v1/admin/security-sites', { accessToken, method: 'POST', data: { code: SITE_CODE, name: SITE_NAME, latitude: 13.7563, longitude: 100.5018, geofenceRadiusMeters: 25, isActive: true } });
  expect(created.status).toBe(201);
  const siteId = created.payload?.data?.id;
  expect(siteId).toBeTruthy();
  const updated = await authenticatedRequest(`/api/v1/admin/security-sites/${siteId}`, { accessToken, method: 'PUT', data: { name: `${SITE_NAME} Updated`, geofenceRadiusMeters: 30 } });
  expect(updated.status).toBe(200);
  expect(updated.payload?.data?.geofenceRadiusMeters).toBe(30);
  const mapped = await authenticatedRequest('/api/v1/admin/security-sites/department-mapping', { accessToken, method: 'PUT', data: { departmentMasterId: department.id, siteIds: [siteId], defaultSiteId: siteId } });
  expect(mapped.status).toBe(200);
  expect(mapped.payload?.data?.defaultSiteId).toBe(siteId);
  const rotated = await authenticatedRequest(`/api/v1/admin/security-sites/${siteId}/qr/rotate`, { accessToken, method: 'POST', data: { reason: `${MARKER} QR rotate contract` } });
  expect(rotated.status).toBe(200);
  const credentialId = rotated.payload?.data?.credential?.id;
  expect(credentialId).toBeTruthy();
  const revoked = await authenticatedRequest(`/api/v1/admin/security-sites/${siteId}/qr/${credentialId}/revoke`, { accessToken, method: 'POST', data: { reason: `${MARKER} QR revoke contract` } });
  expect(revoked.status).toBe(200);
  expect(revoked.payload?.data?.revokedAt).toBeTruthy();
  const unmapped = await authenticatedRequest('/api/v1/admin/security-sites/department-mapping', { accessToken, method: 'PUT', data: { departmentMasterId: department.id, siteIds: [], defaultSiteId: null } });
  expect(unmapped.status).toBe(200);
  expect(unmapped.payload?.data?.siteIds || []).toHaveLength(0);
  const deactivated = await authenticatedRequest(`/api/v1/admin/security-sites/${siteId}`, { accessToken, method: 'PUT', data: { isActive: false, reason: `${MARKER} reversible site deactivation` } });
  expect(deactivated.status).toBe(200);
  expect(deactivated.payload?.data?.isActive).toBe(false);
});

test('Q13C ADMIN: System Setting reversible standard update', async () => {
  assertMutationGuard();
  const accessToken = roleAccessToken('ADMIN');
  const settings = await authenticatedRequest('/api/v1/system-settings', { accessToken });
  expect(settings.status).toBe(200);
  const definition = (settings.payload?.data || []).find((row) => row.key === SETTING_KEY);
  expect(definition).toBeTruthy();
  expect(definition.editable).toBe(true);
  const value = `${MARKER} Preview notification template validation`;
  const updated = await authenticatedRequest(`/api/v1/system-settings/${SETTING_KEY}`, { accessToken, method: 'PUT', data: { value } });
  expect(updated.status).toBe(200);
  const readBack = await authenticatedRequest('/api/v1/system-settings', { accessToken });
  expect(readBack.status).toBe(200);
  expect((readBack.payload?.data || []).find((row) => row.key === SETTING_KEY)?.value).toBe(value);
  const history = await authenticatedRequest(`/api/v1/system-settings/${SETTING_KEY}/history`, { accessToken });
  expect(history.status).toBe(200);
  expect(Array.isArray(history.payload?.data?.history)).toBe(true);
  expect(history.payload.data.history.length).toBeGreaterThan(0);
});