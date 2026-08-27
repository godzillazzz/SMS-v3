import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./pages/attendance/AttendancePage.tsx');
const css = read('./pages/attendance/attendance-v4.css');
const main = read('./main.tsx');
const client = read('./pages/attendance/attendance-client.ts');
const history = read('./pages/pwa-attendance/AttendanceHistoryPwaPage.tsx');
const schedule = read('./pages/pwa-attendance/AttendanceSchedulePwaPage.tsx');

describe('Attendance UX V4 visual acceptance contract', () => {
  it('renders a dedicated mockup-locked Clock surface instead of merely restyling the legacy Attendance pane', () => {
    expect(main).toContain('employeeV4={pwaShell}');
    expect(main).toContain("activePage !== 'attendance'");
    for (const className of [
      'attendance-v4__topbar',
      'attendance-v4__employee',
      'attendance-v4__hero-wrap',
      'attendance-v4__action',
      'attendance-v4__status-pill',
      'attendance-v4__readiness',
      'attendance-v4__clock',
      'attendance-v4__footer'
    ]) expect(page).toContain(className);
    expect(css).toContain('width: 286px;');
    expect(css).toContain('height: 286px;');
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(css).toContain('linear-gradient(145deg, #fff, #f9fbff)');
  });

  it('locks the owner-approved Clock information hierarchy and five-tab navigation', () => {
    for (const text of ['SMS Time Attendance', 'Expected Site', 'TAP TO CHECK IN', 'GPS', 'QR', 'Face', 'Device', 'ดูประวัติวันนี้']) {
      expect(page).toContain(text);
    }
    const nav = main.slice(main.indexOf('className="pwa-bottom-nav"'), main.indexOf('</nav>}', main.indexOf('className="pwa-bottom-nav"')));
    for (const label of ['ลงเวลา', 'ประวัติ', 'ตารางงาน', 'ลา', 'โปรไฟล์']) expect(nav).toContain(label);
  });

  it('uses real employee, shift, site, history and schedule read models rather than mockup sample records', () => {
    expect(client).toContain('/attendance/me/today');
    expect(client).toContain('/attendance/me/history');
    expect(client).toContain('/attendance/me/schedule');
    expect(page).toContain('todayData?.employee.employeeCode');
    expect(page).toContain('assignment?.expectedSite?.name');
    expect(history).toContain('data.rows.map');
    expect(schedule).toContain('data.rows.map');
    expect(page).not.toContain('540368');
    expect(page).not.toContain('SERMPONG');
    expect(page).not.toContain('คลินิกฟัน รักษ์ยิ้ม');
  });

  it('uses the Owner-restored SMS header logo while keeping the retro robot mascot in the action orb', () => {
    const v4 = page.slice(page.indexOf("if (employeeV4)"));
    expect(v4.match(/\/attendance-retro-robot\.svg/g)?.length).toBe(1);
    expect(v4).toContain('/pwa-icon-192.png');
    expect(v4).toContain('alt="SMS"');
    expect(css).toContain('.attendance-v4__brand img');
    expect(css).toContain('.attendance-v4__action-logo');
  });

  it('shows approved correction provenance in employee history without hiding immutable originals', () => {
    expect(history).toContain('row.corrected');
    expect(history).toContain('ปรับแล้ว');
    expect(history).toContain('ดูเวลาเดิมและเวลาที่มีผล');
    expect(history).toContain('row.originalCheckInAt');
    expect(history).toContain('row.originalCheckOutAt');
    expect(history).toContain('Raw AttendanceEvent เดิมไม่ถูกแก้ไข');
    expect(client).toContain('originalCheckInAt?: string | null');
    expect(client).toContain('originalCheckOutAt?: string | null');
    expect(client).toContain('correctionEventTypes?: string[]');
  });

  it('shows expected and actual Site context plus operational flags in employee history', () => {
    expect(history).toContain('Expected Site');
    expect(history).toContain('Actual Site');
    expect(history).toContain('WRONG_SHIFT');
    expect(history).toContain('ASSIST_OTHER_SITE');
    expect(history).toContain('OUTSIDE_ALL_SITES');
  });

  it('highlights today and the next approved shift in the employee schedule', () => {
    expect(schedule).toContain('กะวันนี้');
    expect(schedule).toContain('กะถัดไป');
    expect(schedule).toContain('currentBangkokDate');
    expect(schedule).toContain('row.date > today');
    expect(schedule).toContain('expectedSite?.name');
  });

  it('creates a distinct Success Receipt using server-authoritative AttendanceEvent time and today-history CTA', () => {
    expect(page).toContain('attendance-v4__receipt');
    expect(page).toContain("typeof accepted.event?.effectiveEventAt === 'string'");
    expect(page).toContain("typeof accepted.event?.receivedAt === 'string'");
    expect(page).toContain('SERVER_RECEIVED');
    expect(page).toContain('Receipt / Event ID');
    expect(page).toContain('onTodayHistory');
    expect(main).toContain("selectPwaPage('attendanceHistory', { today: true })");
    expect(page).not.toContain('setAttendanceAccepted({ intent: acceptedIntent, acceptedAt: new Date() })');
  });

  it('provides actionable Location Denied recovery with automatic iOS/Android guidance and permission re-check', () => {
    expect(page).toContain("'LOCATION_PERMISSION_DENIED'");
    expect(page).toContain('เปิดการตั้งค่าตำแหน่ง');
    expect(page).toContain("platform === 'ios'");
    expect(page).toContain("platform === 'android'");
    expect(page).toContain('Privacy & Security → Location Services');
    expect(page).toContain('Location → App permissions');
    expect(page).toContain("navigator.permissions.query({ name: 'geolocation' as PermissionName })");
    expect(page).toContain('locationRecoveryPendingRef.current');
    expect(page).toContain('retryLocationForActiveAttempt');
    expect(page).not.toContain('watchPosition');
  });

  it('keeps visual quality responsive for phone widths and safe-area PWA chrome', () => {
    expect(css).toContain('@media (max-width: 620px)');
    expect(css).toContain('@media (max-width: 420px)');
    expect(css).toContain('@media (max-width: 430px) and (max-height: 760px)');
    expect(css).toContain('@media (max-width: 360px)');
    expect(css).toContain('grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr);');
    const shell = read('./styles/pwa-shell.css');
    expect(shell).toContain('env(safe-area-inset-top)');
    expect(shell).toContain('env(safe-area-inset-bottom)');
    expect(shell).toContain('padding-bottom: calc(112px + env(safe-area-inset-bottom));');
    expect(shell).toContain('.pwa-page-attendance');
  });

  it('fails closed visually when no approved shift exists instead of showing a green ready claim', () => {
    expect(page).toContain("const scheduleReady = Boolean(todayData?.scheduleReady && assignment)");
    expect(page).toContain("'SHIFT NOT READY'");
    expect(page).toContain("'รอตารางงานที่อนุมัติ'");
    expect(page).toContain("'is-pending'");
    expect(css).toContain('.attendance-v4__status-pill.is-pending strong');
    expect(css).toContain('background: #94a3b8;');
  });
});
