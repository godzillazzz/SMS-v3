import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SmsIcon } from '../../components/SmsIcon';
import type { AttendanceActiveChallenge } from './attendance-client';
import { ATTACHMENT_POLICIES, canvasToOptimizedJpeg } from '../../lib/attachment-optimizer';

type CapturedFaceEvidence = {
  photo: Blob;
  challengeFrames: Blob[];
};

type Props = {
  open: boolean;
  busy?: boolean;
  challenge: AttendanceActiveChallenge | null;
  rehearsalOnly?: boolean;
  autoFlow?: boolean;
  onConfirm: (evidence: CapturedFaceEvidence) => Promise<void>;
  onFailure?: (message: string) => void;
  onClose: () => void;
};

const MAX_CAPTURE_EDGE = ATTACHMENT_POLICIES.ATTENDANCE_FACE.maxEdge;
const PREPARE_DELAY_MS = 1800;
const MOVEMENT_START_DELAY_MS = 300;
const MOVEMENT_FRAME_INTERVAL_MS = 420;
const RETURN_TO_CENTER_DELAY_MS = 1200;

type CapturePhase = 'idle' | 'prepare' | 'movement' | 'neutral';

const challengeCopy: Record<string, { title: string; detail: string }> = {
  TURN_LEFT: { title: 'หันหน้าไปทางซ้าย', detail: 'หันหน้าไปทางซ้ายและค้างไว้จนระบบเก็บภาพครบ จากนั้นกลับมามองตรงเมื่อมีข้อความแจ้ง' },
  TURN_RIGHT: { title: 'หันหน้าไปทางขวา', detail: 'หันหน้าไปทางขวาและค้างไว้จนระบบเก็บภาพครบ จากนั้นกลับมามองตรงเมื่อมีข้อความแจ้ง' },
  LOOK_UP: { title: 'เงยหน้าขึ้นเล็กน้อย', detail: 'เงยหน้าขึ้นและค้างไว้จนระบบเก็บภาพครบ จากนั้นกลับมามองตรงเมื่อมีข้อความแจ้ง' },
  LOOK_DOWN: { title: 'ก้มหน้าลงเล็กน้อย', detail: 'ก้มหน้าลงและค้างไว้จนระบบเก็บภาพครบ จากนั้นกลับมามองตรงเมื่อมีข้อความแจ้ง' }
};

