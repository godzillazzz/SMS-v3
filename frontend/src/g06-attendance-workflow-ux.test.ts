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
    expect(page).toContain('Server เป็นผู้ตัดสินเวลาเข้า/ออก');
  });

  it('sends only captureId plus raw QR/GPS evidence to readiness and never sends a client event intent', () => {
    expect(client).toContain("fetch(`${baseUrl}/attendance/readiness`");
    expect(client).toContain('captureId: input.captureId');
    expect(client).toContain('qrToken: input.qrToken');
    expect(client).toContain('location: input.location');
    expect(client).toMatch(/body: JSON\.stringify\(\{\s*captureId: input\.captureId,\s*attendanceEvidence: \{\s*qrToken: input\.qrToken,\s*location: input\.location\s*\}\s*\}\)/);
    expect(page).toContain('client ไม่ส่ง eventIntent');
    expect(page).toContain('const qrLength = qrToken.trim().length');
    expect(page).toContain('const qrReady = qrLength >= 24 && qrLength <= 512');
    expect(page).toContain('maxLength={512}');
  });

  it('automates QR scan into one-shot GPS and server readiness without adding client authority', () => {
    expect(page).toContain('const handleQrDetected = async (value: string) => {');
    expect(page).toMatch(/handleQrDetected[\s\S]*?positionOnce\(\)[\s\S]*?checkReadinessWithEvidence\(nextQrToken, nextLocation, operationEpoch\)/);
    expect(page).toContain('onDetected={(value) => { void handleQrDetected(value); }}');
    expect(page).toContain('สแกน QR เพื่อลงเวลา');
    expect(page).toContain('Scan once · Auto flow');
    expect(page).toContain('ตรวจความพร้อมอีกครั้ง');
    expect(page).not.toContain('watchPosition');
    expect(page).not.toContain('/attendance/events');
  });

  it('does not open biometric verification or Attendance event acceptance from the browser skeleton', () => {
    expect(client).not.toContain('/verification/start');
    expect(client).not.toContain('/attendance/events');
    expect(client).not.toContain('receipt');
    expect(client).not.toContain('padPassed');
    expect(client).not.toContain('faceMatchPassed');
    expect(page).not.toContain('attendanceAccepted = true');
    expect(page).toContain('Self-hosted verifier ยังไม่เปิด runtime');
  });

  it('uses a transient camera QR scanner and releases all media tracks without persisting frames', () => {
    expect(page).toContain('<AttendanceQrScanner');
    expect(page).toContain('สแกน QR');
    expect(scanner).toContain("import { createPortal } from 'react-dom'");
    expect(scanner).toContain('createPortal(<div className="attendance-qr-backdrop"');
    expect(scanner).toContain("document.body.style.overflow = 'hidden'");
    expect(scanner).toContain('document.body.style.overflow = previousBodyOverflow');
    expect(scanner).toContain('navigator.mediaDevices.getUserMedia');
    expect(scanner).toContain("facingMode: { ideal: 'environment' }");
    expect(scanner).toContain('stream?.getTracks().forEach((track) => track.stop())');
    expect(scanner).toContain('canvasRef.current.width = 1');
    expect(scanner).toContain('canvasRef.current.height = 1');
    expect(scanner).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
    expect(scanner).toContain("window.addEventListener('pagehide', handlePageHide)");
    expect(scanner).toContain("document.removeEventListener('visibilitychange', handleVisibilityChange)");
    expect(scanner).toContain("window.removeEventListener('pagehide', handlePageHide)");
    expect(scanner).toContain('onCloseRef.current()');
    expect(scanner).toMatch(/const stopAndCloseForLifecycle = \(\) => \{[\s\S]*?stop\(\);[\s\S]*?document\.body\.style\.overflow = previousBodyOverflow;[\s\S]*?onCloseRef\.current\(\);/);
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
    expect(css).toContain('-webkit-transform: translateZ(0)');
    expect(css).toContain('width: 100dvw; height: 100vh; height: 100dvh; padding: 0;');
    expect(css).toContain('width: 100dvw; height: 100vh; height: 100dvh; max-width: none; max-height: none;');
    expect(css).not.toContain('height: calc(100dvh - max(10px, env(safe-area-inset-top)))');
    expect(css).not.toContain('.attendance-qr-backdrop { align-items: end;');
    expect(css).toContain('flex: 1 1 auto; overflow: hidden; aspect-ratio: auto;');
    expect(css).toContain('border: 0; border-radius: 0;');
    expect(css).toContain('width: 36px; height: 36px;');
    expect(css).toContain('min-height: 44px;');
    expect(css).toContain('padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))');
    expect(css).not.toContain('max-width: 430px');
    expect(css).not.toContain('aspect-ratio: 3 / 2');
    expect(css).not.toContain('margin-inline: auto');
    expect(scanner).toContain('ใช้กล้องเฉพาะขณะสแกน และไม่บันทึกหรืออัปโหลดภาพ');
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
    expect(page).toContain('if (!interactionDisabled) return;');
    expect(page).toContain("setScannerOpen(false)");
    expect(page).toContain("setQrToken('')");
    expect(page).toContain('setLocation(null)');
    expect(page).toContain('disabled={interactionDisabled || checking}');
    expect(page).toContain("readiness?.state === 'DEVICE_SETUP_REQUIRED'");
    expect(page).toContain('ไปหน้าอุปกรณ์ลงเวลา');
  });

  it('invalidates in-flight GPS/readiness results when Attendance becomes blocked or the attempt resets', () => {
    expect(page).toContain('const asyncEvidenceEpochRef = useRef(0)');
    expect(page).toContain('const interactionDisabledRef = useRef(interactionDisabled)');
    expect(page).toContain('interactionDisabledRef.current = interactionDisabled');
    expect(page).toContain('if (!interactionDisabled) return;');
    expect(page).toContain('asyncEvidenceEpochRef.current += 1');
    expect(page).toContain('}, [interactionDisabled]);');
    expect(page.match(/const operationEpoch = asyncEvidenceEpochRef\.current;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page.match(/operationEpoch !== asyncEvidenceEpochRef\.current \|\| interactionDisabledRef\.current/g)?.length).toBeGreaterThanOrEqual(4);
    expect(page).toContain('if (operationEpoch === asyncEvidenceEpochRef.current) setLocationBusy(false)');
    expect(page).toContain('if (operationEpoch === asyncEvidenceEpochRef.current) setChecking(false)');
    expect(page).toMatch(/const resetAttempt = \(\) => \{\s*asyncEvidenceEpochRef\.current \+= 1;/);
  });

  it('clears transient Attendance evidence when the PWA is backgrounded or page lifecycle hides it', () => {
    expect(page).toContain('const clearTransientAttemptForLifecycle = () => {');
    expect(page).toMatch(/const clearTransientAttemptForLifecycle = \(\) => \{[\s\S]*?asyncEvidenceEpochRef\.current \+= 1;[\s\S]*?setScannerOpen\(false\);[\s\S]*?setQrToken\(''\);[\s\S]*?setLocation\(null\);[\s\S]*?setLocationBusy\(false\);[\s\S]*?setChecking\(false\);[\s\S]*?resetServerState\(\);/);
    expect(page).toContain("if (document.visibilityState === 'hidden') clearTransientAttemptForLifecycle();");
    expect(page).toContain('const handlePageHide = () => clearTransientAttemptForLifecycle();');
    expect(page).toContain('const handlePageShow = (event: PageTransitionEvent) => {');
    expect(page).toContain('if (event.persisted) clearTransientAttemptForLifecycle();');
    expect(page).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
    expect(page).toContain("window.addEventListener('pagehide', handlePageHide)");
    expect(page).toContain("window.addEventListener('pageshow', handlePageShow)");
    expect(page).toContain("document.removeEventListener('visibilitychange', handleVisibilityChange)");
    expect(page).toContain("window.removeEventListener('pagehide', handlePageHide)");
    expect(page).toContain("window.removeEventListener('pageshow', handlePageShow)");
  });

  it('has responsive mobile layouts for the four-step flow and evidence cards', () => {
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (max-width: 540px)');
    expect(css).toContain('.attendance-workspace-grid { grid-template-columns: 1fr; }');
    expect(css).toContain('.attendance-flow-grid { grid-template-columns: 1fr; }');
  });
});
