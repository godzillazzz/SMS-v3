import { useEffect, useMemo, useState } from 'react';
import { SmsIcon } from '../../components/SmsIcon';
import {
  AttendanceReadinessError,
  attendanceReadiness,
  type AttendanceEventIntent,
  type AttendanceLocationEvidence,
  type AttendanceReadinessState
} from './attendance-client';
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
    title: 'การยืนยันใบหน้ายังไม่เปิดใช้งาน',
    detail: 'ระบบจะไม่บันทึกเวลาและไม่ถือว่าการตรวจครั้งนี้สำเร็จ จนกว่าจะเปิด biometric runtime ที่เชื่อถือได้จากฝั่ง server',
    tone: 'blocked'
  },
  READY_TO_START_VERIFICATION: {
    title: 'หลักฐาน QR / GPS พร้อมสำหรับขั้นยืนยันตัวตน',
    detail: 'Server ตรวจ authority แล้ว แต่หน้าเว็บรอบนี้ยังไม่เริ่ม Face/Liveness และยังไม่สามารถบันทึกเวลาได้',
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

  const copy = useMemo(() => fallbackCopy(readiness), [readiness]);
  const qrReady = qrToken.trim().length >= 24;
  const gpsReady = Boolean(location);
  const interactionDisabled = readOnly || !online;
  const canCheck = !interactionDisabled && qrReady && gpsReady && !checking && !locationBusy;

  const resetServerState = () => {
    setReadiness(null);
    setEventIntent(null);
    setRouteUnavailable(false);
    setRequestId(undefined);
    setCheckedAt(null);
    setError(undefined);
  };

  useEffect(() => {
    if (online) return;
    setScannerOpen(false);
    setQrToken('');
    setLocation(null);
    setLocationBusy(false);
    setChecking(false);
    resetServerState();
  }, [online]);

  const acquireLocation = async () => {
    if (interactionDisabled) return;
    setLocationBusy(true);
    resetServerState();
    try {
      setLocation(await positionOnce());
    } catch (reason) {
      setLocation(null);
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านตำแหน่งได้');
    } finally {
      setLocationBusy(false);
    }
  };

  const checkReadiness = async () => {
    if (!canCheck || !location) return;
    setChecking(true);
    setError(undefined);
    setRouteUnavailable(false);
    setReadiness(null);
    setEventIntent(null);
    setRequestId(undefined);
    try {
      if (!globalThis.crypto?.randomUUID) throw new Error('เบราว์เซอร์นี้ไม่รองรับ secure attempt identifier ที่ระบบต้องใช้');
      const result = await attendanceReadiness(token, {
        captureId: globalThis.crypto.randomUUID(),
        qrToken: qrToken.trim(),
        location
      });
      setRequestId(result.requestId);
      setCheckedAt(new Date());
      if (!result.routeAvailable) {
        setRouteUnavailable(true);
        return;
      }
      setReadiness(result.data.readiness);
      setEventIntent(result.data.eventIntent);
    } catch (reason) {
      if (reason instanceof AttendanceReadinessError) {
        setRequestId(reason.requestId);
        setError(reason.message);
      } else {
        setError(reason instanceof Error ? reason.message : 'ไม่สามารถตรวจสอบความพร้อมได้');
      }
    } finally {
      setChecking(false);
    }
  };

  const resetAttempt = () => {
    setScannerOpen(false);
    setQrToken('');
    setLocation(null);
    resetServerState();
  };

  return <section className="view-pane attendance-page">
    <AttendanceQrScanner
      open={scannerOpen && !interactionDisabled}
      onDetected={(value) => { setQrToken(value); setScannerOpen(false); resetServerState(); }}
      onClose={() => setScannerOpen(false)}
    />
    <div className="page-heading attendance-heading">
      <div>
        <p className="eyebrow">G06 · ATTENDANCE</p>
        <h1>ลงเวลา</h1>
        <p>ตรวจ QR และตำแหน่งแบบครั้งต่อครั้ง โดย Server เป็นผู้ตัดสินว่าเป็นเวลาเข้า หรือเวลาออก</p>
      </div>
      <div className="heading-actions">
        <button type="button" className="btn-neutral small-action" onClick={resetAttempt} disabled={checking || locationBusy}>
          <SmsIcon name="refresh" size={17} />เริ่มใหม่
        </button>
      </div>
    </div>

    {readOnly && <div className="settings-notice">กำลังอยู่ใน View As — หน้า Attendance เป็นแบบอ่านอย่างเดียวและไม่สามารถส่งหลักฐานลงเวลาแทนพนักงานได้</div>}
    {!online && <div className="settings-notice">ออฟไลน์ — ปิดการสแกน QR, GPS และ Server readiness จนกว่าจะเชื่อมต่อ Server อีกครั้ง</div>}

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
      <article className="attendance-flow-step is-locked">
        <span>4</span><div><strong>Face / Liveness</strong><small>ยังไม่เปิด runtime ในรอบนี้</small></div><SmsIcon name="pause" size={18} />
      </article>
    </div>

    <div className="attendance-workspace-grid">
      <article className="attendance-evidence-card">
        <header className="attendance-qr-evidence-header"><span><SmsIcon name="quality" size={20} /></span><div><h2>1. QR จุดปฏิบัติงาน</h2><p>สแกนด้วยกล้องหรือวางข้อมูล QR; ค่า QR อยู่เฉพาะ attempt ปัจจุบันและไม่บันทึกลง localStorage/sessionStorage</p></div><button type="button" className="btn-primary attendance-qr-open-action" disabled={interactionDisabled || checking} onClick={() => { resetServerState(); setScannerOpen(true); }}><SmsIcon name="quality" size={17} />สแกน QR</button></header>
        <label className="attendance-field">
          <span>ข้อมูลจาก QR</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={qrToken}
            disabled={interactionDisabled || checking}
            onChange={(event) => { setQrToken(event.target.value); resetServerState(); }}
            placeholder="วางข้อมูล QR จากป้าย ณ จุดปฏิบัติงาน หรือกดสแกน QR"
          />
          <small>{qrReady ? 'พร้อมส่งให้ server ตรวจ credential/site binding' : 'ต้องมีข้อมูล QR ที่สมบูรณ์ก่อนตรวจ readiness'}</small>
        </label>
      </article>

      <article className="attendance-evidence-card">
        <header><span><SmsIcon name="quality" size={20} /></span><div><h2>2. ตำแหน่งปัจจุบัน</h2><p>อ่านแบบ one-shot เท่านั้น ไม่มี continuous tracking และไม่เก็บตำแหน่งเบื้องหลัง</p></div></header>
        {location ? <dl className="attendance-location-summary">
          <div><dt>ความแม่นยำ</dt><dd>±{Math.round(location.accuracyMeters)} เมตร</dd></div>
          <div><dt>อ่านเมื่อ</dt><dd>{thaiTime(location.capturedAt)}</dd></div>
        </dl> : <div className="attendance-empty-evidence">ยังไม่มีตำแหน่งสำหรับ attempt นี้</div>}
        <button type="button" className="btn-neutral attendance-location-action" disabled={interactionDisabled || locationBusy || checking} onClick={() => void acquireLocation()}>
          <SmsIcon name="refresh" size={17} />{locationBusy ? 'กำลังอ่านตำแหน่ง…' : location ? 'อ่านตำแหน่งใหม่' : 'อ่านตำแหน่งปัจจุบัน'}
        </button>
      </article>
    </div>

    {error && <div className="alert alert-error attendance-error" role="alert"><strong>ยังตรวจสอบต่อไม่ได้</strong><span>{error}</span>{requestId && <small>Request ID: {requestId}</small>}</div>}

    <section className="attendance-readiness-card">
      <header>
        <div><p className="eyebrow">SERVER DECISION</p><h2>3. ตรวจความพร้อม</h2><span>Server จะ resolve Attendance state ก่อน และ client ไม่ส่ง eventIntent</span></div>
        <button type="button" className="btn-primary" disabled={!canCheck} onClick={() => void checkReadiness()}>
          <SmsIcon name="shield" size={17} />{checking ? 'กำลังตรวจสอบ…' : 'ตรวจสอบความพร้อม'}
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

    <section className="attendance-face-gate">
      <div><span className="attendance-face-gate__icon"><SmsIcon name="pause" size={21} /></span><div><h2>4. Face / Liveness</h2><p>ส่วนนี้ถูกเตรียมไว้สำหรับ trusted provider เท่านั้น ขณะนี้ AWS/provider runtime ยังหยุดไว้ตาม gate ปัจจุบัน</p></div></div>
      <button type="button" className="btn-primary" disabled>ยืนยันใบหน้า — ยังไม่เปิดใช้งาน</button>
    </section>
  </section>;
}
