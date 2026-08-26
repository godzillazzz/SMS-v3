import { useEffect, useMemo, useRef, useState } from 'react';
import { SmsIcon } from '../../components/SmsIcon';
import { SecuritySiteManagementPanel } from '../../components/SecuritySiteManagementPanel';
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
import { AttendanceFaceChallengeUatPanel } from './AttendanceFaceChallengeUatPanel';
import { AttendanceQrScanner } from './AttendanceQrScanner';
import './attendance.css';

type Props = {
  token: string;
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

export function AttendancePage({ token, readOnly = false, online = true }: Props) {
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
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [faceCaptureOpen, setFaceCaptureOpen] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationStage, setVerificationStage] = useState<string>();
  const [verificationSession, setVerificationSession] = useState<{ sessionId: string; attendanceContext: AttendanceContextRef; activeChallenge: AttendanceActiveChallenge } | null>(null);
  const [attendanceAccepted, setAttendanceAccepted] = useState<{ intent: AttendanceEventIntent | null; acceptedAt: Date } | null>(null);
  const [qrStepUpRequired, setQrStepUpRequired] = useState(false);
  const asyncEvidenceEpochRef = useRef(0);
  const activeCaptureIdRef = useRef<string | null>(null);

  const copy = useMemo(() => fallbackCopy(readiness), [readiness]);
  const qrLength = qrToken.trim().length;
  const qrReady = qrLength >= 24 && qrLength <= 512;
  const gpsReady = Boolean(location);
  const interactionDisabled = readOnly || !online;
  const interactionDisabledRef = useRef(interactionDisabled);
  interactionDisabledRef.current = interactionDisabled;
  const canStartAttendance = !interactionDisabled && !checking && !locationBusy && !verificationBusy && !faceCaptureOpen && !scannerOpen;

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
    setCheckedAt(null);
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
      setCheckedAt(new Date());
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
      setCheckedAt(null);
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

  return <section className="view-pane attendance-page attendance-one-action">
    <AttendanceQrScanner
      open={scannerOpen && !interactionDisabled}
      autoFlow
      onDetected={(value) => { void handleQrDetected(value); }}
      onFailure={(message) => { setError(message); setVerificationStage('QR Step-up ไม่สำเร็จ · กดลงเวลาเพื่อลองใหม่'); setQrStepUpRequired(false); activeCaptureIdRef.current = null; }}
      onClose={() => setScannerOpen(false)}
    />
    <AttendanceFaceCapture
      open={faceCaptureOpen && !interactionDisabled}
      busy={verificationBusy}
      challenge={verificationSession?.activeChallenge || null}
      autoFlow
      onConfirm={handleFacePhotoConfirmed}
      onFailure={(message) => { setError(message); setVerificationStage('การยืนยันตัวตนไม่สำเร็จ · กดลงเวลาเพื่อลองใหม่'); setVerificationSession(null); }}
      onClose={() => setFaceCaptureOpen(false)}
    />

    <div className="page-heading attendance-heading">
      <div>
        <p className="eyebrow">G06 · ATTENDANCE</p>
        <h1>ลงเวลา</h1>
        <p>พนักงานกดปุ่มเดียว ระบบทำ GPS → Site/Schedule/Device → QR Step-up เฉพาะเมื่อ Server ขอ → Active Challenge + Face Match → CHECK-IN/CHECK-OUT และบันทึกเวลาให้อัตโนมัติ</p>
      </div>
    </div>

    {readOnly && <div className="settings-notice">กำลังอยู่ใน View As — ไม่อนุญาตให้ลงเวลาแทนพนักงาน</div>}
    {!online && <div className="settings-notice">ออฟไลน์ — การลงเวลาต้องเชื่อมต่อ Server</div>}

    <section className="attendance-safety-banner">
      <span className="attendance-safety-banner__icon"><SmsIcon name="shield" size={22} /></span>
      <div><strong>One tap · Server controlled</strong><p>พนักงานไม่เลือก CHECK-IN/CHECK-OUT, ไม่กด GPS, ไม่กด QR, ไม่กด Face และไม่กด Submit แยกขั้นตอน ทุก policy ถูกตัดสินฝั่ง Server</p></div>
    </section>

    <article className="attendance-evidence-card attendance-one-action-card">
      <header><span><SmsIcon name="clock" size={22} /></span><div><h2>{attendanceAccepted ? 'บันทึกเวลาเรียบร้อย' : 'พร้อมลงเวลา'}</h2><p>{attendanceAccepted
        ? `${intentLabel(attendanceAccepted.intent)} สำเร็จเมื่อ ${thaiTime(attendanceAccepted.acceptedAt)}`
        : verificationStage || 'กดลงเวลา 1 ครั้ง แล้วทำท่าตามคำสั่งบนกล้องเมื่อระบบร้องขอ'}</p></div></header>
      {location && <dl className="attendance-location-summary"><div><dt>GPS ล่าสุด</dt><dd>±{Math.round(location.accuracyMeters)} เมตร</dd></div><div><dt>อ่านเมื่อ</dt><dd>{thaiTime(location.capturedAt)}</dd></div></dl>}
      <button type="button" className="btn-primary attendance-location-action attendance-primary-one-action" disabled={!canStartAttendance} onClick={() => void handleStartAttendance()}>
        <SmsIcon name="clock" size={19} />{locationBusy || checking || verificationBusy || faceCaptureOpen || scannerOpen ? 'กำลังลงเวลา…' : 'ลงเวลา'}
      </button>
      <small className="attendance-one-action-note">หาก GPS ชัดเจน Server จะข้าม QR ให้อัตโนมัติ หากต้องยืนยันพื้นที่เพิ่ม กล้อง QR จะเปิดเองโดยไม่ต้องเลือกขั้นตอน</small>
    </article>

    <div className="attendance-flow-grid" aria-label="สถานะขั้นตอนลงเวลา">
      <article className={`attendance-flow-step ${gpsReady ? 'is-ready' : ''}`}><span>1</span><div><strong>GPS + Site</strong><small>{gpsReady ? `±${Math.round(location?.accuracyMeters || 0)} เมตร` : 'รอเริ่ม'}</small></div><SmsIcon name={gpsReady ? 'check' : 'quality'} size={18} /></article>
      <article className={`attendance-flow-step ${qrReady ? 'is-ready' : qrStepUpRequired ? 'is-checked' : ''}`}><span>2</span><div><strong>QR Step-up</strong><small>{qrReady ? 'ยืนยันแล้ว' : qrStepUpRequired ? 'Server ขอ QR · กล้องเปิดอัตโนมัติ' : 'ไม่จำเป็นใน attempt นี้'}</small></div><SmsIcon name={qrReady ? 'check' : qrStepUpRequired ? 'shield' : 'pause'} size={18} /></article>
      <article className={`attendance-flow-step ${verificationSession || verificationBusy || faceCaptureOpen ? 'is-checked' : ''}`}><span>3</span><div><strong>Device + Face</strong><small>{verificationStage || 'รอ Server'}</small></div><SmsIcon name={verificationBusy || faceCaptureOpen ? 'clock' : verificationSession ? 'shield' : 'pause'} size={18} /></article>
      <article className={`attendance-flow-step ${attendanceAccepted ? 'is-ready' : 'is-locked'}`}><span>4</span><div><strong>Server ลงเวลา</strong><small>{attendanceAccepted ? 'AttendanceEvent บันทึกแล้ว' : intentLabel(eventIntent)}</small></div><SmsIcon name={attendanceAccepted ? 'check' : 'shield'} size={18} /></article>
    </div>

    {error && <div className="alert alert-error attendance-error" role="alert"><strong>ลงเวลายังไม่สำเร็จ</strong><span>{error}</span>{requestId && <small>Request ID: {requestId}</small>}<small>กด “ลงเวลา” ปุ่มเดิมเพื่อเริ่ม attempt ใหม่</small></div>}

    <section className="attendance-readiness-card">
      {routeUnavailable ? <div className="attendance-server-state blocked"><span className="attendance-server-state__icon"><SmsIcon name="pause" size={23} /></span><div><strong>ระบบลงเวลายังไม่เปิดใช้งานในสภาพแวดล้อมนี้</strong><p>Server gate ยังปิด จึงไม่มี Face Verification และไม่มี AttendanceEvent ถูกสร้าง</p></div></div>
        : <div className={`attendance-server-state ${copy.tone}`}><span className="attendance-server-state__icon"><SmsIcon name={copy.tone === 'ready' ? 'check' : copy.tone === 'neutral' ? 'clock' : 'shield'} size={23} /></span><div><strong>{copy.title}</strong><p>{copy.detail}</p>{readiness && <div className="attendance-server-meta"><span>{readiness.state}</span><span>{intentLabel(eventIntent)}</span>{checkedAt && <span>{thaiTime(checkedAt)}</span>}</div>}</div></div>}
    </section>

    <AttendanceFaceChallengeUatPanel token={token} online={online} readOnly={readOnly} />
    <SecuritySiteManagementPanel token={token} />
  </section>;

}
