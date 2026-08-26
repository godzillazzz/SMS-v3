import { useEffect, useMemo, useRef, useState } from 'react';
import { SmsIcon } from '../../components/SmsIcon';
import {
  AttendanceFlowError,
  AttendanceReadinessError,
  attendanceAcceptVerifiedEvent,
  attendanceDeviceState,
  attendanceReadiness,
  attendanceVerificationStart,
  attendanceFaceMatch,
  verifyAttendanceDeviceProof,
  type AttendanceActiveChallenge,
  type AttendanceContextRef,
  type AttendanceEventIntent,
  type AttendanceLocationEvidence,
  type AttendanceReadinessState
} from './attendance-client';
import { signAttendanceDeviceChallenge } from '../../lib/attendance-device-key';
import { AttendanceFaceCapture } from './AttendanceFaceCapture';
import { AttendanceQrScanner } from './AttendanceQrScanner';
import './attendance.css';

type Props = {
  token: string;
  displayName?: string;
  readOnly?: boolean;
  online?: boolean;
};

type Copy = { title: string; detail: string; tone: 'ready' | 'warning' | 'blocked' | 'neutral' };

const readinessCopy: Record<string, Copy> = {
  BIOMETRIC_RUNTIME_DISABLED: {
    title: 'ระบบ Active Challenge + ตรวจใบหน้า 1:1 ยังไม่เปิดใช้งาน',
    detail: 'ระบบจะไม่บันทึกเวลาและไม่ถือว่าการตรวจครั้งนี้สำเร็จ จนกว่าจะเปิด trusted face verifier ฝั่ง server',
    tone: 'blocked'
  },
  READY_TO_START_VERIFICATION: {
    title: 'หลักฐาน QR / GPS พร้อมสำหรับขั้นยืนยันตัวตน',
    detail: 'Server ตรวจ authority แล้ว แต่ยังต้องตรวจใบหน้าแบบ 1:1 กับ Reference Photo ผ่าน trusted verifier ก่อนจึงจะบันทึกเวลาได้',
    tone: 'ready'
  },
  ACCOUNT_NOT_ELIGIBLE: {
    title: 'บัญชียังไม่พร้อมสำหรับลงเวลา',
    detail: 'กรุณาติดต่อ Admin เพื่อตรวจสอบการผูกบัญชีกับ Employee และสถานะการใช้งาน',
    tone: 'blocked'
  },
  DEVICE_SETUP_REQUIRED: {
    title: 'ยังไม่มีอุปกรณ์หลักที่ได้รับอนุมัติ',
    detail: 'ต้องลงทะเบียนอุปกรณ์นี้และให้ Admin อนุมัติก่อนใช้งาน Attendance',
    tone: 'warning'
  },
  DEVICE_REVIEW_REQUIRED: {
    title: 'อุปกรณ์ต้องได้รับการตรวจสอบก่อน',
    detail: 'กรุณาตรวจสอบสถานะคำขออุปกรณ์หรือให้ Admin พิจารณาคำขอที่ค้างอยู่',
    tone: 'warning'
  },
  DEVICE_PROOF_RETRY: {
    title: 'ต้องยืนยันคีย์ของอุปกรณ์อีกครั้ง',
    detail: 'กรุณาติดต่อ Admin เพื่อตรวจสอบอุปกรณ์หลักและสิทธิ์การลงเวลา แล้วกด “ลงเวลา” ใหม่',
    tone: 'warning'
  },
  REFERENCE_PHOTO_REQUIRED: {
    title: 'ยังไม่มีรูปอ้างอิงที่ใช้งานได้',
    detail: 'กรุณาติดต่อ Admin เพื่อจัดการ Employee Reference Photo ก่อนเริ่ม Attendance',
    tone: 'blocked'
  },
  REFERENCE_PHOTO_REVIEW_REQUIRED: {
    title: 'รูปอ้างอิงยังรอการตรวจสอบ',
    detail: 'ต้องมี Reference Photo สถานะ ACTIVE ก่อนเข้าสู่ Face Verification',
    tone: 'warning'
  },
  SCHEDULE_NOT_READY: {
    title: 'ตารางกะยังไม่พร้อม',
    detail: 'ระบบไม่พบกะที่อนุมัติและใช้เป็น authority สำหรับเวลาปัจจุบัน กรุณาติดต่อหัวหน้างาน',
    tone: 'blocked'
  },
  SITE_NOT_READY: {
    title: 'จุดปฏิบัติงานยังไม่พร้อม',
    detail: 'Security Site ของกะนี้ไม่สามารถใช้เป็น authority สำหรับ Attendance ได้',
    tone: 'blocked'
  },
  QR_STEP_UP_REQUIRED: {
    title: 'ต้องยืนยันพื้นที่เพิ่มด้วย QR',
    detail: 'GPS อยู่ใน Site แต่ความแม่นยำ/ตำแหน่งใกล้ขอบหรือพื้นที่ซ้อนกัน ทำให้ Server ขอ QR ของ Site เป็น Step-up เพิ่มอีกชั้น',
    tone: 'warning'
  },
  QR_RESCAN_REQUIRED: {
    title: 'QR ยังไม่ตรงกับ Site ปัจจุบัน',
    detail: 'กรุณาสแกน QR ของ Site ปัจจุบันอีกครั้ง ระบบจะไม่ใช้ QR แทน GPS และจะไม่ยอมรับเมื่ออยู่นอก geofence',
    tone: 'warning'
  },
  LOCATION_REFRESH_REQUIRED: {
    title: 'กรุณาอ่านตำแหน่งใหม่',
    detail: 'ตำแหน่งไม่สดพอหรือความแม่นยำไม่ผ่านเกณฑ์ของ server',
    tone: 'warning'
  },
  OUTSIDE_SITE_GEOFENCE: {
    title: 'ตำแหน่งอยู่นอกพื้นที่ที่ยอมรับ',
    detail: 'กรุณาอยู่ภายในพื้นที่ Site แล้วอ่านตำแหน่งใหม่ ระบบจะไม่บันทึกเวลาเมื่ออยู่นอก geofence',
    tone: 'blocked'
  },
  ATTENDANCE_STATE_REFRESH_REQUIRED: {
    title: 'สถานะลงเวลาเปลี่ยนแล้ว',
    detail: 'กรุณาเริ่มตรวจสอบใหม่เพื่อให้ server ตัดสิน CHECK_IN/CHECK_OUT จากสถานะล่าสุด',
    tone: 'warning'
  },
  CHECK_IN_REQUIRED: {
    title: 'ต้องมีเวลาเข้าก่อน',
    detail: 'Server ไม่พบ CHECK_IN ที่สมบูรณ์สำหรับ session นี้ จึงไม่อนุญาตให้เดินหน้าต่อ',
    tone: 'blocked'
  },
  ACTIVE_CHALLENGE_RETRY: {
    title: 'การเคลื่อนไหวตามคำสั่งยังไม่ชัดเจน',
    detail: 'กรุณาเริ่ม Active Challenge ใหม่ ทำท่าตามคำสั่งจาก Server แล้วกลับมามองตรงที่กล้อง ระบบนี้เป็น anti-spoof risk gate ไม่ใช่ certified Liveness/PAD',
    tone: 'warning'
  },
  ATTENDANCE_UNAVAILABLE: {
    title: 'ยังไม่สามารถตรวจสอบ Attendance ได้',
    detail: 'ระบบปิดแบบ fail-closed กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ',
    tone: 'blocked'
  }
};

