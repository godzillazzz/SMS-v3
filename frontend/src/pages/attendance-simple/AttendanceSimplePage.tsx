import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  simpleAttendanceBootstrap,
  simpleAttendanceSelfieProof,
  simpleAttendanceSubmit,
  type AttendanceSimpleErrorDetails,
  type SimpleBootstrap,
  type SimpleEventInput,
  type SimpleEventResult
} from './attendance-simple-client';
import { normalizeRequestId } from '../../api';
import { RequestErrorReference, toRequestErrorState } from '../../request-error';
import { ATTACHMENT_POLICIES, canvasToOptimizedJpeg } from '../../lib/attachment-optimizer';
import { SmsIcon } from '../../components/SmsIcon';
import { PageHeader, SectionCard } from '../../components/layout';
import { formatThaiDateTime } from '../../thai-date-time';
import { isSmsPwaShellMode } from '../../pwa-mode';
import {
  deviceFingerprint,
  deviceRiskSignals,
  encryptedQueueCount,
  enqueueEncrypted,
  ensureDeviceIdentity,
  gpsGeofenceDecision,
  listEncryptedQueue,
  readEncryptedBootstrap,
  removeQueued,
  sha256Hex,
  signPayload,
  storeEncryptedBootstrap,
  type DeviceIdentity
} from './attendance-simple-storage';
import { paintAttendanceSelfieStamp } from './attendance-selfie-stamp';
import './attendance-simple.css';

type Props = {
  token?: string;
  displayName?: string;
  department?: string | null;
  readOnly?: boolean;
  online?: boolean;
  onTodayHistory?: () => void;
  onOpenSettings?: () => void;
  employeeV4?: boolean;
  onOpenAttendanceDevice?: () => void;
  onOpenSupervisor?: () => void;
};

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';
type SiteSummary = { id: string; code?: string | null; name?: string | null };
type DisplaySiteContext = { assignedSite: SiteSummary; actualSite: SiteSummary | null; workSiteContext: 'ASSIGNED_SITE' | 'SUPPORT_SITE' | 'OUTSIDE_ALL_SITES' };

function siteDisplayName(site: SiteSummary | null | undefined): string {
  const value = String(site?.name || site?.code || '').trim();
  if (!value) return 'Site ที่ตรวจพบ';
  return /^site(?:\s|$)/i.test(value) ? value : `Site ${value}`;
}

// Retained as release-contract copy while device enrollment remains an admin surface.
const DEVICE_TELEMETRY_COPY = Object.freeze({
  primary: 'เครื่องแรกจะผูกอัตโนมัติ',
  foreign: 'ใช้อุปกรณ์อื่น · ต้องตรวจ'
});

function reviewContextDetails(result: SimpleEventResult, evidence = result.event?.locationEvidence): string[] {
  const reasons = new Set([...(result.reviewReasons || []), ...(result.event?.reviewReasons || [])]);
  const details: string[] = [];
  if (evidence?.workSiteContext === 'SUPPORT_SITE' || reasons.has('ASSIST_OTHER_SITE')) {
    details.push(`ช่วยปฏิบัติงานต่าง Site · Site จริง: ${siteDisplayName(evidence?.actualSite)}`);
  }
  const unclassifiedRisk = [...reasons].some((reason) => reason !== 'ASSIST_OTHER_SITE' && reason !== 'DEVICE_MISMATCH');
  if (unclassifiedRisk || (result.reviewRequired && details.length === 0)) details.push('มีรายการที่ต้องตรวจสอบ');
  return details;
}

function acceptedAttendanceDisplay(result: SimpleEventResult): { tone: StatusTone; message: string } {
  const details = reviewContextDetails(result);
  if (result.event?.punctuality === 'LATE') details.push('มาสาย');
  else if (result.event?.punctuality === 'ON_TIME') details.push('ตรงเวลา');
  if (result.event?.checkoutCondition === 'EARLY_LEAVE') details.push('ออกก่อนเวลา');
  const tone: StatusTone = details.length || result.reviewRequired ? 'warning' : 'success';
  return { tone, message: details.length ? `ลงเวลาสำเร็จ · ${details.join(' · ')}` : 'ลงเวลาสำเร็จ' };
}

function formatReceiptTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return formatThaiDateTime(parsed, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function formatElapsedDuration(startValue?: string | null, endValue = new Date()): string {
  if (!startValue) return '—';
  const start = new Date(startValue);
  const end = endValue instanceof Date ? endValue : new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  const minutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  return `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

function formatCurrentClock(value: Date): string {
  return value.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}

function formatCurrentDate(value: Date): string {
  return formatThaiDateTime(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const SAFE_ATTENDANCE_ERROR_CODES = new Set([
  'ATTENDANCE_CHECK_IN_TOO_EARLY', 'ATTENDANCE_CHECK_IN_LATEST_WINDOW_EXCEEDED', 'ATTENDANCE_CHECK_OUT_TOO_EARLY',
  'ATTENDANCE_CHECK_OUT_LATEST_WINDOW_EXCEEDED', 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE', 'ATTENDANCE_SITE_REQUIRED',
  'ATTENDANCE_ASSIGNMENT_REQUIRED', 'ATTENDANCE_ASSIGNMENT_STALE', 'ATTENDANCE_SCHEDULE_NOT_APPROVED',
  'ATTENDANCE_SHIFT_NOT_ACTIONABLE', 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED', 'ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED',
  'ATTENDANCE_DEVICE_REQUIRED', 'ATTENDANCE_DEVICE_NOT_ALLOWED', 'ATTENDANCE_DEVICE_AUTHORITY_CONFLICT',
  'ATTENDANCE_DEVICE_BOUND_TO_OTHER_EMPLOYEE', 'ATTENDANCE_DEVICE_NOT_ACTIVE', 'INACTIVE_EMPLOYEE_OPERATION',
  'ATTENDANCE_ALREADY_CHECKED_IN', 'ATTENDANCE_ALREADY_CHECKED_OUT', 'ATTENDANCE_CHECK_IN_REQUIRED',
  'ATTENDANCE_SESSION_CLOSED', 'ATTENDANCE_SESSION_STALE', 'ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT',
  'ATTENDANCE_LOCATION_STALE', 'ATTENDANCE_LOCATION_CAPTURED_AT_INVALID', 'ATTENDANCE_SELFIE_PATH_SECRET_WEAK',
  'ATTENDANCE_SELFIE_BUCKET_NOT_PRIVATE', 'ATTENDANCE_SELFIE_STORAGE_NOT_CONFIGURED', 'ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED',
  'ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE',
  'ATTENDANCE_LOCATION_ASSURANCE_INSUFFICIENT', 'ATTENDANCE_DEVICE_PROOF_INVALID', 'ATTENDANCE_DEVICE_SIGNATURE_INVALID',
  'ATTENDANCE_FOREIGN_DEVICE_SELFIE_REQUIRED', 'ATTENDANCE_SELFIE_CHECKSUM_MISMATCH', 'ATTENDANCE_FOREIGN_DEVICE_SELFIE_LIVE_REQUIRED',
  'ATTENDANCE_SELFIE_NONCE_INVALID', 'ATTENDANCE_SELFIE_NONCE_EXPIRED', 'ATTENDANCE_SELFIE_OVERLAY_STALE',
  'ATTENDANCE_OFFLINE_BUNDLE_STALE', 'ATTENDANCE_OFFLINE_SITE_NOT_AUTHORIZED', 'ATTENDANCE_OFFLINE_SITE_INACTIVE'
]);

export function attendanceErrorMessage(code: string | undefined, fallback: string): string {
  if (!code || !SAFE_ATTENDANCE_ERROR_CODES.has(code)) return fallback;
  if (code === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE') return 'ตำแหน่ง GPS อยู่นอกขอบเขต Site ตามกะ แม้ชื่อสถานที่อาจแสดงตรงกัน กรุณาเปิด Precise Location แล้วลองใหม่';
  if (code === 'ATTENDANCE_SITE_REQUIRED') return 'ไม่พบ Site สำหรับกะนี้ กรุณาติดต่อหัวหน้างาน';
  if (code === 'ATTENDANCE_CHECK_IN_REQUIRED') return 'ต้องลงเวลาเข้าก่อนจึงจะลงเวลาออกได้';
  if (code === 'ATTENDANCE_LOCATION_CAPTURED_AT_INVALID') return 'เวลาที่จับตำแหน่ง GPS ไม่ถูกต้อง กรุณาเปิด Location แล้วลองใหม่';
  if (code === 'ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT') return 'ตำแหน่ง GPS ยังไม่แม่นยำพอ กรุณาลองอีกครั้งในบริเวณที่โล่ง';
  if (code === 'ATTENDANCE_LOCATION_STALE') return 'ตำแหน่ง GPS หมดอายุแล้ว กรุณาลองอีกครั้ง';
  if (code === 'ATTENDANCE_SELFIE_NONCE_INVALID' || code === 'ATTENDANCE_SELFIE_NONCE_EXPIRED') return 'ภาพยืนยันหมดอายุ กรุณาถ่ายใหม่';
  if (code === 'ATTENDANCE_SELFIE_STORAGE_UNAVAILABLE') return 'ระบบเก็บภาพยืนยันตัวตนขัดข้องชั่วคราว กรุณาถ่ายภาพใหม่แล้วลองอีกครั้ง';
  if (code.startsWith('ATTENDANCE_SELFIE_')) return 'ระบบเก็บภาพยืนยันตัวตนยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ';
  return fallback;
}

export function attendanceFailure(reason: unknown, fallback: string): AttendanceSimpleErrorDetails {
  const normalized = toRequestErrorState(reason, fallback);
  const readRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const source = readRecord(reason);
  const response = readRecord(source.response);
  const responseData = readRecord(response.data);
  const data = readRecord(source.data);
  const body = readRecord(source.body);
  const nested = [source.error, responseData.error, data.error, body.error].map(readRecord);
  const code = [source.code, responseData.code, data.code, body.code, ...nested.map((item) => item.code)]
    .find((value): value is string => typeof value === 'string' && SAFE_ATTENDANCE_ERROR_CODES.has(value));
  const requestId = [normalized.requestId, source.requestId, responseData.requestId, data.requestId, body.requestId, ...nested.map((item) => item.requestId)]
    .map((value) => normalizeRequestId(value))
    .find((value): value is string => Boolean(value));
  const message = attendanceErrorMessage(code, /[\u0E00-\u0E7F]/.test(normalized.message) ? normalized.message : fallback);
  return {
    message,
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {})
  };
}

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function platformHint(): string {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios ? (standalone ? 'iOS Home Screen PWA' : 'iOS Safari') : standalone ? 'Installed PWA' : 'Web';
}

function getLocation(): Promise<{ latitude: number; longitude: number; accuracyMeters: number; capturedAt: string }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('อุปกรณ์นี้ไม่รองรับ GPS'));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        capturedAt: new Date(position.timestamp || Date.now()).toISOString()
      }),
      (error) => reject(new Error(error.code === 1 ? 'กรุณาอนุญาต Location ก่อนลงเวลา' : 'ยังอ่านตำแหน่งไม่ได้ กรุณาลองอีกครั้ง')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }
    );
  });
}

async function signedEvent(identity: DeviceIdentity, base: Omit<SimpleEventInput, 'device'>): Promise<SimpleEventInput> {
  const signals = deviceRiskSignals();
  const deviceBase = {
    publicKeySpkiBase64: identity.publicKeySpkiBase64,
    keyAlgorithm: identity.keyAlgorithm,
    displayName: 'อุปกรณ์ลงเวลา',
    platformHint: platformHint(),
    signals
  };
  const payload: Record<string, unknown> = {
    version: 'SMS_ATTENDANCE_SIMPLE_EVENT_V1',
    captureId: base.captureId,
    eventIntent: base.eventIntent,
    shiftAssignmentId: base.shiftAssignmentId,
    capturedAt: new Date(base.capturedAt).toISOString(),
    location: {
      latitude: Number(base.location.latitude),
      longitude: Number(base.location.longitude),
      accuracyMeters: Number(base.location.accuracyMeters),
      capturedAt: new Date(base.location.capturedAt).toISOString()
    },
    publicKeySpkiBase64: identity.publicKeySpkiBase64,
    keyAlgorithm: identity.keyAlgorithm,
    deviceSignals: signals,
    offlineBundleHash: base.offlineBundle ? await sha256Hex(base.offlineBundle) : null
  };
  if (base.selfie || base.selfieNonce) {
    payload.selfieNonce = base.selfieNonce || null;
    payload.selfieChecksum = base.selfie?.checksum || (base.selfie?.base64 ? await sha256Hex(base.selfie.base64) : null);
    payload.selfieCaptureMode = base.selfie?.captureMode || null;
    payload.selfieOverlayCapturedAt = base.selfie?.overlay?.capturedAt ? new Date(base.selfie.overlay.capturedAt).toISOString() : null;
  };
  return {
    ...base,
    device: { ...deviceBase, signatureBase64: await signPayload(identity, payload) }
  };
}

export function AttendanceSimplePage({
  token,
  displayName,
  department,
  readOnly = false,
  online = navigator.onLine,
  onTodayHistory,
  onOpenSettings,
  onOpenAttendanceDevice,
  onOpenSupervisor
}: Props) {
  const [bootstrap, setBootstrap] = useState<SimpleBootstrap | null>(null);
  const [selectedAction, setSelectedAction] = useState<SimpleEventInput['eventIntent'] | null>(null);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [syncPhase, setSyncPhase] = useState<'idle' | 'sending' | 'done' | 'late'>('idle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('กำลังเตรียมระบบลงเวลา…');
  const [tone, setTone] = useState<StatusTone>('neutral');
  const [lastResult, setLastResult] = useState<SimpleEventResult | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [siteContext, setSiteContext] = useState<DisplaySiteContext | null>(null);
  const [pendingSiteCapture, setPendingSiteCapture] = useState<{
    location: Awaited<ReturnType<typeof getLocation>>;
    context: NonNullable<ReturnType<typeof gpsGeofenceDecision>['actualSite']>;
    selfie?: SimpleEventInput['selfie'] | null;
    selfieNonce?: string | null;
    nonceIssuedAt?: string | null;
  } | null>(null);

  const [bootstrapRetry, setBootstrapRetry] = useState(0);
  const [requestErrorCode, setRequestErrorCode] = useState<string>();
  const [requestErrorId, setRequestErrorId] = useState<string>();
  const [selfie, setSelfie] = useState<SimpleEventInput['selfie'] | null>(null);
  const [selfieNonce, setSelfieNonce] = useState<string | null>(null);
  const [nonceIssuedAt, setNonceIssuedAt] = useState<string | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<SimpleEventInput['selfie'] | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const queueSyncInFlight = useRef(false);
  const [lastFix, setLastFix] = useState<{ latitude: number; longitude: number; accuracyMeters: number } | null>(null);
  const cameraOpeningRef = useRef(false);
  const cameraRequestRef = useRef(0);

  const refreshQueueCount = useCallback(async () => {
    setQueueCount(await encryptedQueueCount().catch(() => 0));
  }, []);

  const loadBootstrap = useCallback(async (deviceFingerprintOverride?: string | null) => {
    if (online && token) {
      const fresh = await simpleAttendanceBootstrap(token, deviceFingerprintOverride);
      await storeEncryptedBootstrap(fresh);
      setBootstrap(fresh);
      return fresh;
    }
    const cached = await readEncryptedBootstrap<SimpleBootstrap>();
    if (!cached) throw new Error('ยังไม่มีสิทธิ์ Offline ที่บันทึกไว้ กรุณาเปิดระบบขณะออนไลน์อย่างน้อยหนึ่งครั้ง');
    const expiresAt = new Date(cached.offline.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || Date.now() > expiresAt.getTime()) {
      throw new Error('สิทธิ์ Offline หมดอายุ กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่ออัปเดต');
    }
    setBootstrap(cached);
    return cached;
  }, [online, token]);

  const syncQueue = useCallback(async () => {
    if (!online || !token || queueSyncInFlight.current) return;
    queueSyncInFlight.current = true;
    try {
      const rows = await listEncryptedQueue<SimpleEventInput>();
      if (rows.length) setSyncPhase('sending');
      for (const row of rows) {
        let acknowledged = false;
        try {
          const result = await simpleAttendanceSubmit(token, row.value);
          if (result.counted || result.status === 'PENDING_CONFIRMATION') {
            acknowledged = true;
            setBootstrap(null);
            const fresh = await simpleAttendanceBootstrap(token, fingerprint);
            await storeEncryptedBootstrap(fresh);
            setBootstrap(fresh);
            setSelectedAction(fresh.eventIntent);
            await removeQueued(row.captureId);
            setLastResult(result);
            const evidence = result.event?.locationEvidence || result.pendingEvent?.locationEvidence;
            if (evidence?.assignedSite) setSiteContext({ assignedSite: evidence.assignedSite, actualSite: evidence.actualSite || null, workSiteContext: evidence.workSiteContext || 'ASSIGNED_SITE' });
            setSyncPhase(result.status === 'PENDING_CONFIRMATION' ? 'late' : 'done');
            if (result.status === 'PENDING_CONFIRMATION') {
              setTone('warning');
              const details = reviewContextDetails(result, evidence);
              const contextMessage = details.length ? `${details.join(' · ')} · ` : '';
              setMessage(`${contextMessage}ส่งรายการ Offline แล้ว แต่ส่งช้าเกินกำหนด · รอ ADMIN ยืนยันก่อนนับ`);
            } else {
              const accepted = acceptedAttendanceDisplay(result);
              setTone(accepted.tone);
              setMessage(`ส่งรายการ Offline แล้ว · ${accepted.message}`);
            }
          }
        } catch {
          if (acknowledged) {
            setBootstrap(null);
            setTone('warning');
            setMessage('ส่งรายการแล้ว แต่ยังตรวจสถานะล่าสุดไม่สำเร็จ · จะลองอีกครั้งเมื่อเชื่อมต่อ');
          }
          break;
        }
      }
    } finally {
      queueSyncInFlight.current = false;
      await refreshQueueCount();
    }
  }, [online, token, refreshQueueCount]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const nextIdentity = await ensureDeviceIdentity();
        if (!active) return;
        setIdentity(nextIdentity);
        setFingerprint(await deviceFingerprint(nextIdentity));
        await refreshQueueCount();
        const nextFingerprint = await deviceFingerprint(nextIdentity);
        setFingerprint(nextFingerprint);
        const nextBootstrap = await loadBootstrap(nextFingerprint);
        if (!active) return;
        setBootstrap(nextBootstrap);
        setSelectedAction(nextBootstrap.eventIntent);
        setRequestErrorCode(undefined);
        setRequestErrorId(undefined);
        setTone(online ? 'success' : 'warning');
        setMessage(online ? 'พร้อมลงเวลา · ระบบจะตรวจตำแหน่งก่อนบันทึก' : 'ออฟไลน์พร้อมใช้งาน · ระบบจะเก็บรายการในเครื่องและส่งเมื่อออนไลน์');
        if (online && token) await syncQueue();
      } catch (error) {
        if (!active) return;
        const failure = attendanceFailure(error, 'ไม่สามารถเตรียมระบบลงเวลาได้ กรุณาลองใหม่หรือติดต่อหัวหน้างาน');
        setRequestErrorCode(failure.code);
        setRequestErrorId(failure.requestId);
        setTone('danger');
        setMessage(failure.message);
      }
    })();
    return () => { active = false; };
  }, [bootstrapRetry, loadBootstrap, online, refreshQueueCount, syncQueue, token]);

  useEffect(() => {
    const onOnline = () => { if (token) void syncQueue(); };
    window.addEventListener('online', onOnline);
    const onVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine && token) void syncQueue(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [syncQueue, token]);

  const bindingState = useMemo(() => {
    if (!bootstrap || !fingerprint) return 'UNKNOWN';
    if (!bootstrap.activeDevice) return 'AUTO_BIND';
    return bootstrap.activeDevice.credentialFingerprint === fingerprint ? 'PRIMARY' : 'FOREIGN';
  }, [bootstrap, fingerprint]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play();
    }
  }, [cameraOpen]);

  useEffect(() => {
    const modalOpen = cameraOpen || Boolean(selfiePreview);
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [cameraOpen, selfiePreview]);

  useEffect(() => () => {
    cameraRequestRef.current += 1;
    stopCamera();
  }, [stopCamera]);

  const openSelfieCamera = useCallback(async () => {
    if (cameraOpeningRef.current || cameraOpen || busy) return;
    cameraOpeningRef.current = true;
    const requestToken = ++cameraRequestRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraOpeningRef.current = false;
      setTone('danger'); setMessage('เบราว์เซอร์นี้ไม่รองรับกล้องหน้า'); return;
    }
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false });
      if (requestToken !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch (error) {
      if (requestToken !== cameraRequestRef.current) return;
      stopCamera(); setCameraOpen(false); setTone('danger');
      setMessage(error instanceof DOMException && error.name === 'NotAllowedError' ? 'กรุณาอนุญาตกล้องหน้าเพื่อยืนยันตัวตน' : 'ไม่สามารถเปิดกล้องหน้าได้ กรุณาลองใหม่');
    } finally {
      cameraOpeningRef.current = false;
    }
  }, [busy, cameraOpen, stopCamera]);

  const recordAttendance = async (capturedSelfie = selfie, capturedSelfieNonce = selfieNonce) => {
    if (bootstrap?.selfiePolicy?.required && !online) {
      setTone('danger');
      setMessage('บทบาทนี้ต้องเชื่อมต่ออินเทอร์เน็ตก่อนลงเวลาเข้า/ออกด้วยเซลฟี่');
      return;
    }

    const pendingSelfie = pendingSiteCapture?.selfie || null;
    const pendingNonce = pendingSiteCapture?.selfieNonce || null;
    const pendingNonceAge = pendingSiteCapture?.nonceIssuedAt
      ? Date.now() - new Date(pendingSiteCapture.nonceIssuedAt).getTime()
      : nonceIssuedAt
        ? Date.now() - new Date(nonceIssuedAt).getTime()
        : 0;
    if (pendingSelfie && pendingNonce && pendingNonceAge > 110000) {
      setPendingSiteCapture((current) => current ? { ...current, selfie: null, selfieNonce: null, nonceIssuedAt: null } : current);
      setSelfie(null); setSelfieNonce(null);
      setTone('warning'); setMessage('ภาพยืนยันหมดอายุ (เกิน 2 นาที) กรุณาถ่ายใหม่');
      await openSelfieCamera();
      return;
    }
    const effectiveSelfie = capturedSelfie || pendingSelfie;
    const effectiveNonce = capturedSelfieNonce || pendingNonce;
    if (bootstrap?.selfiePolicy?.required && !effectiveSelfie) { await openSelfieCamera(); return; }
    if (readOnly || busy || !identity || !bootstrap) return;
    setBusy(true);
    setLastResult(null);
    setRequestErrorCode(undefined);
    setRequestErrorId(undefined);
    setTone('neutral');
    setMessage('กำลังตรวจ GPS/GEOFENCE…');
    let submissionStarted = false;
    try {
      const pendingAgeMs = pendingSiteCapture ? Date.now() - new Date(pendingSiteCapture.location.capturedAt).getTime() : Infinity;
      const reusePending = pendingSiteCapture !== null && pendingAgeMs >= 0 && pendingAgeMs <= 180000;
      const location = reusePending ? pendingSiteCapture.location : await getLocation();
      setLastFix({ latitude: location.latitude, longitude: location.longitude, accuracyMeters: location.accuracyMeters });
      const localDecision = gpsGeofenceDecision(bootstrap.assignment.site, location, bootstrap.eligibleSites || []);
      if (!online && localDecision.classification === 'CONFIDENT_OUTSIDE') {
        throw new Error('อยู่นอก GEOFENCE ของทุก Site ที่อนุญาต · ไม่บันทึกเวลา');
      }
      if (!reusePending && localDecision.workSiteContext === 'SUPPORT_SITE' && localDecision.actualSite) {
        setSiteContext({ assignedSite: { id: localDecision.assignedSite.id, code: localDecision.assignedSite.code, name: localDecision.assignedSite.name || '' },
          actualSite: localDecision.actualSite ? { id: localDecision.actualSite.id, code: localDecision.actualSite.code, name: localDecision.actualSite.name || '' } : null,
          workSiteContext: localDecision.workSiteContext });
        setPendingSiteCapture({ location, context: localDecision.actualSite, selfie: capturedSelfie, selfieNonce: capturedSelfieNonce, nonceIssuedAt: capturedSelfie ? new Date().toISOString() : null });
        setTone('warning');
        setMessage(`พบตำแหน่งที่ ${siteDisplayName(localDecision.actualSite)} · ต่างจาก Site ตามตาราง · ระบบจะเก็บ Site จริงไว้และส่งรายการให้ตรวจ · กดอีกครั้งเพื่อยืนยัน`);
        return;
      }
      setPendingSiteCapture(null);
      setSiteContext({ assignedSite: { id: localDecision.assignedSite.id, code: localDecision.assignedSite.code, name: localDecision.assignedSite.name || '' },
        actualSite: localDecision.actualSite ? { id: localDecision.actualSite.id, code: localDecision.actualSite.code, name: localDecision.actualSite.name || '' } : null,
        workSiteContext: localDecision.workSiteContext });
      const capturedAt = new Date().toISOString();
      const offlineBundle = online && token ? null : bootstrap.offline.bundle;
      const input = await signedEvent(identity, {
        captureId: uuid(),
        eventIntent: selectedAction || bootstrap.eventIntent,
        shiftAssignmentId: bootstrap.assignment.id,
        capturedAt,
        location,
        offlineBundle,
        ...(effectiveSelfie ? { selfie: effectiveSelfie, selfieNonce: effectiveNonce } : {})
      });

      submissionStarted = true;
      if (!online || !token) {
        const maxAccuracy = Number(bootstrap.offline.maxAccuracyMeters || 0);
        if (maxAccuracy > 0 && location.accuracyMeters > maxAccuracy) throw new Error('GPS accuracy ยังไม่ดีพอสำหรับการลงเวลา Offline');
        await enqueueEncrypted(input);
        await refreshQueueCount();
        const next: SimpleBootstrap = {
          ...bootstrap,
          eventIntent: bootstrap.eventIntent === 'CHECK_IN' ? 'CHECK_OUT' : 'CHECK_IN'
        };
        await storeEncryptedBootstrap(next);
        setBootstrap(next);
        setSelectedAction(next.eventIntent);
        setTone(localDecision.classification === 'BORDERLINE' ? 'warning' : 'success');
        const siteMessage = localDecision.workSiteContext === 'SUPPORT_SITE'
          ? `ช่วยปฏิบัติงานต่าง Site · Site จริง: ${siteDisplayName(localDecision.actualSite)} · `
          : '';
        setMessage(localDecision.classification === 'BORDERLINE'
          ? `${siteMessage}เก็บรายการในเครื่องแล้ว · ตำแหน่งอยู่ใกล้ขอบพื้นที่และจะถูกตรวจเมื่อส่ง`
          : `${siteMessage}เก็บรายการในเครื่องแล้ว · จะส่งอัตโนมัติเมื่อกลับมาออนไลน์`);
        return;
      }

      const result = await simpleAttendanceSubmit(token, input);
      setLastResult(result);
      if (result.status === 'PENDING_CONFIRMATION') {
        setTone('warning');
        const evidence = result.pendingEvent?.locationEvidence;
        if (evidence?.assignedSite) setSiteContext({ assignedSite: evidence.assignedSite, actualSite: evidence.actualSite || null, workSiteContext: evidence.workSiteContext || 'ASSIGNED_SITE' });
        const details = reviewContextDetails(result, evidence);
        const contextMessage = details.length ? `${details.join(' · ')} · ` : '';
        setMessage(`${contextMessage}รายการ Offline ต้องให้ ADMIN ยืนยันก่อนนับ`);
      } else {
        const accepted = acceptedAttendanceDisplay(result);
        setTone(accepted.tone);
        const evidence = result.event?.locationEvidence;
        if (evidence?.assignedSite) setSiteContext({ assignedSite: evidence.assignedSite, actualSite: evidence.actualSite || null, workSiteContext: evidence.workSiteContext || 'ASSIGNED_SITE' });
        setMessage(accepted.message);
      }
      if (result.counted) {
        try {
          const fresh = await simpleAttendanceBootstrap(token, fingerprint);
          await storeEncryptedBootstrap(fresh);
          setBootstrap(fresh);
        } catch {
          // Shift can be complete after CHECK_OUT; keep the accepted result visible.
        }
      }
    } catch (error) {
      if (submissionStarted) setPendingSiteCapture(null);
      // A local site context is not backend acceptance evidence when submission fails.
      setSiteContext(null);
      const failure = attendanceFailure(error, 'ไม่สามารถลงเวลาได้ กรุณาลองใหม่หรือติดต่อหัวหน้างาน');
      setRequestErrorCode(failure.code);
      setRequestErrorId(failure.requestId);
      setTone('danger');
      setMessage(failure.message);
    } finally {
      setBusy(false);
      if (submissionStarted) {
        setPendingSiteCapture(null);
        setSelfie(null);
        setSelfieNonce(null);
      }
    }
  };

  const captureSelfie = async () => {
    if (!token || !videoRef.current || !canvasRef.current || busy) return;
    setBusy(true);
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const scale = Math.min(1, ATTACHMENT_POLICIES.ATTENDANCE_FACE.maxEdge / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('ไม่สามารถเตรียมภาพสดได้');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const location = await getLocation();
      const decision = gpsGeofenceDecision(bootstrap!.assignment.site, location, bootstrap?.eligibleSites || []);
      paintAttendanceSelfieStamp(context, canvas.width, canvas.height, {
        employeeName,
        employeeCode: bootstrap?.employee.employeeCode || '',
        action: selectedAction || bootstrap?.eventIntent || 'CHECK_IN',
        capturedAt: new Date(),
        siteName: decision.actualSite?.name || decision.assignedSite?.name || 'นอก Active Site',
        supportSite: decision.workSiteContext === 'SUPPORT_SITE',
        accuracyMeters: location.accuracyMeters,
        reference: uuid().slice(0, 8)
      });
      stopCamera();
      setCameraOpen(false);
      const blob = await canvasToOptimizedJpeg(canvas, 'ATTENDANCE_FACE');
      const checksum = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('อ่านภาพสดไม่สำเร็จ'));
        reader.readAsDataURL(blob);
      });
      const capturedAt = new Date().toISOString();
      const nextSelfie = { mimeType: 'image/jpeg' as const, base64, checksum, captureMode: 'LIVE_CAMERA' as const, overlay: { capturedAt } };
      setSelfiePreview(nextSelfie);
      setTone('neutral'); setMessage('ตรวจสอบภาพตัวอย่างและเลือกใช้ภาพนี้ หรือถ่ายใหม่');
    } catch (error) {
      setTone('danger'); setMessage(error instanceof Error ? error.message : 'ถ่ายภาพยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      stopCamera();
      setBusy(false);
    }
  };

  const useSelfiePreview = async () => {
    if (!selfiePreview || !token) return;
    setBusy(true);
    try {
      const challenge = await simpleAttendanceSelfieProof(token);
      setSelfie(selfiePreview); setSelfieNonce(challenge.nonce); setNonceIssuedAt(new Date().toISOString()); setSelfiePreview(null);
      await recordAttendance(selfiePreview, challenge.nonce);
    } finally {
      setBusy(false);
    }
  };

  const retakeSelfie = () => {
    setSelfiePreview(null); setSelfie(null); setSelfieNonce(null); setNonceIssuedAt(null);
    void openSelfieCamera();
  };

  const employeeName = bootstrap?.employee.displayName || displayName || 'พนักงาน';
  const pwaMode = useMemo(() => isSmsPwaShellMode(), []);
  const firstName = String(bootstrap?.employee.firstName || employeeName.split(/\s+/)[0] || employeeName);
  const employeeInitials = employeeName.trim().split(/\s+/).slice(0, 2).map((part) => (/^[เแโใไ]/.test(part) ? part.slice(1, 2) : part.slice(0, 1))).join('');
  const greetingHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Bangkok' }).format(currentTime));
  const greeting = greetingHour < 12 ? 'สวัสดีตอนเช้า' : greetingHour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const shiftText = bootstrap
    ? `${bootstrap.assignment.shift.code || ''} ${bootstrap.assignment.shift.startTime || ''}–${bootstrap.assignment.shift.endTime || ''}`.trim()
    : '—';
  const nextActionLabel = bootstrap?.eventIntent === 'CHECK_OUT' ? 'ลงเวลาออก' : 'ลงเวลาเข้า';
  const selectedActionLabel = (selectedAction || bootstrap?.eventIntent) === 'CHECK_OUT' ? 'ลงเวลาออก' : 'ลงเวลาเข้า';
  const selfieRequired = Boolean(bootstrap?.selfiePolicy?.required);
  const selfieStepLabel = selfiePreview
    ? 'ตรวจสอบภาพตัวอย่างก่อนยืนยัน'
    : selfie
      ? 'ยืนยันภาพแล้ว · รอส่งพร้อม Nonce จาก Server'
      : 'ถ่าย Selfie พร้อมข้อมูลกำกับ';
  const nowLabel = !bootstrap
    ? 'กำลังเตรียมระบบลงเวลา'
    : bootstrap.eventIntent === 'CHECK_OUT'
      ? 'ลงเวลาเข้าแล้ว · กำลังปฏิบัติงาน'
      : 'พร้อมลงเวลาเข้า';
  const attentionItems: string[] = [];
  if (pendingSiteCapture) {
    attentionItems.push(`ช่วยปฏิบัติงานต่าง Site · พบตำแหน่งที่ ${siteDisplayName(pendingSiteCapture.context)}`);
  } else if (siteContext?.workSiteContext === 'SUPPORT_SITE') {
    attentionItems.push(`ช่วยปฏิบัติงานต่าง Site · Site จริง: ${siteDisplayName(siteContext.actualSite)}`);
  }
  if (queueCount > 0) attentionItems.push(`มี ${queueCount} รายการรอส่งเมื่อออนไลน์`);

  const receiptEvent = lastResult?.counted ? lastResult.event : null;
  const receiptEvidence = receiptEvent?.locationEvidence;
  const receiptTime = formatReceiptTime(receiptEvent?.effectiveEventAt || receiptEvent?.receivedAt);
  const receiptSite = siteDisplayName(receiptEvidence?.actualSite || receiptEvidence?.assignedSite || siteContext?.actualSite || siteContext?.assignedSite);
  const receiptTitle = receiptEvent?.eventType === 'CHECK_OUT' ? 'ลงเวลาออกสำเร็จ' : 'ลงเวลาเข้าสำเร็จ';
  const checkInTime = receiptEvent?.eventType === 'CHECK_IN' ? formatReceiptTime(receiptEvent.effectiveEventAt || receiptEvent.receivedAt) : '—';
  const workedDuration = receiptEvent?.eventType === 'CHECK_IN'
    ? formatElapsedDuration(receiptEvent.effectiveEventAt || receiptEvent.receivedAt, currentTime)
    : '—';
  const receiptDevice = 'Telemetry บันทึกแล้ว';
  const [dismissedReceiptId, setDismissedReceiptId] = useState<string>();
  const [permTab, setPermTab] = useState<'ios' | 'android'>(() => (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent) ? 'android' : 'ios'));
  const offlineExpiry = bootstrap?.offline?.expiresAt ? new Date(bootstrap.offline.expiresAt) : null;
  const offlineValid = Boolean(offlineExpiry && !Number.isNaN(offlineExpiry.getTime()) && offlineExpiry.getTime() > currentTime.getTime());
  const offlineUntil = offlineExpiry && offlineValid ? formatThaiDateTime(offlineExpiry, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const receiptKey = receiptEvent ? String(receiptEvent.id || receiptEvent.effectiveEventAt || receiptEvent.receivedAt || 'receipt') : '';
  const showReceiptSheet = pwaMode && Boolean(receiptEvent) && dismissedReceiptId !== receiptKey;
  const receiptPunctuality = receiptEvent?.punctuality || lastResult?.timeClassification?.punctuality;
  const receiptCheckout = receiptEvent?.checkoutCondition || lastResult?.timeClassification?.checkoutCondition;
  const receiptTimingLabel = receiptCheckout === 'EARLY_LEAVE' ? 'ออกก่อนเวลา' : receiptPunctuality === 'LATE' ? 'มาสาย' : receiptPunctuality === 'ON_TIME' || receiptCheckout === 'NORMAL' ? 'ตรงเวลา' : '';
  const receiptSupport = receiptEvidence?.workSiteContext === 'SUPPORT_SITE';
  const receiptServerTime = (() => { const value = receiptEvent?.effectiveEventAt || receiptEvent?.receivedAt; if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Bangkok' }); })();
  const receiptDetails = lastResult ? reviewContextDetails(lastResult) : [];
  const accountBlockCodes = ['ATTENDANCE_EMPLOYEE_LINK_REQUIRED', 'ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED', 'INACTIVE_EMPLOYEE_OPERATION'];
  const scheduleBlockCodes = ['ATTENDANCE_ASSIGNMENT_REQUIRED', 'ATTENDANCE_SCHEDULE_NOT_APPROVED', 'ATTENDANCE_SHIFT_NOT_ACTIONABLE'];
  const clockBlockedByServer = [...accountBlockCodes, ...scheduleBlockCodes].includes(requestErrorCode || '');
  const clockDisabled = readOnly || busy || !identity || !bootstrap || clockBlockedByServer;
  const disabledGuidance = readOnly
    ? { message: 'โหมดดูแทนไม่สามารถลงเวลาได้ กรุณาออกจากโหมดดูแทนก่อนลงเวลา' }
    : busy
      ? { message: 'กำลังตรวจตำแหน่งหรือบันทึกรายการ กรุณารอให้เสร็จก่อน' }
      : accountBlockCodes.includes(requestErrorCode || '')
        ? { message: message || 'บัญชีนี้ยังไม่พร้อมสำหรับการลงเวลา กรุณาติดต่อผู้ดูแลระบบ' }
        : scheduleBlockCodes.includes(requestErrorCode || '')
            ? { message: message || 'ตารางกะยังไม่พร้อม กรุณาติดต่อหัวหน้างาน', actionLabel: onOpenSupervisor ? 'เปิดหน้าติดตามการลงเวลา' : undefined, action: onOpenSupervisor }
            : !identity
              ? tone === 'danger'
                ? { message: onOpenAttendanceDevice ? 'อุปกรณ์นี้ยังไม่พร้อมสำหรับการยืนยัน กรุณาลองใหม่หรือตรวจสอบอุปกรณ์ลงเวลา' : 'อุปกรณ์นี้ยังไม่พร้อมสำหรับการยืนยัน ลองปิดแล้วเปิดแอปใหม่ ถ้ายังไม่ได้ แจ้งหัวหน้างานพร้อมรหัสอ้างอิงด้านล่าง', actionLabel: onOpenAttendanceDevice ? 'เปิดอุปกรณ์ลงเวลา' : undefined, action: onOpenAttendanceDevice }
                : { message: 'กำลังเตรียมอุปกรณ์สำหรับการลงเวลา กรุณารอสักครู่' }
              : !bootstrap
                ? tone === 'danger'
                  ? { message: message || 'ยังอ่านข้อมูลกะงานไม่ได้ กรุณาลองใหม่', actionLabel: 'ลองโหลดข้อมูลอีกครั้ง', action: () => {
                    setBootstrap(null);
                    setRequestErrorCode(undefined);
                    setRequestErrorId(undefined);
                    setTone('neutral');
                    setMessage('กำลังเตรียมระบบลงเวลา…');
                    setBootstrapRetry((value) => value + 1);
                  } }
                  : { message: 'กำลังโหลดข้อมูลกะงาน กรุณารอสักครู่' }
                : null;

  const blockedByServer = clockBlockedByServer && !busy;
  const outsideGap = (() => {
    const site = bootstrap?.assignment.site;
    if (!lastFix || !site || !Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) return null;
    const rad = Math.PI / 180;
    const dLat = (lastFix.latitude - site.latitude) * rad;
    const dLng = (lastFix.longitude - site.longitude) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(site.latitude * rad) * Math.cos(lastFix.latitude * rad) * Math.sin(dLng / 2) ** 2;
    const meters = 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
    const gap = meters - (Number(site.geofenceRadiusMeters) || 0);
    return gap > 0 ? Math.round(gap / 10) * 10 : null;
  })();
  const locationDenied = tone === 'danger' && message.startsWith('กรุณาอนุญาต Location');
  const scheduleBlocked = scheduleBlockCodes.includes(requestErrorCode || '');
  const shiftWindow = (() => {
    const shift = bootstrap?.assignment.shift;
    const day = bootstrap?.assignment.workDate ? String(bootstrap.assignment.workDate).slice(0, 10) : '';
    if (!shift?.startTime || !shift?.endTime || !day) return null;
    const start = new Date(`${day}T${shift.startTime}:00+07:00`);
    let end = new Date(`${day}T${shift.endTime}:00+07:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86_400_000);
    const ratio = Math.min(1, Math.max(0, (currentTime.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
    return { ratio, startLabel: shift.startTime, endLabel: shift.endTime };
  })();
  const shiftCompleted = pwaMode && receiptEvent?.eventType === 'CHECK_OUT' && !showReceiptSheet;
  const working = pwaMode && !shiftCompleted && (selectedAction || bootstrap?.eventIntent) === 'CHECK_OUT';
  const rootState = [pwaMode && tone === 'danger' && !clockDisabled ? 'is-failed' : '', pwaMode && blockedByServer ? 'is-blocked' : '', working ? 'is-working' : '', shiftCompleted ? 'is-complete' : '', pwaMode && busy ? 'is-busy' : ''].filter(Boolean).join(' ');
  return <section className={`attendance-simple layout-page-surface${rootState ? ` ${rootState}` : ''}`} aria-label="ลงเวลา">
    {selfiePreview && <div role="dialog" aria-modal="true" aria-label="ตรวจสอบภาพเซลฟี่" className="attendance-simple__camera-modal">
      <div className="attendance-simple__camera-panel">
        <h2>ตรวจสอบภาพก่อนส่ง</h2>
        <img className="attendance-simple__camera-preview" src={`data:image/jpeg;base64,${selfiePreview.base64}`} alt="ภาพตัวอย่างพร้อมข้อมูลกำกับ" />
        <ul className="attendance-simple__camera-checks"><li>เห็นใบหน้าชัด ไม่ถูกบัง</li><li>ภาพนี้ใช้ได้ช่วงเวลาสั้น ๆ หลังจากนั้นต้องถ่ายใหม่</li></ul>
        <div className="attendance-simple__camera-actions">
          <button type="button" onClick={retakeSelfie} disabled={busy}>ถ่ายใหม่</button>
          <button type="button" onClick={() => void useSelfiePreview()} disabled={busy}>ใช้ภาพนี้</button>
        </div>
      </div>
    </div>}
    {cameraOpen && <div role="dialog" aria-modal="true" aria-label="ถ่ายภาพยืนยันตัวตน" className="attendance-simple__camera-modal">
      <div className="attendance-simple__camera-panel">
        <h2>ยืนยันตัวตนด้วยเซลฟี่สด</h2>
        <div className="attendance-simple__camera-frame">
          <video ref={videoRef} autoPlay playsInline muted aria-label="กล้องหน้า" />
          <span className="attendance-simple__camera-oval" aria-hidden="true" />
        </div>
        <p className="attendance-simple__camera-hint">จัดหน้าให้อยู่ในกรอบ · แสงพอ · ไม่สวมแว่นดำ</p>
        <canvas ref={canvasRef} hidden />
        <div className="attendance-simple__camera-actions">
          <button type="button" className="attendance-simple__camera-capture" onClick={() => void captureSelfie()} disabled={busy} aria-label="ถ่ายภาพยืนยันตัวตน" title="ถ่ายภาพยืนยันตัวตน">
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M4 8.5h3l1.4-2h5.2l1.4 2h3A1.5 1.5 0 0 1 19.5 10v8A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18v-8A1.5 1.5 0 0 1 4 8.5Z"/><circle cx="12" cy="14" r="3.2"/></svg>
          </button>
          <button type="button" className="attendance-simple__camera-cancel" aria-label="ยกเลิกการถ่ายภาพ" title="ยกเลิกการถ่ายภาพ" onClick={() => { cameraRequestRef.current += 1; stopCamera(); setCameraOpen(false); }} disabled={busy}>
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="m7 7 10 10M17 7 7 17"/></svg>
          </button>
        </div>
      </div>
    </div>}
    {pwaMode && <section className="attendance-simple__mobile" aria-label="สรุปพร้อมลงเวลา">
      <header className="attendance-simple__greet">
        <span className="attendance-simple__greet-avatar" aria-hidden="true">{employeeInitials}</span>
        <div><strong>{greeting}, {firstName}</strong><small>{formatCurrentDate(currentTime)} · {department || bootstrap?.employee.department || '—'}</small></div>
        <span className={`attendance-simple__net ${online ? 'is-online' : 'is-offline'}`}>{online ? 'ออนไลน์' : 'ออฟไลน์'}</span>
      </header>
      {!online && <article className="attendance-simple__offline-card">
        <SmsIcon name="refresh" size={18} />
        <div>
          <strong>{offlineValid ? 'ไม่มีอินเทอร์เน็ต · ยังลงเวลาได้' : 'ไม่มีอินเทอร์เน็ต'}</strong>
          <small>{offlineValid ? 'เก็บในเครื่องแบบเข้ารหัส ส่งให้อัตโนมัติเมื่อออนไลน์' : 'สิทธิ์ออฟไลน์หมดอายุ ต้องเชื่อมต่ออินเทอร์เน็ตก่อนลงเวลา'}</small>
          {offlineValid && offlineUntil && <b>สิทธิ์ออฟไลน์ใช้ได้ถึง {offlineUntil}</b>}
        </div>
      </article>}
      {bindingState === 'FOREIGN' && <article className="attendance-simple__offline-card is-device">
        <SmsIcon name="device" size={18} />
        <div>
          <strong>อุปกรณ์นี้ไม่ใช่เครื่องหลักของคุณ</strong>
          <small>ลงเวลาได้ แต่รายการจะถูกติดธงส่งให้ Admin ตรวจ ถ้าเปลี่ยนเครื่องถาวร ให้แจ้ง Admin ย้ายเครื่องหลักให้</small>
        </div>
      </article>}
      {(queueCount > 0 || syncPhase !== 'idle') && <article className="attendance-simple__sync" aria-label="รายการที่บันทึกตอนออฟไลน์">
        <strong>รายการที่บันทึกตอนออฟไลน์</strong>
        <small>ส่งให้อัตโนมัติเมื่อกลับมาออนไลน์หรือเปิดแอป</small>
        <ol>
          <li className="is-done"><b /><div><strong>เก็บในเครื่องแล้ว</strong><small>เข้ารหัสในเครื่องนี้ · {queueCount} รายการรอส่ง</small></div></li>
          <li className={syncPhase === 'sending' ? 'is-current' : syncPhase === 'done' || syncPhase === 'late' ? 'is-done' : ''}><b /><div><strong>กำลังส่ง</strong><small>{online ? (syncPhase === 'sending' ? 'ออนไลน์แล้ว · กำลังส่ง' : syncPhase === 'idle' ? 'รอส่ง' : 'ส่งแล้ว') : 'รอสัญญาณอินเทอร์เน็ต'}</small></div></li>
          <li className={syncPhase === 'done' ? 'is-done' : syncPhase === 'late' ? 'is-warn' : ''}><b /><div><strong>เซิร์ฟเวอร์รับแล้ว</strong><small>{syncPhase === 'done' ? 'นับเวลาแล้ว' : syncPhase === 'late' ? 'ส่งช้าเกินกำหนด · รอ ADMIN ยืนยันก่อนนับ' : 'นับเวลาแล้ว · หรือ “รอผู้ดูแลยืนยัน” ถ้าส่งช้าเกินกำหนด'}</small></div></li>
        </ol>
      </article>}
      {bootstrap && <article className="attendance-simple__shift-card">
        <b className="attendance-simple__shift-code" data-shift-code={String(bootstrap.assignment.shift.code || '').toUpperCase()}>{bootstrap.assignment.shift.code || '—'}</b>
        <div>
          <strong>{bootstrap.assignment.shift.name || 'กะ'} · {bootstrap.assignment.shift.startTime || '—'} – {bootstrap.assignment.shift.endTime || '—'}</strong>
          <small>ตามตาราง: {[bootstrap.assignment.site.code, bootstrap.assignment.site.name].filter(Boolean).join(' · ') || '—'}</small>
          <span className="attendance-simple__shift-state">{receiptEvent?.eventType === 'CHECK_OUT' ? `ลงเวลาออกแล้ว ${receiptTime}` : checkInTime !== '—' ? `ลงเวลาเข้าแล้ว ${checkInTime}` : bootstrap.eventIntent === 'CHECK_OUT' ? 'ลงเวลาเข้าแล้ว' : 'ยังไม่ลงเวลา'}</span>
        </div>
      </article>}
      <div className="attendance-simple__big-clock" aria-hidden="true"><strong>{formatCurrentClock(currentTime).slice(0, 5).replace(':', ' : ')}</strong><small>:{formatCurrentClock(currentTime).slice(6, 8)}</small></div>
      <p className="attendance-simple__clock-note">เวลาบนเครื่อง · เวลาที่บันทึกใช้เวลาเซิร์ฟเวอร์</p>
      {working && shiftWindow && <div className="attendance-simple__progress" aria-label="ความคืบหน้าของกะ">
        <span>{workedDuration && workedDuration !== '—' ? `ทำงานมาแล้ว ${workedDuration}` : 'อยู่ระหว่างกะ'}</span>
        <i><b style={{ width: `${Math.round(shiftWindow.ratio * 100)}%` }} /></i>
        <small><span>{shiftWindow.startLabel}</span><span>{shiftWindow.endLabel}</span></small>
      </div>}
      {shiftCompleted && <article className="attendance-simple__complete">
        <span aria-hidden="true"><SmsIcon name="check" size={26} /></span>
        <strong>วันนี้ลงเวลาครบแล้ว</strong>
        <small>{checkInTime !== '—' ? `เข้า ${checkInTime} · ` : ''}ออก {receiptTime}</small>
        <button type="button" onClick={() => onTodayHistory?.()}>ดูประวัติวันนี้</button>
      </article>}
      {blockedByServer && <article className="attendance-simple__blocked">
        <span aria-hidden="true"><SmsIcon name={scheduleBlocked ? 'calendar' : 'shield'} size={26} /></span>
        <strong>{scheduleBlocked ? 'ยังไม่มีกะที่อนุมัติสำหรับวันนี้' : 'บัญชียังไม่พร้อมลงเวลา'}</strong>
        <small>{disabledGuidance?.message || message}</small>
        {disabledGuidance?.actionLabel && disabledGuidance.action && <button type="button" onClick={disabledGuidance.action}>{disabledGuidance.actionLabel}</button>}
      </article>}
    </section>}
    {pwaMode && pendingSiteCapture && !busy && <div className="attendance-simple__sheet-backdrop" role="presentation">
      <section className="attendance-simple__sheet is-support" role="dialog" aria-modal="true" aria-labelledby="attendance-support-title">
        <span className="attendance-simple__sheet-handle" aria-hidden="true" />
        <span className="attendance-simple__sheet-pill is-warn">ช่วยปฏิบัติงานต่าง Site</span>
        <h2 id="attendance-support-title">คุณอยู่ Site อื่นจากตาราง</h2>
        <p>ลงเวลาได้ ระบบจะเก็บทั้งสอง Site ไว้และส่งให้หัวหน้าตรวจ</p>
        <svg className="attendance-simple__site-map" viewBox="0 0 340 130" role="img" aria-label={`ภาพประกอบ: ตำแหน่งของคุณอยู่ที่ ${siteDisplayName(pendingSiteCapture.context)} ไม่ใช่ Site ตามตาราง`}>
          <defs><pattern id="sms-grid" width="34" height="26" patternUnits="userSpaceOnUse"><path d="M34 0H0V26" fill="none" stroke="currentColor" strokeOpacity=".12" /></pattern></defs>
          <rect width="340" height="130" rx="12" fill="url(#sms-grid)" />
          <circle cx="92" cy="58" r="34" className="is-assigned" /><circle cx="92" cy="58" r="4" className="is-dot" />
          <text x="92" y="116" textAnchor="middle" className="is-label">{(siteContext?.assignedSite || bootstrap?.assignment.site)?.code || 'ตามตาราง'}</text>
          <circle cx="250" cy="58" r="34" className="is-actual" /><circle cx="250" cy="58" r="8" className="is-you" />
          <text x="250" y="18" textAnchor="middle" className="is-you-label">คุณ</text>
          <text x="250" y="116" textAnchor="middle" className="is-label is-warn">{pendingSiteCapture.context.code || 'Site ที่ตรวจพบ'}</text>
        </svg>
        <dl>
          <div><dt>Site ตามตาราง</dt><dd>{siteDisplayName(siteContext?.assignedSite || bootstrap?.assignment.site)}</dd></div>
          <div><dt>Site ที่ตรวจพบ</dt><dd className="is-warn">{siteDisplayName(pendingSiteCapture.context)}</dd></div>
          <div><dt>ความแม่นยำ GPS</dt><dd>±{Math.round(Number(pendingSiteCapture.location.accuracyMeters) || 0)} ม.</dd></div>
        </dl>
        <footer>
          <button type="button" onClick={() => { setPendingSiteCapture(null); setSiteContext(null); setTone('neutral'); setMessage('ยกเลิกแล้ว · กดลงเวลาอีกครั้งเมื่อพร้อม'); }}>ยกเลิก</button>
          <button type="button" className="is-primary" onClick={() => void recordAttendance()}>ยืนยัน{selectedActionLabel}</button>
        </footer>
        <p className="attendance-simple__sheet-note">ตำแหน่งที่จับไว้ใช้ได้ 3 นาที</p>
      </section>
    </div>}
    {showReceiptSheet && <div className="attendance-simple__sheet-backdrop" role="presentation">
      <section className="attendance-simple__sheet" role="dialog" aria-modal="true" aria-labelledby="attendance-receipt-title">
        <span className="attendance-simple__sheet-handle" aria-hidden="true" />
        <span className="attendance-simple__sheet-icon" aria-hidden="true"><SmsIcon name="check" size={26} /></span>
        <h2 id="attendance-receipt-title">{receiptTitle}</h2>
        <p>{formatCurrentDate(currentTime)} · {receiptTime}</p>
        {receiptTimingLabel && <span className={`attendance-simple__sheet-pill ${receiptTimingLabel === 'ตรงเวลา' ? 'is-ok' : 'is-warn'}`}>{receiptTimingLabel}</span>}
        <dl>
          <div><dt>เวลาที่ระบบบันทึก</dt><dd>{receiptServerTime}</dd></div>
          <div><dt>สถานที่</dt><dd>{receiptSite}{receiptSupport ? ' · ช่วยต่าง Site' : ' · ตามตาราง'}</dd></div>
          <div><dt>ตำแหน่ง</dt><dd className="is-ok">อยู่ในพื้นที่ ✓</dd></div>
          <div><dt>อุปกรณ์</dt><dd className={lastResult?.deviceBinding === 'FOREIGN' ? 'is-warn' : 'is-ok'}>{lastResult?.deviceBinding === 'FOREIGN' ? 'อุปกรณ์อื่น · รอตรวจ' : lastResult?.deviceBinding === 'PRIMARY' ? 'เครื่องหลัก ✓' : receiptDevice}</dd></div>
          <div><dt>การส่งข้อมูล</dt><dd className="is-ok">บันทึกกับเซิร์ฟเวอร์แล้ว</dd></div>
        </dl>
        {receiptDetails.length > 0 && <p className="attendance-simple__sheet-note">{receiptDetails.join(' · ')}</p>}
        <footer>
          <button type="button" onClick={() => { setDismissedReceiptId(receiptKey); onTodayHistory?.(); }}><SmsIcon name="history" size={16} />ดูประวัติวันนี้</button>
          <button type="button" className="is-primary" autoFocus onClick={() => setDismissedReceiptId(receiptKey)}>เสร็จสิ้น</button>
        </footer>
      </section>
    </div>}
    <PageHeader
      kicker="ลงเวลาประจำวัน"
      title="ลงเวลา"
      description={`${employeeName} · ${department || bootstrap?.employee.department || '—'}`}
      actions={<button type="button" className="attendance-simple__profile" onClick={onOpenSettings}><SmsIcon name="settings" size={18} /><span>โปรไฟล์</span></button>}
    />

    <section className="attendance-simple__hero" aria-label="สถานะการทำงานวันนี้">
      <div className="attendance-simple__hero-copy">
        <span className="attendance-simple__eyebrow">วันนี้ · {formatCurrentDate(currentTime)}</span>
        <strong className="attendance-simple__hero-clock" aria-label={`เวลาปัจจุบัน ${formatCurrentClock(currentTime)}`}>{formatCurrentClock(currentTime)}</strong>
        <span className="attendance-simple__hero-status">{bootstrap?.eventIntent === 'CHECK_OUT' ? 'กำลังทำงาน' : 'พร้อมลงเวลา'}</span>
        <span className="attendance-simple__hero-shift">เวลางาน {bootstrap?.assignment.shift.startTime || '—'}–{bootstrap?.assignment.shift.endTime || '—'} น.</span>
      </div>
      <div className="attendance-simple__hero-user" aria-label="ผู้ใช้งาน">
        <span aria-hidden="true">{employeeName.slice(0, 1)}</span>
        <small>{employeeName}</small>
      </div>
    </section>

    <SectionCard className="attendance-simple__main-card" kicker="สถานะวันนี้" title="การลงเวลาเข้า–ออก" description="ตรวจสอบกะ สถานที่ อุปกรณ์ และสถานะก่อนบันทึก">
    <div className="attendance-simple__presence" aria-label="สถานะสถานที่ปัจจุบัน">
      <span className="attendance-simple__presence-icon" aria-hidden="true">⌖</span>
      <div><strong>{siteContext?.actualSite || siteContext?.assignedSite ? 'อยู่ในพื้นที่ที่ลงทะเบียน' : 'รอตรวจสอบตำแหน่ง'}</strong><small>{siteContext?.actualSite ? siteDisplayName(siteContext.actualSite) : siteContext?.assignedSite ? siteDisplayName(siteContext.assignedSite) : 'ระบบจะตรวจ GPS เมื่อกดยืนยัน'}</small></div>
      <span className="attendance-simple__presence-state">{siteContext ? 'พร้อมใช้งาน' : 'รอตรวจ'}</span>
    </div>
    <div className="attendance-simple__journey" aria-label="สถานะการลงเวลา">
      <article>
        <span>ตอนนี้</span>
        <strong>{nowLabel}</strong>
        <small>กะ {shiftText} · Site ตามตาราง: {bootstrap?.assignment.site.name || '—'}</small>
      </article>
      <article>
        <span>ขั้นตอนถัดไป</span>
        <strong>{nextActionLabel}</strong>
        <small>{online ? 'ตรวจตำแหน่งแล้วบันทึกกับ Server' : 'เก็บในเครื่องแล้วส่งเมื่อออนไลน์'}</small>
      </article>
    </div>

    {attentionItems.length > 0 && <section className="attendance-simple__exception" aria-label="รายการที่ต้องทราบ">
      <span>ต้องทราบ</span>
      <strong>{attentionItems[0]}</strong>
      {attentionItems.slice(1).map((item) => <p key={item}>{item}</p>)}
      {siteContext?.workSiteContext === 'SUPPORT_SITE' || pendingSiteCapture
        ? <small>ระบบเก็บ Site ตามตารางและ Site ที่ลงเวลาจริงแยกกันเพื่อการตรวจสอบ</small>
        : null}
    </section>}

    <section className="attendance-simple__site-summary" aria-label="สถานที่และการยืนยันตำแหน่ง">
      <div>
        <span>Site ตามตาราง</span>
        <strong>{siteDisplayName(siteContext?.assignedSite || bootstrap?.assignment.site)}</strong>
      </div>
      <div>
        <span>สถานะ GPS / Site</span>
        <strong>{siteContext ? (siteContext.workSiteContext === 'SUPPORT_SITE' ? `พบ ${siteDisplayName(siteContext.actualSite)} · ต้องยืนยันซ้ำ` : 'ตรวจแล้ว · อยู่ในขอบเขต') : 'ยังไม่ได้ตรวจ · จะตรวจเมื่อกดยืนยัน'}</strong>
      </div>
    </section>

    {selfieRequired && <section className="attendance-simple__selfie-step" aria-label="ขั้นตอน Selfie">
      <div className="attendance-simple__selfie-step-heading">
        <span>ต้องทำก่อนลงเวลา</span>
        <strong>{selfieStepLabel}</strong>
      </div>
      <p>นโยบายจาก Server กำหนดให้ใช้ภาพสด · ระบบจะประทับข้อมูลตำแหน่ง แล้วขอ Challenge/Nonce ก่อนส่งรายการ</p>
      <ol>
        <li className={selfie ? 'is-done' : ''}>ถ่าย Selfie</li>
        <li className={selfiePreview ? 'is-current' : selfie ? 'is-done' : ''}>ตรวจสอบภาพและยืนยัน</li>
        <li className={selfieNonce ? 'is-done' : ''}>รับ Nonce จาก Server และส่งลงเวลา</li>
      </ol>
      {!selfie && !selfiePreview && <button type="button" onClick={() => void openSelfieCamera()} disabled={clockDisabled || busy}>ถ่าย Selfie</button>}
      {selfiePreview && <div className="attendance-simple__selfie-step-actions"><button type="button" onClick={retakeSelfie} disabled={busy}>ถ่ายใหม่</button><button type="button" onClick={() => void useSelfiePreview()} disabled={busy}>ยืนยันภาพนี้</button></div>}
    </section>}

    {pwaMode && tone === 'danger' && !blockedByServer && <section className="attendance-simple__fail" aria-label="ยังไม่ได้บันทึกเวลา">
      <header><span aria-hidden="true"><SmsIcon name={requestErrorCode === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE' || locationDenied ? 'location' : 'close'} size={20} /></span><div><strong>{locationDenied ? 'ต้องใช้ตำแหน่งเพื่อลงเวลา' : 'ยังไม่ได้บันทึกเวลา'}</strong><small>{locationDenied ? 'แอปยังไม่ได้รับอนุญาตให้อ่านตำแหน่ง' : message}</small></div></header>
      {locationDenied && <div className="attendance-simple__perm">
        <div role="tablist" aria-label="วิธีเปิดตำแหน่ง">{(['ios', 'android'] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={permTab === key} className={permTab === key ? 'is-active' : ''} onClick={() => setPermTab(key)}>{key === 'ios' ? 'iPhone' : 'Android'}</button>)}</div>
        <ol>{(permTab === 'ios'
          ? ['เปิด การตั้งค่า › ความเป็นส่วนตัว › บริการหาตำแหน่ง', 'เลือก Safari เว็บไซต์ (หรือแอป SMS)', 'ตั้งเป็น “ขณะใช้แอป” และเปิด “ตำแหน่งที่แม่นยำ”', 'กลับมาที่หน้านี้แล้วกด “ลองอีกครั้ง”']
          : ['เปิด การตั้งค่า › ตำแหน่ง แล้วเปิดใช้ตำแหน่ง', 'เลือก Chrome (หรือแอป SMS) › สิทธิ์ › ตำแหน่ง', 'เลือก “อนุญาตขณะใช้แอป” และเปิด “ใช้ตำแหน่งที่แม่นยำ”', 'กลับมาที่หน้านี้แล้วกด “ลองอีกครั้ง”']).map((step) => <li key={step}>{step}</li>)}</ol>
      </div>}
      {requestErrorCode === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE' && outsideGap !== null && <svg className="attendance-simple__site-map" viewBox="0 0 340 130" role="img" aria-label={`ภาพประกอบ: ห่างขอบ Site ประมาณ ${outsideGap} เมตร`}>
        <rect width="340" height="130" rx="12" fill="none" />
        <circle cx="96" cy="62" r="40" className="is-assigned" /><circle cx="96" cy="62" r="4" className="is-dot" />
        <text x="96" y="122" textAnchor="middle" className="is-label">{bootstrap?.assignment.site.code || 'Site'}</text>
        <line x1="136" y1="62" x2="252" y2="62" stroke="#F87171" strokeDasharray="4 4" />
        <text x="194" y="52" textAnchor="middle" className="is-gap">ห่างขอบ ~{outsideGap} ม.</text>
        <circle cx="262" cy="62" r="12" className="is-you" /><text x="262" y="34" textAnchor="middle" className="is-you-label">คุณ</text>
      </svg>}
      {requestErrorCode === 'ATTENDANCE_OUTSIDE_SITE_GEOFENCE' && <ol>
        <li>เดินเข้าไปในพื้นที่ Site ให้ใกล้จุดกลางมากขึ้น</li>
        <li>เปิด “ตำแหน่งที่แม่นยำ” (Precise Location) ของแอป</li>
        <li>ออกมาที่โล่ง ห่างจากอาคารสูงหรือที่จอดรถใต้ดิน</li>
      </ol>}
      {!clockDisabled && <button type="button" onClick={() => void recordAttendance()} disabled={busy}><SmsIcon name="refresh" size={16} />ลองอีกครั้ง</button>}
    </section>}
    <div className={`attendance-simple__status is-${tone}`} role="status">
      <strong>{message}</strong>
      {siteContext && tone !== 'danger' && <span>สถานที่ตามตาราง: {siteContext.assignedSite.name || siteContext.assignedSite.code || '—'}</span>}
      {siteContext && tone !== 'danger' && <span>สถานที่ลงเวลาจริง: {siteContext.workSiteContext === 'SUPPORT_SITE' ? siteDisplayName(siteContext.actualSite) : siteContext.actualSite?.name || siteContext.assignedSite.name || '—'}{siteContext.workSiteContext === 'SUPPORT_SITE' ? ' · ช่วยปฏิบัติงานต่าง Site' : ' · ปกติ'}</span>}
      {tone === 'danger' && requestErrorCode && <span>รหัสข้อผิดพลาด: <code>{requestErrorCode}</code></span>}
      {tone === 'danger' && requestErrorId && <span>Request ID: <code>{requestErrorId}</code></span>}
      {queueCount > 0 && <span>รอส่งเมื่อออนไลน์ {queueCount} รายการ</span>}
    </div>

    <div className="attendance-simple__action">
      <div className="attendance-simple__action-choice" role="group" aria-label="เลือกประเภทการลงเวลา">
        {(['CHECK_IN', 'CHECK_OUT'] as const).map((action) => {
          const label = action === 'CHECK_IN' ? 'ลงเวลาเข้า' : 'ลงเวลาออก';
          const recommended = action === bootstrap?.eventIntent;
          return <button key={action} type="button" className={recommended ? 'is-recommended' : undefined} aria-label={label} title={recommended ? `${label} · แนะนำตามสถานะล่าสุด` : label} aria-pressed={(selectedAction || bootstrap?.eventIntent) === action} disabled={clockDisabled} onClick={() => setSelectedAction(action)}>{label}</button>;
        })}
      </div>
      <div className="attendance-simple__clock-stack">
        <button
          type="button"
          className="attendance-simple__clock"
          disabled={clockDisabled}
          aria-describedby={clockDisabled ? 'attendance-simple-clock-disabled-reason' : undefined}
          onClick={() => void recordAttendance()}
        >
          <span>{busy ? 'กำลังตรวจ…' : pendingSiteCapture ? `ยืนยัน${selectedActionLabel}ที่ ${siteDisplayName(pendingSiteCapture.context)}` : selectedActionLabel}</span>
          <small>{busy && pwaMode ? 'อย่าปิดหน้านี้' : online ? 'กดครั้งเดียว · บันทึกกับ Server' : 'กดครั้งเดียว · เก็บไว้และส่งเมื่อออนไลน์'}</small>
        </button>
        {clockDisabled && disabledGuidance && <div className="attendance-simple__disabled-guidance">
          <p id="attendance-simple-clock-disabled-reason">{disabledGuidance.message}</p>
          {disabledGuidance.actionLabel && disabledGuidance.action && <button type="button" onClick={disabledGuidance.action}>{disabledGuidance.actionLabel}</button>}
        </div>}
      </div>
      {pwaMode && <div className="attendance-simple__ready-tiles" aria-label="ความพร้อมก่อนลงเวลา">
        <article><SmsIcon name="location" size={18} /><div><b>ตำแหน่ง</b><span>{siteContext ? 'ตรวจแล้ว' : !online && bootstrap?.offline?.maxAccuracyMeters ? `ต้อง ≤ ${bootstrap.offline.maxAccuracyMeters} ม.` : 'ตรวจเมื่อกด'}</span></div></article>
        <article><SmsIcon name="shield" size={18} /><div><b>เครื่องหลัก</b><span>{bindingState === 'PRIMARY' ? 'ยืนยันแล้ว' : bindingState === 'FOREIGN' ? 'เครื่องอื่น' : bindingState === 'AUTO_BIND' ? 'ผูกเมื่อลงเวลา' : bootstrap?.pendingDeviceRequest ? 'รออนุมัติ' : 'กำลังตรวจ'}</span></div></article>
        <article><SmsIcon name="check" size={18} /><div><b>{online ? 'ออนไลน์' : 'รอส่ง'}</b><span>{online ? (queueCount > 0 ? `รอส่ง ${queueCount} รายการ` : 'ส่งทันที') : `${queueCount} รายการ`}</span></div></article>
      </div>}
      <div className="attendance-simple__assurance">
        <article>
          <b>ตำแหน่ง</b>
          <span>GPS / GEOFENCE ตรวจทุกครั้งก่อนบันทึก</span>
        </article>
        <article>
          <b>อุปกรณ์</b>
          <span>ใช้ได้หลายอุปกรณ์ · ระบบเก็บข้อมูลเบราว์เซอร์เป็น telemetry</span>
        </article>
        <article>
          <b>ออฟไลน์พร้อมใช้งาน</b>
          <span>ถ้าเน็ตหลุด ระบบเก็บรายการในเครื่องและส่งให้อัตโนมัติเมื่อออนไลน์</span>
        </article>
    </div>
    </div>
    </SectionCard>

    <SectionCard className="attendance-simple__daily-summary" aria-label="สรุปวันนี้" kicker="สรุปวันนี้" title="ภาพรวมการทำงานวันนี้" description="แสดงเฉพาะข้อมูลที่ได้รับจากระบบ">
      <div className="attendance-simple__daily-metrics">
        <div><span>เข้างาน</span><strong>{checkInTime}</strong></div>
        <div><span>ทำงานมาแล้ว</span><strong>{workedDuration}</strong></div>
        <div><span>Site จริง</span><strong>{receiptEvent ? receiptSite : '—'}</strong></div>
      </div>
      <div className="attendance-simple__daily-meta">
        <span>กะงาน {shiftText}</span>
        <span>เลิกงานตามกะ {bootstrap?.assignment.shift.endTime ? `${bootstrap.assignment.shift.endTime} น.` : '—'}</span>
      </div>
    </SectionCard>

    {receiptEvent && <SectionCard className="attendance-simple__receipt" aria-label="หลักฐานการลงเวลา" kicker="หลักฐานจากระบบ" title={receiptTitle} description={`${receiptTime} · บันทึกกับ Server แล้ว`}>
      <div className="attendance-simple__receipt-heading">
        <SmsIcon name="check" size={18} />
        <strong>บันทึกเวลาและตรวจสอบข้อมูลจาก Server แล้ว</strong>
      </div>
      <div className="attendance-simple__receipt-grid">
        <div><span>Site จริง</span><strong>{receiptSite}</strong></div>
        <div><span>อุปกรณ์</span><strong>{receiptDevice}</strong></div>
        <div><span>GPS / GEOFENCE</span><strong>ตรวจแล้ว</strong></div>
        <div><span>สถานะ Sync</span><strong>บันทึกแล้ว</strong></div>
      </div>
      {receiptDetails.length > 0 && <p>{receiptDetails.join(' · ')}</p>}
      <button type="button" onClick={onTodayHistory}>ดูประวัติวันนี้</button>
    </SectionCard>}



    {lastResult?.reviewReasons?.length ? <details className="attendance-simple__technical">
      <summary>รายละเอียดทางเทคนิค</summary>
      <code>{lastResult.reviewReasons.join(', ')}</code>
    </details> : null}
    {requestErrorId && <details className="attendance-simple__technical">
      <summary>รายละเอียดสำหรับผู้ดูแล</summary>
      {requestErrorCode && <p>รหัส: <code>{requestErrorCode}</code></p>}
      <RequestErrorReference requestId={requestErrorId} />
    </details>}

    <footer className="attendance-simple__footer">
      <button type="button" onClick={onTodayHistory}>ดูประวัติวันนี้</button>
      <span>Online ใช้เวลา Server · Offline ใช้เวลาที่จับบนเครื่องและอาจต้องยืนยันก่อนนับ</span>
    </footer>
  </section>;
}

export default AttendanceSimplePage;
