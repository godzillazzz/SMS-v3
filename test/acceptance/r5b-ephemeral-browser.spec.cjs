'use strict';
// This suite uses a REAL local Chromium browser, backend and local-only database.
// It does NOT run the protected Q13B/Q13C hosted-Preview acceptance cases.
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');

function assertDisposableRuntime() {
  const target = 'postgresql://ci_user:ci_test_only@127.0.0.1:5432/sms_v3_test?schema=public';
  if (process.env.NODE_ENV !== 'test' ||
      process.env.RUN_INTEGRATION_TESTS !== 'true' ||
      process.env.TEST_DATABASE_RUNNER !== 'docker-container-network' ||
      process.env.DATABASE_URL !== target || process.env.DIRECT_URL !== target ||
      process.env.VERCEL_ENV || process.env.SUPABASE_URL ||
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VERCEL_TOKEN ||
      process.env.CRON_SECRET ||
      process.env.R5B_LOCAL_BROWSER_APPROVED !== 'YES') {
    throw Error('R5B_LOCAL_BROWSER_DISPOSABLE_TARGET_NOT_PROVEN');
  }
}

test.describe('R5-B disposable localhost Chromium business UI evidence (NOT Preview UAT)', () => {
  test.describe.configure({ mode: 'serial' });
  const prisma = require('../../src/config/prisma');
  const marker = randomUUID();
  const number = 'R5B-BROWSER-LIC-' + marker.slice(0, 16);
  let employeeId;
  let licenseId;

  test.beforeAll(async () => {
    assertDisposableRuntime();
    const employee = await prisma.employee.create({
      data: { employeeCode: 'R5B-BROWSER-' + marker.slice(0, 12),
        firstName: 'Browser', lastName: 'Synthetic',
        department: 'TEST-ONLY', jobTitle: 'Security Guard', isActive: true }
    });
    employeeId = employee.id;
    const license = await prisma.employeeLicense.create({
      data: {
        employeeId,
        legacyLicenseId: 'test:' + marker,
        licenseType: 'Local Browser Acceptance',
        licenseNumber: number,
        issueDate: new Date('2026-10-01T00:00:00.000Z'),
        expiryDate: new Date('2028-10-01T00:00:00.000Z'),
        status: 'Active'
      }
    });
    licenseId = license.id;
  });

  test.afterAll(async () => {
    try {
      if (licenseId) {
        await prisma.employeeLicense.deleteMany({ where: { id: licenseId } });
        expect(await prisma.employeeLicense.count({ where: { id: licenseId } })).toBe(0);
      }
      if (employeeId) {
        await prisma.employee.deleteMany({ where: { id: employeeId } });
        expect(await prisma.employee.count({ where: { id: employeeId } })).toBe(0);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function signInOnRoute(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#auth-login-form')).toBeVisible();
    await page.locator('#email').fill('ci-admin@example.test');
    await page.locator('#password').fill('ci-seed-password-only-for-ephemeral-db');
    await page.getByRole('button', { name: /เข้าสู่ระบบปฏิบัติการ/ }).click();
    await expect(page.locator('#auth-login-form')).toBeHidden();
    await expect(page.getByText('ไม่มีสิทธิ์เข้าถึงหน้านี้')).toHaveCount(0);
  }

  test('Q13C LOCAL BROWSER: Admin sign-in and real employee-license inventory render', async ({page}) => {
    await signInOnRoute(page, '/app/licenses');
    await expect(page.getByRole('heading', { name: 'ใบอนุญาตพนักงาน' })).toBeVisible();
    const table = page.locator('table[aria-label="รายการใบอนุญาตพนักงาน"]');
    await expect(table).toBeVisible();
    await expect(table.getByText(number)).toBeVisible();
    await expect(table.getByText('Browser Synthetic')).toBeVisible();
    await page.getByRole('textbox', { name: 'ค้นหาใบอนุญาต' }).fill(number);
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.getByText(number)).toBeVisible();
  });

  test('Q13B LOCAL BROWSER: Admin sign-in and governed leave-approval route render', async ({page}) => {
    await signInOnRoute(page, '/app/leave/approvals');
    await expect(page).toHaveURL(/\/app\/leave\/approvals$/);
    await expect(page.getByText('ไม่พบหน้าที่ต้องการ')).toHaveCount(0);
    await expect(page.getByText('ไม่มีสิทธิ์เข้าถึงหน้านี้')).toHaveCount(0);
    await expect(page.getByText('คำขอลา', {exact: true}).first()).toBeVisible();
  });
});
