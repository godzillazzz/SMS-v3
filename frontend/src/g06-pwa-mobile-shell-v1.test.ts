import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const mode = read('./pwa-mode.ts');
const register = read('./pwa.ts');
const profile = read('./pages/pwa-profile/PwaProfilePage.tsx');
const css = read('./styles/pwa-shell.css');
const manifestText = read('../public/manifest.webmanifest');
const manifest = JSON.parse(manifestText);
const sw = read('../public/sw.js');
const index = read('../index.html');

describe('G06 Mobile/PWA Foundation V1', () => {
  it('limits the installed PWA product surface to Attendance, Leave, and Profile only', () => {
    expect(mode).toContain("export const SMS_PWA_PAGES: SmsPwaPage[] = ['attendance', 'leave', 'profile']");
    expect(main).toContain("selectPwaPage('attendance')");
    expect(main).toContain("selectPwaPage('leave')");
    expect(main).toContain("selectPwaPage('profile')");
    const nav = main.slice(main.indexOf('className="pwa-bottom-nav"'), main.indexOf('</nav>}', main.indexOf('className="pwa-bottom-nav"')));
    expect(nav).toContain('ลงเวลา');
    expect(nav).toContain('ลา');
    expect(nav).toContain('โปรไฟล์');
    expect(nav).not.toContain('ตารางกะ');
    expect(nav).not.toContain('Dashboard');
    expect(nav).not.toContain('พนักงาน');
  });

  it('starts installed/standalone PWA on Attendance and fail-closes attempts to navigate outside the three-page shell', () => {
    expect(mode).toContain("return SMS_PWA_PAGES.includes(requested as SmsPwaPage) ? requested as SmsPwaPage : 'attendance'");
    expect(mode).toContain("window.matchMedia('(display-mode: standalone)').matches");
    expect(mode).toContain("queryValue('pwa') === '1'");
    expect(main).toContain("if (pwaShell && !isSmsPwaPage(activePage)) setActivePage('attendance')");
    expect(main).toContain("pwaShell ? initialSmsPwaPage() : 'dashboard'");
  });

  it('keeps the normal web navigation intact while PWA chrome hides the desktop sidebar/topbar', () => {
    expect(main).toContain('visibleNavigation.map');
    expect(css).toContain('.app-shell.pwa-shell .sidebar');
    expect(css).toContain('.app-shell.pwa-shell .topbar');
    expect(css).toContain('display: none !important');
    expect(main).toContain("${pwaShell ? 'pwa-shell' : ''}");
  });

  it('keeps Leave self-service-only inside PWA even for Manager/Admin accounts', () => {
    expect(main).toContain('canManage={pwaShell ? false : canManage}');
    expect(main).toContain("historyScope={activePage === 'leaveHistory' ? 'all' : 'mine'}");
    expect(main).toContain("mode={activePage === 'leavePending' ? 'pending' : activePage === 'leaveHistory' ? 'history' : 'all'}");
  });

  it('provides a dedicated Profile page without exposing Attendance device authority as account/Passkey authority', () => {
    expect(main).toContain('<PwaProfilePage');
    expect(profile).toContain('ข้อมูลบัญชี');
    expect(profile).toContain('การเข้าสู่ระบบและ Passkey');
    expect(profile).toContain('โดยไม่เปลี่ยน Attendance device authority');
    expect(profile).toContain('onLogout');
    expect(profile).not.toContain('/attendance/devices');
  });

  it('ships an installable manifest whose shortcuts contain only the approved three PWA pages', () => {
    expect(index).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(index).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/?pwa=1&page=attendance');
    expect(manifest.shortcuts.map((item: { url: string }) => item.url)).toEqual([
      '/?pwa=1&page=attendance',
      '/?pwa=1&page=leave',
      '/?pwa=1&page=profile'
    ]);
    expect(manifestText).not.toContain('schedule');
    expect(manifestText).not.toContain('dashboard');
  });

  it('registers the service worker only in secure-capable browsers and never caches API data', () => {
    expect(register).toContain("window.isSecureContext");
    expect(register).toContain("'serviceWorker' in navigator");
    expect(register).toContain("navigator.serviceWorker.register('/sw.js', { scope: '/' })");
    expect(sw).toContain("if (url.pathname.startsWith('/api/')) return");
    expect(sw).toContain("if (request.method !== 'GET') return");
    expect(sw).not.toContain('sync');
    expect(sw).not.toContain('push');
    expect(sw).not.toContain('BackgroundSync');
  });

  it('communicates offline state without fabricating Attendance or Leave success', () => {
    expect(main).toContain('ออฟไลน์ — เปิดดู shell ได้ แต่การลงเวลาและการส่งคำขอลาต้องรอการเชื่อมต่อ Server');
    expect(main).toContain("window.addEventListener('online', update)");
    expect(main).toContain("window.addEventListener('offline', update)");
    expect(main).not.toContain('OFFLINE_PENDING');
    expect(sw).not.toContain('/api/v1/attendance');
    expect(sw).not.toContain('/api/v1/leave');
  });

  it('uses safe-area-aware mobile chrome for installed phones', () => {
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('.pwa-bottom-nav');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });
});
