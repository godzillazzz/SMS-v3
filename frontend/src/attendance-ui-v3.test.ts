import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./pages/attendance/AttendancePage.tsx');
const css = read('./pages/attendance/attendance.css');
const main = read('./main.tsx');

describe('Attendance UI V3 mockup-aligned employee surface', () => {
  it('implements the approved mockup as a real one-action Attendance UI without duplicating business authority', () => {
    expect(page).toContain('attendance-v3-identity-card');
    expect(page).toContain('attendance-v3-orb-button');
    expect(page).toContain('attendance-v3-trust-grid');
    expect(page).toContain('attendance-v3-clock-card');
    expect(page).toContain('TAP TO CHECK IN');
    expect(page).toContain('TAP TO CHECK OUT');
    expect(page).toContain('Server ตัดสิน IN / OUT');
    const legacy = page.slice(page.indexOf('return <section className="view-pane attendance-page attendance-v2"'));
    expect(legacy.match(/<button\b/g)?.length).toBe(1);
    expect(page).toContain('disabled={flowBusy}');
    expect(page).toContain('attendanceActivationGuardRef.current.shouldIgnoreSyntheticClick(Date.now())');
    expect(page).toContain('void handleStartAttendance()');
  });

  it('shows only real account context and authority-safe schedule/site placeholders instead of mockup sample data', () => {
    expect(main).toContain('department={auth.user?.department}');
    expect(page).toContain("displayName || 'ผู้ใช้งาน SMS'");
    expect(page).toContain("department || 'หน่วยงานตาม Employee Master'");
    expect(page).toContain('ตามตารางที่อนุมัติ');
    expect(page).toContain('Server ตรวจอัตโนมัติ');
    expect(page).not.toContain('540368');
    expect(page).not.toContain('SERMPONG CHAIWATTANAPONG');
    expect(page).not.toContain('คลินิกฟัน รักษ์ยิ้ม');
    expect(page).not.toContain('DAY 07:00–19:00');
  });

  it('surfaces GPS, QR, Face and Device state without claiming client authority', () => {
    for (const label of ['GPS', 'QR', 'Face', 'Device']) expect(page).toContain(`<strong>${label}</strong>`);
    for (const icon of ['location', 'qr', 'face', 'device']) expect(page).toContain(`name="${icon}"`);
    expect(page).toContain('GPS เฉพาะตอนลงเวลา');
    expect(page).toContain('QR เฉพาะเมื่อจำเป็น');
    expect(page).toContain('ยืนยันใบหน้าชั่วคราว');
    expect(page).toContain('Server ตรวจอุปกรณ์หลัก');
    expect(page).toContain('ระบบเป็นผู้ตัดสินเวลาเข้า/ออก');
    expect(page).toContain('Server time เป็น authority ตอนบันทึก');
  });

  it('renders a live seconds clock and retains mobile/coarse-pointer ergonomics', () => {
    expect(page).toContain("second: '2-digit'");
    expect(page).toContain('window.setInterval(refreshClock, 1000)');
    expect(css).toContain('Attendance UI V3 — mockup-aligned SMS employee clock surface');
    expect(css).toContain('.attendance-v3-orb-button');
    expect(css).toContain('.attendance-v3-trust-grid');
    expect(css).toContain('@media (max-width: 390px)');
    expect(css).toContain('@media (pointer: coarse)');
  });
});
