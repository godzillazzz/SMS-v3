const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { hasRoleCredentials } = require('../helpers/uat-config');
const { assertNoHorizontalOverflow, captureScreenshot, navigateTo, startPageMonitor } = require('../helpers/uat-observe');

const deviceMatrix = [
  { name: 'iphone-se-320', width: 320, height: 568, family: 'iPhone' },
  { name: 'android-compact-360', width: 360, height: 800, family: 'Android' },
  { name: 'iphone-375', width: 375, height: 667, family: 'iPhone' },
  { name: 'iphone-390', width: 390, height: 844, family: 'iPhone' },
  { name: 'android-large-412', width: 412, height: 915, family: 'Android' },
  { name: 'iphone-max-430', width: 430, height: 932, family: 'iPhone' },
  { name: 'mobile-landscape-844', width: 844, height: 390, family: 'Mobile landscape' },
  { name: 'ipad-portrait-768', width: 768, height: 1024, family: 'iPad' },
  { name: 'ipad-landscape-1024', width: 1024, height: 768, family: 'iPad' },
  { name: 'laptop-1280', width: 1280, height: 800, family: 'Computer' },
  { name: 'desktop-1440', width: 1440, height: 900, family: 'Computer' },
  { name: 'fullhd-1920', width: 1920, height: 1080, family: 'Computer' }
];

const representativeDevices = deviceMatrix.filter(({ name }) => [
  'iphone-390',
  'android-large-412',
  'ipad-portrait-768',
  'ipad-landscape-1024',
  'desktop-1440'
].includes(name));

const adminPages = [
  'ข้อมูลพนักงาน',
  'ใบอนุญาต รปภ.',
  'ลงเวลา',
  'ลงเวลาแทนพนักงาน',
  'อุปกรณ์ลงเวลา',
  'ตารางกะรายเดือน',
  'รหัสกะและเวลา',
  'คำขอลา',
  'รออนุมัติ',
  'ประวัติการลาทั้งหมด',
  'โควต้าวันลา',
  'Approval Center',
  'กฎการทำงาน',
  'บันทึกการใช้งานระบบ',
  'คุณภาพข้อมูล',
  'ผู้ใช้และสิทธิ์',
  'รายงานและวิเคราะห์',
  'Security Site & QR',
  'ตั้งค่าระบบ'
];

async function settleLayout(page) {
  await page.locator('.content-area').waitFor({ state: 'visible' });
  await page.waitForTimeout(120);
}

test.skip(!hasRoleCredentials('ADMIN'), 'ADMIN responsive certification skipped: credentials unavailable.');

for (const viewport of deviceMatrix) {
  test(`responsive shell ${viewport.family} ${viewport.name}`, async ({ page }, testInfo) => {
    const monitor = startPageMonitor(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginAs(page, 'ADMIN');
    await expect(page.getByRole('region', { name: 'Executive snapshot' })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const menuButton = page.getByRole('button', { name: 'เปิดเมนูหลัก', exact: true });
    if (viewport.width <= 760) await expect(menuButton).toBeVisible();

    await captureScreenshot(page, testInfo, `responsive-shell-${viewport.name}`);
    monitor.assertClean();
  });
}

for (const viewport of representativeDevices) {
  test(`all primary pages ${viewport.family} ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginAs(page, 'ADMIN');
    await expect(page.getByRole('region', { name: 'Executive snapshot' })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    for (const label of adminPages) {
      await navigateTo(page, label);
      await settleLayout(page);
      await assertNoHorizontalOverflow(page);
    }

    await captureScreenshot(page, testInfo, `responsive-all-pages-final-${viewport.name}`);
  });
}

test('Audit preserves mobile cards and tablet/desktop table contracts', async ({ page }) => {
  for (const viewport of [deviceMatrix[3], deviceMatrix[7], deviceMatrix[10]]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginAs(page, 'ADMIN');
    await navigateTo(page, 'บันทึกการใช้งานระบบ');
    await expect(page.locator('.audit-compliance-page')).toBeVisible();
    const desktopTable = page.locator('.audit-desktop-table');
    const mobileCards = page.locator('.audit-mobile-cards');
    if (viewport.width <= 600) {
      await expect(mobileCards).toBeVisible();
      await expect(desktopTable).toBeHidden();
    } else {
      await expect(desktopTable).toBeVisible();
      await expect(mobileCards).toBeHidden();
    }
    await assertNoHorizontalOverflow(page);
    await page.context().clearCookies();
    await page.goto('/');
  }
});
