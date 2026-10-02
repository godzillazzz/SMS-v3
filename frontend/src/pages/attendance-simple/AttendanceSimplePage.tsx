import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  simpleAttendanceBootstrap,
  simpleAttendanceMoveRequest,
  simpleAttendanceSubmit,
  type SimpleBootstrap,
  type SimpleEventInput,
  type SimpleEventResult
} from './attendance-simple-client';
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
  const payload = {
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
  onOpenSettings
}: Props) {
  const [bootstrap, setBootstrap] = useState<SimpleBootstrap | null>(null);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('กำลังเตรียมระบบลงเวลา…');
  const [tone, setTone] = useState<StatusTone>('neutral');
  const [lastResult, setLastResult] = useState<SimpleEventResult | null>(null);
  const [moveReason, setMoveReason] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);

  const refreshQueueCount = useCallback(async () => {
    setQueueCount(await encryptedQueueCount().catch(() => 0));
  }, []);

  const loadBootstrap = useCallback(async () => {
    if (online && token) {
      const fresh = await simpleAttendanceBootstrap(token);
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
    if (!online || !token) return;
    const rows = await listEncryptedQueue<SimpleEventInput>();
    for (const row of rows) {
      try {
        const result = await simpleAttendanceSubmit(token, row.value);
        if (result.counted || result.status === 'PENDING_CONFIRMATION') {
          await removeQueued(row.captureId);
          setLastResult(result);
          if (result.status === 'PENDING_CONFIRMATION') {
            setTone('warning');
            setMessage('ส่งรายการ Offline แล้ว แต่ส่งช้าเกินกำหนด · รอ ADMIN ยืนยันก่อนนับ');
          } else if (result.reviewRequired) {
            setTone('warning');
            setMessage('ส่งรายการ Offline สำเร็จและนับเวลาแล้ว · มีธงให้ตรวจอุปกรณ์');
          } else {
            setTone('success');
            setMessage('ส่งรายการ Offline และบันทึกเวลาเรียบร้อย');
          }
        }
      } catch {
        break;
      }
    }
    await refreshQueueCount();
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
        const nextBootstrap = await loadBootstrap();
        if (!active) return;
        setBootstrap(nextBootstrap);
        setTone(online ? 'success' : 'warning');
        setMessage(online ? 'พร้อมลงเวลา · GPS/GEOFENCE บังคับ' : 'Offline · พร้อมเก็บรายการแบบเข้ารหัสและส่งเมื่อออนไลน์');
        if (online && token) await syncQueue();
      } catch (error) {
        if (!active) return;
        setTone('danger');
        setMessage(error instanceof Error ? error.message : 'เตรียมระบบลงเวลาไม่สำเร็จ');
      }
    })();
    return () => { active = false; };
  }, [loadBootstrap, online, refreshQueueCount, syncQueue, token]);

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

  const recordAttendance = async () => {
    if (readOnly || busy || !identity || !bootstrap) return;
    setBusy(true);
    setLastResult(null);
    setTone('neutral');
    setMessage('กำลังตรวจ GPS/GEOFENCE…');
    try {
      const location = await getLocation();
      const localDecision = gpsGeofenceDecision(bootstrap.assignment.site, location);
      if (localDecision.classification === 'CONFIDENT_OUTSIDE') {
        throw new Error(`อยู่นอก GEOFENCE ของ ${bootstrap.assignment.site.name} · ไม่บันทึกเวลา`);
      }
      const capturedAt = new Date().toISOString();
      const offlineBundle = online && token ? null : bootstrap.offline.bundle;
      const input = await signedEvent(identity, {
        captureId: uuid(),
        eventIntent: bootstrap.eventIntent,
        shiftAssignmentId: bootstrap.assignment.id,
        capturedAt,
        location,
        offlineBundle
      });

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
        setTone(localDecision.classification === 'BORDERLINE' ? 'warning' : 'success');
        setMessage(localDecision.classification === 'BORDERLINE'
          ? 'เก็บเวลา Offline แบบเข้ารหัสแล้ว · ตำแหน่งอยู่ขอบ GEOFENCE และจะถูกตรวจเมื่อส่ง'
          : 'เก็บเวลา Offline แบบเข้ารหัสแล้ว · จะส่งอัตโนมัติเมื่อกลับมาออนไลน์');
        return;
      }

      const result = await simpleAttendanceSubmit(token, input);
      setLastResult(result);
      if (result.status === 'PENDING_CONFIRMATION') {
        setTone('warning');
        setMessage('รายการถูกส่งแล้วแต่ต้องให้ ADMIN ยืนยันก่อนนับ');
      } else if (result.reviewRequired || result.deviceBinding === 'FOREIGN') {
        setTone('warning');
        setMessage('บันทึกเวลาแล้ว · เครื่องนี้ไม่ใช่เครื่องหลัก จึงติดธงให้ตรวจ');
      } else {
        setTone('success');
        setMessage('บันทึกเวลาเรียบร้อย');
      }
      if (result.counted) {
        try {
          const fresh = await simpleAttendanceBootstrap(token);
          await storeEncryptedBootstrap(fresh);
          setBootstrap(fresh);
        } catch {
          // Shift can be complete after CHECK_OUT; keep the accepted result visible.
        }
      }
    } catch (error) {
      setTone('danger');
      setMessage(error instanceof Error ? error.message : 'ลงเวลาไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const requestMove = async () => {
    if (!token || !online || !identity || moveBusy || moveReason.trim().length < 3) return;
    setMoveBusy(true);
    try {
      const requestId = uuid();
      const reason = moveReason.trim();
      const payload = {
        version: 'SMS_ATTENDANCE_DEVICE_MOVE_V1',
        requestId,
        publicKeySpkiBase64: identity.publicKeySpkiBase64,
        keyAlgorithm: identity.keyAlgorithm,
        reason
      };
      await simpleAttendanceMoveRequest(token, {
        requestId,
        publicKeySpkiBase64: identity.publicKeySpkiBase64,
        keyAlgorithm: identity.keyAlgorithm,
        signatureBase64: await signPayload(identity, payload),
        displayName: 'อุปกรณ์ลงเวลา',
        platformHint: platformHint(),
        reason
      });
      setTone('warning');
      setMessage('ส่งคำขอย้ายเครื่องแล้ว · รอ ADMIN อนุมัติ เครื่องหลักเดิมยังไม่ถูกยกเลิก');
      setMoveReason('');
    } catch (error) {
      setTone('danger');
      setMessage(error instanceof Error ? error.message : 'ส่งคำขอย้ายเครื่องไม่สำเร็จ');
    } finally {
      setMoveBusy(false);
    }
  };

  const employeeName = bootstrap?.employee.displayName || displayName || 'พนักงาน';
  const shiftText = bootstrap
    ? `${bootstrap.assignment.shift.code || ''} ${bootstrap.assignment.shift.startTime || ''}–${bootstrap.assignment.shift.endTime || ''}`.trim()
    : '—';

  return <section className="attendance-simple">
    <header className="attendance-simple__header">
      <div>
        <span>SMS TIME</span>
        <h1>{employeeName}</h1>
        <p>{department || bootstrap?.employee.department || 'Security Operations'}</p>
      </div>
      <button type="button" onClick={onOpenSettings} aria-label="เปิดโปรไฟล์">⚙︎</button>
    </header>

    <div className="attendance-simple__summary">
      <div><span>กะ</span><strong>{shiftText}</strong></div>
      <div><span>พื้นที่</span><strong>{bootstrap?.assignment.site.name || '—'}</strong></div>
      <div><span>เครือข่าย</span><strong>{online ? 'Online' : 'Offline'}</strong></div>
    </div>

    <div className={`attendance-simple__status is-${tone}`} role="status">
      <strong>{message}</strong>
      {queueCount > 0 && <span>คิวเข้ารหัสรอส่ง {queueCount} รายการ</span>}
    </div>

    <div className="attendance-simple__assurance">
      <article>
        <b>GPS / GEOFENCE</b>
        <span>ตรวจทุกครั้งก่อนบันทึก</span>
      </article>
      <article>
        <b>อุปกรณ์</b>
        <span>{bindingState === 'PRIMARY' ? 'เครื่องหลัก' : bindingState === 'AUTO_BIND' ? 'เครื่องแรก · ผูกอัตโนมัติ' : bindingState === 'FOREIGN' ? 'เครื่องอื่น · ติดธงตรวจ' : 'กำลังตรวจ'}</span>
      </article>
      <article>
        <b>Offline</b>
        <span>AES-GCM encrypted queue</span>
      </article>
    </div>

    <button
      type="button"
      className="attendance-simple__clock"
      disabled={readOnly || busy || !identity || !bootstrap}
      onClick={() => void recordAttendance()}
    >
      <span>{busy ? 'กำลังตรวจ…' : bootstrap?.eventIntent === 'CHECK_OUT' ? 'ลงเวลาออก' : 'ลงเวลาเข้า'}</span>
      <small>{online ? 'บันทึกกับ Server' : 'เก็บเข้ารหัสไว้ในเครื่อง'}</small>
    </button>

    {bindingState === 'FOREIGN' && <section className="attendance-simple__move">
      <strong>ต้องการย้ายเครื่องหลักมาที่เครื่องนี้?</strong>
      <p>การลงเวลายังทำได้แต่ติดธงตรวจ การย้ายเครื่องต้องให้ ADMIN อนุมัติและมี Audit log</p>
      <textarea value={moveReason} onChange={(event) => setMoveReason(event.target.value)} maxLength={1000} placeholder="เหตุผลที่ย้ายเครื่อง เช่น เปลี่ยนโทรศัพท์เครื่องหลัก" />
      <button type="button" disabled={!online || !token || moveBusy || moveReason.trim().length < 3} onClick={() => void requestMove()}>
        {moveBusy ? 'กำลังส่ง…' : 'ขอให้ ADMIN อนุมัติย้ายเครื่อง'}
      </button>
    </section>}

    {lastResult?.reviewReasons?.length ? <div className="attendance-simple__flags">
      <b>ธงตรวจ:</b> {lastResult.reviewReasons.join(', ')}
    </div> : null}

    <footer className="attendance-simple__footer">
      <button type="button" onClick={onTodayHistory}>ดูประวัติวันนี้</button>
      <span>เวลา Online ใช้ Server · เวลา Offline ใช้เวลาจับบนเครื่องและอาจต้องยืนยันก่อนนับ</span>
    </footer>
  </section>;
}

export default AttendanceSimplePage;

