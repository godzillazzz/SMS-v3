import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const page = read('./pages/attendance/AttendancePage.tsx');
const client = read('./pages/attendance/attendance-client.ts');
const scanner = read('./pages/attendance/AttendanceQrScanner.tsx');
const css = read('./pages/attendance/attendance.css');

describe('G06 Attendance frontend UX skeleton', () => {
  it('exposes a dedicated self-service Attendance page separate from Personal Device setup', () => {
    expect(main).toContain("'attendance'");
    expect(main).toContain("{ id: 'attendance', icon: 'clock', label: 'ลงเวลา' }");
    expect(main).toContain('<AttendancePage token={auth.token}');
    expect(main).toContain("onOpenDeviceSetup={pwaShell ? undefined : () => setActivePage('attendanceDevice')}");
    expect(page).toContain('Server เป็นผู้ตัดสินว่าเป็นเวลาเข้า หรือเวลาออก');
  });

  it('sends only captureId plus raw QR/GPS evidence to readiness and never sends a client event intent', () => {
    expect(client).toContain("fetch(`${baseUrl}/attendance/readiness`");
    expect(client).toContain('captureId: input.captureId');
    expect(client).toContain('qrToken: input.qrToken');
    expect(client).toContain('location: input.location');
    expect(client).toMatch(/body: JSON\.stringify\(\{\s*captureId: input\.captureId,\s*attendanceEvidence: \{\s*qrToken: input\.qrToken,\s*location: input\.location\s*\}\s*\}\)/);
    expect(page).toContain('client ไม่ส่ง eventIntent');
  });

  it('does not open biometric verification or Attendance event acceptance from the browser skeleton', () => {
    expect(client).not.toContain('/verification/start');
    expect(client).not.toContain('/attendance/events');
    expect(client).not.toContain('receipt');
    expect(client).not.toContain('padPassed');
    expect(client).not.toContain('faceMatchPassed');
    expect(page).not.toContain('attendanceAccepted = true');
    expect(page).toContain('ยังไม่เปิด runtime ในรอบนี้');
  });

  it('uses a transient camera QR scanner and releases all media tracks without persisting frames', () => {
    expect(page).toContain('<AttendanceQrScanner');
    expect(page).toContain('สแกน QR');
    expect(scanner).toContain('navigator.mediaDevices.getUserMedia');
    expect(scanner).toContain("facingMode: { ideal: 'environment' }");
    expect(scanner).toContain('stream?.getTracks().forEach((track) => track.stop())');
    expect(scanner).toContain('context.getImageData');
    expect(scanner).toContain('jsQR(frame.data');
    expect(scanner).toContain('onDetectedRef.current(value)');
    expect(scanner).not.toContain('fetch(');
    expect(scanner).not.toContain('XMLHttpRequest');
    expect(scanner).not.toContain('localStorage.');
    expect(scanner).not.toContain('sessionStorage.');
    expect(scanner).not.toContain('MediaRecorder');
    expect(css).toContain('.attendance-qr-backdrop');
    expect(css).toContain('.attendance-qr-camera video');
  });

  it('uses one-shot high-accuracy geolocation without continuous tracking or local persistence', () => {
    expect(page).toContain('navigator.geolocation.getCurrentPosition');
    expect(page).toContain('enableHighAccuracy: true');
    expect(page).toContain('maximumAge: 0');
    expect(page).toContain('timeout: 15000');
    expect(page).not.toContain('watchPosition');
    expect(page).not.toContain('localStorage.');
    expect(page).not.toContain('sessionStorage.');
  });

  it('fails closed when the Attendance route is hidden and never presents route availability as success', () => {
    expect(client).toContain("if (response.status === 404) return { routeAvailable: false");
    expect(page).toContain('ระบบลงเวลายังไม่เปิดใช้งานในสภาพแวดล้อมนี้');
    expect(page).toContain('ไม่มี AttendanceEvent ถูกสร้าง');
    expect(page).toContain("readiness?.state === 'READY_TO_START_VERIFICATION'");
  });

  it('keeps View As read-only and offers device remediation without impersonated Attendance evidence', () => {
    expect(page).toContain('กำลังอยู่ใน View As');
    expect(page).toContain('const interactionDisabled = readOnly || !online');
    expect(page).toContain('disabled={interactionDisabled || checking}');
    expect(page).toContain("readiness?.state === 'DEVICE_SETUP_REQUIRED'");
    expect(page).toContain('ไปหน้าอุปกรณ์ลงเวลา');
  });

  it('has responsive mobile layouts for the four-step flow and evidence cards', () => {
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (max-width: 540px)');
    expect(css).toContain('.attendance-workspace-grid { grid-template-columns: 1fr; }');
    expect(css).toContain('.attendance-flow-grid { grid-template-columns: 1fr; }');
  });
});
