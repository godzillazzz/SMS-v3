import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import jsQR from 'jsqr';
import { SmsIcon } from '../../components/SmsIcon';
import { canvasToOptimizedJpeg } from '../../lib/attachment-optimizer';
import { toRequestErrorState, RequestErrorContent, type RequestErrorInput } from '../../request-error';
import { patrolApi } from './patrol-client';
import { bangkokToday, parsePatrolQr, thaiDate, thaiTime, type PatrolCheckpoint, type PatrolProgress, type PatrolScan } from './patrol-model';
import './patrol.css';

type Step = 'idle' | 'scanQr' | 'photo' | 'review' | 'saving' | 'done';
const SCAN_INTERVAL_MS = 220;
const MAX_DECODE_WIDTH = 720;
const PHOTO_MAX_EDGE = 1280;

function cameraError(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'ไม่ได้รับสิทธิ์ใช้กล้อง กรุณาอนุญาต Camera สำหรับเว็บไซต์นี้แล้วลองใหม่';
  if (name === 'NotFoundError') return 'ไม่พบกล้องบนอุปกรณ์นี้';
  if (name === 'NotReadableError') return 'กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปนั้นแล้วลองใหม่';
  return 'ไม่สามารถเปิดกล้องได้ กรุณาลองใหม่';
}

async function openRearCamera(): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'NotSupportedError' });
  // Rear camera only: patrol evidence must show the checkpoint, never a selfie.
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function isFrontFacing(stream: MediaStream) {
  const settings = stream.getVideoTracks()[0]?.getSettings?.();
  return settings?.facingMode === 'user';
}

function currentPosition(): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }));
}

