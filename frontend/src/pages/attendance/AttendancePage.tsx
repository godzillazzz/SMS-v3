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
  attendanceSelfToday,
  verifyAttendanceDeviceProof,
  type AttendanceActiveChallenge,
  type AttendanceContextRef,
  type AttendanceEventIntent,
  type AttendanceLocationEvidence,
  type AttendanceReadinessState,
  type AttendanceSelfTodayData
} from './attendance-client';
import { signAttendanceDeviceChallenge } from '../../lib/attendance-device-key';
import { AttendanceFaceCapture } from './AttendanceFaceCapture';
import { AttendanceQrScanner } from './AttendanceQrScanner';
import './attendance.css';
import './attendance-v4.css';

type Props = {
  token: string;
  displayName?: string;
  department?: string;
  readOnly?: boolean;
  online?: boolean;
  employeeV4?: boolean;
  onTodayHistory?: () => void;
  onOpenSettings?: () => void;
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

type AttendanceLocationIssueCode = 'LOCATION_PERMISSION_DENIED' | 'LOCATION_TIMEOUT' | 'LOCATION_UNAVAILABLE' | 'LOCATION_NOT_SUPPORTED';

class AttendanceLocationError extends Error {
  code: AttendanceLocationIssueCode;

  constructor(code: AttendanceLocationIssueCode, message: string) {
    super(message);
    this.name = 'AttendanceLocationError';
    this.code = code;
  }
}

function positionOnce(): Promise<AttendanceLocationEvidence> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new AttendanceLocationError('LOCATION_NOT_SUPPORTED', 'เบราว์เซอร์นี้ไม่รองรับการอ่านตำแหน่ง GPS'));
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
        if (error.code === error.PERMISSION_DENIED) reject(new AttendanceLocationError('LOCATION_PERMISSION_DENIED', 'ต้องเปิดสิทธิ์ตำแหน่งก่อนลงเวลา'));
        else if (error.code === error.TIMEOUT) reject(new AttendanceLocationError('LOCATION_TIMEOUT', 'อ่านตำแหน่งไม่ทันเวลา กรุณาลองใหม่ในจุดที่รับสัญญาณได้ดีขึ้น'));
        else reject(new AttendanceLocationError('LOCATION_UNAVAILABLE', 'ไม่สามารถอ่านตำแหน่งปัจจุบันได้ กรุณาลองใหม่'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function platformKind() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)) return 'ios' as const;
  if (/Android/i.test(ua)) return 'android' as const;
  return 'other' as const;
}

