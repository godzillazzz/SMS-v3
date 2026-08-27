import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const mode = read('./pwa-mode.ts');
const register = read('./pwa.ts');
const profile = read('./pages/pwa-profile/PwaProfilePage.tsx');
const history = read('./pages/pwa-attendance/AttendanceHistoryPwaPage.tsx');
const schedule = read('./pages/pwa-attendance/AttendanceSchedulePwaPage.tsx');
const css = read('./styles/pwa-shell.css');
const manifestText = read('../public/manifest.webmanifest');
const manifest = JSON.parse(manifestText);
const sw = read('../public/sw.js');
const index = read('../index.html');

describe('Attendance UX V4 Employee Mobile/PWA shell', () => {
  it('limits the installed employee product surface to the approved five self-service pages', () => {
    expect(mode).toContain("export const SMS_PWA_PAGES: SmsPwaPage[] = ['attendance', 'attendanceHistory', 'employeeSchedule', 'leave', 'profile']");
    const nav = main.slice(main.indexOf('className="pwa-bottom-nav"'), main.indexOf('</nav>}', main.indexOf('className="pwa-bottom-nav"')));
    for (const label of ['ลงเวลา', 'ประวัติ', 'ตารางงาน', 'ลา', 'โปรไฟล์']) expect(nav).toContain(label);
    for (const adminLabel of ['Dashboard', 'พนักงาน', 'ผู้ใช้งาน']) expect(nav).not.toContain(adminLabel);
  });

  it('starts standalone PWA on Attendance and fail-closes navigation outside the five-page shell', () => {
    expect(mode).toContain("return SMS_PWA_PAGES.includes(requested as SmsPwaPage) ? requested as SmsPwaPage : 'attendance'");
    expect(mode).toContain("window.matchMedia('(display-mode: standalone)').matches");
    expect(mode).toContain("queryValue('pwa') === '1'");
    expect(main).toContain("if (pwaShell && !isSmsPwaPage(activePage)) setActivePage('attendance')");
    expect(main).toContain("pwaShell ? initialSmsPwaPage() : 'dashboard'");
  });

  it('keeps normal web navigation intact while Attendance gets a dedicated page-aware PWA surface', () => {
    expect(main).toContain('visibleNavigation.map');
    expect(css).toContain('.app-shell.pwa-shell .sidebar');
    expect(css).toContain('.app-shell.pwa-shell .topbar');
    expect(css).toContain('display: none !important');
    expect(main).toContain('pwa-shell pwa-page-');
    expect(main).toContain("activePage !== 'attendance'");
  });

  it('keeps Leave self-service-only inside PWA even for Manager/Admin accounts', () => {
    expect(main).toContain('canManage={pwaShell ? false : canManage}');
    expect(main).toContain("historyScope={activePage === 'leaveHistory' ? 'all' : 'mine'}");
    expect(main).toContain("mode={activePage === 'leavePending' ? 'pending' : activePage === 'leaveHistory' ? 'history' : 'all'}");
  });

  it('provides employee-only History, Schedule and Profile surfaces', () => {
    expect(main).toContain('<AttendanceHistoryPwaPage');
    expect(main).toContain('<AttendanceSchedulePwaPage');
    expect(history).toContain('attendanceSelfHistory(token');
    expect(schedule).toContain('attendanceSelfSchedule(token');
    expect(schedule).toContain('แสดงเฉพาะตารางที่อนุมัติและล็อกแล้ว');
    expect(main).toContain('<PwaProfilePage');
    expect(profile).toContain('ข้อมูลบัญชี');
    expect(profile).toContain('การเข้าสู่ระบบและ Passkey');
    expect(profile).not.toContain('/attendance/devices');
  });

  it('ships exactly the five approved employee shortcuts', () => {
    expect(index).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(index).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/?pwa=1&page=attendance');
    expect(manifest.shortcuts.map((item: { url: string }) => item.url)).toEqual([
      '/?pwa=1&page=attendance',
      '/?pwa=1&page=attendanceHistory',
      '/?pwa=1&page=employeeSchedule',
      '/?pwa=1&page=leave',
      '/?pwa=1&page=profile'
    ]);
    expect(manifestText).not.toContain('dashboard');
  });

  it('registers the service worker only in secure-capable browsers and never caches API data', () => {
    expect(register).toContain('window.isSecureContext');
    expect(register).toContain("'serviceWorker' in navigator");
    expect(register).toContain("navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })");
    expect(sw).toContain("if (url.pathname.startsWith('/api/')) return");
    expect(sw).toContain("if (request.method !== 'GET') return");
    expect(sw).not.toContain('BackgroundSync');
  });

  it('communicates offline state without fabricating Attendance success', () => {
    expect(main).toContain('ออฟไลน์ — เปิดดู shell ได้ แต่การลงเวลาและการส่งคำขอลาต้องรอการเชื่อมต่อ Server');
    expect(main).toContain("window.addEventListener('online', update)");
    expect(main).toContain("window.addEventListener('offline', update)");
    expect(main).not.toContain('OFFLINE_PENDING');
    expect(sw).not.toContain('/api/v1/attendance');
  });

  it('uses safe-area-aware five-column bottom navigation', () => {
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
  });
});