function newScanId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function CameraStage({ mode, onQr, onPhoto, onCancel }: { mode: 'qr' | 'photo'; onQr?: (value: string) => void; onPhoto?: (blob: Blob, previewUrl: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'starting' | 'live' | 'error'>('starting');
  const [message, setMessage] = useState<string>();
  const [frontCamera, setFrontCamera] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (async () => {
      try {
        const stream = await openRearCamera();
        if (!active) { stopStream(stream); return; }
        streamRef.current = stream;
        setFrontCamera(isFrontFacing(stream));
        const video = videoRef.current!;
        video.srcObject = stream; video.muted = true; video.playsInline = true;
        await video.play();
        if (!active) return;
        setState('live');
        if (mode === 'qr') {
          timer = window.setInterval(() => {
            const canvas = canvasRef.current;
            if (!canvas || video.readyState < 2 || !video.videoWidth) return;
            const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const decoded = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
            const value = decoded?.data?.trim();
            if (!value) return;
            const payload = parsePatrolQr(value);
            if (!payload) { setMessage('QR นี้ไม่ใช่ QR จุดตรวจ กรุณาสแกนป้ายจุดตรวจของระบบ SMS'); return; }
            window.clearInterval(timer); timer = undefined;
            onQr?.(payload);
          }, SCAN_INTERVAL_MS);
        }
      } catch (error) {
        if (!active) return;
        setState('error'); setMessage(cameraError(error));
      }
    })();
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
      stopStream(streamRef.current); streamRef.current = null;
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const capture = async () => {
    const video = videoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || capturing) return;
    setCapturing(true);
    try {
      const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('ไม่สามารถเตรียมภาพได้');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToOptimizedJpeg(canvas, 'ATTENDANCE_FACE');
      onPhoto?.(blob, URL.createObjectURL(blob));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ถ่ายภาพไม่สำเร็จ');
    } finally { setCapturing(false); }
  };

  return createPortal(<div className="patrol-camera" role="dialog" aria-modal="true" aria-label={mode === 'qr' ? 'สแกน QR จุดตรวจ' : 'ถ่ายรูปจุดตรวจ'}>
    <header className="patrol-camera__head">
      <div><span className="patrol-camera__step">{mode === 'qr' ? 'ขั้นที่ 1 จาก 2' : 'ขั้นที่ 2 จาก 2'}</span><strong>{mode === 'qr' ? 'สแกน QR จุดตรวจ' : 'ถ่ายรูปจุดตรวจ'}</strong></div>
      <button type="button" className="patrol-camera__close" onClick={onCancel} aria-label="ปิดกล้อง"><SmsIcon name="close" size={22} /></button>
    </header>
    <div className={`patrol-camera__view patrol-camera__view--${mode}`}>
      <video ref={videoRef} autoPlay muted playsInline />
      <canvas ref={canvasRef} hidden />
      {mode === 'qr' && state === 'live' && <div className="patrol-camera__target" aria-hidden="true"><i /><i /><i /><i /></div>}
      {state === 'starting' && <div className="patrol-camera__status">กำลังเปิดกล้องหลัง…</div>}
      {state === 'error' && <div className="patrol-camera__status patrol-camera__status--error">{message}</div>}
    </div>
    <footer className="patrol-camera__foot">
      {message && state !== 'error' && <p className="patrol-camera__hint patrol-camera__hint--warn" role="status">{message}</p>}
      {frontCamera && mode === 'photo' && <p className="patrol-camera__hint patrol-camera__hint--warn" role="alert">อุปกรณ์เปิดกล้องหน้า ระบบต้องการภาพจุดตรวจ ไม่ใช่ภาพตัวเอง กรุณาใช้กล้องหลัง</p>}
      {mode === 'qr'
        ? <p className="patrol-camera__hint">เล็ง QR ที่ป้ายจุดตรวจให้อยู่ในกรอบ ระบบจะอ่านอัตโนมัติ</p>
        : <>
          <p className="patrol-camera__hint">ถ่ายให้เห็นสภาพจุดตรวจ 1 รูป (กล้องหลังเท่านั้น)</p>
          <button type="button" className="patrol-camera__shutter" disabled={state !== 'live' || capturing || frontCamera} onClick={() => void capture()} aria-label="ถ่ายรูป"><span /></button>
        </>}
    </footer>
  </div>, document.body);
}

function minutesUntil(iso: string, now: number) {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ชม. ${minutes % 60} นาที` : `${minutes} นาที`;
}

/** Current 3-hour round for the guard's department: what is still left to check. */
export function PatrolRoundCard({ progress, department, onDepartment, now = Date.now() }: { progress?: PatrolProgress; department: string; onDepartment: (value: string) => void; now?: number }) {
  if (!progress) return null;
  const done = progress.checkpoints.filter((item) => item.doneThisRound).length;
  const total = progress.checkpoints.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return <section className="patrol-round-card" aria-labelledby="patrol-round-title">
    <header>
      <div>
        <p className="patrol-round-card__kicker">รอบที่ {progress.round}/{progress.rounds} · {progress.roundLabel} น.</p>
        <h2 id="patrol-round-title">ตรวจแล้ว {done}/{total} จุด</h2>
        <p className="patrol-muted">เหลือเวลารอบนี้ {durationLabel(minutesUntil(progress.roundEnd, now))}</p>
      </div>
      <label className="patrol-field patrol-round-card__dept"><span>จุดปฏิบัติงาน</span><select value={department || progress.department || ''} onChange={(event) => onDepartment(event.target.value)}>{progress.departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    </header>
    <div className="patrol-round-card__bar" role="progressbar" aria-label="ความคืบหน้ารอบนี้" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
    {total === 0 ? <p className="patrol-empty">จุดปฏิบัติงานนี้ยังไม่มีจุดตรวจ</p> : <ul className="patrol-round-card__list">
      {progress.checkpoints.map((item) => <li key={item.id} className={item.doneThisRound ? 'is-done' : 'is-pending'}>
        <span className="patrol-round-card__mark" aria-hidden="true">{item.doneThisRound ? '✓' : ''}</span>
        <span className="patrol-round-card__name"><strong>{item.code}</strong> {item.name}</span>
        <span className="patrol-round-card__state">{item.doneThisRound ? `${thaiTime(item.lastScanAt)} น.` : 'ยังไม่ตรวจ'}</span>
      </li>)}
    </ul>}
  </section>;
}

export function PatrolScanPage({ token }: { token: string }) {
  const [step, setStep] = useState<Step>('idle');
  const [qrPayload, setQrPayload] = useState('');
  const [checkpoint, setCheckpoint] = useState<PatrolCheckpoint>();
  const [photo, setPhoto] = useState<{ blob: Blob; url: string }>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<RequestErrorInput>();
  const [result, setResult] = useState<PatrolScan>();
  const [history, setHistory] = useState<PatrolScan[]>([]);
  const scanIdRef = useRef<string>('');
  const today = bangkokToday();

  const [progress, setProgress] = useState<PatrolProgress>();
  const [progressDepartment, setProgressDepartment] = useState('');
  const loadHistory = useCallback(() => {
    patrolApi.myScans(token, today).then(setHistory).catch(() => undefined);
    patrolApi.progress(token, progressDepartment || undefined).then(setProgress).catch(() => undefined);
  }, [token, today, progressDepartment]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => {
    const timer = window.setInterval(() => { patrolApi.progress(token, progressDepartment || undefined).then(setProgress).catch(() => undefined); }, 60_000);
    return () => window.clearInterval(timer);
  }, [token, progressDepartment]);
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);

  const reset = () => {
    setStep('idle'); setQrPayload(''); setCheckpoint(undefined); setNote(''); setError(undefined);
    setPhoto((current) => { if (current?.url) URL.revokeObjectURL(current.url); return undefined; });
  };

  const onQr = async (payload: string) => {
    setError(undefined);
    try {
      const found = await patrolApi.resolve(token, payload);
      setQrPayload(payload); setCheckpoint(found); scanIdRef.current = newScanId(); setStep('photo');
    } catch (reason) {
      setError(toRequestErrorState(reason, 'QR นี้ไม่ใช่จุดตรวจที่ใช้งานอยู่')); setStep('idle');
    }
  };

  const submit = async () => {
    if (!photo || !checkpoint) return;
    setStep('saving'); setError(undefined);
    const position = await currentPosition();
    try {
      const saved = await patrolApi.scan(token, {
        qrPayload,
        clientScanId: scanIdRef.current,
        latitude: position?.coords.latitude,
        longitude: position?.coords.longitude,
        accuracyMeters: position?.coords.accuracy,
        note
      }, photo.blob);
      setResult(saved); setStep('done'); loadHistory();
    } catch (reason) {
      setError(toRequestErrorState(reason, 'บันทึกการตรวจไม่สำเร็จ กรุณาลองส่งอีกครั้ง')); setStep('review');
    }
  };

  return <section className="patrol-scan-page view-pane" aria-label="สแกนจุดตรวจ">
    <header className="patrol-hero">
      <div className="patrol-hero__icon" aria-hidden="true"><SmsIcon name="qr" size={26} /></div>
      <div>
        <p className="patrol-hero__kicker">ตรวจจุด · {thaiDate(today, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <h1>สแกนจุดตรวจ</h1>
        <p>สแกน QR ที่ป้ายจุดตรวจ แล้วถ่ายรูปสภาพจุดนั้น 1 รูป สแกนจุดของจุดปฏิบัติงานอื่นได้</p>
      </div>
    </header>

    {error && <div className="patrol-alert" role="alert"><SmsIcon name="shield" size={18} /><div><RequestErrorContent error={error} /></div></div>}

    {step === 'done' && result ? <div className="patrol-success" role="status">
      <div className="patrol-success__badge" aria-hidden="true"><SmsIcon name="check" size={30} /></div>
      <h2>บันทึกการตรวจแล้ว</h2>
      <p><strong>{result.checkpointCode}</strong> · {result.checkpointName}</p>
      <p className="patrol-muted">จุดปฏิบัติงาน {result.checkpointDepartment} · เวลา {thaiTime(result.scannedAt)} น.{result.replayed ? ' · (บันทึกไว้ก่อนหน้าแล้ว)' : ''}</p>
      <button type="button" className="btn-primary patrol-cta" onClick={reset}><SmsIcon name="qr" size={20} />สแกนจุดถัดไป</button>
    </div> : step === 'review' || step === 'saving' ? <div className="patrol-review">
      <div className="patrol-review__checkpoint">
        <span className="patrol-chip">{checkpoint?.department}</span>
        <h2>{checkpoint?.code} · {checkpoint?.name}</h2>
        {checkpoint?.locationNote && <p className="patrol-muted">{checkpoint.locationNote}</p>}
      </div>
      {photo && <img className="patrol-review__photo" src={photo.url} alt="รูปจุดตรวจที่ถ่าย" />}
      <label className="patrol-field"><span>หมายเหตุ (ถ้ามี)</span><textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ประตูล็อกเรียบร้อย / พบสิ่งผิดปกติ" /></label>
      <div className="patrol-review__actions">
        <button type="button" className="btn-neutral" disabled={step === 'saving'} onClick={() => setStep('photo')}>ถ่ายใหม่</button>
        <button type="button" className="btn-primary" disabled={step === 'saving'} aria-busy={step === 'saving' || undefined} onClick={() => void submit()}>{step === 'saving' ? 'กำลังบันทึก…' : 'ยืนยันการตรวจ'}</button>
      </div>
    </div> : <div className="patrol-start">
      <button type="button" className="patrol-start__button" onClick={() => { setError(undefined); setStep('scanQr'); }}>
        <span className="patrol-start__ring" aria-hidden="true"><SmsIcon name="qr" size={44} /></span>
        <strong>เริ่มสแกน QR</strong>
        <small>ใช้กล้องหลัง · ต้องถ่ายรูปทุกจุด</small>
      </button>
      <ol className="patrol-steps" aria-label="ขั้นตอน">
        <li><b>1</b>สแกน QR ที่ป้ายจุดตรวจ</li>
        <li><b>2</b>ถ่ายรูปสภาพจุดตรวจ 1 รูป</li>
        <li><b>3</b>ตรวจสอบแล้วกดยืนยัน</li>
      </ol>
    </div>}

    {(step === 'idle' || step === 'scanQr' || step === 'photo') && <PatrolRoundCard progress={progress} department={progressDepartment} onDepartment={setProgressDepartment} />}

    <section className="patrol-history" aria-labelledby="patrol-history-title">
      <header><h2 id="patrol-history-title">ที่ตรวจแล้ววันนี้</h2><span className="patrol-chip patrol-chip--count">{history.length} จุด</span></header>
      {history.length === 0 ? <p className="patrol-empty">ยังไม่มีการตรวจวันนี้</p> : <ul>
        {history.map((scan) => <li key={scan.id}>
          <span className="patrol-history__time">{thaiTime(scan.scannedAt)}</span>
          <span className="patrol-history__name"><strong>{scan.checkpointCode}</strong> {scan.checkpointName}</span>
          <span className="patrol-chip">{scan.checkpointDepartment}</span>
        </li>)}
      </ul>}
    </section>

    {step === 'scanQr' && <CameraStage mode="qr" onQr={(value) => void onQr(value)} onCancel={() => setStep('idle')} />}
    {step === 'photo' && <CameraStage mode="photo" onPhoto={(blob, url) => { setPhoto((current) => { if (current?.url) URL.revokeObjectURL(current.url); return { blob, url }; }); setStep('review'); }} onCancel={() => setStep(photo ? 'review' : 'idle')} />}
  </section>;
}