async function geolocationPermissionState(): Promise<PermissionState | 'unknown'> {
  if (!navigator.permissions?.query) return 'unknown';
  try {
    return (await navigator.permissions.query({ name: 'geolocation' as PermissionName })).state;
  } catch {
    return 'unknown';
  }
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
  return new Intl.DateTimeFormat('th-TH-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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

export function AttendancePage({ token, displayName, department, readOnly = false, online = true, employeeV4 = false, onTodayHistory, onOpenSettings }: Props) {
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
  const [attendanceAccepted, setAttendanceAccepted] = useState<{ intent: AttendanceEventIntent | null; acceptedAt: string; eventId?: string | null; sessionId?: string | null; recovered?: boolean } | null>(null);
  const [qrStepUpRequired, setQrStepUpRequired] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [todayData, setTodayData] = useState<AttendanceSelfTodayData>();
  const [todayLoading, setTodayLoading] = useState(false);
  const [deviceEnrolled, setDeviceEnrolled] = useState(false);
  const [locationIssue, setLocationIssue] = useState<AttendanceLocationError | null>(null);
  const [locationHelpOpen, setLocationHelpOpen] = useState(false);
  const asyncEvidenceEpochRef = useRef(0);
  const activeCaptureIdRef = useRef<string | null>(null);
  const locationRecoveryPendingRef = useRef(false);

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
  const tapActionLabel = flowBusy
    ? 'PROCESSING'
    : eventIntent === 'CHECK_OUT' || attendanceAccepted?.intent === 'CHECK_IN'
      ? 'TAP TO CHECK OUT'
      : eventIntent === 'CHECK_IN'
        ? 'TAP TO CHECK IN'
        : 'TAP TO CLOCK';
  const qrReady = Boolean(qrToken) || (Boolean(readiness) && !qrStepUpRequired && readiness?.state === 'READY_TO_START_VERIFICATION');
  const faceReady = Boolean(attendanceAccepted) || Boolean(verificationSession) || faceCaptureOpen;
  const deviceReady = Boolean(attendanceAccepted) || Boolean(verificationSession) || faceCaptureOpen;
  const readinessLabel = attendanceAccepted
    ? 'บันทึกเวลาเรียบร้อย'
    : flowBusy ? 'กำลังตรวจสอบตามลำดับความปลอดภัย' : 'Ready for secure attendance';

  useEffect(() => {
    const refreshClock = () => setNow(new Date());
    refreshClock();
    const timer = window.setInterval(refreshClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!employeeV4 || !online) return;
    let active = true;
    setTodayLoading(true);
    attendanceSelfToday(token)
      .then((result) => { if (active) setTodayData(result); })
      .catch(() => { if (active) setTodayData(undefined); })
      .finally(() => { if (active) setTodayLoading(false); });
    attendanceDeviceState(token)
      .then((result) => { if (active) setDeviceEnrolled(result.activeDevice?.status === 'ACTIVE'); })
      .catch(() => { if (active) setDeviceEnrolled(false); });
    return () => { active = false; };
  }, [employeeV4, online, token]);

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
      if (document.visibilityState === 'hidden' && !locationRecoveryPendingRef.current) clearTransientAttemptForLifecycle();
    };
    const handlePageHide = () => {
      if (!locationRecoveryPendingRef.current) clearTransientAttemptForLifecycle();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && !locationRecoveryPendingRef.current) clearTransientAttemptForLifecycle();
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

  const handleLocationFailure = (reason: unknown) => {
    setLocation(null);
    if (reason instanceof AttendanceLocationError) {
      setLocationIssue(reason);
      setError(reason.message);
      locationRecoveryPendingRef.current = reason.code === 'LOCATION_PERMISSION_DENIED';
      if (employeeV4 && reason.code === 'LOCATION_PERMISSION_DENIED') setLocationHelpOpen(true);
      return;
    }
    locationRecoveryPendingRef.current = false;
    setLocationIssue(null);
    setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านตำแหน่งได้');
  };

  const retryLocationForActiveAttempt = async () => {
    const captureId = activeCaptureIdRef.current;
    if (!captureId || interactionDisabledRef.current) return;
    asyncEvidenceEpochRef.current += 1;
    const operationEpoch = asyncEvidenceEpochRef.current;
    setLocationBusy(true);
    setChecking(false);
    setError(undefined);
    setLocationIssue(null);
    try {
      const nextLocation = await positionOnce();
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      locationRecoveryPendingRef.current = false;
      setLocationHelpOpen(false);
      setLocation(nextLocation);
      setLocationBusy(false);
      await checkReadinessWithEvidence(captureId, qrToken.trim() || undefined, nextLocation, operationEpoch);
    } catch (reason) {
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      handleLocationFailure(reason);
    } finally {
      if (operationEpoch === asyncEvidenceEpochRef.current) setLocationBusy(false);
    }
  };

  useEffect(() => {
    if (!employeeV4) return;
    const resumeLocationAttempt = async () => {
      if (!locationRecoveryPendingRef.current || interactionDisabledRef.current || !activeCaptureIdRef.current) return;
      const permission = await geolocationPermissionState();
      if (permission === 'granted' || permission === 'unknown') await retryLocationForActiveAttempt();
    };
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void resumeLocationAttempt();
    };
    const handlePageShowForLocation = () => { void resumeLocationAttempt(); };
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('pageshow', handlePageShowForLocation);
    return () => {
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('pageshow', handlePageShowForLocation);
    };
  }, [employeeV4, qrToken]);

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
      handleLocationFailure(reason);
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
    setLocationIssue(null);
    setLocationHelpOpen(false);
    locationRecoveryPendingRef.current = false;
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
      handleLocationFailure(reason);
    } finally {
      if (operationEpoch === asyncEvidenceEpochRef.current) setLocationBusy(false);
    }
  };

  const handleFacePhotoConfirmed = async ({ photo, challengeFrames }: { photo: Blob; challengeFrames: Blob[] }) => {
    const activeVerification = verificationSession;
    if (!activeVerification) throw new Error('Verification session ไม่พร้อม กรุณาเริ่มตรวจสอบใหม่');
    const operationEpoch = asyncEvidenceEpochRef.current;
    const acceptedIntent = activeVerification.attendanceContext.eventIntent || eventIntent;
    if (!acceptedIntent) throw new Error('Server intent ไม่พร้อม กรุณาเริ่มตรวจสอบใหม่');
    let eventAcceptanceAttempted = false;

    const applyAcceptedState = (
      acceptedAt: string,
      eventId?: string | null,
      sessionId?: string | null,
      recovered = false,
      latestToday?: AttendanceSelfTodayData
    ) => {
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
      setAttendanceAccepted({ intent: acceptedIntent, acceptedAt, eventId, sessionId, recovered });
      setQrStepUpRequired(false);
      activeCaptureIdRef.current = null;
      locationRecoveryPendingRef.current = false;
      setLocationIssue(null);
      setLocationHelpOpen(false);
      if (latestToday) setTodayData(latestToday);
      else if (employeeV4) void attendanceSelfToday(token).then(setTodayData).catch(() => {});
      setVerificationStage(recovered
        ? 'Server ยืนยันว่าบันทึกเวลาแล้วหลังการเชื่อมต่อขาดช่วง'
        : 'Server บันทึกเวลาเรียบร้อยแล้ว');
      setVerificationBusy(false);
      asyncEvidenceEpochRef.current += 1;
    };

    const recoverAcceptedEventFromServer = async () => {
      if (!employeeV4 || !eventAcceptanceAttempted) return false;
      try {
        const latest = await attendanceSelfToday(token);
        if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return false;
        const assignment = latest.assignment;
        const acceptedAt = acceptedIntent === 'CHECK_IN' ? assignment?.checkInAt : assignment?.checkOutAt;
        const eventId = acceptedIntent === 'CHECK_IN' ? assignment?.checkInEventId : assignment?.checkOutEventId;
        if (!acceptedAt) return false;
        applyAcceptedState(acceptedAt, eventId || null, null, true, latest);
        return true;
      } catch {
        return false;
      }
    };

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
      eventAcceptanceAttempted = true;
      const accepted = await attendanceAcceptVerifiedEvent(token, {
        receipt: matched.receipt,
        attendanceContext: activeVerification.attendanceContext
      });
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      if (accepted.attendanceAccepted !== true) {
        if (await recoverAcceptedEventFromServer()) return;
        setFaceCaptureOpen(false);
        setVerificationSession(null);
        if (accepted.readiness) setReadiness(accepted.readiness);
        throw new Error('Server ยังไม่ยอมรับ AttendanceEvent กรุณาเริ่มตรวจสอบใหม่');
      }

      const acceptedAt = typeof accepted.event?.effectiveEventAt === 'string'
        ? accepted.event.effectiveEventAt
        : typeof accepted.event?.receivedAt === 'string'
          ? accepted.event.receivedAt
          : '';
      if (!acceptedAt) throw new Error('Server ยอมรับ AttendanceEvent แต่ไม่ส่งเวลาฝั่ง Server กลับมา');
      applyAcceptedState(
        acceptedAt,
        typeof accepted.event?.id === 'string' ? accepted.event.id : null,
        typeof accepted.session?.id === 'string' ? accepted.session.id : null
      );
    } catch (reason) {
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      if (await recoverAcceptedEventFromServer()) return;
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

  if (employeeV4) {
    const assignment = todayData?.assignment || null;
    const scheduleReady = Boolean(todayData?.scheduleReady && assignment);
    const shiftCode = assignment?.shift.code || assignment?.shift.name || '—';
    const shiftTime = assignment
      ? `${assignment.shift.startTime || '—'}–${assignment.shift.endTime || '—'}`
      : todayLoading ? 'กำลังโหลดตารางงาน…' : 'ยังไม่มีตารางที่อนุมัติ';
    const siteName = assignment?.expectedSite?.name
      || (todayLoading ? 'กำลังโหลดข้อมูล Site…' : 'ยังไม่มี Site ตามตารางงาน');
    const employeeName = todayData?.employee.displayName || displayName || 'ผู้ใช้งาน SMS';
    const employeeCode = todayData?.employee.employeeCode || '';
    const nextIntent: AttendanceEventIntent = eventIntent || (assignment?.checkInAt && !assignment?.checkOutAt ? 'CHECK_OUT' : 'CHECK_IN');
    const attendanceComplete = Boolean(assignment?.checkInAt && assignment?.checkOutAt) && !attendanceAccepted;
    const actionText = flowBusy
      ? 'PROCESSING'
      : attendanceComplete
        ? 'ATTENDANCE COMPLETE'
        : todayLoading
          ? 'LOADING SHIFT'
          : !scheduleReady
            ? 'SHIFT NOT READY'
            : nextIntent === 'CHECK_OUT'
              ? 'TAP TO CHECK OUT'
              : 'TAP TO CHECK IN';
    const actionThai = flowBusy
      ? 'กำลังตรวจสอบ…'
      : attendanceComplete
        ? 'ลงเวลาครบแล้ว'
        : todayLoading
          ? 'กำลังอ่านตารางงาน…'
          : !scheduleReady
            ? 'รอตารางงานที่อนุมัติ'
            : nextIntent === 'CHECK_OUT'
              ? 'พร้อมเช็กเอาต์'
              : 'พร้อมเช็กอิน';
    const flags = assignment?.flags || [];
    const statusTone = !scheduleReady ? 'is-pending' : flags.includes('TIME_ABNORMAL') || flags.includes('ABSENT') ? 'is-danger' : flags.includes('LATE') || flags.includes('EARLY_OUT') ? 'is-warning' : '';
    const statusLabel = todayLoading
      ? 'LOADING'
      : !scheduleReady
        ? 'NOT READY'
        : flags.includes('TIME_ABNORMAL')
          ? 'ABNORMAL'
          : flags.includes('ABSENT')
            ? 'ABSENT'
            : flags.includes('LATE')
              ? 'LATE'
              : 'ON TIME';
    const dateLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).format(now);
    const platform = platformKind();
    const platformName = platform === 'ios' ? 'iPhone / iPad' : platform === 'android' ? 'Android' : 'อุปกรณ์นี้';
    const locationSteps = platform === 'ios'
      ? [
          'เปิด Settings → Privacy & Security → Location Services และเปิด Location Services',
          'เลือก Safari Websites หรือเบราว์เซอร์ที่ใช้งาน → เลือก While Using และเปิด Precise Location',
          'หากใช้ Safari ให้ตรวจ Website Settings → Location ของเว็บไซต์ SMS เป็น Allow แล้วกลับมาที่ SMS'
        ]
      : platform === 'android'
        ? [
            'เปิด Settings → Location → App permissions → เลือก Chrome หรือเบราว์เซอร์ที่ใช้งาน',
            'ตั้ง Location เป็น Allow only while using the app และเปิด Precise location หากมีตัวเลือก',
            'ใน Chrome ตรวจ Site settings → Location → เว็บไซต์ SMS ต้องเป็น Allow แล้วกลับมาที่ SMS'
          ]
        : [
            'เปิดการตั้งค่าความเป็นส่วนตัว/ตำแหน่งของระบบและอนุญาต Location ให้เบราว์เซอร์',
            'เปิด Site permissions ของเว็บไซต์ SMS และตั้ง Location เป็น Allow',
            'กลับมาที่ SMS ระบบจะตรวจสิทธิ์และลองอ่าน GPS ใหม่'
          ];
    const qrV4Ready = qrReady || Boolean(readiness && !qrStepUpRequired && readiness.state === 'READY_TO_START_VERIFICATION');
    const faceV4Ready = Boolean(attendanceAccepted) || Boolean(verificationSession) || faceCaptureOpen;
    const deviceV4Ready = deviceEnrolled || Boolean(attendanceAccepted) || Boolean(verificationSession);
    const actionEnabled = canStartAttendance && !attendanceComplete && scheduleReady;

    return <section className="attendance-v4" aria-label="SMS Time Attendance">
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

      {locationHelpOpen && <div className="attendance-v4__location-help" role="dialog" aria-modal="true" aria-label="วิธีเปิดสิทธิ์ตำแหน่ง">
        <section className="attendance-v4__location-sheet">
          <div className="attendance-v4__location-sheet-head">
            <span><SmsIcon name="location" size={22} /></span>
            <div>
              <strong>เปิดสิทธิ์ตำแหน่งบน {platformName}</strong>
              <p>SMS ใช้ตำแหน่งเฉพาะตอนลงเวลาและไม่มีการติดตามต่อเนื่อง ระบบ Web/PWA ไม่สามารถบังคับเปิดหน้า Settings ของทุกเบราว์เซอร์ได้ จึงแสดงขั้นตอนที่ตรงกับอุปกรณ์ให้อัตโนมัติ</p>
            </div>
          </div>
          <ol className="attendance-v4__location-steps">
            {locationSteps.map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}
          </ol>
          <div className="attendance-v4__location-actions">
            <button type="button" onClick={() => setLocationHelpOpen(false)}>ปิดคำแนะนำ</button>
            <button type="button" onClick={() => void retryLocationForActiveAttempt()}>ตรวจสิทธิ์อีกครั้ง</button>
          </div>
        </section>
      </div>}

      <header className="attendance-v4__topbar">
        <div className="attendance-v4__brand">
          <img src="/attendance-sms-logo.svg" alt="SMS" />
          <strong>SMS Time Attendance</strong>
        </div>
        <button type="button" className="attendance-v4__settings" aria-label="เปิดโปรไฟล์และการตั้งค่า" onClick={onOpenSettings}>
          <SmsIcon name="settings" size={24} />
        </button>
      </header>

      <article className={`attendance-v4__employee ${assignment ? '' : 'is-empty'}`}>
        <p className="attendance-v4__employee-site">{siteName}</p>
        <h1>{employeeCode ? `${employeeCode} ` : ''}{employeeName}</h1>
        <div className="attendance-v4__employee-meta">
          <div className="attendance-v4__meta-item">
            <SmsIcon name="clock" size={22} />
            <div><span>Shift: {shiftCode}</span><strong>{shiftTime}</strong></div>
          </div>
          <i />
          <div className="attendance-v4__meta-item">
            <SmsIcon name="location" size={22} />
            <div><span>Expected Site</span><strong>{siteName}</strong></div>
          </div>
        </div>
      </article>

      {attendanceAccepted ? <article className="attendance-v4__receipt" aria-live="polite">
        <div className="attendance-v4__receipt-head">
          <span className="attendance-v4__receipt-check"><SmsIcon name="check" size={24} /></span>
          <div><strong>บันทึกเวลาเรียบร้อย</strong><span>{intentLabel(attendanceAccepted.intent)} สำเร็จ</span></div>
        </div>
        <div className="attendance-v4__receipt-time">
          <strong>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(attendanceAccepted.acceptedAt))}</strong>
          <span>{thaiTime(attendanceAccepted.acceptedAt)}</span>
        </div>
        <dl>
          <div><dt>Site</dt><dd>{siteName}</dd></div>
          <div><dt>Shift</dt><dd>{shiftCode} {shiftTime}</dd></div>
          <div><dt>Receipt / Event ID</dt><dd>{attendanceAccepted.eventId || 'Server accepted'}</dd></div>
        </dl>
        <small>{attendanceAccepted.recovered
          ? 'ยืนยันสถานะซ้ำจาก Server หลัง response ขาดช่วง · เวลาและ Event ID มาจากข้อมูล Attendance ที่ Server บันทึกแล้ว'
          : 'เวลาบนใบรับรองมาจาก AttendanceEvent ฝั่ง Server (SERVER_RECEIVED) ไม่ใช่เวลาจากโทรศัพท์'}</small>
        <button type="button" className="attendance-v4__today-link" onClick={onTodayHistory}><SmsIcon name="history" size={17} />ดูประวัติวันนี้</button>
      </article> : <>
        <div className="attendance-v4__hero-wrap">
          <button type="button" className={`attendance-v4__action ${flowBusy ? 'is-busy' : ''}`} disabled={!actionEnabled} onClick={() => void handleStartAttendance()}>
            <span className="attendance-v4__action-content">
              <img className="attendance-v4__action-logo" src="/attendance-retro-robot.svg" alt="" />
              <strong>{actionText}</strong>
              <small>{actionThai}</small>
            </span>
          </button>
          <div className={`attendance-v4__status-pill ${statusTone}`}>
            <strong>{statusLabel}</strong>
            <span>{shiftCode === '—' ? 'SHIFT' : `${shiftCode} SHIFT`}</span>
          </div>
        </div>

        <section className="attendance-v4__readiness" aria-label="ความพร้อมสำหรับลงเวลา">
          <article className={`attendance-v4__ready-card ${gpsReady ? 'is-ready' : ''}`}>
            <span className="attendance-v4__ready-icon"><SmsIcon name="location" size={21} /></span>
            <div><strong>GPS</strong><small>{gpsReady ? `Ready ±${Math.round(location?.accuracyMeters || 0)}m` : 'On tap'}</small></div>
            {gpsReady && <span className="attendance-v4__ready-check"><SmsIcon name="check" size={11} /></span>}
          </article>
          <article className={`attendance-v4__ready-card ${qrV4Ready ? 'is-ready' : ''}`}>
            <span className="attendance-v4__ready-icon"><SmsIcon name="qr" size={21} /></span>
            <div><strong>QR</strong><small>{qrStepUpRequired ? 'Required' : qrV4Ready ? 'Ready' : 'Auto'}</small></div>
            {qrV4Ready && <span className="attendance-v4__ready-check"><SmsIcon name="check" size={11} /></span>}
          </article>
          <article className={`attendance-v4__ready-card ${faceV4Ready ? 'is-ready' : ''}`}>
            <span className="attendance-v4__ready-icon"><SmsIcon name="face" size={21} /></span>
            <div><strong>Face</strong><small>{faceV4Ready ? 'Ready' : 'Auto'}</small></div>
            {faceV4Ready && <span className="attendance-v4__ready-check"><SmsIcon name="check" size={11} /></span>}
          </article>
          <article className={`attendance-v4__ready-card ${deviceV4Ready ? 'is-ready' : ''}`}>
            <span className="attendance-v4__ready-icon"><SmsIcon name="device" size={21} /></span>
            <div><strong>Device</strong><small>{deviceV4Ready ? 'OK' : 'Check'}</small></div>
            {deviceV4Ready && <span className="attendance-v4__ready-check"><SmsIcon name="check" size={11} /></span>}
          </article>
        </section>

        <article className="attendance-v4__clock" aria-label={`เวลาปัจจุบัน ${thaiClock(now)} นาฬิกา`}>
          <strong>{thaiClock(now)}</strong>
          <span>{dateLabel}</span>
          <small>เวลาหน้าจอสำหรับอ้างอิง · เวลา Attendance จริงยืนยันโดย Server</small>
        </article>

        <div className="attendance-v4__ready-line" role="status">
          <SmsIcon name={flowBusy ? 'refresh' : 'check'} size={18} />
          <span>{todayLoading ? 'กำลังอ่านตารางงาน…' : scheduleReady ? <>Ready for <b>{nextIntent === 'CHECK_OUT' ? 'CHECK OUT' : 'CHECK IN'}</b></> : 'ยังไม่พร้อมลงเวลา · ต้องมีตารางที่อนุมัติ'}</span>
        </div>
      </>}

      {readOnly && <div className="attendance-v4__notice is-warning"><strong>View As · อ่านอย่างเดียว</strong><span>ไม่อนุญาตให้ ADMIN/MANAGER ลงเวลาแทนพนักงานจากหน้าจอนี้</span></div>}
      {!online && <div className="attendance-v4__notice is-warning"><strong>ออฟไลน์</strong><span>Attendance ต้องเชื่อมต่อ Server จึงจะลงเวลาได้</span></div>}
      {routeUnavailable && <div className="attendance-v4__notice is-warning"><strong>Attendance runtime ยังไม่เปิด</strong><span>Server gate ปิดอยู่ จึงไม่มี AttendanceEvent ถูกสร้าง</span></div>}
      {locationIssue?.code === 'LOCATION_PERMISSION_DENIED' && <div className="attendance-v4__notice is-danger" role="alert">
        <strong>ต้องเปิดสิทธิ์ตำแหน่งก่อนลงเวลา</strong>
        <span>SMS ใช้ตำแหน่งเฉพาะตอนลงเวลา ไม่ติดตามตำแหน่งต่อเนื่อง เมื่อเปิดสิทธิ์แล้วระบบจะตรวจและลอง GPS ใหม่โดยคง attempt เดิมไว้</span>
        <button type="button" className="attendance-v4__today-link" onClick={() => setLocationHelpOpen(true)}>เปิดการตั้งค่าตำแหน่ง</button>
      </div>}
      {error && locationIssue?.code !== 'LOCATION_PERMISSION_DENIED' && <div className="attendance-v4__notice is-danger" role="alert">
        <strong>ลงเวลายังไม่สำเร็จ</strong><span>{error}</span>{requestId && <span>Request ID: {requestId}</span>}
      </div>}

      {!attendanceAccepted && <button type="button" className="attendance-v4__today-link" onClick={onTodayHistory}><SmsIcon name="history" size={17} />ดูประวัติวันนี้</button>}

      <footer className="attendance-v4__footer">
        <span>Platform Version: SMS Time 4.0 Preview</span>
        <span>© 2020 SMS Security Management System Co., Ltd. All rights reserved.</span>
      </footer>
    </section>;
  }

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

    <div className="attendance-v2-shell attendance-v3-shell">
      {readOnly && <div className="settings-notice attendance-v2-notice">กำลังอยู่ใน View As — ไม่สามารถลงเวลาแทนพนักงานได้</div>}
      {!online && <div className="settings-notice attendance-v2-notice">ออฟไลน์ — กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนลงเวลา</div>}

      <section className="attendance-v3-identity-card" aria-label="ข้อมูลพนักงานและตารางงาน">
        <div className="attendance-v3-identity-copy">
          <span className="attendance-v3-kicker">SMS EMPLOYEE</span>
          <h1>{displayName || 'ผู้ใช้งาน SMS'}</h1>
          <p>{department || 'หน่วยงานตาม Employee Master'}</p>
        </div>
        <div className="attendance-v3-assignment-grid">
          <div>
            <span className="attendance-v3-meta-icon"><SmsIcon name="clock" size={18} /></span>
            <span><small>Shift</small><strong>ตามตารางที่อนุมัติ</strong></span>
          </div>
          <div>
            <span className="attendance-v3-meta-icon"><SmsIcon name="location" size={18} /></span>
            <span><small>Expected Site</small><strong>Server ตรวจอัตโนมัติ</strong></span>
          </div>
        </div>
      </section>

      <article className={`attendance-v2-hero attendance-v3-hero ${attendanceAccepted ? 'is-success' : ''}`}>
        <div className="attendance-v2-hero-top attendance-v3-hero-top">
          <span className={`attendance-v2-status-chip ${online && !readOnly ? 'is-ready' : 'is-blocked'}`}>
            <span aria-hidden="true" />{readOnly ? 'VIEW ONLY' : idleStatusLabel}
          </span>
          <span className="attendance-v2-secure"><SmsIcon name="shield" size={16} /> Server Authority</span>
        </div>

        <div className="attendance-v3-orb-wrap">
          <button type="button" className="btn-primary attendance-v2-primary attendance-v3-orb-button" disabled={!canStartAttendance} onClick={() => void handleStartAttendance()}>
            <span className="attendance-v3-orb-icon"><SmsIcon name={flowBusy ? 'refresh' : 'attendance'} size={42} /></span>
            <strong>{tapActionLabel}</strong>
            <small>{primaryActionLabel}</small>
          </button>
          <span className={`attendance-v3-intent-badge ${attendanceAccepted ? 'is-success' : ''}`}>
            <SmsIcon name={attendanceAccepted ? 'check' : 'shield'} size={17} />
            <span>{eventIntent ? intentLabel(eventIntent) : 'Server ตัดสิน IN / OUT'}</span>
          </span>
        </div>

        <section className="attendance-v2-trust attendance-v3-trust-grid" aria-label="สถานะการตรวจสอบ Attendance">
          <div className={gpsReady ? 'is-ready' : flowPhase >= 1 ? 'is-active' : ''}>
            <SmsIcon name="location" size={21} />
            <span><strong>GPS</strong><small>{gpsReady ? `Ready · ±${Math.round(location?.accuracyMeters || 0)} m` : 'GPS เฉพาะตอนลงเวลา'}</small></span>
          </div>
          <div className={qrStepUpRequired || scannerOpen ? 'is-active' : qrReady ? 'is-ready' : ''}>
            <SmsIcon name="qr" size={21} />
            <span><strong>QR</strong><small>{qrStepUpRequired || scannerOpen ? 'Step-up required' : qrReady ? 'Ready / not required' : 'QR เฉพาะเมื่อจำเป็น'}</small></span>
          </div>
          <div className={faceReady ? 'is-ready' : verificationBusy ? 'is-active' : ''}>
            <SmsIcon name="face" size={21} />
            <span><strong>Face</strong><small>{attendanceAccepted ? 'Verified' : faceReady ? 'Ready' : 'ยืนยันใบหน้าชั่วคราว'}</small></span>
          </div>
          <div className={deviceReady ? 'is-ready' : verificationStage?.includes('อุปกรณ์') ? 'is-active' : ''}>
            <SmsIcon name="device" size={21} />
            <span><strong>Device</strong><small>{deviceReady ? 'OK' : 'Server ตรวจอุปกรณ์หลัก'}</small></span>
          </div>
        </section>

        <div className="attendance-v2-clock attendance-v3-clock-card" aria-label={`เวลาปัจจุบัน ${thaiClock(now)} นาฬิกา`}>
          <strong>{thaiClock(now)}</strong>
          <span>{thaiDateLabel(now)}</span>
          <small>เวลาแสดงผลจากอุปกรณ์ · Server time เป็น authority ตอนบันทึก</small>
        </div>

        <div className="attendance-v3-ready-line" role="status">
          <SmsIcon name={attendanceAccepted ? 'check' : flowBusy ? 'refresh' : 'clock'} size={18} />
          <span>{readinessLabel}</span>
        </div>

        {attendanceAccepted && <div className="attendance-v2-success" role="status">
          <span className="attendance-v2-success-icon"><SmsIcon name="check" size={28} /></span>
          <div><strong>{intentLabel(attendanceAccepted.intent)}สำเร็จ</strong><span>{thaiTime(attendanceAccepted.acceptedAt)}</span></div>
        </div>}

        {!attendanceAccepted && gpsReady && <div className="attendance-v2-location is-ready">
          <span className="attendance-v2-location-icon"><SmsIcon name="check" size={19} /></span>
          <div><strong>ตำแหน่งพร้อมสำหรับ Server validation</strong><span>ความแม่นยำประมาณ ±{Math.round(location?.accuracyMeters || 0)} เมตร · ไม่มีการติดตามต่อเนื่อง</span></div>
        </div>}

        <small className="attendance-v3-authority-note">ระบบเป็นผู้ตัดสินเวลาเข้า/ออก · QR จะเปิดเฉพาะเมื่อจำเป็น</small>
      </article>

      {(flowBusy || flowPhase > 0) && <section className="attendance-v2-progress attendance-v3-progress" aria-label="ขั้นตอนการลงเวลา">
        {[
          { step: 1, title: 'GPS', detail: gpsReady ? 'ตำแหน่งพร้อม' : 'กำลังอ่าน GPS' },
          { step: 2, title: 'QR / Device / Face', detail: qrStepUpRequired ? 'กำลังสแกน QR' : (verificationStage || 'Server ตรวจอัตโนมัติ') },
          { step: 3, title: 'Attendance', detail: attendanceAccepted ? 'บันทึกเรียบร้อย' : 'รอการยืนยัน' }
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

      <section className="attendance-v3-privacy-note" aria-label="นโยบายความเป็นส่วนตัว Attendance">
        <SmsIcon name="shield" size={18} />
        <p><strong>Privacy by design</strong><span>GPS เฉพาะตอนลงเวลา · QR เฉพาะเมื่อจำเป็น · ยืนยันใบหน้าชั่วคราวและไม่เก็บ live/challenge frames เป็นหลักฐานถาวร</span></p>
      </section>
    </div>
  </section>;
}
