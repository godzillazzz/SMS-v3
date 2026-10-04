import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
type SiteSummary = { id: string; code?: string | null; name?: string | null };
type DisplaySiteContext = { assignedSite: SiteSummary; actualSite: SiteSummary | null; workSiteContext: 'ASSIGNED_SITE' | 'SUPPORT_SITE' | 'OUTSIDE_ALL_SITES' };

function siteDisplayName(site: SiteSummary | null | undefined): string {
  const value = String(site?.name || site?.code || '').trim();
  if (!value) return 'Site ที่ตรวจพบ';
  return /^site(?:\s|$)/i.test(value) ? value : `Site ${value}`;
}

function reviewContextDetails(result: SimpleEventResult, evidence = result.event?.locationEvidence): string[] {
  const reasons = new Set([...(result.reviewReasons || []), ...(result.event?.reviewReasons || [])]);
  const details: string[] = [];
  if (evidence?.workSiteContext === 'SUPPORT_SITE' || reasons.has('ASSIST_OTHER_SITE')) {
    details.push(`ช่วยปฏิบัติงานที่ ${siteDisplayName(evidence?.actualSite)}`);
  }
  if (result.deviceBinding === 'FOREIGN' || reasons.has('DEVICE_MISMATCH')) {
    details.push('ใช้อุปกรณ์อื่นจากเครื่องหลัก · ติดธงให้ตรวจสอบ');
  }
  const unclassifiedRisk = [...reasons].some((reason) => !['ASSIST_OTHER_SITE', 'DEVICE_MISMATCH'].includes(reason));
  if (unclassifiedRisk || (result.reviewRequired && details.length === 0)) details.push('มีธงความเสี่ยงให้ตรวจสอบ');
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
  const [siteContext, setSiteContext] = useState<DisplaySiteContext | null>(null);
  const [pendingSiteCapture, setPendingSiteCapture] = useState<{ location: Awaited<ReturnType<typeof getLocation>>; context: NonNullable<ReturnType<typeof gpsGeofenceDecision>['actualSite']> } | null>(null);
  const [moveReason, setMoveReason] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const queueSyncInFlight = useRef(false);

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
    if (!online || !token || queueSyncInFlight.current) return;
    queueSyncInFlight.current = true;
    try {
      const rows = await listEncryptedQueue<SimpleEventInput>();
      for (const row of rows) {
        let acknowledged = false;
        try {
          const result = await simpleAttendanceSubmit(token, row.value);
          if (result.counted || result.status === 'PENDING_CONFIRMATION') {
            acknowledged = true;
            setBootstrap(null);
            const fresh = await simpleAttendanceBootstrap(token);
            await storeEncryptedBootstrap(fresh);
            setBootstrap(fresh);
            await removeQueued(row.captureId);
            setLastResult(result);
            const evidence = result.event?.locationEvidence || result.pendingEvent?.locationEvidence;
            if (evidence?.assignedSite) setSiteContext({ assignedSite: evidence.assignedSite, actualSite: evidence.actualSite || null, workSiteContext: evidence.workSiteContext || 'ASSIGNED_SITE' });
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
      const pendingAgeMs = pendingSiteCapture ? Date.now() - new Date(pendingSiteCapture.location.capturedAt).getTime() : Infinity;
      const reusePending = pendingSiteCapture !== null && pendingAgeMs >= 0 && pendingAgeMs <= 180000;
      const location = reusePending ? pendingSiteCapture.location : await getLocation();
      const localDecision = gpsGeofenceDecision(bootstrap.assignment.site, location, bootstrap.eligibleSites || []);
      if (!online && localDecision.classification === 'CONFIDENT_OUTSIDE') {
        throw new Error('อยู่นอก GEOFENCE ของทุก Site ที่อนุญาต · ไม่บันทึกเวลา');
      }
      if (!reusePending && localDecision.workSiteContext === 'SUPPORT_SITE' && localDecision.actualSite) {
        setSiteContext({ assignedSite: { id: localDecision.assignedSite.id, code: localDecision.assignedSite.code, name: localDecision.assignedSite.name || '' },
          actualSite: localDecision.actualSite ? { id: localDecision.actualSite.id, code: localDecision.actualSite.code, name: localDecision.actualSite.name || '' } : null,
          workSiteContext: localDecision.workSiteContext });
        setPendingSiteCapture({ location, context: localDecision.actualSite });
        setTone('warning');
        setMessage(`สถานที่ตามตาราง: ${bootstrap.assignment.site.name} · กำลังลงเวลาที่ ${siteDisplayName(localDecision.actualSite)} · ระบบจะบันทึกเป็น “ช่วยปฏิบัติงาน” · กดอีกครั้งเพื่อยืนยัน`);
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
        const siteMessage = localDecision.workSiteContext === 'SUPPORT_SITE'
          ? `สถานที่ลงเวลาจริง: ${siteDisplayName(localDecision.actualSite)} · ช่วยปฏิบัติงาน · `
          : '';
        setMessage(localDecision.classification === 'BORDERLINE'
          ? `${siteMessage}เก็บเวลา Offline แบบเข้ารหัสแล้ว · ตำแหน่งอยู่ขอบ GEOFENCE และจะถูกตรวจเมื่อส่ง`
          : `${siteMessage}เก็บเวลา Offline แบบเข้ารหัสแล้ว · จะส่งอัตโนมัติเมื่อกลับมาออนไลน์`);
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
          const fresh = await simpleAttendanceBootstrap(token);
          await storeEncryptedBootstrap(fresh);
          setBootstrap(fresh);
        } catch {
          // Shift can be complete after CHECK_OUT; keep the accepted result visible.
        }
      }
    } catch (error) {
      setPendingSiteCapture(null);
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
      <div><span>สถานที่ตามตาราง</span><strong>{bootstrap?.assignment.site.name || '—'}</strong></div>
      <div><span>เครือข่าย</span><strong>{online ? 'Online' : 'Offline'}</strong></div>
    </div>

    <div className={`attendance-simple__status is-${tone}`} role="status">
      <strong>{message}</strong>
      {siteContext && <span>สถานที่ตามตาราง: {siteContext.assignedSite.name || siteContext.assignedSite.code || '—'}</span>}
      {siteContext && <span>สถานที่ลงเวลาจริง: {siteContext.workSiteContext === 'SUPPORT_SITE' ? siteDisplayName(siteContext.actualSite) : siteContext.actualSite?.name || siteContext.assignedSite.name || '—'}{siteContext.workSiteContext === 'SUPPORT_SITE' ? ' · ช่วยปฏิบัติงาน' : ' · ปกติ'}</span>}
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
      <span>{busy ? 'กำลังตรวจ…' : pendingSiteCapture ? `ยืนยันช่วยปฏิบัติงานที่ ${siteDisplayName(pendingSiteCapture.context)}` : bootstrap?.eventIntent === 'CHECK_OUT' ? 'ลงเวลาออก' : 'ลงเวลาเข้า'}</span>
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
