import { expect, test } from '@playwright/test';

test('same browser profile persists a non-exportable key and signs the verification device ID after reload', async ({ page }) => {
  await page.goto('/e2e-device-key/fixture.html');
  const first = await page.evaluate(async () => await (window as any).deviceKeyFixture.persistAndVerifyAfterReload());
  expect(first.activeKeyIdMatch).toBe(true);
  expect(first.verificationMatchesActive).toBe(true);
  expect(first.localKeyStatus).toBe('PRESENT');
  expect(first.hasLocalKey).toBe(true);
  expect(first.extractable).toBe(false);
  expect(first.algorithm).toBe('ECDSA');
  expect(first.namedCurve).toBe('P-256');
  expect(first.signatureVerified).toBe(true);

  await page.reload();
  const afterReload = await page.evaluate(async () => await (window as any).deviceKeyFixture.persistAndVerifyAfterReload());
  expect(afterReload.activeDeviceId).toBe(first.activeDeviceId);
  expect(afterReload.verificationDeviceId).toBe(first.verificationDeviceId);
  expect(afterReload.storedEnrollmentIds).toContain(first.activeDeviceId);
  expect(afterReload.localKeyStatus).toBe('PRESENT');
  expect(afterReload.hasLocalKey).toBe(true);
  expect(afterReload.signatureVerified).toBe(true);
});

test('prunes only stale enrollment keys and retains both allowed active and candidate keys', async ({ page }) => {
  await page.goto('/e2e-device-key/fixture.html');
  const result = await page.evaluate(async () => await (window as any).deviceKeyFixture.pruneKeepsAllowed());
  expect(result.removed).toBe(1);
  expect(result.ids).toEqual(['fixture-active', 'fixture-candidate']);
  expect(result.activeStatus).toBe('PRESENT');
  expect(result.candidateStatus).toBe('PRESENT');
  expect(result.staleStatus).toBe('MISSING');
});

test('a separate browser profile cannot read the first profile private key', async ({ page, browser }) => {
  await page.goto('/e2e-device-key/fixture.html');
  const firstProfile = await page.evaluate(async () => await (window as any).deviceKeyFixture.persistAndVerifyAfterReload());
  const otherProfile = await browser.newPage();
  await otherProfile.goto('/e2e-device-key/fixture.html');
  const result = await otherProfile.evaluate(async (enrollmentId) => await (window as any).deviceKeyFixture.inspectExistingEnrollment(enrollmentId), firstProfile.activeDeviceId);
  expect(result.available).toBe(true);
  expect(result.status).toBe('MISSING');
  expect(result.storedEnrollmentIds).toEqual([]);
  await otherProfile.close();
});

test('malformed IndexedDB key records are reported invalid and signing fails closed', async ({ page }) => {
  await page.goto('/e2e-device-key/fixture.html');
  const result = await page.evaluate(async () => await (window as any).deviceKeyFixture.malformedRecordFailsClosed());
  expect(result.status).toBe('INVALID');
  expect(result.signingErrorCode).toBe('ATTENDANCE_DEVICE_LOCAL_KEY_INVALID');
  expect(result.malformedRecordCount).toBe(1);
});

const uiActiveDevice = {
  id: 'browser-ui-active-device',
  employeeId: 'browser-ui-employee',
  displayName: 'Browser test iPhone',
  keyAlgorithm: 'ECDSA_P256_SHA256',
  platformHint: 'iPhone',
  status: 'ACTIVE',
  activatedAt: '2026-09-01T00:00:00.000Z',
  approvedBy: { id: 'browser-ui-admin', displayName: 'Admin' }
};

async function mountDevicePage(page: import('@playwright/test').Page, options: { activeKey: boolean; candidateKey?: boolean }) {
  await page.route('**/api/v1/attendance/devices/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        employeeId: 'browser-ui-employee',
        activeDevice: uiActiveDevice,
        activeRequest: options.candidateKey ? {
          id: 'browser-ui-request',
          employeeId: 'browser-ui-employee',
          requestType: 'REPLACEMENT',
          status: 'PENDING_APPROVAL',
          requestedByUserId: 'browser-ui-user',
          candidateDeviceEnrollmentId: 'browser-ui-candidate-device',
          createdAt: '2026-09-01T00:00:00.000Z',
          candidateDevice: { ...uiActiveDevice, id: 'browser-ui-candidate-device', displayName: 'Candidate iPhone', status: 'PENDING_APPROVAL', proofVerifiedAt: null }
        } : null
      }
    })
  }));
  await page.goto('/e2e-device-key/device-page-fixture.html');
  await page.evaluate(async (settings) => await (window as any).devicePageFixture.mount(settings), options);
}

test('device page reflects active local key state without overflow at desktop and mobile widths', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mountDevicePage(page, { activeKey: true, candidateKey: true });
  const active = page.getByTestId('attendance-active-device');
  await expect(active).toHaveAttribute('data-local-key-state', 'READY_LOCAL_KEY');
  await expect(page.getByTestId('attendance-candidate-key-state')).toHaveAttribute('data-local-key-state', 'PRESENT');
  await page.getByTestId('attendance-device-id-diagnostics').locator('summary').click();

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      columns: getComputedStyle(document.querySelector('.attendance-device-grid')!).gridTemplateColumns,
      overflowers: [...document.querySelectorAll('body *')].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      }).slice(0, 8).map((element) => ({ tag: element.tagName, className: (element as HTMLElement).className, right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) }))
    }));
    expect(metrics.document, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewport);
    if (width < 640) expect(metrics.columns.trim().split(/\s+/)).toHaveLength(1);
    else expect(metrics.columns.trim().split(/\s+/).length).toBeGreaterThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('device page warns when Server ACTIVE has no matching local key', async ({ page }) => {
  await mountDevicePage(page, { activeKey: false });
  const active = page.getByTestId('attendance-active-device');
  await expect(active).toHaveAttribute('data-local-key-state', 'MISSING_LOCAL_KEY');
  await expect(page.getByText('สถานะ Server ACTIVE แต่ local key ยังไม่พร้อม')).toBeVisible();
  await expect(page.getByText(/Attendance จะหยุดก่อน device proof/)).toBeVisible();
  await expect(page.getByText('Private key พร้อมใน browser นี้')).toHaveCount(0);
});
