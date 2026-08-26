import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const page = read('./pages/attendance/AttendancePage.tsx');
const icon = read('./components/SmsIcon.tsx');
const client = read('./pages/attendance/attendance-client.ts');
const scanner = read('./pages/attendance/AttendanceQrScanner.tsx');
const faceCapture = read('./pages/attendance/AttendanceFaceCapture.tsx');
const faceUat = read('./pages/attendance/AttendanceFaceChallengeUatPanel.tsx');
const css = read('./pages/attendance/attendance.css');

describe('G06 Attendance frontend UX skeleton', () => {
  it('exposes a dedicated self-service Attendance page separate from Personal Device setup', () => {
    expect(main).toContain("'attendance'");
    expect(main).toContain("{ id: 'attendance', icon: 'attendance', label: 'ลงเวลา' }");
    expect(main).toContain('<AttendancePage token={auth.token}');
    expect(page).toContain('attendance-v2-hero');
    expect(main).toContain('displayName={auth.user?.displayName}');
    expect(page.match(/<button\b/g)?.length).toBe(1);
    expect(page).not.toContain('onOpenDeviceSetup');
  });

  it('uses one attendance-specific clock-plus-confirmation icon without changing Shift Setup', () => {
    expect(icon).toContain("| 'dashboard' | 'employees' | 'license' | 'calendar' | 'clock' | 'attendance'");
    expect(icon).toContain('attendance: <><circle');
    expect(icon).toContain('M14.5 16.5l2 2 4-4');
    expect(main).toContain("{ id: 'attendance', icon: 'attendance', label: 'ลงเวลา' }");
    expect(main).toContain("{ id: 'shiftSetup', icon: 'clock', label: 'รหัสกะและเวลา' }");
    expect(page).toContain("<SmsIcon name={flowBusy ? 'refresh' : 'attendance'} size={21} />");
    expect(page).not.toContain("<SmsIcon name={flowBusy ? 'refresh' : 'clock'} size={21} />");
  });

  it('sends captureId + GPS first, with QR optional only when Server requests step-up, and never sends client event intent', () => {
    expect(client).toContain("fetch(`${baseUrl}/attendance/readiness`");
    expect(client).toContain('captureId: input.captureId');
    expect(client).toContain('...(input.qrToken ? { qrToken: input.qrToken } : {})');
    expect(client).toContain('location: input.location');
    expect(client).toContain('qrToken?: string');
    expect(page).toContain('ระบบเป็นผู้ตัดสินเวลาเข้า/ออก');
    expect(page).toContain("result.data.readiness.state === 'QR_STEP_UP_REQUIRED'");
    expect(page).toContain("result.data.readiness.state === 'QR_RESCAN_REQUIRED'");
    expect(page).toContain('QR จะเปิดเฉพาะเมื่อจำเป็น');
  });

  it('runs one-tap GPS first and opens QR only as automatic step-up while preserving server authority', () => {
    expect(page).toContain('const handleStartAttendance = async () => {');
    expect(page).toMatch(/handleStartAttendance[\s\S]*?positionOnce\(\)[\s\S]*?checkReadinessWithEvidence\(captureId, undefined, nextLocation, operationEpoch\)/);
    expect(page).toContain("setScannerOpen(true)");
    expect(page).toContain('const handleQrDetected = async (value: string) => {');
    expect(page).toMatch(/handleQrDetected[\s\S]*?positionOnce\(\)[\s\S]*?checkReadinessWithEvidence\(captureId, nextQrToken, nextLocation, operationEpoch\)/);
    expect(page).toContain('onDetected={(value) => { void handleQrDetected(value); }}');
    expect(page).toContain("'ลงเวลา'");
    expect(page).not.toContain('สแกน QR เพื่อยืนยันพื้นที่</button>');
    expect(page).not.toContain('watchPosition');
    expect(page).not.toContain('/attendance/events');
  });

  it('orchestrates Face Match only through server-issued context, device proof, opaque receipt, and server Attendance acceptance', () => {
    expect(client).toContain('attendance/verification/start');
    expect(page).toContain("result.data.readiness.state === 'READY_TO_START_VERIFICATION'");
    expect(page).toContain('attendanceVerificationStart(token');
    expect(page).toContain('signAttendanceDeviceChallenge(activeDeviceId, verification.challenge)');
    expect(client).toContain('/attendance/verification/${encodeURIComponent(sessionId)}/device-proof');
    expect(client).not.toContain('face-verification-self-hosted');
    expect(page).toMatch(/attendanceVerificationStart[\s\S]*?signAttendanceDeviceChallenge[\s\S]*?verifyAttendanceDeviceProof[\s\S]*?setFaceCaptureOpen\(true\)/);
    expect(client).toContain("form.append('photo', photo, 'attendance-live-face.jpg')");
    expect(client).toContain("form.append('challengeFrame', frame");
    expect(page).toContain('verification.activeChallenge');
    expect(page).toContain('challenge={verificationSession?.activeChallenge || null}');
    expect(client).toContain('/attendance/verification/${encodeURIComponent(sessionId)}/face-match');
    expect(page).toContain('matched.verificationAccepted !== true || !matched.receipt');
    expect(client).toContain('attendance/events');
    expect(client).toMatch(/body: JSON.stringify\(\{\s*receipt: input\.receipt,\s*attendanceContext: input\.attendanceContext\s*\}\)/);
    expect(page).toContain('accepted.attendanceAccepted !== true');
    expect(page).toContain('setAttendanceAccepted({ intent: acceptedIntent, acceptedAt: new Date() })');
    expect(client).not.toContain('padPassed: input.');
    expect(client).not.toContain('faceMatchPassed');
    expect(client).not.toContain('padPassed');
    expect(client).not.toContain('activeChallengePassed');
    expect(page).not.toContain('attendanceAccepted = true');
  });

  it('uses a transient camera QR scanner and releases all media tracks without persisting frames', () => {
    expect(page).toContain('<AttendanceQrScanner');
    expect(page).toContain('autoFlow');
    expect(scanner).toContain('autoFlow?: boolean');
    expect(scanner).toContain('AUTO_FLOW_TIMEOUT_MS = 30000');
    expect(scanner).toContain('{!autoFlow && <button type="button" className="drawer-close overlay-close"');
    expect(scanner).toContain('{!autoFlow && <footer>');
    expect(page).toContain('QR Step-up');
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
    expect(scanner).toContain('ใช้กล้องเฉพาะขณะสแกน QR และไม่บันทึกภาพหรือวิดีโอจากกล้อง');
  });

  it('captures the front-camera still only in memory, provides preview/confirm, and purges media on lifecycle exit', () => {
    expect(faceCapture).toContain('navigator.mediaDevices.getUserMedia');
    expect(faceCapture).toContain('autoFlow?: boolean');
    expect(faceCapture).toContain('autoStartedRef');
    expect(faceCapture).toContain('{!autoFlow && <footer>');
    expect(page).toContain('autoFlow');
    expect(faceCapture).toContain("facingMode: { ideal: 'user' }");
    expect(faceCapture).toContain("canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)");
    expect(faceCapture).toContain('URL.createObjectURL(finalPhoto)');
    expect(faceCapture).toContain('URL.revokeObjectURL(previewUrlRef.current)');
    expect(faceCapture).toContain('streamRef.current?.getTracks().forEach((track) => track.stop())');
    expect(faceCapture).toContain('canvasRef.current.width = 1');
    expect(faceCapture).toContain('canvasRef.current.height = 1');
    expect(faceCapture).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
    expect(faceCapture).toContain("window.addEventListener('pagehide', handlePageHide)");
    expect(faceCapture).toContain('const cameraRequestEpochRef = useRef(0)');
    expect(faceCapture).toContain('if (cameraEpoch !== cameraRequestEpochRef.current)');
    expect(faceCapture).toContain('stream.getTracks().forEach((track) => track.stop())');
    expect(faceCapture).toContain('cameraRequestEpochRef.current += 1');
    expect(faceCapture).toContain('await onConfirm({ photo, challengeFrames: [...challengeFrames] })');
    expect(faceCapture).toContain('const captureSequenceEpochRef = useRef(0)');
    expect(faceCapture).toContain('if (sequenceEpoch !== captureSequenceEpochRef.current) return');
    expect(faceCapture).toContain('challenge.frameCount !== 4');
    expect(faceCapture).toContain('กำลังยืนยัน {captureProgress}/{challenge?.frameCount || 4}');
    expect(faceCapture).toContain('ยืนยันใบหน้า');
    expect(faceCapture).toContain('ทำตามคำสั่งบนหน้าจอ');
    expect(faceCapture).toContain('เริ่ม Active Challenge');
    expect(faceCapture).toContain('ไม่มี file picker / Gallery');
    expect(faceCapture).not.toContain('type="file"');
    expect(faceCapture).not.toContain('accept="image/');
    expect(faceCapture).not.toContain('localStorage.');
    expect(faceCapture).not.toContain('sessionStorage.');
    expect(faceCapture).not.toContain('indexedDB.');
    expect(faceCapture).not.toContain('MediaRecorder');
    expect(faceCapture).not.toContain('fetch(');
    expect(css).toContain('.attendance-face-backdrop');
    expect(css).toContain('.attendance-face-camera video');
  });

  it('keeps the physical Active Challenge rehearsal Preview-only and permanently non-authoritative', () => {
    expect(page).not.toContain('<AttendanceFaceChallengeUatPanel');
    expect(faceUat).toContain("import.meta.env.VITE_G06_FACE_CHALLENGE_UAT === 'true'");
    expect(faceUat).toContain('if (!FACE_CHALLENGE_UAT_ENABLED) return null');
    expect(faceUat).toContain('attendanceFaceChallengeUatStart(token)');
    expect(faceUat).toContain('attendanceFaceChallengeUatCapture(token, attempt.attemptId, photo, challengeFrames)');
    expect(faceUat).toContain('rehearsalOnly');
    expect(faceUat).toContain('started.verifierCalled !== false');
    expect(faceUat).toContain('started.verificationAccepted !== false');
    expect(faceUat).toContain('started.attendanceAccepted !== false');
    expect(faceUat).toContain('result.verifierCalled !== false');
    expect(faceUat).toContain('result.verificationAccepted !== false');
    expect(faceUat).toContain('result.attendanceAccepted !== false');
    expect(faceUat).toContain('result.receipt !== null');
    expect(faceUat).toContain('result.retained !== false');
    expect(faceUat).toContain('ไม่เรียก Face Verifier');
    expect(faceUat).toContain('ไม่สร้าง AttendanceEvent');
    expect(client).toContain('/attendance/uat/face-challenge/start');
    expect(client).toContain('/attendance/uat/face-challenge/');
    expect(faceUat).not.toContain('/attendance/events');
    expect(faceUat).not.toContain('faceMatchPassed');
    expect(faceUat).not.toContain('activeChallengePassed');
    expect(faceUat).not.toContain('localStorage.');
    expect(faceUat).not.toContain('sessionStorage.');
    expect(faceUat).not.toContain('indexedDB.');
    expect(faceCapture).toContain('rehearsalOnly?: boolean');
    expect(faceCapture).toContain('UAT นี้ไม่มี Face PASS และไม่มี Attendance PASS');
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
    expect(page).toContain('ระบบลงเวลายังไม่เปิดใช้งาน');
    expect(page).toContain('ขณะนี้ระบบป้องกันการบันทึกเวลาไว้');
    expect(page).toContain("result.data.readiness.state === 'READY_TO_START_VERIFICATION'");
  });

  it('keeps View As read-only and offers device remediation without impersonated Attendance evidence', () => {
    expect(page).toContain('กำลังอยู่ใน View As');
    expect(page).toContain('const interactionDisabled = readOnly || !online');
    expect(page).toContain('if (!interactionDisabled) return;');
    expect(page).toContain("setScannerOpen(false)");
    expect(page).toContain("setQrToken('')");
    expect(page).toContain('setLocation(null)');
    expect(page).toContain('disabled={!canStartAttendance}');
    expect(page).not.toContain('ไปหน้าอุปกรณ์ลงเวลา');
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
    expect(page).toContain('const activeCaptureIdRef = useRef<string | null>(null)');
    expect(page).toContain('activeCaptureIdRef.current = null');
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

  it('uses an Android-first mobile surface without exposing admin or UAT controls to employees', () => {
    expect(page).toContain('attendance-v2-clock');
    expect(page).toContain('GPS เฉพาะตอนลงเวลา');
    expect(page).toContain('QR เฉพาะเมื่อจำเป็น');
    expect(page).toContain('ยืนยันใบหน้าชั่วคราว');
    expect(page).toContain('รายละเอียดสำหรับผู้ดูแล');
    expect(page).not.toContain('<SecuritySiteManagementPanel');
    expect(page).not.toContain('<AttendanceFaceChallengeUatPanel');
    expect(faceCapture).toContain("'ยืนยันใบหน้า'");
    expect(scanner).toContain('<p>ยืนยันพื้นที่</p>');
    expect(css).toContain('@media (pointer: coarse)');
    expect(css).toContain('.attendance-v2-primary { min-height: 64px;');
    expect(css).toContain('width: 100dvw; height: 100dvh; max-height: none;');
    expect(css).toContain('touch-action: manipulation');
    expect(css).toContain('env(safe-area-inset-bottom)');
  });

  it('keeps Attendance policy controls on the existing ADMIN-only Settings page', () => {
    const policyCard = read('./components/AttendancePolicySettingsCard.tsx');
    expect(main).toContain("if (page === 'settings') return auth.user?.role === 'ADMIN'");
    expect(main).toContain('<AttendancePolicySettingsCard settings={settings} onSave={onSaveAttendancePolicy} onRefresh={onRefresh} />');
    expect(main).toContain('onSaveAttendancePolicy={async (policy) =>');
    expect(policyCard).toContain('บันทึก Attendance Policy');
    expect(policyCard).toContain('คืนค่าแนะนำ');
    expect(policyCard).toContain('ADAPTIVE');
    expect(policyCard).toContain('REQUIRED');
    expect(policyCard).toContain('DISABLED');
    expect(page).not.toContain('บันทึก Attendance Policy');
  });
});