function positionOnce(): Promise<AttendanceLocationEvidence> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('เบราว์เซอร์นี้ไม่รองรับการอ่านตำแหน่ง GPS'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        capturedAt: new Date(position.timestamp || Date.now()).toISOString()
      }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) reject(new Error('ไม่ได้รับสิทธิ์ตำแหน่ง กรุณาอนุญาต Location สำหรับเว็บไซต์นี้'));
        else if (error.code === error.TIMEOUT) reject(new Error('อ่านตำแหน่งไม่ทันเวลา กรุณาลองใหม่ในจุดที่รับสัญญาณได้ดีขึ้น'));
        else reject(new Error('ไม่สามารถอ่านตำแหน่งปัจจุบันได้ กรุณาลองใหม่'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function thaiTime(value?: string | Date | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Bangkok'
  }).format(new Date(value));
}

function thaiClock(value: Date) {
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok'
  }).format(value);
}

function thaiDateLabel(value: Date) {
  return new Intl.DateTimeFormat('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok'
  }).format(value);
}

function intentLabel(intent: AttendanceEventIntent | null) {
  if (intent === 'CHECK_IN') return 'ลงเวลาเข้า';
  if (intent === 'CHECK_OUT') return 'ลงเวลาออก';
  return 'รอ Server ตัดสิน';
}

