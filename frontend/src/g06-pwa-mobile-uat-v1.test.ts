import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSmsPwaUatReport, readSmsPwaDiagnostics } from './pwa-diagnostics';
import { initialSmsPwaPage, isSmsPwaPage, isSmsPwaShellMode } from './pwa-mode';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const attendance = read('./pages/attendance/AttendancePage.tsx');
const profile = read('./pages/pwa-profile/PwaProfilePage.tsx');

function browser(search = '', { standalone = false, iosStandalone = false } = {}) {
  vi.stubGlobal('window', {
    location: { search },
    isSecureContext: true,
    matchMedia: vi.fn(() => ({ matches: standalone })),
    addEventListener: vi.fn()
  });
  vi.stubGlobal('navigator', {
    standalone: iosStandalone,
    serviceWorker: { register: vi.fn(), controller: null }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('G06 Employee PWA mobile UAT/hardening', () => {
  it('deep-links only to the three Owner-approved employee pages', () => {
    browser('?pwa=1&page=attendance');
    expect(isSmsPwaShellMode()).toBe(true);
    expect(initialSmsPwaPage()).toBe('attendance');

    browser('?pwa=1&page=leave');
    expect(initialSmsPwaPage()).toBe('leave');

    browser('?pwa=1&page=profile');
    expect(initialSmsPwaPage()).toBe('profile');

    browser('?pwa=1&page=schedule');
    expect(initialSmsPwaPage()).toBe('attendance');
    expect(isSmsPwaPage('schedule')).toBe(false);
  });

  it('detects installed standalone mode without requiring the pwa query flag', () => {
    browser('', { standalone: true });
    expect(isSmsPwaShellMode()).toBe(true);
    expect(initialSmsPwaPage()).toBe('attendance');

    browser('', { iosStandalone: true });
    expect(isSmsPwaShellMode()).toBe(true);
  });

  it('does not turn the normal browser Web into the restricted PWA shell', () => {
    browser('');
    expect(isSmsPwaShellMode()).toBe(false);
  });

  it('blocks Attendance evidence actions while the PWA is offline without mislabeling it as View As', () => {
    expect(main).toContain('online={!pwaShell || pwaOnline}');
    expect(attendance).toContain('const interactionDisabled = readOnly || !online');
    expect(attendance).toContain('if (interactionDisabled) return');
    expect(attendance).toContain('open={scannerOpen && !interactionDisabled}');
    expect(attendance).toContain('disabled={interactionDisabled || checking}');
    expect(attendance).toContain('disabled={interactionDisabled || locationBusy || checking || verificationBusy}');
    expect(attendance).toContain('open={faceCaptureOpen && !interactionDisabled}');
    expect(attendance).toContain('ออฟไลน์ — ปิดการสแกน QR, GPS และ Server readiness');
  });

  it('blocks Leave mutations while offline but keeps normal Web authority unchanged', () => {
    expect(main).toContain('mutationsEnabled={!pwaShell || pwaOnline}');
    expect(main).toContain('if (!mutationsEnabled || !formReady) return');
    expect(main).toContain('disabled={!mutationsEnabled || !canSubmit || !formReady || submitting}');
    expect(main).toContain('canManage={pwaShell ? false : canManage}');
  });

  it('reports device PWA capabilities without requesting camera or location permission', () => {
    const getUserMedia = vi.fn();
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('window', {
      location: { search: '?pwa=1&page=profile' },
      isSecureContext: true,
      matchMedia: vi.fn(() => ({ matches: true }))
    });
    vi.stubGlobal('navigator', {
      standalone: false,
      mediaDevices: { getUserMedia },
      geolocation: { getCurrentPosition },
      serviceWorker: { controller: {} }
    });

    expect(readSmsPwaDiagnostics()).toEqual({
      standalone: true,
      secureContext: true,
      serviceWorkerSupported: true,
      serviceWorkerControlled: true,
      cameraSupported: true,
      locationSupported: true
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(profile).toContain('ตรวจเฉพาะ capability และสถานะของเบราว์เซอร์ ไม่ขอสิทธิ์กล้อง/ตำแหน่ง');
    expect(profile).toContain('ไม่สร้างหลักฐาน Attendance');
  });

  it('builds a privacy-minimized copyable UAT report with no identity or evidence fields', () => {
    const report = buildSmsPwaUatReport({
      standalone: true,
      secureContext: true,
      serviceWorkerSupported: true,
      serviceWorkerControlled: true,
      cameraSupported: true,
      locationSupported: true
    }, true);
    expect(report).toContain('SMS_PWA_UAT_V1');
    expect(report).toContain('online=true');
    expect(report).toContain('standalone=true');
    expect(report).toContain('cameraSupported=true');
    expect(report).toContain('locationSupported=true');
    expect(report).not.toMatch(/email|displayName|latitude|longitude|qrToken|userAgent/i);
    expect(profile).toContain('คัดลอกรายงาน UAT');
    expect(profile).toContain('ไม่มีชื่อ อีเมล QR หรือพิกัด');
  });
});