function cameraErrorMessage(reason: unknown) {
  const name = reason instanceof DOMException ? reason.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'ไม่ได้รับสิทธิ์กล้องหน้า กรุณาอนุญาต Camera สำหรับเว็บไซต์นี้';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'ไม่พบกล้องหน้าที่พร้อมใช้งานบนอุปกรณ์นี้';
  if (name === 'NotReadableError') return 'กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปกล้องแล้วลองใหม่';
  return reason instanceof Error ? reason.message : 'ไม่สามารถเปิดกล้องหน้าได้';
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function AttendanceFaceCapture({ open, busy = false, challenge, rehearsalOnly = false, autoFlow = false, onConfirm, onFailure, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const cameraRequestEpochRef = useRef(0);
  const captureSequenceEpochRef = useRef(0);
  const autoStartedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [starting, setStarting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle');
  const [captureProgress, setCaptureProgress] = useState(0);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [challengeFrames, setChallengeFrames] = useState<Blob[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  onCloseRef.current = onClose;

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const purgeCanvas = () => {
    if (!canvasRef.current) return;
    canvasRef.current.width = 1;
    canvasRef.current.height = 1;
  };

  const clearCapturedEvidence = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setPhoto(null);
    setChallengeFrames([]);
    setCaptureProgress(0);
    setCapturePhase('idle');
    purgeCanvas();
  };

  const invalidateCaptureSequence = () => {
    captureSequenceEpochRef.current += 1;
    setCapturing(false);
    setCapturePhase('idle');
  };

  const startCamera = async () => {
    const cameraEpoch = cameraRequestEpochRef.current + 1;
    cameraRequestEpochRef.current = cameraEpoch;
    invalidateCaptureSequence();
    setError(undefined);
    setStarting(true);
    stopStream();
    clearCapturedEvidence();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('เบราว์เซอร์นี้ไม่รองรับกล้องที่ระบบต้องใช้');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 720 },
          height: { ideal: 960 }
        }
      });
      if (cameraEpoch !== cameraRequestEpochRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    } catch (reason) {
      if (cameraEpoch !== cameraRequestEpochRef.current) return;
      stopStream();
      const message = cameraErrorMessage(reason);
      setError(message);
      if (autoFlow) { onFailure?.(message); onCloseRef.current(); }
    } finally {
      if (cameraEpoch === cameraRequestEpochRef.current) setStarting(false);
    }
  };

  useEffect(() => {
    if (!open) {
      cameraRequestEpochRef.current += 1;
      invalidateCaptureSequence();
      stopStream();
      clearCapturedEvidence();
      setError(undefined);
      return;
    }
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void startCamera();

    const stopAndCloseForLifecycle = () => {
      cameraRequestEpochRef.current += 1;
      invalidateCaptureSequence();
      stopStream();
      clearCapturedEvidence();
      document.body.style.overflow = previousBodyOverflow;
      onCloseRef.current();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopAndCloseForLifecycle();
    };
    const handlePageHide = () => stopAndCloseForLifecycle();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      cameraRequestEpochRef.current += 1;
      captureSequenceEpochRef.current += 1;
      stopStream();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      purgeCanvas();
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  const captureFrame = async (): Promise<Blob> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) throw new Error('ภาพจากกล้องหน้ายังไม่พร้อม กรุณารอสักครู่แล้วลองใหม่');
    const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      purgeCanvas();
      throw new Error('ไม่สามารถเตรียมภาพสดสำหรับตรวจใบหน้าได้');
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToOptimizedJpeg(canvas, 'ATTENDANCE_FACE');
    purgeCanvas();
    if (!blob || blob.size < 64) throw new Error('ถ่ายภาพสดไม่สำเร็จ กรุณาลองใหม่');
    return blob;
  };

  const captureChallenge = async () => {
    if (capturing || busy || starting) return;
    if (!challenge || challenge.frameCount !== 4 || !challengeCopy[challenge.code]) {
      setError('คำสั่ง Active Challenge จาก Server ไม่ถูกต้อง กรุณาเริ่มการลงเวลาใหม่');
      return;
    }
    const sequenceEpoch = captureSequenceEpochRef.current + 1;
    captureSequenceEpochRef.current = sequenceEpoch;
    clearCapturedEvidence();
    setError(undefined);
    setCapturing(true);
    setCapturePhase('prepare');
    const frames: Blob[] = [];
    try {
      await sleep(PREPARE_DELAY_MS);
      if (sequenceEpoch !== captureSequenceEpochRef.current) return;
      setCapturePhase('movement');
      for (let index = 0; index < challenge.frameCount; index += 1) {
        await sleep(index === 0 ? MOVEMENT_START_DELAY_MS : MOVEMENT_FRAME_INTERVAL_MS);
        if (sequenceEpoch !== captureSequenceEpochRef.current) return;
        const frame = await captureFrame();
        if (sequenceEpoch !== captureSequenceEpochRef.current) return;
        frames.push(frame);
        setCaptureProgress(index + 1);
      }
      setCapturePhase('neutral');
      await sleep(RETURN_TO_CENTER_DELAY_MS);
      if (sequenceEpoch !== captureSequenceEpochRef.current) return;
      const finalPhoto = await captureFrame();
      if (sequenceEpoch !== captureSequenceEpochRef.current) return;
      stopStream();
      if (autoFlow) {
        try { await onConfirm({ photo: finalPhoto, challengeFrames: [...frames] }); }
        catch (reason) {
          const message = reason instanceof Error ? reason.message : 'ไม่สามารถตรวจ Active Challenge และใบหน้าได้';
          setError(message);
          onFailure?.(message);
          onCloseRef.current();
        } finally {
          setChallengeFrames([]);
          setPhoto(null);
          setCaptureProgress(0);
          purgeCanvas();
        }
        return;
      }
      const nextUrl = URL.createObjectURL(finalPhoto);
      previewUrlRef.current = nextUrl;
      setChallengeFrames(frames);
      setPhoto(finalPhoto);
      setPreviewUrl(nextUrl);
    } catch (reason) {
      if (sequenceEpoch !== captureSequenceEpochRef.current) return;
      const message = reason instanceof Error ? reason.message : 'ไม่สามารถเก็บลำดับภาพ Active Challenge ได้';
      setError(message);
      clearCapturedEvidence();
      if (autoFlow) { onFailure?.(message); onCloseRef.current(); }
    } finally {
      if (sequenceEpoch === captureSequenceEpochRef.current) {
        setCapturing(false);
        setCapturePhase('idle');
      }
    }
  };

  useEffect(() => {
    if (!open || !autoFlow || busy || starting || capturing || error || !challenge || !streamRef.current || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void captureChallenge();
  }, [open, autoFlow, busy, starting, capturing, error, challenge]);

  useEffect(() => {
    if (!open) autoStartedRef.current = false;
  }, [open]);

  const retake = async () => {
    if (busy) return;
    invalidateCaptureSequence();
    clearCapturedEvidence();
    await startCamera();
  };

  const closeNow = () => {
    if (busy) return;
    cameraRequestEpochRef.current += 1;
    invalidateCaptureSequence();
    stopStream();
    clearCapturedEvidence();
    onClose();
  };

  const confirm = async () => {
    if (!photo || busy || !challenge || challengeFrames.length !== challenge.frameCount) return;
    setError(undefined);
    try {
      await onConfirm({ photo, challengeFrames: [...challengeFrames] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : rehearsalOnly ? 'ไม่สามารถส่งชุดภาพ Active Challenge UAT ได้' : 'ไม่สามารถตรวจ Active Challenge และใบหน้าได้');
    }
  };

  if (!open) return null;
  const activeCopy = challenge ? challengeCopy[challenge.code] : null;
  const captureStatus = capturePhase === 'prepare'
    ? `เตรียมทำท่า: ${activeCopy?.title || 'รอคำสั่ง'} · มีเวลาเตรียมตัวก่อนเริ่มเก็บภาพ`
    : capturePhase === 'movement'
      ? `ค้างท่าตามคำสั่ง · กำลังเก็บภาพ ${captureProgress}/${challenge?.frameCount || 4}`
      : capturePhase === 'neutral'
        ? 'กลับมามองตรงที่กล้องและค้างไว้ · กำลังเตรียมภาพยืนยันสุดท้าย'
        : 'กำลังเตรียม Active Challenge';

  return createPortal(<div className="attendance-face-backdrop" role="presentation">
    <section className="attendance-face-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-face-title">
      <header>
        <div><p>{rehearsalOnly ? 'ACTIVE CHALLENGE · PREVIEW UAT · MEMORY ONLY' : 'ยืนยันตัวตน'}</p><h2 id="attendance-face-title">{rehearsalOnly ? 'ทดสอบกล้องหน้า + Active Challenge' : 'ยืนยันใบหน้า'}</h2><span>{rehearsalOnly ? 'โหมดนี้ใช้ทดสอบกล้องและลำดับภาพเท่านั้น Server จะทิ้งภาพทันที ไม่เรียก Face Verifier ไม่ออก receipt และไม่สร้าง AttendanceEvent' : 'จัดใบหน้าให้อยู่ในกรอบ แล้วทำตามคำสั่งบนหน้าจอ ระบบจะใช้ภาพชั่วคราวเพื่อยืนยันตัวตนก่อนบันทึกเวลา'}</span></div>
        {!autoFlow && <button type="button" className="drawer-close overlay-close" disabled={busy} onClick={closeNow} aria-label="ปิด"><SmsIcon name="close" size={20} /></button>}
      </header>

      <div className="attendance-face-challenge" role="status">
        <span className="attendance-face-challenge__icon"><SmsIcon name="shield" size={20} /></span>
        <div><small>ทำตามคำสั่งบนหน้าจอ</small><strong>{activeCopy?.title || 'กำลังรอคำสั่งจาก Server'}</strong><p>{activeCopy?.detail || 'กรุณาเริ่มการลงเวลาใหม่หากคำสั่งไม่พร้อม'}</p></div>
      </div>

      <div className="attendance-face-camera">
        {previewUrl
          ? <img src={previewUrl} alt="ภาพสดสำหรับตรวจสอบก่อนส่ง" />
          : <video ref={videoRef} playsInline muted autoPlay />}
        <canvas ref={canvasRef} className="attendance-face-canvas" aria-hidden="true" />
        {!previewUrl && <div className="attendance-face-guide" aria-hidden="true"><span /></div>}
        {starting && <div className="attendance-face-status"><SmsIcon name="clock" size={22} /><span>กำลังเปิดกล้องหน้า…</span></div>}
        {capturing && <div className="attendance-face-status" aria-live="polite"><SmsIcon name="clock" size={22} /><span>{captureStatus}</span></div>}
      </div>

      {error && <div className="alert alert-error attendance-face-error" role="alert">{error}</div>}
      <div className="attendance-face-privacy"><SmsIcon name="shield" size={17} /><span>{rehearsalOnly ? 'ไม่มี file picker / Gallery และไม่มี localStorage, sessionStorage หรือ IndexedDB · UAT นี้ไม่มี Face PASS และไม่มี Attendance PASS' : 'ใช้กล้องเฉพาะขณะยืนยันตัวตน ภาพชั่วคราวจะถูกล้างเมื่อจบขั้นตอน ปิดหน้า หรือสลับแอป'}</span></div>

      {!autoFlow && <footer>
        {previewUrl
          ? <><button type="button" className="btn-neutral" disabled={busy} onClick={() => void retake()}>ทำ Challenge ใหม่</button><button type="button" className="btn-primary" disabled={busy || !photo || challengeFrames.length !== challenge?.frameCount} onClick={() => void confirm()}><SmsIcon name="shield" size={17} />{busy ? (rehearsalOnly ? 'กำลังส่งชุดภาพ UAT…' : 'กำลังส่งให้ Server ตรวจ…') : (rehearsalOnly ? 'ส่งชุดภาพ UAT และทิ้งทันที' : 'ยืนยันและส่งตรวจ')}</button></>
          : <><button type="button" className="btn-neutral" disabled={busy} onClick={closeNow}>ยกเลิก</button><button type="button" className="btn-primary" disabled={busy || starting || capturing || Boolean(error) || !activeCopy} onClick={() => void captureChallenge()}><SmsIcon name="quality" size={17} />{capturing ? 'กำลังทำ Challenge…' : 'เริ่ม Active Challenge'}</button></>}
      </footer>}
    </section>
  </div>, document.body);
}
