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
  readOnly?: boolean;
  online?: boolean;
  onOpenDeviceSetup?: () => void;
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
    detail: 'กลับไปหน้าอุปกรณ์ลงเวลาเพื่อยืนยัน possession ของ private key แล้วลองใหม่',
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
  QR_RESCAN_REQUIRED: {
    title: 'กรุณาสแกน QR ปัจจุบันอีกครั้ง',
    detail: 'QR ไม่ตรงกับ Site/credential ที่ server ยอมรับ หรือ credential ปัจจุบันเปลี่ยนแล้ว',
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
    title: 'รอหลักฐาน QR และ GPS',
    detail: 'ระบบจะส่งเฉพาะหลักฐานของ attempt นี้ให้ server ตรวจ authority ก่อนเริ่มขั้นยืนยันตัวตน',
    tone: 'neutral'
  };
  return readinessCopy[state.state] || {
    title: 'ระบบยังไม่อนุญาตให้ดำเนินการต่อ',
    detail: 'Attendance อยู่ในสถานะป้องกันความผิดพลาด กรุณาเริ่มตรวจสอบใหม่หรือติดต่อผู้ดูแลระบบ',
    tone: 'blocked'
  };
}

export function AttendancePage({ token, readOnly = false, online = true, onOpenDeviceSetup }: Props) {
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
  const asyncEvidenceEpochRef = useRef(0);

  const copy = useMemo(() => fallbackCopy(readiness), [readiness]);
  const qrLength = qrToken.trim().length;
  const qrReady = qrLength >= 24 && qrLength <= 512;
  const gpsReady = Boolean(location);
  const interactionDisabled = readOnly || !online;
  const interactionDisabledRef = useRef(interactionDisabled);
  interactionDisabledRef.current = interactionDisabled;
  const canCheck = !interactionDisabled && qrReady && gpsReady && !checking && !locationBusy && !verificationBusy;

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
    nextQrToken: string,
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
        qrToken: nextQrToken.trim(),
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
      if (!started.data.ok || started.data.readiness.state !== 'READY_TO_START_VERIFICATION' || !verification) {
        setVerificationStage('Server ยังไม่อนุญาตให้เริ่ม Face Verification');
        return;
      }
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
    nextQrToken: string,
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
        qrToken: nextQrToken.trim(),
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

  const acquireLocation = async () => {
    if (interactionDisabled) return;
    const operationEpoch = asyncEvidenceEpochRef.current;
    setLocationBusy(true);
    resetServerState();
    try {
      const nextLocation = await positionOnce();
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setLocation(nextLocation);
    } catch (reason) {
      if (operationEpoch !== asyncEvidenceEpochRef.current || interactionDisabledRef.current) return;
      setLocation(null);
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านตำแหน่งได้');
    } finally {
      if (operationEpoch === asyncEvidenceEpochRef.current) setLocationBusy(false);
    }
  };

  const handleQrDetected = async (value: string) => {
    if (interactionDisabledRef.current) return;
    const nextQrToken = value.trim();
    asyncEvidenceEpochRef.current += 1;
    const operationEpoch = asyncEvidenceEpochRef.current;
    setScannerOpen(false);
    setQrToken(nextQrToken);
    setLocation(null);
    setLocationBusy(false);
    setChecking(false);
    resetServerState();

    if (nextQrToken.length < 24 || nextQrToken.length > 512) {
      setError('QR ไม่อยู่ในรูปแบบที่พร้อมตรวจ กรุณาสแกน QR จุดปฏิบัติงานอีกครั้ง');
      return;
    }

    if (!globalThis.crypto?.randomUUID) {
      setError('เบราว์เซอร์นี้ไม่รองรับ secure attempt identifier ที่ระบบต้องใช้');
      return;
    }
    const captureId = globalThis.crypto.randomUUID();
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

  const checkReadiness = async () => {
    if (!canCheck || !location) return;
    if (!globalThis.crypto?.randomUUID) {
      setError('เบราว์เซอร์นี้ไม่รองรับ secure attempt identifier ที่ระบบต้องใช้');
      return;
    }
    const operationEpoch = asyncEvidenceEpochRef.current;
    await checkReadinessWithEvidence(globalThis.crypto.randomUUID(), qrToken, location, operationEpoch);
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

  const resetAttempt = () => {
    asyncEvidenceEpochRef.current += 1;
    setScannerOpen(false);
    setQrToken('');
    setLocation(null);
    setLocationBusy(false);
    setChecking(false);
    resetServerState();
  };

  return <section className="view-pane attendance-page">
    <AttendanceQrScanner
      open={scannerOpen && !interactionDisabled}
      onDetected={(value) => { void handleQrDetected(value); }}
      onClose={() => setScannerOpen(false)}
    />
    <AttendanceFaceCapture
      open={faceCaptureOpen && !interactionDisabled}
      busy={verificationBusy}
      challenge={verificationSession?.activeChallenge || null}
      onConfirm={handleFacePhotoConfirmed}
      onClose={() => setFaceCaptureOpen(false)}
    />
    <div className="page-heading attendance-heading">
      <div>
        <p className="eyebrow">G06 · ATTENDANCE</p>
        <h1>ลงเวลา</h1>
        <p>สแกน QR ครั้งเดียว แล้วระบบอ่าน GPS แบบ one-shot และตรวจ Server ต่อให้อัตโนมัติ โดย Server เป็นผู้ตัดสินเวลาเข้า/ออก</p>
      </div>
      <div className="heading-actions">
        <button type="button" className="btn-neutral small-action" onClick={resetAttempt} disabled={checking || locationBusy || verificationBusy}>
          <SmsIcon name="refresh" size={17} />เริ่มใหม่
        </button>
      </div>
    </div>

    {readOnly && <div className="settings-notice">กำลังอยู่ใน View As — หน้า Attendance เป็นแบบอ่านอย่างเดียวและไม่สามารถส่งหลักฐานลงเวลาแทนพนักงานได้</div>}
    {!online && <div className="settings-notice">ออฟไลน์ — ปิดการสแกน QR, GPS และ Server readiness จนกว่าจะเชื่อมต่อ Server อีกครั้ง</div>}

    <div className="settings-notice">
      <strong>Scan once · Auto flow</strong> — หลังสแกน QR สำเร็จ ระบบจะอ่านตำแหน่งปัจจุบันและตรวจ Server readiness ต่อทันทีโดยไม่ต้องกดทีละขั้น
      ปุ่ม GPS และตรวจความพร้อมด้านล่างยังคงไว้สำหรับลองใหม่เมื่อมีข้อผิดพลาดเท่านั้น
    </div>

    <section className="attendance-safety-banner">
      <span className="attendance-safety-banner__icon"><SmsIcon name="shield" size={22} /></span>
      <div><strong>Server time และ Server authority เท่านั้นที่ตัดสินผล</strong><p>หน้าเว็บไม่มีตัวเลือก CHECK_IN/CHECK_OUT และไม่มีสถานะ PASS จาก QR, GPS หรือ Face ที่สามารถบันทึกเวลาได้เอง</p></div>
    </section>

    <div className="attendance-flow-grid" aria-label="ขั้นตอนลงเวลา">
      <article className={`attendance-flow-step ${qrReady ? 'is-ready' : ''}`}>
        <span>1</span><div><strong>QR จุดปฏิบัติงาน</strong><small>{qrReady ? 'มีหลักฐาน QR พร้อมตรวจ' : 'รอสแกน/รับข้อมูล QR'}</small></div><SmsIcon name={qrReady ? 'check' : 'quality'} size={18} />
      </article>
      <article className={`attendance-flow-step ${gpsReady ? 'is-ready' : ''}`}>
        <span>2</span><div><strong>GPS ปัจจุบัน</strong><small>{gpsReady ? `±${Math.round(location?.accuracyMeters || 0)} เมตร` : 'ยังไม่ได้อ่านตำแหน่ง'}</small></div><SmsIcon name={gpsReady ? 'check' : 'quality'} size={18} />
      </article>
      <article className={`attendance-flow-step ${readiness || routeUnavailable ? 'is-checked' : ''}`}>
        <span>3</span><div><strong>Server readiness</strong><small>{routeUnavailable ? 'ยังไม่เปิดใช้งาน' : readiness ? readiness.state : 'รอหลักฐานครบ'}</small></div><SmsIcon name={readiness?.state === 'READY_TO_START_VERIFICATION' ? 'check' : 'shield'} size={18} />
      </article>
      <article className={`attendance-flow-step ${attendanceAccepted ? 'is-ready' : verificationSession || verificationBusy ? 'is-checked' : 'is-locked'}`}>
        <span>4</span><div><strong>Active Challenge + ตรวจใบหน้า 1:1</strong><small>{attendanceAccepted ? 'Server รับผลและบันทึกเวลาแล้ว' : verificationStage || 'รอ Server readiness'}</small></div><SmsIcon name={attendanceAccepted ? 'check' : verificationBusy ? 'clock' : verificationSession ? 'shield' : 'pause'} size={18} />
      </article>
    </div>

    <div className="attendance-workspace-grid">
      <article className="attendance-evidence-card">
        <header className="attendance-qr-evidence-header"><span><SmsIcon name="quality" size={20} /></span><div><h2>1. QR จุดปฏิบัติงาน</h2><p>สแกนครั้งเดียวเพื่อเริ่ม QR → GPS → Server readiness อัตโนมัติ; ค่า QR อยู่เฉพาะ attempt ปัจจุบันและไม่บันทึกลง localStorage/sessionStorage</p></div><button type="button" className="btn-primary attendance-qr-open-action" disabled={interactionDisabled || checking || locationBusy || verificationBusy} onClick={() => { resetServerState(); setScannerOpen(true); }}><SmsIcon name="quality" size={17} />สแกน QR เพื่อลงเวลา</button></header>
        <label className="attendance-field">
          <span>ข้อมูลจาก QR (สำรอง / UAT)</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={qrToken}
            maxLength={512}
            disabled={interactionDisabled || checking}
            onChange={(event) => { setQrToken(event.target.value); resetServerState(); }}
            placeholder="วางข้อมูล QR จากป้าย ณ จุดปฏิบัติงาน หรือกดสแกน QR"
          />
          <small>{qrReady ? 'พร้อมตรวจ; หากสแกนด้วยกล้อง ระบบจะเดินต่ออัตโนมัติ' : 'ช่องนี้เป็นทางสำรอง การใช้งานปกติให้กดสแกน QR เพื่อลงเวลา'}</small>
        </label>
      </article>

      <article className="attendance-evidence-card">
        <header><span><SmsIcon name="quality" size={20} /></span><div><h2>2. ตำแหน่งปัจจุบัน</h2><p>อ่านแบบ one-shot เท่านั้น ไม่มี continuous tracking และไม่เก็บตำแหน่งเบื้องหลัง</p></div></header>
        {location ? <dl className="attendance-location-summary">
          <div><dt>ความแม่นยำ</dt><dd>±{Math.round(location.accuracyMeters)} เมตร</dd></div>
          <div><dt>อ่านเมื่อ</dt><dd>{thaiTime(location.capturedAt)}</dd></div>
        </dl> : <div className="attendance-empty-evidence">ยังไม่มีตำแหน่งสำหรับ attempt นี้</div>}
        <button type="button" className="btn-neutral attendance-location-action" disabled={interactionDisabled || locationBusy || checking || verificationBusy} onClick={() => void acquireLocation()}>
          <SmsIcon name="refresh" size={17} />{locationBusy ? 'กำลังอ่านตำแหน่ง…' : location ? 'อ่านตำแหน่งใหม่' : 'อ่านตำแหน่งปัจจุบัน'}
        </button>
      </article>
    </div>

    {error && <div className="alert alert-error attendance-error" role="alert"><strong>ยังตรวจสอบต่อไม่ได้</strong><span>{error}</span>{requestId && <small>Request ID: {requestId}</small>}</div>}

    <section className="attendance-readiness-card">
      <header>
        <div><p className="eyebrow">SERVER DECISION</p><h2>3. ตรวจความพร้อม</h2><span>หลังสแกน QR ระบบตรวจให้อัตโนมัติ; ปุ่มนี้ใช้ลองซ้ำเท่านั้น และ client ไม่ส่ง eventIntent</span></div>
        <button type="button" className="btn-primary" disabled={!canCheck} onClick={() => void checkReadiness()}>
          <SmsIcon name="shield" size={17} />{checking ? 'กำลังตรวจสอบ…' : 'ตรวจความพร้อมอีกครั้ง'}
        </button>
      </header>

      {routeUnavailable ? <div className="attendance-server-state blocked">
        <span className="attendance-server-state__icon"><SmsIcon name="pause" size={23} /></span>
        <div><strong>ระบบลงเวลายังไม่เปิดใช้งานในสภาพแวดล้อมนี้</strong><p>Attendance API ถูกซ่อนโดย server gate จึงไม่มีการเริ่ม Face Verification และไม่มี AttendanceEvent ถูกสร้าง</p></div>
      </div> : <div className={`attendance-server-state ${copy.tone}`}>
        <span className="attendance-server-state__icon"><SmsIcon name={copy.tone === 'ready' ? 'check' : copy.tone === 'neutral' ? 'clock' : 'shield'} size={23} /></span>
        <div><strong>{copy.title}</strong><p>{copy.detail}</p>{readiness && <div className="attendance-server-meta"><span>{readiness.state}</span><span>{intentLabel(eventIntent)}</span>{checkedAt && <span>{thaiTime(checkedAt)}</span>}</div>}</div>
      </div>}

      {readiness?.state === 'DEVICE_SETUP_REQUIRED' && onOpenDeviceSetup && <button type="button" className="btn-neutral attendance-remediation" onClick={onOpenDeviceSetup}>ไปหน้าอุปกรณ์ลงเวลา</button>}
    </section>

    <section className={`attendance-face-gate ${attendanceAccepted ? 'is-success' : ''}`}>
      <div><span className="attendance-face-gate__icon"><SmsIcon name={attendanceAccepted ? 'check' : verificationBusy ? 'clock' : verificationSession ? 'shield' : 'pause'} size={21} /></span><div><h2>4. Active Challenge + ตรวจใบหน้า 1:1</h2><p>{attendanceAccepted
        ? `${intentLabel(attendanceAccepted.intent)} สำเร็จเมื่อ ${thaiTime(attendanceAccepted.acceptedAt)} — ยืนยันจาก AttendanceEvent ที่ Server รับแล้ว`
        : verificationStage || 'เมื่อ Server readiness พร้อม ระบบจะยืนยันคีย์อุปกรณ์ แล้วเปิดกล้องหน้าสำหรับภาพสดแบบ memory-only โดยอัตโนมัติ'}</p><small>ภาพ Challenge/ภาพสดไม่ลง Gallery, localStorage/sessionStorage/IndexedDB หรือ Attendance Storage และ client ไม่ส่งค่า Challenge PASS / Face PASS ไปตัดสินเอง</small></div></div>
      {attendanceAccepted
        ? <span className="attendance-face-success-badge">บันทึกเวลาแล้ว</span>
        : verificationSession
          ? <button type="button" className="btn-primary" disabled={interactionDisabled || verificationBusy} onClick={() => setFaceCaptureOpen(true)}>เปิดกล้องหน้าอีกครั้ง</button>
          : <button type="button" className="btn-primary" disabled>รอ Server readiness</button>}
    </section>
  </section>;
}
