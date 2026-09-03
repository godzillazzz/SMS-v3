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
const actionState = read('./pages/attendance/attendance-action-state.ts');

describe('G06 Attendance frontend UX skeleton', () => {
  it('exposes a dedicated self-service Attendance page separate from Personal Device setup', () => {
    expect(main).toContain("'attendance'");
    expect(main).toContain("{ id: 'attendance', icon: 'attendance', label: 'ลงเวลา' }");
    expect(main).toContain('<AttendancePage');
    expect(page).toContain('attendance-v2-hero');
    expect(page).toContain('className="attendance-v4"');
    expect(main).toContain('displayName={auth.user?.displayName}');
    expect(main).toContain('employeeV4={pwaShell}');
    expect(page).not.toContain('onOpenDeviceSetup');
  });

  it('uses one attendance-specific clock-plus-confirmation icon without changing Shift Setup', () => {
    expect(icon).toContain("| 'dashboard' | 'employees' | 'license' | 'calendar' | 'clock' | 'attendance'");
    expect(icon).toContain('attendance: <><circle');
    expect(icon).toContain('M14.5 16.5l2 2 4-4');
    expect(main).toContain("{ id: 'attendance', icon: 'attendance', label: 'ลงเวลา' }");
    expect(main).toContain("{ id: 'shiftSetup', icon: 'clock', label: 'รหัสกะและเวลา' }");
    expect(page).toMatch(/<SmsIcon name=\{flowBusy \? 'refresh' : 'attendance'\} size=\{\d+\} \/>/);
    expect(page).not.toContain("name={flowBusy ? 'refresh' : 'clock'}");
  });

  it('sends captureId + GPS first, with QR optional only when Server requests step-up, and never sends client event intent', () => {
    expect(client).toContain("attendanceAuthenticatedRequest(`/attendance/verification/start`, token");
    expect(client).toContain("attendanceAuthenticatedRequest(`/attendance/readiness`, token");
    expect(page).not.toContain('attendanceReadiness(token');
    expect(client).toContain('captureId: input.captureId');
    expect(client).toContain('...(input.qrToken ? { qrToken: input.qrToken } : {})');
    expect(client).toContain('location: input.location');
    expect(client).toContain('qrToken?: string');
    expect(page).toContain('ระบบเป็นผู้ตัดสินเวลาเข้า/ออก');
    expect(page).toContain("started.data.readiness.state === 'QR_STEP_UP_REQUIRED'");
    expect(page).toContain("started.data.readiness.state === 'QR_RESCAN_REQUIRED'");
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
    expect(page).toContain("started.data.readiness.state !== 'READY_TO_START_VERIFICATION'");
    expect(page).toContain('attendanceVerificationStart(token');
    expect(page).toContain('signAttendanceDeviceChallenge(verification.deviceEnrollmentId, verification.challenge)');
    expect(client).toContain('/attendance/verification/${encodeURIComponent(sessionId)}/device-proof');
    expect(client).not.toContain('face-verification-self-hosted');
    expect(page).toMatch(/attendanceVerificationStart[\s\S]*?signAttendanceDeviceChallenge[\s\S]*?verifyAttendanceDeviceProof[\s\S]*?setFaceCaptureOpen\(true\)/);
    expect(client).toContain("form.append('photo', photo, 'attendance-live-face.jpg')");
    expect(client).toContain("form.append('challengeFrame', frame");
    expect(page).toContain('verification.activeChallenge');
    expect(page).toContain('challenge={verificationSession?.activeChallenge || null}');
    expect(client).toContain('/attendance/verification/${encodeURIComponent(sessionId)}/face-match');
    expect(client).toContain("export type AttendanceFaceRetryHint = 'MOVE_MORE'");
    expect(client).toContain('retryHint?: AttendanceFaceRetryHint | null');
    expect(page).toContain('matched.verificationAccepted !== true || !matched.receipt');
    expect(client).toContain('attendance/events');
    expect(client).toMatch(/body: JSON.stringify\(\{\s*receipt: input\.receipt,\s*attendanceContext: input\.attendanceContext\s*\}\)/);
    expect(page).toContain('accepted.attendanceAccepted !== true');
    expect(page).toContain("typeof accepted.event?.effectiveEventAt === 'string'");
    expect(page).toContain("typeof accepted.event?.receivedAt === 'string'");
    expect(page).toContain("typeof accepted.event?.id === 'string' ? accepted.event.id : null");
    expect(page).not.toContain('setAttendanceAccepted({ intent: acceptedIntent, acceptedAt: new Date() })');
    expect(client).not.toContain('padPassed: input.');
    expect(client).not.toContain('faceMatchPassed');
    expect(client).not.toContain('padPassed');
    expect(client).not.toContain('activeChallengePassed');
    expect(page).not.toContain('attendanceAccepted = true');
    expect(page).toContain("setFailurePresentation(activeChallengeFailed ? 'ACTIVE_CHALLENGE' : 'VERIFICATION')");
    expect(page).toContain("'Active Challenge ยังไม่ผ่าน'");
    expect(page).toContain('activeChallengeRetryMessage(matched.retryHint)');
    expect(page).toContain("hint === 'MOVE_MORE'");
    expect(page).toContain("hint === 'KEEP_FACE_VISIBLE'");
    expect(page).toContain("hint === 'FOLLOW_DIRECTION'");
    expect(page).toContain("hint === 'START_CENTERED'");
    expect(page).toContain("hint === 'RETURN_CENTER'");
    expect(page).toContain('กรุณาทำ Active Challenge ใหม่อีกครั้ง');
  });

  it('reconciles lost responses first and safely retries the same opaque receipt + capture context without a second Face Verification', () => {
    expect(client).toContain('function publicCode(payload: Record<string, any>)');
    expect(page).toContain('let eventAcceptanceAttempted = false');
    expect(page).toContain('let eventCommitCandidate: PendingAttendanceCommit | null = null');
    expect(page).toContain("return readiness?.state === 'ATTENDANCE_UNAVAILABLE' || readiness?.state === 'BIOMETRIC_TEMPORARILY_UNAVAILABLE'");
    expect(page).toContain('if (!canRetryVerifiedAttendanceCommit(accepted.readiness)) {');
    expect(page).toContain("const blockedCopy = accepted.readiness ? fallbackCopy(accepted.readiness) : null");
    expect(page).toContain('eventAcceptanceAttempted && eventCommitCandidate && canRetryVerifiedAttendanceTransportFailure(reason)');
    expect(page).toContain('return reason.status >= 500 || reason.status === 408 || reason.status === 429');
    expect(page).toContain('const recoverAcceptedEventFromServer = async () => {');
    expect(page).toContain('const latest = await attendanceSelfToday(token)');
    expect(page).toContain('setPendingAttendanceCommit(eventCommitCandidate)');
    expect(page).toContain('receiptExpiresAt: matched.receiptExpiresAt || null');
    expect(page).toContain('const retryPendingAttendanceCommit = async () => {');
    expect(page).toContain('receipt: pending.receipt');
    expect(page).toContain('attendanceContext: pending.attendanceContext');
    expect(page).toContain("pendingAttendanceCommit ? 'RETRY COMMIT'");
    expect(page).toContain("pendingAttendanceCommit ? 'ลองบันทึกเวลาอีกครั้ง'");
    expect(page).toContain('if (pendingAttendanceCommit) {');
    expect(page).toContain('void retryPendingAttendanceCommit()');
    expect(page).toContain('accepted.idempotent === true');
    expect(page).toContain('setPendingAttendanceCommit(null)');
    expect(page).toContain('receipt เดิมหมดอายุแล้ว');
    expect(page.match(/attendanceAcceptVerifiedEvent\(token/g)?.length).toBe(2);
    expect(page).not.toContain('localStorage.setItem');
    expect(page).not.toContain('sessionStorage.setItem');
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
    expect(faceCapture).toContain("canvasToOptimizedJpeg(canvas, 'ATTENDANCE_FACE')");
    expect(faceCapture).toContain('ATTACHMENT_POLICIES.ATTENDANCE_FACE.maxEdge');
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
    expect(faceCapture).toContain('const PREPARE_DELAY_MS = 2200');
    expect(faceCapture).toContain('const MOVEMENT_START_DELAY_MS = 2200');
    expect(faceCapture).toContain('const MOVEMENT_FRAME_INTERVAL_MS = 350');
    expect(faceCapture).toContain('const RETURN_TO_CENTER_DELAY_MS = 2200');
    expect(faceCapture).toContain('const captureFrame = async (mirrorHorizontally = false)');
    expect(faceCapture).toContain('context.scale(-1, 1)');
    expect(faceCapture).toContain('const frame = await captureFrame(true)');
    expect(faceCapture).toContain('const finalPhoto = await captureFrame()');
    expect(faceCapture).toContain("type CapturePhase = 'idle' | 'prepare' | 'baseline' | 'movement' | 'neutral'");
    expect(faceCapture).toContain("setCapturePhase('prepare')");
    expect(faceCapture).toContain("setCapturePhase('baseline')");
    expect(faceCapture).toContain("setCapturePhase('movement')");
    expect(faceCapture).toContain("setCapturePhase('neutral')");
    expect(faceCapture).toContain('มองตรงค้างไว้ · กำลังเก็บภาพตั้งต้น');
    expect(faceCapture).toContain('ขยับพอประมาณแล้วค้างนิ่ง');
    expect(faceCapture).toContain('กลับมามองตรงที่กล้องและค้างไว้');
    expect(faceCapture).toContain("title: 'มองตรงที่กล้องก่อน'");
    expect(faceCapture).toContain("'ขั้นที่ 1 · มองตรงเพื่อตั้งต้น'");
    expect(faceCapture).toContain("'ขั้นที่ 2 · ทำท่าตอนนี้และค้างไว้'");
    expect(faceCapture).toContain("'ขั้นที่ 3 · กลับมามองตรง'");
    expect(faceCapture).toContain('const displayedChallengeCopy = preparingBaseline');
    expect(faceCapture).toContain('ไม่ต้องหันจนสุด');
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
    expect(page).toContain("started.data.readiness.state !== 'READY_TO_START_VERIFICATION'");
  });

  it('keeps View As read-only and offers device remediation without impersonated Attendance evidence', () => {
    expect(page).toContain('กำลังอยู่ใน View As');
    expect(page).toContain('const interactionDisabled = readOnly || !online');
    expect(page).toContain('if (!interactionDisabled) return;');
    expect(page).toContain("setScannerOpen(false)");
    expect(page).toContain("setQrToken('')");
    expect(page).toContain('setLocation(null)');
    expect(actionState).toContain("code: 'VIEW_ONLY'");
    expect(actionState).toContain('โหมด View As เป็นแบบอ่านอย่างเดียว');
    expect(page).toContain("setError(blockedMessage)");
    expect(page).toContain('disabled={flowBusy}')
    expect(page).not.toContain('ไปหน้าอุปกรณ์ลงเวลา');
  });

  it('invalidates in-flight GPS/readiness results when Attendance becomes blocked or the attempt resets', () => {
    expect(page).toContain('const asyncEvidenceEpochRef = useRef(0)');
    expect(page).toContain('const interactionDisabledRef = useRef(interactionDisabled)');
    expect(page).toContain('interactionDisabledRef.current = interactionDisabled');
    expect(page).toContain('if (!interactionDisabled) return;');
    expect(page).toContain('asyncEvidenceEpochRef.current += 1');
    expect(page).toContain('}, [interactionDisabled, online, readOnly]);');
    expect(page.match(/const operationEpoch = asyncEvidenceEpochRef\.current;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page.match(/shouldStopOperation\(operationEpoch\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(page).not.toContain('operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current');
    expect(page).toContain('if (operationEpoch === asyncEvidenceEpochRef.current) setLocationBusy(false)');
    expect(page).toContain('if (operationEpoch === asyncEvidenceEpochRef.current) setChecking(false)');
    expect(page).toContain('const activeCaptureIdRef = useRef<string | null>(null)');
    expect(page).toContain('activeCaptureIdRef.current = null');
  });

  it('clears transient evidence on lifecycle exit except a denied-location recovery attempt', () => {
    expect(page).toContain('const clearTransientAttemptForLifecycle = () => {');
    expect(page).toMatch(/const clearTransientAttemptForLifecycle = \(\) => \{[\s\S]*?asyncEvidenceEpochRef\.current \+= 1;[\s\S]*?setScannerOpen\(false\);[\s\S]*?setQrToken\(''\);[\s\S]*?setLocation\(null\);[\s\S]*?resetServerState\(\);/);
    expect(page).toContain("document.visibilityState === 'hidden' && !locationRecoveryPendingRef.current");
    expect(page).toContain('if (!locationRecoveryPendingRef.current) clearTransientAttemptForLifecycle();');
    expect(page).toContain("navigator.permissions.query({ name: 'geolocation' as PermissionName })");
    expect(page).toContain("permission === 'granted' || permission === 'unknown'");
    expect(page).toContain('retryLocationForActiveAttempt');
    expect(page).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
    expect(page).toContain("window.addEventListener('pagehide', handlePageHide)");
    expect(page).toContain("window.addEventListener('pageshow', handlePageShow)");
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