function fallbackCopy(state?: AttendanceReadinessState | null): Copy {
  if (!state) return {
    title: 'พร้อมเริ่มลงเวลาแบบอัตโนมัติ',
    detail: 'กด “ลงเวลา” หนึ่งครั้ง ระบบจะอ่าน GPS แล้วให้ Server ตัดสินเองว่าต้องสแกน QR เพิ่มหรือไม่',
    tone: 'neutral'
  };
  return readinessCopy[state.state] || {
    title: 'ระบบยังไม่อนุญาตให้ดำเนินการต่อ',
    detail: 'Attendance อยู่ในสถานะป้องกันความผิดพลาด กรุณาเริ่มตรวจสอบใหม่หรือติดต่อผู้ดูแลระบบ',
    tone: 'blocked'
  };
}

export function AttendancePage({ token, displayName, readOnly = false, online = true }: Props) {
  const [qrToken, setQrToken] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [location, setLocation] = useState<AttendanceLocationEvidence | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [routeUnavailable, setRouteUnavailable] = useState(false);
  const [readiness, setReadiness] = useState<AttendanceReadinessState | null>(null);
  const [eventIntent, setEventIntent] = useState<AttendanceEventIntent | null>(null);
  const [error, setError] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const [faceCaptureOpen, setFaceCaptureOpen] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationStage, setVerificationStage] = useState<string>();
  const [verificationSession, setVerificationSession] = useState<{ sessionId: string; attendanceContext: AttendanceContextRef; activeChallenge: AttendanceActiveChallenge } | null>(null);
  const [attendanceAccepted, setAttendanceAccepted] = useState<{ intent: AttendanceEventIntent | null; acceptedAt: Date } | null>(null);
  const [qrStepUpRequired, setQrStepUpRequired] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const asyncEvidenceEpochRef = useRef(0);
  const activeCaptureIdRef = useRef<string | null>(null);

  const copy = useMemo(() => fallbackCopy(readiness), [readiness]);
  const gpsReady = Boolean(location);
  const interactionDisabled = readOnly || !online;
  const interactionDisabledRef = useRef(interactionDisabled);
  interactionDisabledRef.current = interactionDisabled;
  const canStartAttendance = !interactionDisabled && !checking && !locationBusy && !verificationBusy && !faceCaptureOpen && !scannerOpen;
  const flowBusy = locationBusy || checking || verificationBusy || faceCaptureOpen || scannerOpen;
  const flowPhase = attendanceAccepted ? 4
    : (verificationBusy || verificationSession || faceCaptureOpen) ? 3
      : (qrStepUpRequired || scannerOpen) ? 2
        : (locationBusy || checking || gpsReady) ? 1 : 0;
  const primaryActionLabel = flowBusy
    ? 'กำลังตรวจสอบ…'
    : attendanceAccepted?.intent === 'CHECK_IN'
      ? 'ลงเวลาออกงาน'
      : 'ลงเวลา';
  const idleStatusLabel = attendanceAccepted
    ? (attendanceAccepted.intent === 'CHECK_IN' ? 'กำลังปฏิบัติงาน' : 'ลงเวลาครบแล้ว')
    : online ? 'พร้อมลงเวลา' : 'ออฟไลน์';

  useEffect(() => {
    const refreshClock = () => setNow(new Date());
    refreshClock();
    const timer = window.setInterval(refreshClock, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const resetVerificationState = () => {
    setFaceCaptureOpen(false);
    setVerificationBusy(false);
    setVerificationStage(undefined);
    setVerificationSession(null);
    setAttendanceAccepted(null);
  };

  const resetServerState = () => {
    setReadiness(null);
    setEventIntent(null);
    setRouteUnavailable(false);
    setRequestId(undefined);
    setError(undefined);
    resetVerificationState();
  };

  useEffect(() => {
    if (!interactionDisabled) return;
    asyncEvidenceEpochRef.current += 1;
    setScannerOpen(false);
    setQrToken('');
    setLocation(null);
    setLocationBusy(false);
    setChecking(false);
    setQrStepUpRequired(false);
    activeCaptureIdRef.current = null;
    resetServerState();
  }, [interactionDisabled]);

  useEffect(() => {
    const clearTransientAttemptForLifecycle = () => {
      asyncEvidenceEpochRef.current += 1;
      setScannerOpen(false);
      setQrToken('');
      setLocation(null);
      setLocationBusy(false);
      setChecking(false);
      setQrStepUpRequired(false);
      activeCaptureIdRef.current = null;
      resetServerState();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') clearTransientAttemptForLifecycle();
    };
    const handlePageHide = () => clearTransientAttemptForLifecycle();
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) clearTransientAttemptForLifecycle();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  const beginFaceVerificationWithEvidence = async (
    captureId: string,
    nextQrToken: string | undefined,
    nextLocation: AttendanceLocationEvidence,
    operationEpoch: number
  ) => {
    if (interactionDisabledRef.current) return;
    setVerificationBusy(true);
    setVerificationStage('กำลังขอ Verification session จาก Server…');
    setError(undefined);
    try {
      const started = await attendanceVerificationStart(token, {
        captureId,
        qrToken: nextQrToken?.trim() || undefined,
        location: nextLocation
      });
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setRequestId(started.requestId);
      if (!started.routeAvailable) {
        setRouteUnavailable(true);
        setVerificationStage('Attendance runtime ยังไม่เปิด');
        return;
      }
      setReadiness(started.data.readiness);
      setEventIntent(started.data.eventIntent);
      const verification = started.data.verification;
      if (started.data.readiness.state === 'QR_STEP_UP_REQUIRED' || started.data.readiness.state === 'QR_RESCAN_REQUIRED') {
        setQrStepUpRequired(true);
        setVerificationStage('Server ขอ QR Step-up เพื่อยืนยัน Site เพิ่มเติม');
        setScannerOpen(true);
        return;
      }
      if (!started.data.ok || started.data.readiness.state !== 'READY_TO_START_VERIFICATION' || !verification) {
        setVerificationStage('Server ยังไม่อนุญาตให้เริ่ม Face Verification');
        return;
      }
      setQrStepUpRequired(false);
      if (!verification.sessionId || !verification.challengeId || !verification.challenge || !verification.attendanceContext || !verification.activeChallenge) {
        throw new Error('Server ไม่ได้ออก Verification session และ Active Challenge ที่สมบูรณ์');
      }

      setVerificationStage('กำลังยืนยันคีย์ของอุปกรณ์หลัก…');
      const deviceState = await attendanceDeviceState(token);
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      const activeDeviceId = deviceState.activeDevice?.status === 'ACTIVE' ? deviceState.activeDevice.id : null;
      if (!activeDeviceId) throw new Error('ไม่พบอุปกรณ์หลัก ACTIVE สำหรับลงเวลา กรุณาตรวจสอบหน้าอุปกรณ์ลงเวลา');
      const signatureBase64 = await signAttendanceDeviceChallenge(activeDeviceId, verification.challenge);
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      await verifyAttendanceDeviceProof(token, verification.sessionId, {
        challengeId: verification.challengeId,
        challenge: verification.challenge,
        signatureBase64
      });
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;

      setVerificationSession({ sessionId: verification.sessionId, attendanceContext: verification.attendanceContext, activeChallenge: verification.activeChallenge });
      setVerificationStage('Device proof ผ่านแล้ว · พร้อมทำ Simple Active Challenge');
      setFaceCaptureOpen(true);
    } catch (reason) {
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setVerificationSession(null);
      if (reason instanceof AttendanceFlowError) {
        setRequestId(reason.requestId);
        setVerificationStage(reason.code === 'FACE_VERIFIER_UNAVAILABLE' ? 'FACE_VERIFIER_UNAVAILABLE' : 'Face Verification เริ่มไม่สำเร็จ');
        setError(reason.message);
      } else {
        setVerificationStage('Face Verification เริ่มไม่สำเร็จ');
        setError(reason instanceof Error ? reason.message : 'ไม่สามารถเริ่ม Face Verification ได้');
      }
    } finally {
      if (operationEpoch === asyncEvidenceEpochRef.current) setVerificationBusy(false);
    }
  };

  const checkReadinessWithEvidence = async (
    captureId: string,
    nextQrToken: string | undefined,
    nextLocation: AttendanceLocationEvidence,
    operationEpoch: number
  ) => {
    if (interactionDisabledRef.current) return;
    setChecking(true);
    setError(undefined);
    setRouteUnavailable(false);
    setReadiness(null);
    setEventIntent(null);
    setRequestId(undefined);
    resetVerificationState();
    try {
      const result = await attendanceReadiness(token, {
        captureId,
        qrToken: nextQrToken?.trim() || undefined,
        location: nextLocation
      });
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setRequestId(result.requestId);
      if (!result.routeAvailable) {
        setRouteUnavailable(true);
        return;
      }
      setReadiness(result.data.readiness);
      setEventIntent(result.data.eventIntent);
      if (result.data.readiness.state === 'QR_STEP_UP_REQUIRED' || result.data.readiness.state === 'QR_RESCAN_REQUIRED') {
        setQrStepUpRequired(true);
        setScannerOpen(true);
        return;
      }
      setQrStepUpRequired(false);
      if (result.data.readiness.state === 'READY_TO_START_VERIFICATION') {
        await beginFaceVerificationWithEvidence(captureId, nextQrToken, nextLocation, operationEpoch);
      }
    } catch (reason) {
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      if (reason instanceof AttendanceReadinessError) {
        setRequestId(reason.requestId);
        setError(reason.message);
      } else {
        setError(reason instanceof Error ? reason.message : 'ไม่สามารถตรวจสอบความพร้อมได้');
      }
    } finally {
      if (operationEpoch === asyncEvidenceEpochRef.current) setChecking(false);
    }
  };

  const handleQrDetected = async (value: string) => {
    if (interactionDisabledRef.current) return;
    const captureId = activeCaptureIdRef.current;
    if (!captureId) {
      setScannerOpen(false);
      setError('Attempt นี้หมดอายุแล้ว กรุณากดลงเวลาใหม่');
      return;
    }
    const nextQrToken = value.trim();
    asyncEvidenceEpochRef.current += 1;
    const operationEpoch = asyncEvidenceEpochRef.current;
    setScannerOpen(false);
    setQrToken(nextQrToken);
    setLocationBusy(false);
    setChecking(false);
    resetServerState();
    setQrStepUpRequired(true);

    if (nextQrToken.length < 24 || nextQrToken.length > 512) {
      setError('QR ไม่อยู่ในรูปแบบที่พร้อมตรวจ กรุณาสแกน QR ของ Site ปัจจุบันอีกครั้ง');
      return;
    }

    setLocationBusy(true);
    try {
      const nextLocation = await positionOnce();
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setLocation(nextLocation);
      setLocationBusy(false);
      await checkReadinessWithEvidence(captureId, nextQrToken, nextLocation, operationEpoch);
    } catch (reason) {
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setLocation(null);
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านตำแหน่งได้');
    } finally {
      if (operationEpoch === asyncEvidenceEpochRef.current) setLocationBusy(false);
    }
  };

  const handleStartAttendance = async () => {
    if (!canStartAttendance) return;
    if (!globalThis.crypto?.randomUUID) {
      setError('เบราว์เซอร์นี้ไม่รองรับ secure attempt identifier ที่ระบบต้องใช้');
      return;
    }
    asyncEvidenceEpochRef.current += 1;
    const operationEpoch = asyncEvidenceEpochRef.current;
    const captureId = globalThis.crypto.randomUUID();
    activeCaptureIdRef.current = captureId;
    setScannerOpen(false);
    setQrToken('');
    setQrStepUpRequired(false);
    setLocation(null);
    setLocationBusy(true);
    setChecking(false);
    resetServerState();
    setVerificationStage('กำลังอ่าน GPS และให้ Server ประเมิน Site…');
    try {
      const nextLocation = await positionOnce();
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setLocation(nextLocation);
      setLocationBusy(false);
      await checkReadinessWithEvidence(captureId, undefined, nextLocation, operationEpoch);
    } catch (reason) {
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setLocation(null);
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านตำแหน่งได้');
    } finally {
      if (operationEpoch === asyncEvidenceEpochRef.current) setLocationBusy(false);
    }
  };

  const handleFacePhotoConfirmed = async ({ photo, challengeFrames }: { photo: Blob; challengeFrames: Blob[] }) => {
    const activeVerification = verificationSession;
    if (!activeVerification) throw new Error('Verification session ไม่พร้อม กรุณาเริ่มตรวจสอบใหม่');
    const operationEpoch = asyncEvidenceEpochRef.current;
    setVerificationBusy(true);
    setVerificationStage('กำลังส่งลำดับ Active Challenge และภาพสดให้ trusted verifier ตรวจ…');
    setError(undefined);
    try {
      const matched = await attendanceFaceMatch(token, activeVerification.sessionId, photo, challengeFrames);
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      if (matched.verificationAccepted !== true || !matched.receipt) {
        setFaceCaptureOpen(false);
        setVerificationSession(null);
        if (matched.readiness) setReadiness(matched.readiness);
        const activeChallengeFailed = matched.readiness?.state === 'ACTIVE_CHALLENGE_RETRY';
        setVerificationStage(activeChallengeFailed ? 'Simple Active Challenge ยังไม่ผ่าน' : 'ใบหน้าไม่ตรงกับ Reference Photo');
        throw new Error(activeChallengeFailed
          ? 'Server ยังยืนยันการเคลื่อนไหวตามคำสั่งไม่ได้ กรุณาเริ่ม Active Challenge ใหม่'
          : 'Server ตรวจแล้วใบหน้าไม่ตรงกับ Reference Photo กรุณาเริ่ม attempt ใหม่');
      }

      setVerificationStage('ใบหน้าตรงแล้ว · กำลังให้ Server บันทึก AttendanceEvent…');
      const accepted = await attendanceAcceptVerifiedEvent(token, {
        receipt: matched.receipt,
        attendanceContext: activeVerification.attendanceContext
      });
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      if (accepted.attendanceAccepted !== true) {
        setFaceCaptureOpen(false);
        setVerificationSession(null);
        if (accepted.readiness) setReadiness(accepted.readiness);
        throw new Error('Server ยังไม่ยอมรับ AttendanceEvent กรุณาเริ่มตรวจสอบใหม่');
      }

      const acceptedIntent = eventIntent;
      setFaceCaptureOpen(false);
      setVerificationSession(null);
      setQrToken('');
      setLocation(null);
      setLocationBusy(false);
      setChecking(false);
      setReadiness(null);
      setEventIntent(null);
      setRouteUnavailable(false);
      setRequestId(undefined);
      setError(undefined);
      setAttendanceAccepted({ intent: acceptedIntent, acceptedAt: new Date() });
      setQrStepUpRequired(false);
      activeCaptureIdRef.current = null;
      setVerificationStage('Server บันทึกเวลาเรียบร้อยแล้ว');
      setVerificationBusy(false);
      asyncEvidenceEpochRef.current += 1;
    } catch (reason) {
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      if (reason instanceof AttendanceFlowError) {
        setRequestId(reason.requestId);
        setError(reason.message);
      } else {
        setError(reason instanceof Error ? reason.message : 'ไม่สามารถตรวจใบหน้าหรือบันทึกเวลาได้');
      }
      throw reason;
    } finally {
      if (operationEpoch === asyncEvidenceEpochRef.current) setVerificationBusy(false);
    }
  };

  return <section className="view-pane attendance-page attendance-v2">
    <AttendanceQrScanner
      open={scannerOpen && !interactionDisabled}
      autoFlow
      onDetected={(value) => { void handleQrDetected(value); }}
      onFailure={(message) => { setError(message); setVerificationStage('ยืนยันพื้นที่ไม่สำเร็จ · กดลงเวลาเพื่อลองใหม่'); setQrStepUpRequired(false); activeCaptureIdRef.current = null; }}
      onClose={() => setScannerOpen(false)}
    />
    <AttendanceFaceCapture
      open={faceCaptureOpen && !interactionDisabled}
      busy={verificationBusy}
      challenge={verificationSession?.activeChallenge || null}
      autoFlow
      onConfirm={handleFacePhotoConfirmed}
      onFailure={(message) => { setError(message); setVerificationStage('ยืนยันตัวตนไม่สำเร็จ · กดลงเวลาเพื่อลองใหม่'); setVerificationSession(null); }}
      onClose={() => setFaceCaptureOpen(false)}
    />

    <div className="attendance-v2-shell">
      <header className="attendance-v2-heading">
        <div>
          <p className="eyebrow">ลงเวลาปฏิบัติงาน</p>
          <h1>{displayName ? `สวัสดี, ${displayName}` : 'ลงเวลา'}</h1>
          <p>กดเพียงครั้งเดียว ระบบจะตรวจตำแหน่งและยืนยันตัวตนตามที่จำเป็น แล้วบันทึกเวลาให้อัตโนมัติ</p>
        </div>
      </header>

      {readOnly && <div className="settings-notice attendance-v2-notice">กำลังอยู่ใน View As — ไม่สามารถลงเวลาแทนพนักงานได้</div>}
      {!online && <div className="settings-notice attendance-v2-notice">ออฟไลน์ — กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนลงเวลา</div>}

      <article className={`attendance-v2-hero ${attendanceAccepted ? 'is-success' : ''}`}>
        <div className="attendance-v2-hero-top">
          <span className={`attendance-v2-status-chip ${online && !readOnly ? 'is-ready' : 'is-blocked'}`}>
            <span aria-hidden="true" />{readOnly ? 'ดูอย่างเดียว' : idleStatusLabel}
          </span>
          <span className="attendance-v2-secure"><SmsIcon name="shield" size={16} /> ยืนยันผ่านระบบ</span>
        </div>

        <div className="attendance-v2-clock" aria-label={`เวลาปัจจุบัน ${thaiClock(now)} นาฬิกา`}>
          <strong>{thaiClock(now)}</strong>
          <span>{thaiDateLabel(now)}</span>
        </div>

        {attendanceAccepted && <div className="attendance-v2-success" role="status">
          <span className="attendance-v2-success-icon"><SmsIcon name="check" size={28} /></span>
          <div><strong>{intentLabel(attendanceAccepted.intent)}สำเร็จ</strong><span>{thaiTime(attendanceAccepted.acceptedAt)}</span></div>
        </div>}

        {!attendanceAccepted && <div className={`attendance-v2-location ${gpsReady ? 'is-ready' : ''}`}>
          <span className="attendance-v2-location-icon"><SmsIcon name={gpsReady ? 'check' : 'quality'} size={19} /></span>
          <div>
            <strong>{gpsReady ? 'ตำแหน่งพร้อม' : flowBusy ? 'กำลังตรวจสอบ…' : 'พร้อมตรวจตำแหน่ง'}</strong>
            <span>{gpsReady ? `ความแม่นยำประมาณ ±${Math.round(location?.accuracyMeters || 0)} เมตร` : 'ระบบจะอ่าน GPS เฉพาะตอนที่คุณกดลงเวลา'}</span>
          </div>
        </div>}

        <div className="attendance-v2-action-zone">
          <button type="button" className="btn-primary attendance-v2-primary" disabled={!canStartAttendance} onClick={() => void handleStartAttendance()}>
            <SmsIcon name={flowBusy ? 'refresh' : 'attendance'} size={21} />
            <span>{primaryActionLabel}</span>
          </button>
          <small>ระบบเป็นผู้ตัดสินเวลาเข้า/ออก · QR จะเปิดเฉพาะเมื่อจำเป็น</small>
        </div>
      </article>

      {(flowBusy || flowPhase > 0) && <section className="attendance-v2-progress" aria-label="ขั้นตอนการลงเวลา">
        {[
          { step: 1, title: 'ตรวจตำแหน่ง', detail: gpsReady ? 'ตำแหน่งพร้อม' : 'กำลังอ่าน GPS' },
          { step: 2, title: 'ยืนยันพื้นที่และตัวตน', detail: qrStepUpRequired ? 'กำลังสแกน QR' : (verificationStage || 'ตรวจอัตโนมัติ') },
          { step: 3, title: 'บันทึกเวลา', detail: attendanceAccepted ? 'เรียบร้อย' : 'รอการยืนยัน' }
        ].map((item) => {
          const done = flowPhase > item.step;
          const active = flowPhase === item.step && flowBusy;
          return <div key={item.step} className={`attendance-v2-progress-step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
            <span>{done ? <SmsIcon name="check" size={16} /> : item.step}</span>
            <div><strong>{item.title}</strong><small>{item.detail}</small></div>
          </div>;
        })}
      </section>}

      {error && <div className="alert alert-error attendance-v2-error" role="alert">
        <strong>ยังลงเวลาไม่สำเร็จ</strong>
        <span>{error}</span>
        <small>ตรวจสอบข้อความด้านบน แล้วกด “ลงเวลา” อีกครั้ง</small>
        {requestId && <details><summary>รายละเอียดสำหรับผู้ดูแล</summary><code>Request ID: {requestId}</code></details>}
      </div>}

      {routeUnavailable && <section className="attendance-v2-state is-blocked">
        <span><SmsIcon name="pause" size={21} /></span>
        <div><strong>ระบบลงเวลายังไม่เปิดใช้งาน</strong><p>ขณะนี้ระบบป้องกันการบันทึกเวลาไว้ กรุณาติดต่อผู้ดูแลระบบ</p></div>
      </section>}

      {!routeUnavailable && readiness && readiness.state !== 'READY_TO_START_VERIFICATION' && !attendanceAccepted && <section className={`attendance-v2-state ${copy.tone}`}>
        <span><SmsIcon name={copy.tone === 'ready' ? 'check' : copy.tone === 'warning' ? 'clock' : 'shield'} size={21} /></span>
        <div><strong>{copy.title}</strong><p>{copy.detail}</p></div>
      </section>}

      <section className="attendance-v2-trust" aria-label="ข้อมูลการใช้งาน">
        <div><SmsIcon name="quality" size={18} /><span><strong>GPS เฉพาะตอนลงเวลา</strong><small>ไม่มีการติดตามตำแหน่งต่อเนื่อง</small></span></div>
        <div><SmsIcon name="shield" size={18} /><span><strong>QR เฉพาะเมื่อจำเป็น</strong><small>ระบบจะเปิดกล้องให้เองเมื่อพื้นที่ต้องยืนยันเพิ่ม</small></span></div>
        <div><SmsIcon name="users" size={18} /><span><strong>ยืนยันใบหน้าชั่วคราว</strong><small>ภาพไม่ถูกเก็บไว้ในเครื่องของคุณ</small></span></div>
      </section>
    </div>
  </section>;
}
